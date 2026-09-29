# Core Invariants

These invariants define the behavioral contract of only-core. They drive the test suite and should never be violated.

---

## Invariant 1 — Action Cannot Execute If Any Guard Fails

> `.to()` cannot run after a failed guard.

If any guard returns `false`, returns a rejection string, or throws, the action is never invoked. This is the central guarantee of the library.

## Invariant 2 — Action Cannot Execute If Any Predicate Fails

> `.to()` cannot run after a failed predicate.

Predicates are the second enforcement boundary. Even if all guards pass, a failed predicate prevents the action.

## Invariant 3 — Sealed Policy Cannot Be Modified

> A sealed policy cannot accept new rules.

After `.to()` is called, the policy is sealed. Guard and predicate arrays are frozen. There is no API to add, remove, or reorder rules on a sealed policy.

## Invariant 4 — Execution Bookkeeping Is Always Released

> A running execution always releases execution bookkeeping.

Whether the execution succeeds, fails, times out, or is cancelled, the `finally` block always:
- Clears the timeout timer
- Removes the context from the reentrancy WeakSet
- Cleans up exactly-once action tracking
- Aborts the internal AbortController

## Invariant 5 — Timeouts Cannot Leave Internal Timers Alive

> Every `setTimeout` created by the execution engine is matched by a `clearTimeout` in the cleanup path.

Timer handles are stored and cleared in the `finally` block of every execution.

## Invariant 6 — Cancellation Releases Execution Bookkeeping

> When execution is cancelled via AbortSignal, all cleanup runs identically to a normal completion.

Cancellation is not a special case — it follows the same cleanup path.

## Invariant 7 — Guard Exceptions Are Never Silently Successful

> Guard exceptions are never silently converted into successful results.

A guard that throws produces a `PolicyExecutionError`, not a successful pass. This is a critical safety property.

## Invariant 8 — Observability Cannot Change Policy Behavior

> Telemetry listener errors are silently caught.

If a `.tap()` listener throws, it must not affect the policy's execution outcome. The policy's success/failure is determined solely by guards, predicates, and the action.

## Invariant 9 — Exactly-Once Action Execution

> One execution cannot accidentally execute the action twice.

Even if promises resolve multiple times, callbacks misbehave, or telemetry throws, the action is invoked at most once per execution.

## Invariant 10 — No Global Execution Registry

> The library maintains no global execution registry.

Reentrancy tracking is per-engine, not global. Two different sealed policies share no state. There are no module-level singletons or static registries.

---

## What Only-Core Guarantees

### Guaranteed

- `.to()` cannot run after a failed guard
- `.to()` cannot run after a failed predicate
- A sealed pipeline cannot accept new rules
- Active execution bookkeeping is released
- Guard timeouts terminate policy waiting
- Concurrent reuse of the same context can be rejected
- Errors are represented structurally
- No external dependencies are required

### Not Guaranteed

- A timed-out underlying network operation is automatically cancelled
- `Object.freeze()` makes nested `Map`/`Set` objects immutable
- only-core provides authentication
- only-core provides database transactions
- only-core prevents all prototype-pollution vulnerabilities
- Parallel guards are automatically safe if they have side effects
