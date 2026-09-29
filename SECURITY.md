# Security Policy

`only-core` is a policy execution utility. It is not a security boundary by itself and does not replace application security controls.

## Scope and Guarantees

| Behavior | What the library provides | What it does not provide |
|----------|---------------------------|---------------------------|
| Policy ordering | The action is not invoked unless guards and predicates pass in that execution. | Cross-process or cross-request coordination. |
| Reentrancy | Optional same-policy/same-object overlap detection within one engine instance. | Distributed locking or deduplication across workers, processes, or distinct context objects. |
| Timeouts | Stops waiting and aborts the signal for guards/actions that cooperate. | Forced termination of non-cooperative promises, database queries, or provider requests. |
| Action invocation | The engine invokes the action at most once for a single execution ID within that execution. | Exactly-once external side effects, retry idempotency, or protection from duplicate client requests. |
| Context handling | Optional top-level snapshot or freezing of supported cloned values. | Input sanitization, schema validation, deep isolation of arbitrary objects, or prototype-pollution prevention. |
| Telemetry/errors | Structured event/error details for the application to handle. | Automatic redaction of sensitive context placed in metadata or reason strings. |

## Context Isolation

- `reference` passes the original context.
- `snapshot` copies the outer array/plain object only; nested references remain shared.
- `immutable` recursively clones/freezes arrays and plain objects. Non-plain instances and built-ins such as `Map`, `Set`, `Date`, `RegExp`, and typed arrays are not cloned or frozen and may remain shared. Circular references are unsupported.

Do not treat these strategies as a defense against hostile object graphs. Validate and sanitize input before policy execution, and avoid passing mutable privileged objects as context.

## External Checks and Race Conditions

A guard that reads a balance and a later guard/action that writes it is not atomic. Two executions can both pass separate reads. For credits, inventory, quota, rate limits, or one-time actions, enforce the invariant with a transaction, conditional write, idempotency key, lease, or distributed coordination mechanism in the system that owns the resource. `only-core` can gate an action on an atomic reservation result; it cannot create that atomicity.

Parallel guards must be independent. Fail-fast aborts sibling signals, but external work that ignores `AbortSignal` may continue. Aggregate mode collects policy violations; operational exceptions/timeouts/cancellation are execution failures and are not silently treated as ordinary denials.

## Application Responsibilities

Applications remain responsible for authentication, authorization design, schema validation, output encoding, CSRF protections, rate limiting, secret management, database transactions, distributed coordination, logging/redaction, and safe error responses. Do not return internal policy names, rule IDs, raw causes, or stack traces to untrusted clients without review.

## Reporting a Security Concern

Email **ikkegoon@gmail.com** with a concise description and reproducible steps. Do not include credentials, tokens, private customer information, or other secrets. Please avoid publishing an unpatched vulnerability in a public issue.
