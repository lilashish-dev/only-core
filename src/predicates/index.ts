/**
 * only-core — Predicate Execution Module
 *
 * Handles the execution of predicate rules (.where()).
 *
 * Predicates (.where()):
 *   - For deterministic local state checks
 *   - Synchronous only
 *   - Cheap, no external I/O
 *   - No timeout required
 *   - Examples: amount > 0, items.length > 0, status === "draft"
 *
 * Semantic distinction from guards:
 *   .only()  → external/domain enforcement (potentially async, expensive)
 *   .where() → context state must satisfy a condition (sync, cheap)
 */

import type { PredicateRule, ViolationDetail } from '../types.js';
import { PolicyViolationError, PolicyExecutionError } from '../errors/index.js';
import type { ErrorInfo } from '../errors/index.js';
import { TelemetryEmitter, createEvent } from '../telemetry/index.js';

interface PredicateExecutionOptions {
  readonly policyName: string;
  readonly executionId: string;
  readonly telemetry: TelemetryEmitter;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Executes all predicate rules synchronously.
 * All predicates are always evaluated (no fail-fast for predicates
 * in aggregate mode), and all violations are collected.
 *
 * @throws {PolicyViolationError} When one or more predicates fail
 * @throws {PolicyExecutionError} When a predicate throws unexpectedly
 */
export function executePredicates<TContext>(
  predicates: readonly PredicateRule<TContext>[],
  context: Readonly<TContext>,
  options: PredicateExecutionOptions
): void {
  if (predicates.length === 0) return;

  const violations: ViolationDetail[] = [];

  for (const predicate of predicates) {
    const info: ErrorInfo = {
      policy: options.policyName,
      executionId: options.executionId,
      phase: 'predicate',
      ruleId: predicate.id,
      rule: predicate.id,
    };

    if (options.telemetry.hasListeners) {
      options.telemetry.emit(
        createEvent('predicate:start', options.policyName, options.executionId, {
          ruleId: predicate.id,
        }, options.metadata)
      );
    }

    const startTime = Date.now();

    try {
      const result = predicate.fn(context);

      if (result === true) {
        if (options.telemetry.hasListeners) {
          options.telemetry.emit(
            createEvent('predicate:success', options.policyName, options.executionId, {
              ruleId: predicate.id,
              duration: Date.now() - startTime,
            }, options.metadata)
          );
        }
        continue;
      }

      // Predicate failed
      const reason =
        typeof result === 'string'
          ? result
          : `Predicate '${predicate.id}' rejected the context`;

      if (options.telemetry.hasListeners) {
        options.telemetry.emit(
          createEvent('predicate:failure', options.policyName, options.executionId, {
            ruleId: predicate.id,
            duration: Date.now() - startTime,
            reason,
          }, options.metadata)
        );
      }

      violations.push({
        ruleId: predicate.id,
        phase: 'predicate',
        reason,
      });
    } catch (error) {
      // Predicate exceptions are execution failures, not policy violations
      throw new PolicyExecutionError(
        `Predicate '${predicate.id}' threw an unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        info,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  if (violations.length > 0) {
    const reasons = violations.map((v) => v.reason).join('; ');
    throw new PolicyViolationError(
      `Policy '${options.policyName}' violated: ${reasons}`,
      violations,
      {
        policy: options.policyName,
        executionId: options.executionId,
        phase: 'predicate',
      }
    );
  }
}
