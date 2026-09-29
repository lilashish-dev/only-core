/**
 * only-core — Error Architecture
 *
 * Structured error hierarchy for the policy execution engine.
 * Every error carries machine-readable codes and structured information
 * so consumers never need to parse error messages.
 *
 * Error hierarchy:
 *   OnlyCoreError
 *   ├── PolicyViolationError
 *   ├── PolicyTimeoutError
 *   ├── PolicyCancelledError
 *   ├── PolicyConfigurationError
 *   ├── PolicyExecutionError
 *   └── PolicyReentrancyError
 *
 * Stable error codes:
 *   POLICY_VIOLATION
 *   POLICY_TIMEOUT
 *   POLICY_CANCELLED
 *   POLICY_CONFIGURATION
 *   POLICY_EXECUTION
 *   POLICY_REENTRANT
 */

import type { ExecutionPhase, ViolationDetail } from '../types.js';

// ─── Error Codes ────────────────────────────────────────────────────────

export const ErrorCode = {
  POLICY_VIOLATION: 'POLICY_VIOLATION',
  POLICY_TIMEOUT: 'POLICY_TIMEOUT',
  POLICY_CANCELLED: 'POLICY_CANCELLED',
  POLICY_CONFIGURATION: 'POLICY_CONFIGURATION',
  POLICY_EXECUTION: 'POLICY_EXECUTION',
  POLICY_REENTRANT: 'POLICY_REENTRANT',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// ─── Structured Error Info ──────────────────────────────────────────────

export interface ErrorInfo {
  readonly policy?: string;
  readonly phase?: ExecutionPhase | string;
  readonly rule?: string;
  readonly ruleId?: string;
  readonly executionId?: string;
  readonly reason?: string;
  readonly timestamp?: number;
  readonly duration?: number;
}

// ─── Base Error ─────────────────────────────────────────────────────────

/**
 * Base error class for all only-core errors.
 * Carries a stable `code` field for machine-readable error identification.
 */
export class OnlyCoreError extends Error {
  readonly code: ErrorCodeValue;
  readonly info: ErrorInfo;
  readonly timestamp: number;

  constructor(
    message: string,
    code: ErrorCodeValue,
    info: ErrorInfo = {},
    cause?: Error
  ) {
    super(message, { cause });
    this.name = 'OnlyCoreError';
    this.code = code;
    this.info = info;
    this.timestamp = info.timestamp ?? Date.now();

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Policy Violation ───────────────────────────────────────────────────

/**
 * Thrown when a guard or predicate rejects the execution context.
 * This represents a legitimate policy rejection — not an application failure.
 *
 * A returned negative verdict represents policy rejection.
 * An exception represents execution failure.
 */
export class PolicyViolationError extends OnlyCoreError {
  readonly violations: readonly ViolationDetail[];

  constructor(
    message: string,
    violations: readonly ViolationDetail[],
    info: ErrorInfo = {}
  ) {
    super(message, ErrorCode.POLICY_VIOLATION, info);
    this.name = 'PolicyViolationError';
    this.violations = violations;
  }
}

// ─── Policy Timeout ─────────────────────────────────────────────────────

/**
 * Thrown when a policy execution exceeds its configured timeout.
 *
 * Important distinction:
 *   Timeout = "The policy waited too long."
 *   Cancellation = "The caller no longer wants this operation."
 *
 * Note: Promise.race() does not actually cancel the underlying operation.
 * The timeout fires the AbortController so guards that respect AbortSignal
 * can clean up, but operations that don't support cancellation may continue.
 */
export class PolicyTimeoutError extends OnlyCoreError {
  readonly timeoutMs: number;

  constructor(
    message: string,
    timeoutMs: number,
    info: ErrorInfo = {}
  ) {
    super(message, ErrorCode.POLICY_TIMEOUT, info);
    this.name = 'PolicyTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

// ─── Policy Cancelled ───────────────────────────────────────────────────

/**
 * Thrown when a policy execution is cancelled via AbortSignal.
 *
 * Cancellation is a first-class concept:
 *   request cancelled → policy execution cancelled → guards receive cancellation → action receives cancellation
 */
export class PolicyCancelledError extends OnlyCoreError {
  constructor(message: string, info: ErrorInfo = {}) {
    super(message, ErrorCode.POLICY_CANCELLED, info);
    this.name = 'PolicyCancelledError';
  }
}

// ─── Policy Configuration ───────────────────────────────────────────────

/**
 * Thrown when a policy is misconfigured.
 * For example: executing without an action, invalid timeout, sealed policy modification.
 */
export class PolicyConfigurationError extends OnlyCoreError {
  constructor(message: string, info: ErrorInfo = {}) {
    super(message, ErrorCode.POLICY_CONFIGURATION, info);
    this.name = 'PolicyConfigurationError';
  }
}

// ─── Policy Execution Error ─────────────────────────────────────────────

/**
 * Thrown when a guard or action throws an unexpected error.
 * This wraps the original error as `cause` to preserve stack traces.
 *
 * Semantic distinction:
 *   guard returns false  → PolicyViolationError
 *   database throws      → PolicyExecutionError (with original error as cause)
 */
export class PolicyExecutionError extends OnlyCoreError {
  constructor(
    message: string,
    info: ErrorInfo = {},
    cause?: Error
  ) {
    super(message, ErrorCode.POLICY_EXECUTION, info, cause);
    this.name = 'PolicyExecutionError';
  }
}

// ─── Policy Reentrancy Error ────────────────────────────────────────────

/**
 * Thrown when a policy detects concurrent execution with the same context
 * and reentrancy is set to "reject".
 */
export class PolicyReentrancyError extends OnlyCoreError {
  constructor(message: string, info: ErrorInfo = {}) {
    super(message, ErrorCode.POLICY_REENTRANT, info);
    this.name = 'PolicyReentrancyError';
  }
}
