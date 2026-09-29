only-core — Production Architecture Direction

1. Product Definition

Position it as:

> A zero-dependency, TypeScript-first policy execution engine for enforcing preconditions before executing business actions.



The important distinction is that only-core should not become an authorization framework, validation library, workflow engine, or general-purpose rules engine.

Its job is:

Context
   ↓
Policy
   ↓
Guards
   ↓
Predicates
   ↓
Action
   ↓
Result

And the fundamental guarantee should be:

> The action is never invoked unless every required enforcement stage has successfully completed.



That should become the central invariant of the entire project.


---

2. Recommended Public API

Keep your existing API, but expand it carefully.

Core

policy()
.only()
.where()
.to()

Configuration

timeout
mode
concurrency
error strategy
context strategy

Observability

.tap()
.onError()
.onComplete()

Composition

.use()
.compose()
.extend()

Execution

execute()

Advanced

.abort()
.signal()
metadata
execution IDs
rule IDs

The API should remain small even if the internal engine becomes sophisticated.


---

3. Make the Pipeline Model More Explicit

I would define the architecture as four conceptual layers rather than three.

┌─────────────────────────────┐
│        INPUT CONTEXT        │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│     CONTEXT PREPARATION     │
│ normalization / snapshot    │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│       ENFORCEMENT           │
│                             │
│ .only()                     │
│ .where()                    │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│         EXECUTION           │
│                             │
│ .to()                       │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│     RESULT / TELEMETRY      │
└─────────────────────────────┘

This gives you room later for:

cancellation

telemetry

tracing

error normalization

execution IDs

context transformation

policy composition


without changing the fundamental programming model.


---

4. Separate "Guard" From "Predicate"

This distinction is excellent in your proposal. Make it an explicit architectural rule.

.only()

For things that may involve external state:

authentication
authorization
subscription
account state
database lookup
feature entitlement
signature verification
rate-limit checks
external service checks

Characteristics:

potentially asynchronous

timeout-aware

cancellation-aware

potentially expensive

can throw

should be treated as a critical enforcement boundary


.where()

For deterministic local state:

amount > 0
items.length > 0
status === "draft"
country === "IN"

Characteristics:

synchronous

deterministic

cheap

no external I/O

no timeout required


This distinction gives users architectural guidance rather than merely providing two methods.


---

5. Add a Dedicated .assert() Concept Carefully

One useful future feature would be:

.only()
.where()
.assert()
.to()

But only if it has a clearly different semantic purpose.

For example:

.only()

means:

> external/domain enforcement



.where()

means:

> context state must satisfy a condition



.assert()

could mean:

> developer invariant that indicates a programming/configuration error



Example conceptual distinction:

where:
"User cannot purchase an empty cart."

assert:
"Policy configuration unexpectedly produced an invalid execution state."

However, I would not implement this in v1 unless real use cases demonstrate the need. API surface should grow from actual requirements.


---

6. Context Handling Needs More Thought

Your current shallow-copy approach is useful, but don't market it as complete protection against prototype pollution or malicious mutation.

A shallow freeze only protects the top-level object.

For example:

ctx.user.name

can still potentially be changed if user itself isn't frozen.

More importantly, Object.freeze() does not make arbitrary application objects universally safe.

I would define three explicit context strategies.

reference

Use the original object.

Fastest.

contextStrategy: "reference"

snapshot

Create a shallow snapshot.

contextStrategy: "snapshot"

Good default for lightweight contexts.

immutable

Deep-freeze supported structures.

contextStrategy: "immutable"

Potentially expensive.

The documentation should explicitly state the guarantees and limitations of each.


---

7. Do Not Promise "Prototype Pollution Prevention"

This is an important production-readiness correction.

only-core can reduce mutation risks, but it cannot guarantee that the application is immune to prototype pollution.

Instead document:

> "Context isolation reduces accidental or intentional mutation of the execution snapshot. It is not a substitute for input sanitization, schema validation, or application-level prototype-pollution defenses."



That's much more defensible.


---

8. Cancellation Should Become a First-Class Feature

This is one of the biggest additions I'd make.

Use the platform's AbortSignal model conceptually.

A policy execution should be able to receive:

context
signal

or an execution object containing:

context
signal
executionId
metadata

This allows:

request cancelled
     ↓
policy execution cancelled
     ↓
guards receive cancellation
     ↓
action receives cancellation

This is much more useful than relying exclusively on timeouts.

Important distinction

Timeout:

> "The policy waited too long."



Cancellation:

> "The caller no longer wants this operation."



Both should exist.


---

9. Fix the Timeout Philosophy

Your current Promise.race() concept is good for deciding when the policy should stop waiting.

But there is a crucial limitation:

> Promise.race() does not actually cancel the underlying operation.



For example:

database request
       ↓
Promise.race()
       ↓
timeout

The database request may still continue after the policy has rejected.

Therefore production architecture should be:

Policy timeout
      ↓
AbortController.abort()
      ↓
guard receives AbortSignal
      ↓
underlying operation may cancel

while still retaining a timeout fallback for operations that don't support cancellation.

Documentation should explicitly distinguish:

timeout enforcement

from

underlying operation cancellation

That distinction will save you from a lot of production confusion.


---

10. Error Architecture Should Be Much Richer

PolicyViolationError is a good starting point.

I'd create a structured error hierarchy conceptually like:

OnlyCoreError
│
├── PolicyViolationError
├── PolicyTimeoutError
├── PolicyCancelledError
├── PolicyConfigurationError
├── PolicyExecutionError
└── PolicyReentrancyError

And every error should carry structured information such as:

policy
phase
rule
ruleId
executionId
reason
timestamp
duration
cause

Potentially:

error.code

with stable machine-readable values.

For example:

POLICY_VIOLATION
POLICY_TIMEOUT
POLICY_CANCELLED
POLICY_REENTRANT
POLICY_CONFIGURATION
POLICY_EXECUTION

Do not make consumers parse error messages.


---

11. Introduce Stable Rule IDs

Function names aren't reliable identifiers.

This:

.only(isAuthenticated)

might produce:

isAuthenticated

but anonymous functions won't.

And minifiers can change function names.

Give rules stable IDs.

Conceptually:

.only("authenticated", isAuthenticated)

or perhaps support both:

.only(isAuthenticated)
.only("authenticated", isAuthenticated)

I strongly recommend the explicit form for enterprise use.

Then telemetry can say:

policy: OrderCheckout
rule: authenticated
phase: guard

rather than relying on JavaScript function names.


---

12. Make Rule Metadata Possible

Eventually users will want:

rule name
description
tags
severity
timeout
metadata

For example:

authenticated
authorization
billing
fraud-check

This makes telemetry significantly more useful.

But keep metadata optional.


---

13. Global Timeout vs Per-Rule Timeout

Your current design has:

timeoutMs

for all guards.

Production systems will eventually need:

global timeout

and:

rule timeout

For example:

authentication: 1000ms
subscription: 2000ms
fraud check: 5000ms

Conceptually:

policy(..., {
    timeoutMs: 5000
})

.only(..., {
    timeoutMs: 1000
})

The rule timeout should never exceed the overall execution boundary.

This should be specified formally.


---

14. Parallel Mode Needs a Clear Contract

Your parallel mode is useful, but the semantics need to be crystal clear.

There are two different concepts:

Parallel fail-fast

Start all rules, but return as soon as one fails.

Parallel aggregate

Run all rules and report every failure.

Your current Promise.allSettled() design is the second.

I'd explicitly name the modes rather than making "parallel" carry ambiguous meaning.

For example:

sequential
parallel

with:

failureStrategy:
  fail-fast
  aggregate

That gives you:

mode: sequential
failureStrategy: fail-fast

or:

mode: parallel
failureStrategy: aggregate

Much clearer.


---

15. Be Careful With Parallel Guards

Parallel execution introduces an important rule:

> Guards running in parallel must be independent.



If guard B depends on a mutation or result from guard A, parallel execution becomes unsafe.

Therefore document:

Guards must be observational and independent.

Even better:

> A guard must not mutate the context or depend on side effects produced by another guard.



This should be part of the core contract.


---

16. I Would Remove Rollback From the Core

Your Saga idea is interesting, but I would not put rollback directly into the basic policy engine.

Why?

Because now you're moving from:

policy enforcement

toward:

distributed transaction orchestration

Those are very different responsibilities.

Instead, provide an extension point later:

only-core
    ↓
only-core-composition
    ↓
workflow/saga package

Keep the core extremely predictable.


---

17. Add Policy Composition

This is one of the most valuable advanced features.

Imagine:

AuthenticatedUser

and:

ActiveSubscription

and:

VerifiedAccount

Then another policy can reuse them.

Conceptually:

checkoutPolicy
  .use(authenticatedUser)
  .use(activeSubscription)
  .use(verifiedAccount)
  .where(...)
  .to(...)

This prevents duplicated guards across applications.

It also allows teams to establish reusable organizational policies.


---

18. Add Policy Groups

Another useful abstraction:

policy("Checkout")
    .use(SecurityPolicy)
    .use(BillingPolicy)
    .use(InventoryPolicy)
    .to(...)

This creates a hierarchy:

Reusable policy
       ↓
Composite policy
       ↓
Application policy
       ↓
Action

But again, don't make this recursive and infinitely complex. Put sensible limits around composition.


---

19. Add a Policy Introspection API

Enterprise users will eventually ask:

> "What does this policy contain?"



So provide read-only introspection.

Conceptually:

policy.describe()

could return:

{
  name,
  mode,
  rules,
  predicates,
  configuration
}

Never expose mutable internal functions in a way that allows policy modification.

This becomes useful for:

debugging

documentation generators

telemetry

admin dashboards

testing



---

20. Add Execution IDs

Every invocation should optionally receive an execution identifier.

Example:

executionId: exec_01...

Then telemetry can correlate:

policy
  ↓
execution
  ↓
rule 1
  ↓
rule 2
  ↓
action

This becomes extremely useful when debugging distributed systems.

Do not make users supply the ID unless they want correlation with their own tracing system.


---

21. Observability Should Be Event-Based

Your .tap() idea is good.

I'd define a stable event model rather than passing arbitrary values.

Possible events:

policy:start
rule:start
rule:success
rule:failure
rule:timeout
predicate:start
predicate:success
predicate:failure
action:start
action:success
action:failure
policy:success
policy:failure
policy:cancelled

Each event could include:

policyName
executionId
phase
ruleId
timestamp
duration

Then users can connect it to:

OpenTelemetry
Datadog
Prometheus
custom logging
application metrics

without only-core depending on any of them.


---

22. Keep Observability Zero-Dependency

Do not integrate directly with:

OpenTelemetry
Datadog
Sentry
New Relic
Prometheus

inside the core.

Instead:

only-core
     ↓
events
     ↓
adapter
     ↓
observability platform

That preserves your zero-dependency promise.


---

23. Don't Log by Default

Your current idea here is correct.

Default behavior:

no console.log
no console.error
no telemetry
no network calls
no global state

The library should be silent unless explicitly configured.


---

24. Reentrancy Needs Precise Semantics

The WeakSet concept is useful, but document exactly what it means.

The question is:

> What constitutes the same execution?



If the same context object is intentionally used by two independent callers, should that be prohibited?

You need to make that a deliberate contract.

I'd consider making reentrancy protection configurable:

reentrancy:
  reject
  allow

Default:

reject

But users who intentionally share immutable contexts may need another behavior.


---

25. Consider Execution Tokens Instead of Context Identity

For more advanced usage, you could eventually have:

policy.execute(context)

and internally create an execution record:

Execution {
    id
    context
    state
    signal
}

Then reentrancy is attached to an execution lifecycle rather than merely the object reference.

That gives you a cleaner conceptual model.


---

26. Define the State Machine

This is extremely important before implementation.

A policy execution should have defined states:

CREATED
   ↓
PREPARING
   ↓
GUARDING
   ↓
PREDICATING
   ↓
EXECUTING
   ↓
COMPLETED

Failure paths:

GUARDING ──→ REJECTED
PREDICATING ─→ REJECTED
EXECUTING ──→ FAILED
any stage ──→ TIMEOUT
any stage ──→ CANCELLED

Once you have this state model, many edge cases become easier to reason about.


---

27. Define the Core Invariants

Before writing implementation, create a document containing invariants.

For example:

Invariant 1

Action cannot execute if any guard fails.

Invariant 2

Action cannot execute if any predicate fails.

Invariant 3

A sealed policy cannot be structurally modified.

Invariant 4

A running execution always releases execution bookkeeping.

Invariant 5

Timeouts cannot leave internal timers alive.

Invariant 6

Cancellation releases execution bookkeeping.

Invariant 7

Guard exceptions are never silently converted into successful results.

Invariant 8

Observability cannot change policy behavior.

Invariant 9

One execution cannot accidentally execute the action twice.

Invariant 10

The library maintains no global execution registry.

These invariants should drive your tests.


---

28. Add Exactly-Once Action Semantics

One particularly important guarantee:

> A single policy execution must invoke .to() at most once.



Even if:

promise resolves twice
callback misbehaves
telemetry throws

the action must not accidentally execute twice.

This should be explicitly tested.


---

29. Think About Thenables

Production JavaScript libraries should not assume every returned value is a native Promise.

Users may return:

Promise

or:

thenable

or:

boolean

or:

string

Your execution model should define how thenables are handled.

Promise normalization should happen at the execution boundary.


---

30. Define Error Propagation Precisely

There should be a documented difference between:

policy violation

and:

application failure

For example:

guard returns false
        ↓
PolicyViolationError

while:

database throws
        ↓
original error / wrapped execution error

You should preserve the original error as cause where appropriate.

Don't destroy useful stack traces.


---

31. Treat User Errors Differently From Policy Errors

A guard can legitimately throw:

DatabaseConnectionError

That isn't necessarily a policy violation.

Therefore define a rule like:

> A returned negative verdict represents policy rejection. An exception represents execution failure unless explicitly configured otherwise.



That's a very clean semantic boundary.


---

32. TypeScript Should Be a First-Class Design Constraint

Don't build JavaScript first and bolt TypeScript onto it afterward.

Design the API around TypeScript inference.

The ideal experience is:

policy(...)
   .only(...)
   .where(...)
   .to(...)

where the editor understands the context type throughout the chain.

Consider allowing an explicit generic:

policy<MyContext>("Checkout")

but also allow inference when possible.


---

33. Consider Schema Integration Without Depending on Schemas

Don't build Zod, Valibot, Joi, etc. into the core.

But make it easy to use them:

schema validation
       ↓
only-core policy
       ↓
action

Potentially expose a generic guard adapter API.

This keeps the core zero-dependency while making it ecosystem-friendly.


---

34. Browser Support Needs an Explicit Compatibility Policy

"Modern browsers" should not remain vague.

Document supported environments around capabilities:

ES2022+
AbortController
Promise
WeakSet
Object.freeze
private class fields

Then define your actual support matrix.

For Node:

supported Node LTS versions

For browsers:

Chrome
Firefox
Safari
Edge

You don't necessarily need polyfills because zero-dependency is part of the product.


---

35. Packaging Should Be Excellent

Your package should eventually provide:

ESM
CommonJS
TypeScript declarations
source maps

And correct package exports.

Conceptually:

exports
 ├── import
 ├── require
 └── types

Avoid exposing internal modules.

Public API should be intentionally tiny.


---

36. Consider Separate Entry Points

Potential future package structure:

only-core
only-core/testing
only-core/adapters

For example:

only-core/testing

could expose utilities for:

mock contexts
assert policy violations
inspect execution events

But don't put testing helpers into the production runtime.


---

37. Testing Strategy

Don't chase "100% coverage" as the primary quality metric.

Coverage is useful, but your real target should be behavioral guarantees.

Build a matrix around:

Guard behavior

true
false
string
throw
reject
timeout
cancel

Predicate behavior

true
false
throw
return thenable

Action behavior

success
throw
reject
timeout
cancel

Pipeline lifecycle

append before .to()
append after .to()
execute twice
same context concurrently
different contexts concurrently

Modes

sequential
parallel

Context

mutation attempt
nested object mutation
prototype behavior
null
undefined
primitive

Resource safety

timer cleanup
WeakSet cleanup
repeated execution
high concurrency


---

38. Add Property-Based / Stress Testing Later

This project is particularly suitable for stress testing.

Test things like:

10,000 concurrent executions

with randomized:

guard outcomes
timeouts
throws
cancellations

Then verify invariants.

This will uncover lifecycle bugs that normal unit tests may miss.


---

39. Benchmarking

Create a benchmark suite comparing:

direct function call

against:

one guard

five guards

ten guards

sequential

parallel

with telemetry

without telemetry

Don't optimize prematurely.

Your target should be:

> Policy enforcement overhead should be negligible relative to the I/O and business operations it protects.




---

40. Security Model
Create a dedicated SECURITY.md.
Document that only-core protects against:
accidental context mutation
pipeline mutation after sealing
duplicate concurrent execution
unbounded guard waiting
But explicitly state that it does not replace:
authentication systems
authorization systems
input validation
rate limiting
CSRF protection
XSS protection
database transactions
distributed locks
secret management
prototype-pollution defenses
This is extremely important for an enterprise library.
41. Don't Call It an Authorization Framework
Even though .only() sounds authorization-oriented, your product is broader.
I'd describe it as:
Policy enforcement and controlled execution.
Authorization can be implemented using it, but isn't its exclusive purpose.
That leaves room for:
security policies
business policies
data policies
workflow preconditions
resource policies
feature policies
42. Recommended Feature Roadmap
The milestones below describe the staged development plan. They are implemented
in the current `1.0.0` package; treat them as completed scope, not upcoming
release promises. The stable public contract is documented in
`docs/api/reference.md` and recorded in `CHANGELOG.md`.

v0.1 — Engine
Ship only:
policy
.only
.where
.to
PolicyViolationError
sequential execution
timeouts
context snapshot
reentrancy protection
Goal:
Prove the execution model.
v0.2 — Reliability
Add:
AbortSignal
cancellation
structured errors
execution IDs
per-rule timeout
better cleanup
Goal:
Make lifecycle behavior production-safe.
v0.3 — Parallelism
Add:
parallel mode
aggregate failures
concurrency controls
Goal:
Support independent external guards efficiently.
v0.4 — Observability
Add:
tap
events
execution metadata
rule timing
success/failure metrics
Goal:
Make production debugging possible.
v0.5 — Composition
Add:
use
compose
policy reuse
policy introspection
Goal:
Allow large applications to build policy libraries.
v1.0 — Stable Contract
Freeze:
public API
error codes
event schema
configuration semantics
TypeScript types
package exports
Then commit to backwards compatibility.
43. Recommended Repository Architecture
Keep the project roughly conceptually organized like:
only-core/
│
├── src/
│   ├── policy/
│   ├── execution/
│   ├── guards/
│   ├── predicates/
│   ├── errors/
│   ├── context/
│   ├── cancellation/
│   ├── telemetry/
│   └── composition/
│
├── test/
│   ├── unit/
│   ├── integration/
│   ├── concurrency/
│   ├── cancellation/
│   ├── errors/
│   └── stress/
│
├── benchmarks/
│
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── concepts/
│   ├── security/
│   └── recipes/
│
├── examples/
│
├── README
├── SECURITY
├── CHANGELOG
└── package
Don't let the implementation structure leak into the public API.
44. Documentation Structure
Your documentation should teach the mental model before listing methods.
I'd structure it as:
1. Introduction
2. Why only-core exists
3. Core mental model
4. Installation
5. First policy
6. Guards
7. Predicates
8. Actions
9. Errors
10. Timeouts
11. Cancellation
12. Sequential execution
13. Parallel execution
14. Context isolation
15. Reentrancy
16. Observability
17. Composition
18. TypeScript
19. Browser usage
20. Node.js usage
21. Security model
22. Performance
23. Testing
24. FAQ
25. API reference
45. The Most Important Documentation Page
Create:
"What only-core guarantees"
And explicitly list guarantees.
For example:
Guaranteed
.to() cannot run after a failed guard.
.to() cannot run after a failed predicate.
A sealed pipeline cannot accept new rules.
Active execution bookkeeping is released.
Guard timeouts terminate policy waiting.
Concurrent reuse of the same context can be rejected.
Errors are represented structurally.
No external dependencies are required.
Not guaranteed
A timed-out underlying network operation is automatically cancelled.
Object.freeze() makes nested objects immutable.
only-core provides authentication.
only-core provides database transactions.
only-core prevents all prototype-pollution vulnerabilities.
Parallel guards are automatically safe if they have side effects.
That page will prevent users from misunderstanding the library.
46. One Major Architectural Change I'd Make
I would make execution a first-class concept internally.
Instead of thinking:
dispatch(context)
think:
Execution
│
├── policy
├── context
├── signal
├── executionId
├── state
├── startedAt
├── currentPhase
└── cleanup
Then the runtime operates:
create Execution
       ↓
prepare context
       ↓
run guards
       ↓
run predicates
       ↓
run action
       ↓
emit completion
       ↓
cleanup execution
This will make cancellation, telemetry, timeout handling, tracing, and future features dramatically easier to implement correctly.
47. Your Final Product Mental Model
I'd make this the central diagram of the documentation:
                    ┌─────────────────┐
                    │     CONTEXT     │
                    └────────┬────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │   POLICY EXECUTION  │
                  │                     │
                  │ executionId         │
                  │ AbortSignal         │
                  │ timeout             │
                  │ metadata            │
                  └──────────┬──────────┘
                             │
                             ▼
              ┌─────────────────────────────┐
              │       ENFORCEMENT           │
              │                             │
              │  .only() → external guards │
              │  .where() → local rules    │
              └──────────────┬──────────────┘
                             │
                       all passed?
                         /       \
                       NO         YES
                       │           │
                       ▼           ▼
                    REJECT      .to()
                                   │
                                   ▼
                                RESULT
                                   │
                                   ▼
                              OBSERVABILITY
                                   │
                                   ▼
                                 CLEANUP
48. What I Would Actually Build
If this were my project, I would not start by implementing every feature above.
I'd build the first production architecture around these principles:
                    only-core
                       │
        ┌──────────────┼───────────────┐
        │              │               │
    Enforcement    Execution       Lifecycle
        │              │               │
    .only()        .to()          timeout
    .where()       result         cancellation
                   errors         cleanup
                                   │
                              reentrancy
Then add:
v0.x
   ↓
reliable lifecycle
   ↓
parallel execution
   ↓
observability
   ↓
composition
   ↓
v1 API stabilization
The most important design decision is not adding more methods. It's defining the execution semantics so precisely that users can trust the statement:
Once a policy action starts, every required enforcement boundary has already passed; if enforcement does not complete successfully, the action does not execute.
That gives only-core a much stronger identity than simply being a fluent collection of guards.