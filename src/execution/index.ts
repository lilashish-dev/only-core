/**
 * only-core — Execution Engine
 *
 * The core runtime that orchestrates the policy execution lifecycle.
 *
 * Execution lifecycle (state machine):
 *   create Execution → prepare context → run guards → run predicates
 *   → run action → emit completion → cleanup execution
 *
 * Central invariant:
 *   The action is never invoked unless every required enforcement stage
 *   has successfully completed.
 *
 * Additional invariants:
 *   - A single policy execution invokes .to() at most once (exactly-once semantics)
 *   - A running execution always releases execution bookkeeping
 *   - Timeouts cannot leave internal timers alive
 *   - Cancellation releases execution bookkeeping
 *   - Guard exceptions are never silently converted into successful results
 *   - One execution cannot accidentally execute the action twice
 */

import type {
  GuardRule,
  PredicateRule,
  ActionFn,
  ResolvedPolicyConfig,
  ExecuteOptions,
  PolicyResult,
  TelemetryListener,
} from '../types.js';
import {
  PolicyReentrancyError,
  PolicyCancelledError,
  PolicyExecutionError,
} from '../errors/index.js';
import type { ErrorInfo } from '../errors/index.js';
import { prepareContext } from '../context/index.js';
import {
  createLinkedAbortController,
  setupTimeout,
  throwIfAborted,
  raceWithSignal,
} from '../cancellation/index.js';
import { executeGuards } from '../guards/index.js';
import { executePredicates } from '../predicates/index.js';
import { TelemetryEmitter, createEvent } from '../telemetry/index.js';

/**
 * Generates a unique execution ID.
 * Uses crypto.randomUUID() when available, falls back to timestamp-based ID.
 */
function generateExecutionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `exec_${crypto.randomUUID()}`;
  }
  // Fallback for environments without crypto.randomUUID
  return `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The core execution engine.
 * Manages the complete lifecycle of a policy execution.
 */
export class ExecutionEngine<TContext, TResult> {
  readonly #config: ResolvedPolicyConfig;
  readonly #guards: readonly GuardRule<TContext>[];
  readonly #predicates: readonly PredicateRule<TContext>[];
  readonly #action: ActionFn<TContext, TResult>;
  readonly #policyName: string;
  readonly #telemetry: TelemetryEmitter;

  /**
   * WeakSet for reentrancy detection.
   * Tracks context objects currently being executed.
   *
   * Invariant: The library maintains no global execution registry.
   * This is per-engine, not global.
   */
  readonly #activeContexts = new WeakSet<object>();

  /**
   * Flag to track if the action has been invoked (exactly-once semantics).
   * This is per-execution, managed via the execution record.
   */
  #actionInvokedForExecution = new Map<string, boolean>();

  constructor(
    policyName: string,
    config: ResolvedPolicyConfig,
    guards: readonly GuardRule<TContext>[],
    predicates: readonly PredicateRule<TContext>[],
    action: ActionFn<TContext, TResult>,
    telemetry: TelemetryEmitter
  ) {
    this.#policyName = policyName;
    this.#config = config;
    this.#guards = guards;
    this.#predicates = predicates;
    this.#action = action;
    this.#telemetry = telemetry;
  }

  /**
   * Add a telemetry listener.
   */
  addListener(listener: TelemetryListener): void {
    this.#telemetry.addListener(listener);
  }

  /**
   * Execute the policy against the given context.
   *
   * Lifecycle:
   *   CREATED → PREPARING → GUARDING → PREDICATING → EXECUTING → COMPLETED
   *
   * @throws {PolicyViolationError} Guard or predicate rejects
   * @throws {PolicyTimeoutError} Execution exceeds timeout
   * @throws {PolicyCancelledError} Execution cancelled via signal
   * @throws {PolicyExecutionError} Guard/action throws unexpectedly
   * @throws {PolicyReentrancyError} Same context already executing
   * @throws {PolicyConfigurationError} Missing action or invalid config
   */
  async execute(
    context: TContext,
    options: ExecuteOptions = {}
  ): Promise<PolicyResult<TResult>> {
    const executionId = options.executionId ?? generateExecutionId();
    const startTime = Date.now();

    const info: ErrorInfo = {
      policy: this.#policyName,
      executionId,
    };

    // ── Reentrancy Check ──────────────────────────────────────────
    if (
      this.#config.reentrancy === 'reject' &&
      context !== null &&
      context !== undefined &&
      typeof context === 'object'
    ) {
      if (this.#activeContexts.has(context as object)) {
        throw new PolicyReentrancyError(
          `Policy '${this.#policyName}' is already executing with this context`,
          info
        );
      }
      this.#activeContexts.add(context as object);
    }

    // ── Create Linked Abort Controller ────────────────────────────
    const controller = createLinkedAbortController(options.signal);
    const signal = controller.signal;

    // ── Setup Timeout ─────────────────────────────────────────────
    const clearTimer = setupTimeout(controller, this.#config.timeoutMs, {
      ...info,
      phase: 'guard',
    });

    // ── Track exactly-once action invocation ──────────────────────
    this.#actionInvokedForExecution.set(executionId, false);

    // ── Emit policy:start ─────────────────────────────────────────
    if (this.#telemetry.hasListeners) {
      this.#telemetry.emit(
        createEvent('policy:start', this.#policyName, executionId, {}, options.metadata)
      );
    }

    try {
      // ── PREPARING: Context Preparation ─────────────────────────
      throwIfAborted(signal, info);
      const preparedContext = prepareContext(context, this.#config.contextStrategy);

      // ── GUARDING: Execute Guards ───────────────────────────────
      await executeGuards(this.#guards, preparedContext, {
        mode: this.#config.mode,
        concurrency: this.#config.concurrency,
        failureStrategy: this.#config.failureStrategy,
        globalTimeoutMs: this.#config.timeoutMs,
        signal,
        policyName: this.#policyName,
        executionId,
        telemetry: this.#telemetry,
        metadata: options.metadata,
      });

      // ── PREDICATING: Execute Predicates ────────────────────────
      throwIfAborted(signal, info);
      executePredicates(this.#predicates, preparedContext, {
        policyName: this.#policyName,
        executionId,
        telemetry: this.#telemetry,
        metadata: options.metadata,
      });

      // ── EXECUTING: Run Action ──────────────────────────────────
      throwIfAborted(signal, info);

      // Exactly-once check: ensure action hasn't already been invoked
      if (this.#actionInvokedForExecution.get(executionId)) {
        throw new PolicyExecutionError(
          `Action for execution '${executionId}' has already been invoked`,
          info
        );
      }
      this.#actionInvokedForExecution.set(executionId, true);

      if (this.#telemetry.hasListeners) {
        this.#telemetry.emit(
          createEvent('action:start', this.#policyName, executionId, {}, options.metadata)
        );
      }

      const actionStartTime = Date.now();
      let result: TResult;

      try {
        const actionResult = this.#action(preparedContext, signal);

        // Handle thenables at execution boundary
        if (
          actionResult !== null &&
          actionResult !== undefined &&
          typeof actionResult === 'object' &&
          'then' in actionResult &&
          typeof (actionResult as PromiseLike<unknown>).then === 'function'
        ) {
          result = await raceWithSignal(
            Promise.resolve(actionResult),
            signal,
            { ...info, phase: 'action' }
          );
        } else {
          result = actionResult as TResult;
        }
      } catch (actionError) {
        if (this.#telemetry.hasListeners) {
          this.#telemetry.emit(
            createEvent('action:failure', this.#policyName, executionId, {
              duration: Date.now() - actionStartTime,
              reason: actionError instanceof Error ? actionError.message : String(actionError),
            }, options.metadata)
          );
        }

        // Re-throw only-core errors (timeout, cancellation) as-is —
        // they already carry the correct structured error code.
        if (
          actionError instanceof PolicyCancelledError ||
          (actionError instanceof Error &&
            'code' in actionError &&
            ((actionError as Error & { code: string }).code === 'POLICY_TIMEOUT' ||
             (actionError as Error & { code: string }).code === 'POLICY_CANCELLED'))
        ) {
          throw actionError;
        }

        // Wrap unexpected action errors as PolicyExecutionError.
        // Semantic: an exception from the action is an execution failure,
        // and the original error is preserved as `cause` so stack traces
        // are not destroyed.
        throw new PolicyExecutionError(
          `Action in policy '${this.#policyName}' threw an unexpected error: ${actionError instanceof Error ? actionError.message : String(actionError)}`,
          { ...info, phase: 'action' },
          actionError instanceof Error ? actionError : new Error(String(actionError))
        );
      }

      if (this.#telemetry.hasListeners) {
        this.#telemetry.emit(
          createEvent('action:success', this.#policyName, executionId, {
            duration: Date.now() - actionStartTime,
          }, options.metadata)
        );
      }

      // ── COMPLETED ──────────────────────────────────────────────
      const duration = Date.now() - startTime;

      if (this.#telemetry.hasListeners) {
        this.#telemetry.emit(
          createEvent('policy:success', this.#policyName, executionId, {
            duration,
          }, options.metadata)
        );
      }

      return {
        success: true,
        value: result,
        executionId,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (this.#telemetry.hasListeners) {
        const isCancelled = error instanceof PolicyCancelledError;
        this.#telemetry.emit(
          createEvent(
            isCancelled ? 'policy:cancelled' : 'policy:failure',
            this.#policyName,
            executionId,
            {
              duration,
              reason: error instanceof Error ? error.message : String(error),
            },
            options.metadata
          )
        );
      }

      throw error;
    } finally {
      // ── CLEANUP ────────────────────────────────────────────────
      // Invariant: Timeouts cannot leave internal timers alive
      clearTimer();

      // Invariant: A running execution always releases execution bookkeeping
      if (
        this.#config.reentrancy === 'reject' &&
        context !== null &&
        context !== undefined &&
        typeof context === 'object'
      ) {
        this.#activeContexts.delete(context as object);
      }

      // Clean up exactly-once tracking
      this.#actionInvokedForExecution.delete(executionId);

      // Abort the controller to clean up any lingering listeners
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
  }
}
