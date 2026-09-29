# API Reference

## `policy<TContext>(name, config?)`

Creates a new policy builder.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | ✅ | Stable policy name for telemetry and error reporting |
| `config` | `PolicyConfig` | ❌ | Configuration overrides |

### Returns

`PolicyBuilder<TContext>` — A fluent builder for adding guards, predicates, and actions.

### Throws

`PolicyConfigurationError` if `name` is empty or configuration values are invalid.

---

## `PolicyBuilder<TContext>`

### `.only(fn)`
### `.only(id, fn)`
### `.only(id, fn, metadata)`

Adds a guard (external enforcement) to the policy.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Stable rule identifier |
| `fn` | `GuardFn<TContext>` | `(ctx, signal) => boolean \| string \| Promise<boolean \| string>` |
| `metadata` | `RuleMetadata` | Optional metadata (description, tags, severity, timeoutMs) |

**Returns:** `PolicyBuilder<TContext>` (chainable)

### `.where(fn)`
### `.where(id, fn)`
### `.where(id, fn, metadata)`

Adds a predicate (local state check) to the policy.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Stable rule identifier |
| `fn` | `PredicateFn<TContext>` | `(ctx) => boolean \| string` |
| `metadata` | `RuleMetadata` | Optional metadata |

**Returns:** `PolicyBuilder<TContext>` (chainable)

### `.use(sealedPolicy)`

Composes guards and predicates from another sealed policy.

| Parameter | Type | Description |
|-----------|------|-------------|
| `sealedPolicy` | `SealedPolicy<TContext, unknown>` | A sealed policy to compose from |

**Returns:** `PolicyBuilder<TContext>` (chainable)

### `.compose(...sealedPolicies)`

Composes guards and predicates from multiple sealed policies, in the supplied
policy order. Like `.use()`, it does not import source actions, listeners, or
configuration; the receiving policy owns those.

**Returns:** `PolicyBuilder<TContext>` (chainable)

### `.to(fn)`

Sets the action and **seals** the policy. No structural modifications allowed afterward.

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `ActionFn<TContext, TResult>` | `(ctx, signal) => TResult \| Promise<TResult>` |

**Returns:** `SealedPolicy<TContext, TResult>`

---

## `SealedPolicy<TContext, TResult>`

### `.execute(context, options?)`

Executes the policy against the given context.

| Parameter | Type | Description |
|-----------|------|-------------|
| `context` | `TContext` | The execution context |
| `options` | `ExecuteOptions` | Optional: `executionId`, `signal`, `metadata` |

**Returns:** `Promise<PolicyResult<TResult>>`

```typescript
interface PolicyResult<TResult> {
  success: true;
  value: TResult;
  executionId: string;
  duration: number;
}
```

**Throws:**

| Error | When |
|-------|------|
| `PolicyViolationError` | Guard or predicate rejects |
| `PolicyTimeoutError` | Execution exceeds timeout |
| `PolicyCancelledError` | Execution cancelled via signal |
| `PolicyExecutionError` | Guard/action throws unexpectedly |
| `PolicyReentrancyError` | Same context already executing |

### `.tap(listener)`

Adds a telemetry event listener. Does not modify policy structure.

| Parameter | Type | Description |
|-----------|------|-------------|
| `listener` | `TelemetryListener` | `(event: TelemetryEvent) => void` |

**Returns:** `SealedPolicy<TContext, TResult>` (chainable)

### `.extend(name, config?)`

Creates a new policy builder preloaded with this policy's guards and predicates.
The new policy uses the supplied configuration (or defaults), and must define
its own action with `.to()`.

**Returns:** `PolicyBuilder<TContext>`

### `.describe()`

Returns a read-only description of the policy.

**Returns:** `PolicyDescription`

```typescript
interface PolicyDescription {
  name: string;
  mode: ExecutionMode;
  concurrency: number;
  failureStrategy: FailureStrategy;
  contextStrategy: ContextStrategy;
  reentrancy: ReentrancyStrategy;
  timeoutMs: number;
  guards: { id: string; metadata: RuleMetadata }[];
  predicates: { id: string; metadata: RuleMetadata }[];
  hasAction: boolean;
  composedPolicies: string[];
}
```

### `.name`

The policy name (`string`).

---

## Configuration

### `PolicyConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `timeoutMs` | `number` | `30000` | Global timeout in milliseconds; `0` or `Infinity` disables the timeout |
| `mode` | `'sequential' \| 'parallel'` | `'sequential'` | Guard execution mode |
| `concurrency` | `number` | `Infinity` | Maximum active guards in parallel mode; must be a positive integer or `Infinity` |
| `failureStrategy` | `'fail-fast' \| 'aggregate'` | `'fail-fast'` | How failures are handled |
| `contextStrategy` | `'reference' \| 'snapshot' \| 'immutable'` | `'snapshot'` | How context is protected |
| `reentrancy` | `'reject' \| 'allow'` | `'reject'` | Concurrent same-context behavior |

`timeoutMs` must be non-negative or `Infinity`. In parallel `fail-fast` mode,
the first guard failure aborts running siblings and prevents queued guards from
starting. In `aggregate` mode, all guards run and policy violations are
reported in registration order.

### `ExecuteOptions`

| Property | Type | Description |
|----------|------|-------------|
| `executionId` | `string` | External execution ID for correlation |
| `signal` | `AbortSignal` | External AbortSignal for cancellation |
| `metadata` | `Record<string, unknown>` | Arbitrary execution metadata |

### `RuleMetadata`

| Property | Type | Description |
|----------|------|-------------|
| `description` | `string` | Human-readable rule description |
| `tags` | `string[]` | Categorization tags |
| `severity` | `'low' \| 'medium' \| 'high' \| 'critical'` | Severity level |
| `timeoutMs` | `number` | Per-rule timeout (guards only) |

---

## Error Classes

All errors extend `OnlyCoreError` and carry:

| Property | Type | Description |
|----------|------|-------------|
| `code` | `ErrorCodeValue` | Machine-readable error code |
| `info` | `ErrorInfo` | Structured context (policy, phase, ruleId, executionId) |
| `timestamp` | `number` | When the error occurred |
| `cause` | `Error` | Original error (when wrapping) |

### Error Codes

| Code | Error Class | Meaning |
|------|-------------|---------|
| `POLICY_VIOLATION` | `PolicyViolationError` | Guard/predicate rejected |
| `POLICY_TIMEOUT` | `PolicyTimeoutError` | Execution exceeded timeout |
| `POLICY_CANCELLED` | `PolicyCancelledError` | Caller cancelled via signal |
| `POLICY_CONFIGURATION` | `PolicyConfigurationError` | Invalid policy setup |
| `POLICY_EXECUTION` | `PolicyExecutionError` | Guard/action threw unexpectedly |
| `POLICY_REENTRANT` | `PolicyReentrancyError` | Same context already executing |

---

## Telemetry Events

| Event Type | When |
|-----------|------|
| `policy:start` | Execution begins |
| `rule:start` | Guard begins evaluation |
| `rule:success` | Guard passes |
| `rule:failure` | Guard rejects |
| `rule:timeout` | Guard exceeds timeout |
| `predicate:start` | Predicate begins evaluation |
| `predicate:success` | Predicate passes |
| `predicate:failure` | Predicate rejects |
| `action:start` | Action begins execution |
| `action:success` | Action completes successfully |
| `action:failure` | Action throws/rejects |
| `policy:success` | Entire execution succeeds |
| `policy:failure` | Execution fails |
| `policy:cancelled` | Execution cancelled |

Each event includes `policyName`, `executionId`, `timestamp`, and optional
execution `metadata`, plus event-specific fields (`phase`, `ruleId`, `duration`,
`reason`). Durations are available on completed rules, predicates, actions, and
policy lifecycle events.
