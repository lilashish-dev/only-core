# Architecture Overview

## Pipeline Model

only-core implements a four-layer execution pipeline:

```
┌─────────────────────────────┐
│        INPUT CONTEXT        │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│     CONTEXT PREPARATION     │
│ normalization / snapshot     │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│       ENFORCEMENT           │
│                             │
│ .only()  → external guards  │
│ .where() → local predicates │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│         EXECUTION           │
│                             │
│ .to()   → business action   │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│     RESULT / TELEMETRY      │
└─────────────────────────────┘
```

## Execution State Machine

Every policy execution transitions through defined states:

```
CREATED
   ↓
PREPARING        (context snapshot/freeze)
   ↓
GUARDING         (running .only() rules)
   ↓
PREDICATING      (running .where() rules)
   ↓
EXECUTING        (running .to() action)
   ↓
COMPLETED

Failure paths:
  GUARDING    ──→ REJECTED
  PREDICATING ─→ REJECTED
  EXECUTING   ──→ FAILED
  any stage   ──→ TIMEOUT
  any stage   ──→ CANCELLED
```

## Execution Lifecycle

Each call to `execute()` follows this conceptual lifecycle. The engine tracks
the execution ID, prepared context, signal, timing, and cleanup internally; it
does not expose a mutable execution-record object.

```
Execution
│
├── policy          (reference to the sealed policy)
├── context         (original input)
├── preparedContext  (snapshot/frozen copy)
├── signal          (AbortSignal for cancellation)
├── executionId     (unique identifier)
├── startedAt       (timestamp)
└── duration        (computed on completion)
```

This model makes cancellation, telemetry, timeout handling, and tracing straightforward.

## Module Architecture

```
src/
├── index.ts            ← Public API entry point
├── types.ts            ← All type definitions
├── policy/             ← Fluent builder & sealed policy
│   └── index.ts
├── execution/          ← Core execution engine
│   └── index.ts
├── guards/             ← Guard execution (sequential/parallel)
│   └── index.ts
├── predicates/         ← Predicate execution (synchronous)
│   └── index.ts
├── errors/             ← Structured error hierarchy
│   └── index.ts
├── context/            ← Context preparation strategies
│   └── index.ts
├── cancellation/       ← AbortSignal/timeout management
│   └── index.ts
├── telemetry/          ← Event-based observability
│   └── index.ts
└── composition/        ← Reserved for future internal composition helpers
```

**Key principle:** Internal module structure never leaks into the public API. The public surface is the `src/index.ts` exports only.

Policy composition is currently implemented by the policy builder. `.use()`
and `.compose()` copy guards and predicates into the receiving builder;
`.extend()` creates a new builder from an existing sealed policy. Source actions,
listeners, and configuration are not inherited.

## Guard vs Predicate — Architectural Distinction

This is an explicit architectural rule, not merely two different methods:

| Aspect | `.only()` (Guard) | `.where()` (Predicate) |
|--------|-------------------|----------------------|
| Purpose | External enforcement | Local state check |
| Async | ✅ Yes | ❌ No |
| Timeout | ✅ Aware | ❌ Not needed |
| Cancellation | ✅ Receives AbortSignal | ❌ No |
| Cost | Potentially expensive | Cheap |
| I/O | May involve external systems | No external I/O |
| Examples | Auth, DB, API calls | `amount > 0`, `status === 'draft'` |

## Cancellation Architecture

```
Policy timeout
      ↓
AbortController.abort()
      ↓
guard receives AbortSignal
      ↓
underlying operation may cancel
```

The library creates a **linked** AbortController:
- External signal (from caller) → internal controller
- Timeout → internal controller abort
- Either path triggers cleanup

**Important:** `Promise.race()` does not cancel the underlying operation. The timeout ensures the policy stops waiting, but the actual database/API operation may continue. Guards should respect the AbortSignal parameter for proper cleanup.

## Sealing and Immutability

Calling `.to()` creates a `SealedPolicy`:
- Guard and predicate arrays are frozen (`Object.freeze`)
- No methods exist to add/remove/modify rules
- The action function reference is stored privately
- Only observability listeners can be added post-seal

## Reentrancy Model

Uses `WeakSet<object>` per execution engine instance:
- Before execution: check if context object is already tracked
- During execution: context is tracked
- After execution (success or failure): context is removed from tracking
- **This is per-engine, not global** — no global execution registry exists
