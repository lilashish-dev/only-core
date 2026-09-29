/**
 * only-core — Guard Execution Module
 *
 * Handles the execution of guard rules (.only()) in both sequential
 * and parallel modes.
 *
 * Guards (.only()):
 *   - May involve external state (auth, db, APIs)
 *   - Potentially asynchronous
 *   - Timeout-aware
 *   - Cancellation-aware
 *   - Can throw (execution error, not policy violation)
 *   - Treated as critical enforcement boundaries
 *
 * Contract:
 *   - Guards running in parallel must be independent
 *   - A guard must not mutate the context or depend on side effects
 *     produced by another guard
 *   - A returned negative verdict = policy rejection
 *   - An exception = execution failure (unless configured otherwise)
 */

import type {
  GuardRule,
  ExecutionMode,
  FailureStrategy,
  ViolationDetail,
} from '../types.js';
import {
  PolicyViolationError,
  PolicyExecutionError,
  PolicyTimeoutError,
} from '../errors/index.js';
import type { ErrorInfo } from '../errors/index.js';
import { createLinkedAbortController, raceWithSignal, throwIfAborted } from '../cancellation/index.js';
import { TelemetryEmitter, createEvent } from '../telemetry/index.js';

interface GuardExecutionOptions {
  readonly mode: ExecutionMode;
  readonly concurrency: number;
  readonly failureStrategy: FailureStrategy;
  readonly globalTimeoutMs: number;
  readonly signal: AbortSignal;
  readonly policyName: string;
  readonly executionId: string;
  readonly telemetry: TelemetryEmitter;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Executes all guard rules according to the configured mode and failure strategy.
 *
 * @throws {PolicyViolationError} When one or more guards reject the context
 * @throws {PolicyExecutionError} When a guard throws an unexpected error
 * @throws {PolicyTimeoutError} When execution exceeds the timeout
 * @throws {PolicyCancelledError} When execution is cancelled via signal
 */
export async function executeGuards<TContext>(
  guards: readonly GuardRule<TContext>[],
  context: Readonly<TContext>,
  options: GuardExecutionOptions
): Promise<void> {
  if (guards.length === 0) return;

  throwIfAborted(options.signal, {
    policy: options.policyName,
    executionId: options.executionId,
    phase: 'guard',
  });

  if (options.mode === 'parallel') {
    await executeGuardsParallel(guards, context, options);
  } else {
    await executeGuardsSequential(guards, context, options);
  }
}

/**
 * Sequential guard execution: runs guards one after another.
 * Stops on first failure when failureStrategy is 'fail-fast'.
 */
async function executeGuardsSequential<TContext>(
  guards: readonly GuardRule<TContext>[],
  context: Readonly<TContext>,
  options: GuardExecutionOptions
): Promise<void> {
  const violations: ViolationDetail[] = [];

  for (const guard of guards) {
    throwIfAborted(options.signal, {
      policy: options.policyName,
      executionId: options.executionId,
      phase: 'guard',
      ruleId: guard.id,
    });

    const result = await executeSingleGuard(guard, context, options);

    if (result !== null) {
      violations.push(result);

      if (options.failureStrategy === 'fail-fast') {
        throwViolation(violations, options);
      }
    }
  }

  if (violations.length > 0) {
    throwViolation(violations, options);
  }
}

/**
 * Parallel guard execution: runs all guards concurrently with bounded concurrency.
 *
 * Implements true fail-fast cancellation by using a local AbortController to abort
 * other running guards if one fails.
 * 
 * IMPORTANT: Guards running in parallel must be independent.
 */
async function executeGuardsParallel<TContext>(
  guards: readonly GuardRule<TContext>[],
  context: Readonly<TContext>,
  options: GuardExecutionOptions
): Promise<void> {
  const parallelController = createLinkedAbortController(options.signal);
  const parallelSignal = parallelController.signal;

  const parallelOptions = { ...options, signal: parallelSignal };
  const orderedResults: (ViolationDetail | null | undefined)[] = new Array(guards.length);
  const rejections: (unknown | undefined)[] = new Array(guards.length);
  let nextIndex = 0;
  let firstViolation: ViolationDetail | undefined;
  let firstError: unknown;

  const runWorker = async (): Promise<void> => {
    while (!parallelSignal.aborted) {
      const index = nextIndex++;
      if (index >= guards.length) return;

      try {
        const result = await executeSingleGuard(guards[index], context, parallelOptions);
        orderedResults[index] = result;

        if (result && options.failureStrategy === 'fail-fast') {
          firstViolation ??= result;
          parallelController.abort();
          return;
        }
      } catch (error) {
        rejections[index] = error;
        if (options.failureStrategy === 'fail-fast') {
          // A sibling can reject with cancellation after the first failure
          // aborts the shared signal. Preserve that original failure.
          if (firstViolation || firstError !== undefined) return;
          firstError ??= error;
          parallelController.abort();
          return;
        }
      }
    }
  };

  try {
    const workerCount = Math.min(guards.length, options.concurrency);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    if (options.failureStrategy === 'fail-fast') {
      if (firstError !== undefined) throw firstError;
      if (firstViolation) throwViolation([firstViolation], options);
    } else {
      const violations: ViolationDetail[] = [];
      for (let i = 0; i < guards.length; i++) {
        if (rejections[i]) {
          const err = rejections[i];
          const errorCode =
            err !== null && typeof err === 'object' && 'code' in err
              ? (err as { code?: unknown }).code
              : undefined;
          if (
            err instanceof PolicyExecutionError ||
            errorCode === 'POLICY_TIMEOUT' ||
            errorCode === 'POLICY_CANCELLED'
          ) {
            throw err;
          }
        }
        const result = orderedResults[i];
        if (result != null) violations.push(result);
      }
      if (violations.length > 0) {
        throwViolation(violations, options);
      }
    }
  } finally {
    if (!parallelController.signal.aborted) {
      parallelController.abort();
    }
  }
}

/**
 * Executes a single guard and returns a violation detail if it fails,
 * or null if it passes.
 *
 * Each guard receives its own AbortController linked to the parent signal.
 * Per-rule timeouts abort the per-guard controller so the guard's signal
 * reflects cancellation, and the timer is always cleared in the finally block.
 */
async function executeSingleGuard<TContext>(
  guard: GuardRule<TContext>,
  context: Readonly<TContext>,
  options: GuardExecutionOptions
): Promise<ViolationDetail | null> {
  const info: ErrorInfo = {
    policy: options.policyName,
    executionId: options.executionId,
    phase: 'guard',
    ruleId: guard.id,
    rule: guard.id,
  };

  const startTime = Date.now();

  if (options.telemetry.hasListeners) {
    options.telemetry.emit(
      createEvent('rule:start', options.policyName, options.executionId, {
        phase: 'guard',
        ruleId: guard.id,
      }, options.metadata)
    );
  }

  // ── Per-guard AbortController ─────────────────────────────────────
  // Linked to the parent signal so global timeout/cancellation propagates,
  // but also independently abortable for per-rule timeout.
  const guardController = createLinkedAbortController(options.signal);
  const guardSignal = guardController.signal;

  // ── Per-rule timeout ──────────────────────────────────────────────
  const ruleTimeout = guard.metadata.timeoutMs ?? options.globalTimeoutMs;
  let ruleTimer: ReturnType<typeof setTimeout> | undefined;

  if (ruleTimeout > 0 && Number.isFinite(ruleTimeout)) {
    ruleTimer = setTimeout(() => {
      const timeoutError = new PolicyTimeoutError(
        `Guard '${guard.id}' exceeded timeout of ${ruleTimeout}ms`,
        ruleTimeout,
        info
      );
      guardController.abort(timeoutError);
    }, ruleTimeout);
  }

  try {
    let result: boolean | string;

    // Execute the guard function — receives the per-guard signal
    const guardResult = guard.fn(context, guardSignal);

    // Handle thenables: normalize to Promise at the execution boundary
    if (
      guardResult !== null &&
      guardResult !== undefined &&
      typeof guardResult === 'object' &&
      'then' in guardResult &&
      typeof (guardResult as PromiseLike<unknown>).then === 'function'
    ) {
      const normalizedPromise = Promise.resolve(guardResult) as Promise<boolean | string>;
      result = await raceWithSignal(normalizedPromise, guardSignal, info);
    } else {
      result = guardResult as boolean | string;
    }

    // Evaluate the guard result
    if (result === true) {
      if (options.telemetry.hasListeners) {
        options.telemetry.emit(
          createEvent('rule:success', options.policyName, options.executionId, {
            phase: 'guard',
            ruleId: guard.id,
            duration: Date.now() - startTime,
          }, options.metadata)
        );
      }
      return null;
    }

    // Guard failed: returned false or a rejection reason string
    const reason =
      typeof result === 'string'
        ? result
        : `Guard '${guard.id}' rejected the context`;

    if (options.telemetry.hasListeners) {
      options.telemetry.emit(
        createEvent('rule:failure', options.policyName, options.executionId, {
          phase: 'guard',
          ruleId: guard.id,
          duration: Date.now() - startTime,
          reason,
        }, options.metadata)
      );
    }

    return { ruleId: guard.id, phase: 'guard', reason };
  } catch (error) {
    const duration = Date.now() - startTime;

    // Re-throw only-core errors (timeout, cancellation)
    if (error instanceof Error && 'code' in error) {
      const errorWithCode = error as Error & { code: string };
      if (
        errorWithCode.code === 'POLICY_TIMEOUT' ||
        errorWithCode.code === 'POLICY_CANCELLED'
      ) {
        if (options.telemetry.hasListeners) {
          options.telemetry.emit(
            createEvent(
              errorWithCode.code === 'POLICY_TIMEOUT' ? 'rule:timeout' : 'rule:failure',
              options.policyName,
              options.executionId,
              {
                phase: 'guard',
                ruleId: guard.id,
                duration,
                reason: error.message,
              },
              options.metadata
            )
          );
        }
        throw error;
      }
    }

    // Wrap unexpected errors as PolicyExecutionError
    // Semantic: guard exceptions are execution failures, not policy violations
    throw new PolicyExecutionError(
      `Guard '${guard.id}' threw an unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      info,
      error instanceof Error ? error : new Error(String(error))
    );
  } finally {
    // ── Cleanup ───────────────────────────────────────────────────
    // Invariant: per-rule timers cannot outlive the guard execution
    if (ruleTimer !== undefined) {
      clearTimeout(ruleTimer);
    }
    // Abort the per-guard controller to detach signal listeners
    if (!guardController.signal.aborted) {
      guardController.abort();
    }
  }
}

function throwViolation(
  violations: readonly ViolationDetail[],
  options: GuardExecutionOptions
): never {
  const reasons = violations.map((v) => v.reason).join('; ');
  throw new PolicyViolationError(
    `Policy '${options.policyName}' violated: ${reasons}`,
    violations,
    {
      policy: options.policyName,
      executionId: options.executionId,
      phase: 'guard',
    }
  );
}
