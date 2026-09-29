# only-core

A zero-runtime-dependency, TypeScript-first policy execution engine for enforcing preconditions before business actions run.

> **Guarantee:** a policy action runs only after every guard and predicate has passed. This guarantee applies within one execution. It does not make external checks and writes transactional, distributed, or idempotent.

## What It Is

`only-core` provides an ordered policy pipeline:

```text
context -> guards -> predicates -> protected action -> result
```

- **Guards (`.only()`)** perform potentially asynchronous checks against external systems.
- **Predicates (`.where()`)** perform synchronous checks against local context or application state.
- **Actions (`.to()`)** contain the business operation and run only after enforcement succeeds.

It is an enforcement and orchestration primitive, not an authentication provider, authorization framework, schema validator, workflow engine, database transaction manager, or distributed lock service.

## Installation

The supported installation path is cloning this repository. There is no npm-registry installation documented or required.

```bash
git clone https://github.com/lilashish-dev/only-core.git
cd only-core
npm install
npm run build
npm test
```

Requires Node.js 18 or newer. `npm install` installs this repository's development dependencies; the library itself has no runtime dependencies. Work from the cloned repository and its examples, or use the clone as a local dependency from your application after building it.

## Quick Start

```typescript
import { policy, PolicyViolationError } from './src/index.js';

interface PublishContext {
  actorId: string;
  documentId: string;
  reviewerApproved: boolean;
}

const publishDocument = policy<PublishContext>('Publish document', {
  timeoutMs: 5000,
})
  .only('workspace-editor', async (context, signal) => {
    return await accessService.isEditor(context.actorId, { signal })
      || 'Actor cannot edit this workspace';
  })
  .where('review-approved', (context) =>
    context.reviewerApproved || 'Reviewer approval is required'
  )
  .to(async (context, signal) =>
    documentService.publish(context.documentId, { signal })
  );

try {
  const result = await publishDocument.execute({
    actorId: 'editor-42',
    documentId: 'doc-103',
    reviewerApproved: true,
  });
  console.log(result.value, result.executionId, result.duration);
} catch (error) {
  if (error instanceof PolicyViolationError) {
    console.error(error.code, error.violations);
  }
  throw error;
}
```

Import from `./src/index.js` when running TypeScript through a compatible tool. For compiled JavaScript, build first and import from `./dist/index.js`.

## Configuration and Execution

```typescript
policy<Context>('Policy name', {
  timeoutMs: 5000,                    // default 30000; 0 or Infinity disables
  mode: 'parallel',                   // 'sequential' by default
  concurrency: 4,                     // parallel guard limit; Infinity by default
  failureStrategy: 'fail-fast',       // or 'aggregate'
  contextStrategy: 'snapshot',        // reference, snapshot, immutable
  reentrancy: 'reject',               // or allow
});
```

- Parallel guards must be independent. `concurrency` is a positive integer or `Infinity`.
- Parallel `fail-fast` aborts active sibling signals and does not start queued guards after a failure. Underlying work stops only if it honors `AbortSignal`.
- `aggregate` gathers policy violations in registration order. Unexpected guard exceptions, timeouts, and cancellation remain execution errors, not ordinary policy violations.
- `snapshot` shallow-copies the outer context; nested values are shared. `immutable` clones/freezes arrays and plain objects. Non-plain instances and built-ins such as `Map`, `Set`, `Date`, and typed arrays are not cloned/frozen; circular input is unsupported.
- `.execute()` returns a successful result or throws a structured error. The public `PolicyOutcome` type does not change this runtime behavior.
- `.use()`, `.compose()`, and `.extend()` reuse guards and predicates. They do not inherit source actions, telemetry listeners, or configuration.

See the [API reference](docs/api/reference.md) for the complete contract.

## Use Cases

Good fits are operations with explicit preconditions and one protected action:

- Document publishing: editor access, review approval, complete content, resolved comments.
- AI generation: identity and entitlement checks before a reservation/generation action. Credit and quota reservation must be atomic in the system that owns the balance; separate checks in guards can race.
- API access: key validity, allowlists, and independent external eligibility checks.
- Feature access: entitlement checks before exposing a capability.
- Administrative changes: role, approval, and state-transition preconditions.
- Job dispatch: tenant access, job eligibility, and idempotent dispatch.

An in-memory document workflow is available in [examples/document-publishing.ts](examples/document-publishing.ts), with integration tests in [test/integration/document-publishing.test.ts](test/integration/document-publishing.test.ts). It demonstrates policy behavior and local state mutation, not real identity/database integrations.

## Where It Is Not Enough

Do not rely on `only-core` alone for authentication, authorization policy design, input/schema validation, rate limiting, fraud detection, payment safety, distributed coordination, or atomic resource accounting. Implement those in trusted application services and infrastructure. Use database transactions, conditional updates, idempotency keys, leases, or distributed locks where the invariant requires them.

For example, two AI requests can both observe one available credit if checks are separate. Put the final eligibility check and credit/quota reservation in one atomic ledger operation. `only-core` can gate generation on that reservation result, but it cannot prevent double-spending itself. See [AI generation and atomic credits](docs/recipes/examples.md#ai-generation-atomic-credits-and-quota).

## Security and Reliability

The library does not make untrusted input safe. Review [SECURITY.md](SECURITY.md) and the [security model](docs/security/model.md) before using it across trust boundaries. In particular, timeouts stop the policy waiting and abort signals; they do not forcibly stop non-cooperative external work. Keep errors and rule details out of untrusted client responses.

## Benchmarks and Tests

Run the full suite with `npm test`, repeated-execution stress checks with `npm run test:stress`, and the diagnostic latency/memory benchmarks with `npm run benchmark` and `npm run benchmark:memory`. Method and observed results are in [BENCHMARKS.md](BENCHMARKS.md). Measurements are local Node.js microbenchmarks, not service-level guarantees.

## Reporting Issues

For bugs, questions, or security concerns, email **ikkegoon@gmail.com**. Include the Node.js version, reproduction steps, expected behavior, and actual behavior. Please avoid sending credentials, tokens, customer data, or other secrets.

## License

MIT. See [LICENSE](LICENSE).
