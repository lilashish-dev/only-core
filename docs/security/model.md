# Security Model

## Threat Model

only-core operates in a specific security context:

```
User Input
    ↓
Application Layer (auth, validation, sanitization)
    ↓
only-core (policy enforcement)
    ↓
Business Action
```

only-core is positioned **after** application-level security and **before** business logic. It enforces preconditions but does not implement the security measures themselves.

## Context Isolation

### The Problem

When multiple guards and predicates operate on the same context object, there's a risk of:
- Accidental mutation by one guard affecting another
- Intentional mutation to bypass subsequent checks
- Prototype pollution through crafted context objects

### The Solution (and Its Limits)

| Strategy | Protection | Limitation |
|----------|-----------|-----------|
| `reference` | None | Original object exposed directly |
| `snapshot` | Top-level isolation | `ctx.user.name` still mutable if `user` is a shared reference |
| `immutable` | Clones/freezes arrays and plain objects | Non-plain values such as `Map`, `Set`, `Date`, `RegExp`, typed arrays, and class instances remain shared and are not frozen. Circular references unsupported. |

### What We DON'T Claim

> "Context isolation reduces accidental or intentional mutation of the execution snapshot. It is not a substitute for input sanitization, schema validation, or application-level prototype-pollution defenses."

## Parallel Guard Safety

> Guards running in parallel must be independent.
> A guard must not mutate the context or depend on side effects produced by another guard.

This is a documented contract, not an enforced constraint. only-core does not detect guard dependencies — it is the developer's responsibility to ensure parallel guards are truly independent.

Parallel fail-fast signals active sibling guards and stops scheduling queued guards. It cannot forcibly stop external work that ignores its signal. Aggregate mode collects policy violations in registration order; operational errors such as thrown guard exceptions, timeouts, and cancellation remain execution errors.

## Timeout Safety

```
Policy timeout
      ↓
AbortController.abort()
      ↓
guard receives AbortSignal
      ↓
underlying operation MAY cancel (if it respects the signal)
```

**What happens:** The policy stops waiting and rejects with `PolicyTimeoutError`.
**What doesn't happen:** The underlying network request, database query, or external API call is not guaranteed to be cancelled. Only operations that explicitly check `AbortSignal` will terminate.

The action is invoked at most once by one policy execution. This is not an exactly-once guarantee for external side effects: client retries and multiple processes require application-level idempotency and coordination.

## Atomic Resources

Separate guard reads followed by a later write are subject to races. For balances, credits, inventory, quotas, and one-time claims, the authoritative service must check and reserve atomically (for example, a transaction or conditional update). only-core can require that reservation guard to pass before calling the action; it does not supply the transaction or distributed lock. See the [AI generation credit/quota recipe](../recipes/examples.md#ai-generation-atomic-credits-and-quota).

## Error Information Leakage

All `OnlyCoreError` instances carry structured `info` objects containing:
- Policy name
- Rule ID
- Execution ID
- Phase
- Reason

Ensure these details are not leaked to external clients in production. Log them server-side but return generic error messages to API consumers.

## Supply Chain

only-core has **zero runtime dependencies**. The attack surface from third-party packages is eliminated entirely.

Development dependencies (TypeScript, Vitest) are not included in the production bundle.
