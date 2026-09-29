/**
 * only-core — Core Type Definitions
 *
 * Central type system for the policy execution engine.
 * All types are designed for TypeScript-first inference
 * throughout the fluent API chain.
 */

// ─── Execution State Machine ────────────────────────────────────────────

/**
 * Represents the defined states of a policy execution lifecycle.
 *
 * State transitions:
 *   CREATED → PREPARING → GUARDING → PREDICATING → EXECUTING → COMPLETED
 *
 * Failure paths:
 *   GUARDING    → REJECTED
 *   PREDICATING → REJECTED
 *   EXECUTING   → FAILED
 *   any stage   → TIMEOUT
 *   any stage   → CANCELLED
 */
export type ExecutionState =
  | 'CREATED'
  | 'PREPARING'
  | 'GUARDING'
  | 'PREDICATING'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'FAILED'
  | 'TIMEOUT'
  | 'CANCELLED';

/**
 * Represents the phase a rule belongs to in the enforcement pipeline.
 */
export type ExecutionPhase = 'guard' | 'predicate' | 'action';

// ─── Context Strategies ─────────────────────────────────────────────────

/**
 * Defines how the execution context is handled.
 *
 * - `reference`: Use the original object. Fastest. No protection.
 * - `snapshot`: Create a shallow copy. Good default for lightweight contexts.
 * - `immutable`: Deep-freeze supported structures. Potentially expensive.
 */
export type ContextStrategy = 'reference' | 'snapshot' | 'immutable';

// ─── Execution Modes ────────────────────────────────────────────────────

/**
 * Defines how guards are executed.
 *
 * - `sequential`: Guards run one after another. Stops on first failure.
 * - `parallel`: Guards run concurrently. Behavior depends on `failureStrategy`.
 */
export type ExecutionMode = 'sequential' | 'parallel';

/**
 * Defines how failures are handled in the pipeline.
 *
 * - `fail-fast`: Stop as soon as one rule fails.
 * - `aggregate`: Run all rules and collect every failure.
 */
export type FailureStrategy = 'fail-fast' | 'aggregate';

// ─── Reentrancy ─────────────────────────────────────────────────────────

/**
 * Defines reentrancy behavior when the same context is used concurrently.
 *
 * - `reject`: Throw a PolicyReentrancyError.
 * - `allow`: Permit concurrent execution with the same context.
 */
export type ReentrancyStrategy = 'reject' | 'allow';

// ─── Rule Types ─────────────────────────────────────────────────────────

/**
 * A guard function that may involve external state (async).
 * Returns `true` to pass, `false` or a rejection reason string to fail.
 * May throw to indicate execution failure (not policy violation).
 */
export type GuardFn<TContext> = (
  context: Readonly<TContext>,
  signal: AbortSignal
) => boolean | string | Promise<boolean | string>;

/**
 * A predicate function that checks deterministic local state (sync only).
 * Returns `true` to pass, `false` or a rejection reason string to fail.
 */
export type PredicateFn<TContext> = (
  context: Readonly<TContext>
) => boolean | string;

/**
 * The action function to execute once all enforcement passes.
 * Receives the execution context and an AbortSignal for cancellation.
 */
export type ActionFn<TContext, TResult> = (
  context: Readonly<TContext>,
  signal: AbortSignal
) => TResult | Promise<TResult>;

// ─── Rule Descriptors ───────────────────────────────────────────────────

/**
 * Metadata associated with a rule for telemetry and introspection.
 */
export interface RuleMetadata {
  /** Human-readable description of the rule's purpose */
  readonly description?: string;
  /** Tags for categorization (e.g., "authorization", "billing") */
  readonly tags?: readonly string[];
  /** Severity level for reporting */
  readonly severity?: 'low' | 'medium' | 'high' | 'critical';
  /** Per-rule timeout in milliseconds (guards only) */
  readonly timeoutMs?: number;
  /** Arbitrary user-defined metadata */
  readonly [key: string]: unknown;
}

/**
 * Internal representation of a registered guard rule.
 */
export interface GuardRule<TContext> {
  readonly id: string;
  readonly fn: GuardFn<TContext>;
  readonly phase: 'guard';
  readonly metadata: RuleMetadata;
}

/**
 * Internal representation of a registered predicate rule.
 */
export interface PredicateRule<TContext> {
  readonly id: string;
  readonly fn: PredicateFn<TContext>;
  readonly phase: 'predicate';
  readonly metadata: RuleMetadata;
}

/**
 * Union of all rule types.
 */
export type Rule<TContext> = GuardRule<TContext> | PredicateRule<TContext>;

// ─── Policy Configuration ───────────────────────────────────────────────

/**
 * Configuration options for a policy.
 */
export interface PolicyConfig {
  /** Global timeout for the entire policy execution in milliseconds */
  readonly timeoutMs?: number;
  /** Execution mode: sequential or parallel */
  readonly mode?: ExecutionMode;
  /** Maximum number of concurrent guards when mode is 'parallel' (default: Infinity) */
  readonly concurrency?: number;
  /** How failures are handled */
  readonly failureStrategy?: FailureStrategy;
  /** How the context is protected */
  readonly contextStrategy?: ContextStrategy;
  /** Reentrancy behavior */
  readonly reentrancy?: ReentrancyStrategy;
}

/**
 * Resolved configuration with all defaults applied.
 */
export interface ResolvedPolicyConfig {
  readonly timeoutMs: number;
  readonly mode: ExecutionMode;
  readonly concurrency: number;
  readonly failureStrategy: FailureStrategy;
  readonly contextStrategy: ContextStrategy;
  readonly reentrancy: ReentrancyStrategy;
}

// ─── Execution Record ───────────────────────────────────────────────────

/**
 * First-class execution record created for every policy invocation.
 *
 * This is the internal representation — never directly exposed to users.
 */
export interface ExecutionRecord<TContext> {
  /** Unique execution identifier */
  readonly id: string;
  /** Reference to the original context */
  readonly context: TContext;
  /** The prepared (possibly frozen/copied) context */
  readonly preparedContext: Readonly<TContext>;
  /** AbortSignal for cancellation */
  readonly signal: AbortSignal;
  /** Current execution state */
  state: ExecutionState;
  /** Timestamp when execution started */
  readonly startedAt: number;
  /** Current phase being executed */
  currentPhase: ExecutionPhase | 'preparation' | 'completed' | 'cleanup';
  /** Duration in milliseconds (set on completion) */
  duration?: number;
}

// ─── Telemetry Events ───────────────────────────────────────────────────

/**
 * Base shape for all telemetry events.
 */
export interface TelemetryEventBase {
  readonly policyName: string;
  readonly executionId: string;
  readonly timestamp: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * All possible telemetry event types.
 */
export type TelemetryEventType =
  | 'policy:start'
  | 'rule:start'
  | 'rule:success'
  | 'rule:failure'
  | 'rule:timeout'
  | 'predicate:start'
  | 'predicate:success'
  | 'predicate:failure'
  | 'action:start'
  | 'action:success'
  | 'action:failure'
  | 'policy:success'
  | 'policy:failure'
  | 'policy:cancelled';

export interface PolicyStartEvent extends TelemetryEventBase {
  readonly type: 'policy:start';
}

export interface RuleEvent extends TelemetryEventBase {
  readonly type: 'rule:start' | 'rule:success' | 'rule:failure' | 'rule:timeout';
  readonly phase: ExecutionPhase;
  readonly ruleId: string;
  readonly duration?: number;
  readonly reason?: string;
}

export interface PredicateEvent extends TelemetryEventBase {
  readonly type: 'predicate:start' | 'predicate:success' | 'predicate:failure';
  readonly ruleId: string;
  readonly duration?: number;
  readonly reason?: string;
}

export interface ActionEvent extends TelemetryEventBase {
  readonly type: 'action:start' | 'action:success' | 'action:failure';
  readonly duration?: number;
  readonly reason?: string;
}

export interface PolicyEndEvent extends TelemetryEventBase {
  readonly type: 'policy:success' | 'policy:failure' | 'policy:cancelled';
  readonly duration: number;
  readonly reason?: string;
}

export type TelemetryEvent =
  | PolicyStartEvent
  | RuleEvent
  | PredicateEvent
  | ActionEvent
  | PolicyEndEvent;

/**
 * Listener function for telemetry events.
 */
export type TelemetryListener = (event: TelemetryEvent) => void;

// ─── Execution Options ──────────────────────────────────────────────────

/**
 * Options passed to `execute()`.
 */
export interface ExecuteOptions {
  /** External execution ID for correlation with tracing systems */
  readonly executionId?: string;
  /** External AbortSignal for caller-initiated cancellation */
  readonly signal?: AbortSignal;
  /** Arbitrary metadata attached to this execution */
  readonly metadata?: Record<string, unknown>;
}

// ─── Policy Introspection ───────────────────────────────────────────────

/**
 * Read-only description of a policy, returned by `.describe()`.
 */
export interface PolicyDescription {
  readonly name: string;
  readonly mode: ExecutionMode;
  readonly concurrency: number;
  readonly failureStrategy: FailureStrategy;
  readonly contextStrategy: ContextStrategy;
  readonly reentrancy: ReentrancyStrategy;
  readonly timeoutMs: number;
  readonly guards: readonly {
    readonly id: string;
    readonly metadata: RuleMetadata;
  }[];
  readonly predicates: readonly {
    readonly id: string;
    readonly metadata: RuleMetadata;
  }[];
  readonly hasAction: boolean;
  readonly composedPolicies: readonly string[];
}

// ─── Execution Result ───────────────────────────────────────────────────

/**
 * The result of a successful policy execution.
 */
export interface PolicyResult<TResult> {
  readonly success: true;
  readonly value: TResult;
  readonly executionId: string;
  readonly duration: number;
}

/**
 * The result of a failed policy execution (when not throwing).
 */
export interface PolicyFailure {
  readonly success: false;
  readonly error: Error;
  readonly executionId: string;
  readonly duration: number;
  readonly violations: readonly ViolationDetail[];
}

export interface ViolationDetail {
  readonly ruleId: string;
  readonly phase: ExecutionPhase;
  readonly reason: string;
}

export type PolicyOutcome<TResult> = PolicyResult<TResult> | PolicyFailure;
