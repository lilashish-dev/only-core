# only-core

> A zero-dependency, TypeScript-first policy execution engine for enforcing preconditions before executing business actions.

[![Tests](https://img.shields.io/badge/tests-58%20passing-brightgreen)]()
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-first-blue)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)]()

## The Central Guarantee

> **The action is never invoked unless every required enforcement stage has successfully completed.**

```
Context → Policy → Guards → Predicates → Action → Result
```

## What only-core Is

**Policy enforcement and controlled execution.**

It is **not** an authorization framework, validation library, workflow engine, or general-purpose rules engine.

Its job is to ensure that preconditions are met before business actions execute — reliably, predictably, and without external dependencies.

## Installation

```bash
npm install only-core
```

## Quick Start

```typescript
import { policy } from 'only-core';

interface CheckoutContext {
  userId: string;
  items: string[];
  amount: number;
  subscription: 'active' | 'expired';
}

// Define guards (external enforcement — potentially async)
async function isAuthenticated(ctx: Readonly<CheckoutContext>, signal: AbortSignal): Promise<boolean> {
  // Check authentication against your auth system
  return ctx.userId !== '';
}

// Define the policy
const checkout = policy<CheckoutContext>('Checkout', {
  timeoutMs: 5000,
  mode: 'sequential',
  contextStrategy: 'snapshot',
})
  .only('authenticated', isAuthenticated)
  .only('active-subscription', (ctx) => 
    ctx.subscription === 'active' || 'Subscription is expired'
  )
  .where('cart-not-empty', (ctx) => 
    ctx.items.length > 0 || 'Cart is empty'
  )
  .where('valid-amount', (ctx) => 
    ctx.amount > 0 || 'Amount must be positive'
  )
  .to(async (ctx) => {
    // This ONLY runs if ALL guards and predicates pass
    return { orderId: 'ord_123', total: ctx.amount };
  });

// Execute the policy
try {
  const result = await checkout.execute({
    userId: 'user_123',
    items: ['item_a', 'item_b'],
    amount: 99.99,
    subscription: 'active',
  });
  
  console.log(result.value);        // { orderId: 'ord_123', total: 99.99 }
  console.log(result.executionId);  // exec_01abc...
  console.log(result.duration);     // 42 (ms)
} catch (error) {
  // Structured error with machine-readable code
  // error.code === 'POLICY_VIOLATION'
  // error.violations === [{ ruleId, phase, reason }]
}
```

## Core Concepts

### Guards (`.only()`) — External Enforcement

Guards handle checks that may involve external state:

- Authentication / Authorization
- Subscription status
- Database lookups
- Feature entitlements
- Rate-limit checks

**Characteristics:** potentially async, timeout-aware, cancellation-aware, can throw.

```typescript
.only('authenticated', async (ctx, signal) => {
  const user = await authService.verify(ctx.token, { signal });
  return user !== null;
})
```

### Predicates (`.where()`) — Local State Checks

Predicates handle deterministic, synchronous conditions:

- `amount > 0`
- `items.length > 0`
- `status === 'draft'`

**Characteristics:** synchronous, deterministic, cheap, no external I/O.

```typescript
.where('positive-amount', (ctx) => ctx.amount > 0 || 'Amount must be positive')
```

### Actions (`.to()`) — Protected Execution

The action is the business logic that only runs when all enforcement passes. Calling `.to()` **seals** the policy — no further structural modification is allowed.

```typescript
.to(async (ctx, signal) => {
  return await processPayment(ctx, { signal });
})
```

## Configuration

```typescript
policy<Context>('PolicyName', {
  timeoutMs: 5000,                    // Global timeout (default: 30000ms)
  mode: 'sequential' | 'parallel',   // Guard execution mode (default: 'sequential')
  concurrency: 4,                     // Max active guards in parallel (default: Infinity)
  failureStrategy: 'fail-fast' | 'aggregate',  // (default: 'fail-fast')
  contextStrategy: 'reference' | 'snapshot' | 'immutable',  // (default: 'snapshot')
  reentrancy: 'reject' | 'allow',    // (default: 'reject')
})
```

### Context Strategies

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `reference` | Pass original object | Performance-critical, trusted code |
| `snapshot` | Shallow copy | **Default.** Lightweight contexts |
| `immutable` | Deep-clone then deep freeze | Maximum protection (expensive). Note: Does not clone/freeze Map, Set, classes, etc. |

### Execution Modes

| Mode + Strategy | Behavior |
|-----------------|----------|
| `sequential` + `fail-fast` | Run guards in order, stop on first failure |
| `sequential` + `aggregate` | Run all guards, collect all failures |
| `parallel` + `fail-fast` | Run guards concurrently, fail on first |
| `parallel` + `aggregate` | Run all guards concurrently, collect all |

Parallel `fail-fast` aborts active sibling guards and does not start queued
guards after the first failure. `concurrency` must be a positive integer or
`Infinity`; `timeoutMs` must be non-negative or `Infinity` (`0` disables timeout).

## Cancellation

First-class cancellation using `AbortSignal`:

```typescript
const controller = new AbortController();

// Cancel after 2 seconds
setTimeout(() => controller.abort(), 2000);

const result = await checkout.execute(context, {
  signal: controller.signal,
});
```

**Important distinction:**
- **Timeout** = "The policy waited too long."
- **Cancellation** = "The caller no longer wants this operation."

## Error Architecture

All errors carry structured, machine-readable information:

```
OnlyCoreError
├── PolicyViolationError    (code: POLICY_VIOLATION)
├── PolicyTimeoutError      (code: POLICY_TIMEOUT)
├── PolicyCancelledError    (code: POLICY_CANCELLED)
├── PolicyConfigurationError (code: POLICY_CONFIGURATION)
├── PolicyExecutionError    (code: POLICY_EXECUTION)
└── PolicyReentrancyError   (code: POLICY_REENTRANT)
```

Every error includes:
- `code` — Stable machine-readable error code
- `info` — `{ policy, phase, ruleId, executionId, ... }`
- `cause` — Original error (when wrapping)
- `timestamp`

**Semantic distinction:**
- Guard returns `false` → `PolicyViolationError` (policy rejection)
- Guard throws `Error` → `PolicyExecutionError` (execution failure)

## Observability

Zero-dependency event-based observability via `.tap()`:

```typescript
checkout.tap((event) => {
  // Connect to OpenTelemetry, Datadog, Prometheus, etc.
  console.log(`${event.type} [${event.executionId}]`);
});
```

**Events:** `policy:start`, `rule:start`, `rule:success`, `rule:failure`, `rule:timeout`, `predicate:start`, `predicate:success`, `predicate:failure`, `action:start`, `action:success`, `action:failure`, `policy:success`, `policy:failure`, `policy:cancelled`

**Invariant:** Listener errors never affect policy behavior.

## Policy Composition

Reuse enforcement rules across policies:

```typescript
const authPolicy = policy<Context>('Auth')
  .only('authenticated', isAuthenticated)
  .to((ctx) => ctx);

const billingPolicy = policy<Context>('Billing')
  .only('active-subscription', hasSubscription)
  .to((ctx) => ctx);

const checkout = policy<Context>('Checkout')
  .use(authPolicy)
  .use(billingPolicy)
  .where('cart-valid', (ctx) => ctx.items.length > 0)
  .to(processCheckout);
```

Use `.compose(authPolicy, billingPolicy)` to append multiple policies at once,
or `authPolicy.extend('Checkout')` to start a new builder with the source
policy's guards and predicates. Composition reuses checks only: source actions,
listeners, and configuration are not inherited.

## Domain Example: Document Publishing

See [examples/document-publishing.ts](examples/document-publishing.ts) for a publishing workflow guarded by workspace access, reviewer approval, complete content, and resolved comments. Its integration tests use in-memory adapters; they verify policy execution and state mutation, not a live identity provider or database.

## Benchmarks and Memory Audit

Run `npm run benchmark` to compare direct action calls with policies containing 0, 1, 5, or 10 passing guards, with telemetry on and off. Run `npm run benchmark:memory` for repeated success/rejection executions with forced garbage collection between samples. These are diagnostic measurements without pass/fail thresholds; use the same Node version and machine when comparing runs.

## Introspection

Read-only policy inspection for debugging, testing, and admin dashboards:

```typescript
const description = checkout.describe();
// {
//   name: 'Checkout',
//   mode: 'sequential',
//   guards: [{ id: 'authenticated', metadata: {...} }, ...],
//   predicates: [{ id: 'cart-valid', metadata: {...} }],
//   hasAction: true,
//   composedPolicies: ['Auth', 'Billing'],
// }
```

## Stable Rule IDs

Always use explicit IDs for enterprise applications:

```typescript
// ✅ Recommended: explicit ID
.only('authenticated', isAuthenticated)

// ⚠️ Acceptable: uses function.name (fragile with minifiers)
.only(isAuthenticated)
```

## Rule Metadata

Attach metadata for richer telemetry:

```typescript
.only('fraud-check', checkFraud, {
  description: 'Validates transaction against fraud detection',
  tags: ['security', 'billing'],
  severity: 'critical',
  timeoutMs: 5000,  // Per-rule timeout
})
```

## Supported Environments

**Required capabilities:** ES2022+, `AbortController`, `Promise`, `WeakSet`, `Object.freeze`

| Environment | Version |
|-------------|---------|
| Node.js | 18 LTS+ |
| Chrome | 94+ |
| Firefox | 93+ |
| Safari | 15.4+ |
| Edge | 94+ |

## API Reference

See [docs/api/](./docs/api/) for the complete API reference.

## Security

See [SECURITY.md](./SECURITY.md) for the security model and responsible disclosure.

## License

MIT
