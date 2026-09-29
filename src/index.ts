/**
 * only-core
 *
 * A zero-dependency, TypeScript-first policy execution engine
 * for enforcing preconditions before executing business actions.
 *
 * Central invariant:
 *   The action is never invoked unless every required enforcement
 *   stage has successfully completed.
 *
 * Pipeline:
 *   Context → Policy → Guards → Predicates → Action → Result
 *
 * @packageDocumentation
 */

// ─── Core API ───────────────────────────────────────────────────────────
export { policy } from './policy/index.js';

// ─── Types ──────────────────────────────────────────────────────────────
export type {
  // Context
  ContextStrategy,

  // Execution
  ExecutionMode,
  FailureStrategy,
  ExecutionState,
  ExecutionPhase,
  ReentrancyStrategy,

  // Rules
  GuardFn,
  PredicateFn,
  ActionFn,
  RuleMetadata,

  // Configuration
  PolicyConfig,
  ResolvedPolicyConfig,

  // Execution options
  ExecuteOptions,

  // Results
  PolicyResult,
  PolicyFailure,
  PolicyOutcome,
  ViolationDetail,

  // Introspection
  PolicyDescription,

  // Telemetry
  TelemetryEvent,
  TelemetryEventType,
  TelemetryListener,
  PolicyStartEvent,
  RuleEvent,
  PredicateEvent,
  ActionEvent,
  PolicyEndEvent,
} from './types.js';

// ─── Policy Builder Types ───────────────────────────────────────────────
export type {
  PolicyBuilder,
  SealedPolicy,
} from './policy/index.js';

// ─── Errors ─────────────────────────────────────────────────────────────
export {
  OnlyCoreError,
  PolicyViolationError,
  PolicyTimeoutError,
  PolicyCancelledError,
  PolicyConfigurationError,
  PolicyExecutionError,
  PolicyReentrancyError,
  ErrorCode,
} from './errors/index.js';

export type {
  ErrorCodeValue,
  ErrorInfo,
} from './errors/index.js';
