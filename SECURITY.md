# Security Policy — only-core

## What only-core Protects Against

only-core is a **policy enforcement engine**, not a security product. However, it provides specific protections within its domain:

### Protected

| Protection | Mechanism |
|-----------|-----------|
| **Accidental context mutation** | Context strategies (`snapshot`, `immutable`) create copies or freeze the context before passing it to guards/predicates/actions |
| **Pipeline mutation after sealing** | Calling `.to()` seals the policy. Guards and predicates cannot be added or removed afterward. Internal arrays are frozen. |
| **Duplicate concurrent execution** | Reentrancy detection (`reentrancy: 'reject'`) uses a `WeakSet` to track contexts currently being executed |
| **Unbounded guard waiting** | Global and per-rule timeouts ensure guards cannot hang indefinitely. `AbortController.abort()` fires on timeout. |
| **Exactly-once action execution** | The execution engine tracks action invocation per execution ID to prevent double execution |
| **Structured error handling** | All errors carry machine-readable codes. Guard exceptions are never silently converted into successful results |

### NOT Protected (Explicitly)

> **only-core does not replace application-level security infrastructure.**

| Not Protected | Reason |
|--------------|--------|
| Authentication systems | only-core executes auth checks but does not implement authentication |
| Authorization systems | only-core enforces guard results but does not define authorization logic |
| Input validation | Use schema validation libraries (Zod, Valibot, Joi) before or within guards |
| Rate limiting | Implement at the infrastructure or middleware layer |
| CSRF protection | Framework/middleware responsibility |
| XSS protection | Template engine / output encoding responsibility |
| Database transactions | Use database-level transaction mechanisms |
| Distributed locks | Use a distributed coordination service |
| Secret management | Use a secrets manager (Vault, AWS Secrets Manager, etc.) |
| Prototype-pollution defenses | Context isolation reduces mutation risks but is not a substitute for input sanitization |

### Context Isolation — Honest Guarantees

> "Context isolation reduces accidental or intentional mutation of the execution snapshot. It is not a substitute for input sanitization, schema validation, or application-level prototype-pollution defenses."

| Strategy | Guarantee | Limitation |
|----------|-----------|-----------|
| `reference` | None. Original object passed directly. | No protection at all |
| `snapshot` | Top-level properties are isolated | Nested objects share references with the original |
| `immutable` | All enumerable properties are deeply cloned and frozen | Does not clone/freeze `Map`, `Set`, `WeakMap`, `WeakSet`, `Date`, `RegExp`, typed arrays, or class instances (copied by reference). Circular references unsupported. |

### Timeout vs Cancellation — Security Implications

**Timeout enforcement ≠ operation cancellation.**

When a policy times out:
1. The policy rejects with `PolicyTimeoutError`
2. `AbortController.abort()` fires
3. Guards that respect `AbortSignal` can clean up
4. **Guards that do NOT respect `AbortSignal` may continue executing**

This means a timed-out database query or API call may still complete in the background. Design guards to accept and respect the `AbortSignal` parameter.

## Reporting Vulnerabilities

If you discover a security vulnerability in only-core, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email: security@only-core.dev (or the maintainer's email)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a timeline for resolution.

## Security Design Principles

1. **Zero dependencies** — No supply chain attack surface
2. **No global state** — No global execution registry
3. **No logging by default** — Silent unless explicitly configured
4. **No network calls** — The core never makes network requests
5. **Structured errors** — Consumers never need to parse error messages
6. **Immutable sealed policies** — Policies cannot be modified after construction
7. **Explicit over implicit** — All behavior is configurable and documented
