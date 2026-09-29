# Changelog

All notable changes to only-core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-09-29

### Added

#### Core Engine
- `policy<TContext>(name, config?)` — Create a named policy with optional configuration
- `.only(fn)` / `.only(id, fn)` / `.only(id, fn, metadata)` — Add external guards
- `.where(fn)` / `.where(id, fn)` / `.where(id, fn, metadata)` — Add local predicates
- `.to(fn)` — Set the action and seal the policy

#### Execution
- Sequential guard execution with fail-fast semantics
- Parallel guard execution with fail-fast and aggregate strategies
- Predicate execution (always synchronous)
- Exactly-once action execution guarantee
- Execution IDs (auto-generated or user-supplied)
- Execution duration tracking
- Execution metadata propagation to events

#### Context Handling
- Three context strategies: `reference`, `snapshot`, `immutable`
- Shallow copy for `snapshot` strategy
- Deep freeze for `immutable` strategy (clones first to protect caller)

#### Timeouts
- Global policy timeout (`timeoutMs`)
- Per-rule timeout via rule metadata
- AbortController-based timeout propagation

#### Cancellation
- First-class AbortSignal support via `execute(ctx, { signal })`
- Linked AbortController architecture
- Proper distinction between timeout and cancellation
- Fail-fast parallel cancellation

#### Error Architecture
- `OnlyCoreError` base class with stable `code` field
- `PolicyViolationError` — Guard or predicate rejection
- `PolicyTimeoutError` — Execution exceeded timeout
- `PolicyCancelledError` — Caller-initiated cancellation
- `PolicyConfigurationError` — Invalid policy setup
- `PolicyExecutionError` — Guard/action threw unexpectedly
- `PolicyReentrancyError` — Concurrent execution with same context
- All errors carry structured `info` object
- Original errors preserved as `cause`

#### Reentrancy Protection
- WeakSet-based reentrancy detection
- Configurable: `reject` (default) or `allow`
- Automatic cleanup on completion or failure

#### Observability
- `.tap(listener)` — Subscribe to execution events
- Event types: `policy:start`, `rule:start/success/failure/timeout`, `predicate:start/success/failure`, `action:start/success/failure`, `policy:success/failure/cancelled`
- Execution metadata injected into events
- Zero-dependency: no built-in logging, no console output
- Invariant: listener errors never affect policy behavior

#### Composition
- `.use(sealedPolicy)` — Compose guards/predicates from another policy
- `.compose(...policies)` — Compose multiple policies at once
- `.extend(name)` — Create a new policy extending an existing sealed policy
- Policy name tracking for introspection

#### Introspection
- `.describe()` — Read-only policy description
- Returns: name, mode, guards, predicates, configuration, composed policies

#### TypeScript
- Full TypeScript-first design with generic context types
- Strict type inference through the fluent chain
- All public types exported

### Security
- Zero runtime dependencies
- No global state
- No logging by default
- Sealed policy immutability
- Dedicated SECURITY.md with honest guarantees
