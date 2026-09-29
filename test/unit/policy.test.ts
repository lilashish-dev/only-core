/**
 * only-core — Core Policy Tests
 *
 * Tests organized around the behavioral guarantee matrix:
 *
 * Guard behavior:  true, false, string, throw, reject, timeout, cancel
 * Predicate:       true, false, throw
 * Action:          success, throw, reject, timeout, cancel
 * Pipeline:        append before/after .to(), execute twice
 * Modes:           sequential, parallel
 * Context:         mutation attempt, nested mutation, null, undefined
 * Resource safety: timer cleanup, WeakSet cleanup, repeated execution
 */

import { describe, it, expect, vi } from 'vitest';
import {
  policy,
  PolicyViolationError,
  PolicyTimeoutError,
  PolicyCancelledError,
  PolicyExecutionError,
  PolicyReentrancyError,
  PolicyConfigurationError,
  ErrorCode,
} from '../src/index.js';

// ─── Helper Types ───────────────────────────────────────────────────────

interface TestContext {
  userId: string;
  amount: number;
  items: string[];
  status: string;
}

const validContext: TestContext = {
  userId: 'user_123',
  amount: 100,
  items: ['item1', 'item2'],
  status: 'active',
};

// ─── Helper Functions ───────────────────────────────────────────────────

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── 1. Policy Creation ────────────────────────────────────────────────

describe('Policy Creation', () => {
  it('creates a policy with a name', () => {
    const p = policy<TestContext>('TestPolicy')
      .to((ctx) => ctx.amount);

    expect(p.name).toBe('TestPolicy');
  });

  it('throws on empty policy name', () => {
    expect(() => policy('')).toThrow(PolicyConfigurationError);
  });

  it('rejects invalid timeout and concurrency configuration', () => {
    expect(() => policy('InvalidConcurrency', { concurrency: 0 })).toThrow(PolicyConfigurationError);
    expect(() => policy('InvalidConcurrency', { concurrency: 1.5 })).toThrow(PolicyConfigurationError);
    expect(() => policy('InvalidTimeout', { timeoutMs: -1 })).toThrow(PolicyConfigurationError);
    expect(() => policy('InvalidTimeout', { timeoutMs: Number.NaN })).toThrow(PolicyConfigurationError);
  });

  it('throws when .to() receives a non-function', () => {
    expect(() =>
      policy<TestContext>('Test')
        // @ts-expect-error testing runtime behavior
        .to('not a function')
    ).toThrow(PolicyConfigurationError);
  });

  it('creates a policy with custom config', () => {
    const p = policy<TestContext>('Test', {
      timeoutMs: 5000,
      mode: 'parallel',
      failureStrategy: 'aggregate',
      contextStrategy: 'immutable',
      reentrancy: 'allow',
    }).to((ctx) => ctx);

    const desc = p.describe();
    expect(desc.mode).toBe('parallel');
    expect(desc.concurrency).toBe(Infinity);
    expect(desc.failureStrategy).toBe('aggregate');
    expect(desc.contextStrategy).toBe('immutable');
    expect(desc.reentrancy).toBe('allow');
    expect(desc.timeoutMs).toBe(5000);
  });
});

// ─── 2. Guard Behavior (.only()) ────────────────────────────────────────

describe('Guard Behavior (.only())', () => {
  it('passes when guard returns true', async () => {
    const p = policy<TestContext>('Test')
      .only('auth', () => true)
      .to((ctx) => ctx.amount);

    const result = await p.execute(validContext);
    expect(result.success).toBe(true);
    expect(result.value).toBe(100);
  });

  it('rejects when guard returns false', async () => {
    const p = policy<TestContext>('Test')
      .only('auth', () => false)
      .to((ctx) => ctx.amount);

    await expect(p.execute(validContext)).rejects.toThrow(PolicyViolationError);
  });

  it('rejects with reason when guard returns a string', async () => {
    const p = policy<TestContext>('Test')
      .only('auth', () => 'User is not authenticated')
      .to((ctx) => ctx.amount);

    try {
      await p.execute(validContext);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PolicyViolationError);
      const violation = error as PolicyViolationError;
      expect(violation.violations[0].reason).toBe('User is not authenticated');
      expect(violation.code).toBe(ErrorCode.POLICY_VIOLATION);
    }
  });

  it('wraps guard exceptions as PolicyExecutionError', async () => {
    const dbError = new Error('Connection refused');

    const p = policy<TestContext>('Test')
      .only('db-check', () => { throw dbError; })
      .to((ctx) => ctx.amount);

    try {
      await p.execute(validContext);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PolicyExecutionError);
      expect((error as PolicyExecutionError).cause).toBe(dbError);
      expect((error as PolicyExecutionError).code).toBe(ErrorCode.POLICY_EXECUTION);
    }
  });

  it('handles async guards returning true', async () => {
    const p = policy<TestContext>('Test')
      .only('async-auth', async () => {
        await delay(10);
        return true;
      })
      .to((ctx) => ctx.amount);

    const result = await p.execute(validContext);
    expect(result.success).toBe(true);
  });

  it('handles async guards returning false', async () => {
    const p = policy<TestContext>('Test')
      .only('async-auth', async () => {
        await delay(10);
        return false;
      })
      .to((ctx) => ctx.amount);

    await expect(p.execute(validContext)).rejects.toThrow(PolicyViolationError);
  });

  it('handles async guards that reject', async () => {
    const p = policy<TestContext>('Test')
      .only('async-fail', async () => {
        await delay(10);
        throw new Error('Network error');
      })
      .to((ctx) => ctx.amount);

    await expect(p.execute(validContext)).rejects.toThrow(PolicyExecutionError);
  });

  it('supports named guards with explicit IDs', async () => {
    const p = policy<TestContext>('Test')
      .only('authenticated', () => true)
      .only('authorized', () => false)
      .to((ctx) => ctx.amount);

    try {
      await p.execute(validContext);
      expect.fail('Should have thrown');
    } catch (error) {
      const violation = error as PolicyViolationError;
      expect(violation.violations[0].ruleId).toBe('authorized');
    }
  });

  it('supports guards with metadata', async () => {
    const p = policy<TestContext>('Test')
      .only('auth', () => true, {
        description: 'Checks authentication',
        tags: ['security'],
        severity: 'critical',
      })
      .to((ctx) => ctx.amount);

    const desc = p.describe();
    expect(desc.guards[0].metadata.description).toBe('Checks authentication');
    expect(desc.guards[0].metadata.tags).toEqual(['security']);
    expect(desc.guards[0].metadata.severity).toBe('critical');
  });

  it('extracts rule ID from function name when no explicit ID given', async () => {
    function isAuthenticated() { return true; }

    const p = policy<TestContext>('Test')
      .only(isAuthenticated)
      .to((ctx) => ctx.amount);

    const desc = p.describe();
    expect(desc.guards[0].id).toBe('isAuthenticated');
  });

  it('generates rule ID for anonymous functions', async () => {
    const p = policy<TestContext>('Test')
      .only(() => true)
      .to((ctx) => ctx.amount);

    const desc = p.describe();
    expect(desc.guards[0].id).toMatch(/^rule_\d+$/);
  });
});

// ─── 3. Predicate Behavior (.where()) ──────────────────────────────────

describe('Predicate Behavior (.where())', () => {
  it('passes when predicate returns true', async () => {
    const p = policy<TestContext>('Test')
      .where('has-items', (ctx) => ctx.items.length > 0)
      .to((ctx) => ctx.amount);

    const result = await p.execute(validContext);
    expect(result.success).toBe(true);
  });

  it('rejects when predicate returns false', async () => {
    const p = policy<TestContext>('Test')
      .where('has-items', (ctx) => ctx.items.length > 100)
      .to((ctx) => ctx.amount);

    await expect(p.execute(validContext)).rejects.toThrow(PolicyViolationError);
  });

  it('rejects with reason when predicate returns a string', async () => {
    const p = policy<TestContext>('Test')
      .where('valid-amount', (ctx) =>
        ctx.amount > 0 ? true : 'Amount must be positive'
      )
      .to((ctx) => ctx.amount);

    const result = await p.execute(validContext);
    expect(result.success).toBe(true);

    // Now with invalid context
    await expect(
      p.execute({ ...validContext, amount: -1 })
    ).rejects.toThrow(PolicyViolationError);
  });

  it('wraps predicate exceptions as PolicyExecutionError', async () => {
    const p = policy<TestContext>('Test')
      .where('crash', () => { throw new Error('Unexpected'); })
      .to((ctx) => ctx.amount);

    await expect(p.execute(validContext)).rejects.toThrow(PolicyExecutionError);
  });

  it('predicates run after guards', async () => {
    const order: string[] = [];

    const p = policy<TestContext>('Test')
      .only('guard', () => { order.push('guard'); return true; })
      .where('pred', () => { order.push('predicate'); return true; })
      .to((ctx) => { order.push('action'); return ctx.amount; });

    await p.execute(validContext);
    expect(order).toEqual(['guard', 'predicate', 'action']);
  });
});

// ─── 4. Action Behavior (.to()) ────────────────────────────────────────

describe('Action Behavior (.to())', () => {
  it('executes action and returns result', async () => {
    const p = policy<TestContext>('Test')
      .to((ctx) => ctx.amount * 2);

    const result = await p.execute(validContext);
    expect(result.value).toBe(200);
  });

  it('handles async actions', async () => {
    const p = policy<TestContext>('Test')
      .to(async (ctx) => {
        await delay(10);
        return ctx.amount * 3;
      });

    const result = await p.execute(validContext);
    expect(result.value).toBe(300);
  });

  it('propagates action errors as PolicyExecutionError', async () => {
    const originalError = new Error('Payment failed');
    const p = policy<TestContext>('Test')
      .to(() => { throw originalError; });

    try {
      await p.execute(validContext);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PolicyExecutionError);
      const executionError = error as PolicyExecutionError;
      expect(executionError.cause).toBe(originalError);
      expect(executionError.code).toBe(ErrorCode.POLICY_EXECUTION);
      expect(executionError.info.phase).toBe('action');
    }
  });

  it('action never runs if guard fails', async () => {
    const actionSpy = vi.fn();

    const p = policy<TestContext>('Test')
      .only('fail', () => false)
      .to(actionSpy);

    await expect(p.execute(validContext)).rejects.toThrow(PolicyViolationError);
    expect(actionSpy).not.toHaveBeenCalled();
  });

  it('action never runs if predicate fails', async () => {
    const actionSpy = vi.fn();

    const p = policy<TestContext>('Test')
      .only('pass', () => true)
      .where('fail', () => false)
      .to(actionSpy);

    await expect(p.execute(validContext)).rejects.toThrow(PolicyViolationError);
    expect(actionSpy).not.toHaveBeenCalled();
  });
});

// ─── 5. Central Invariant ──────────────────────────────────────────────

describe('Central Invariant', () => {
  it('action never executes if any guard fails', async () => {
    const actionSpy = vi.fn();

    const p = policy<TestContext>('Test')
      .only('pass1', () => true)
      .only('fail', () => false)
      .only('pass2', () => true)
      .to(actionSpy);

    await expect(p.execute(validContext)).rejects.toThrow(PolicyViolationError);
    expect(actionSpy).not.toHaveBeenCalled();
  });

  it('action never executes if any predicate fails', async () => {
    const actionSpy = vi.fn();

    const p = policy<TestContext>('Test')
      .only('pass', () => true)
      .where('pred1', () => true)
      .where('pred-fail', () => false)
      .to(actionSpy);

    await expect(p.execute(validContext)).rejects.toThrow(PolicyViolationError);
    expect(actionSpy).not.toHaveBeenCalled();
  });
});

// ─── 6. Execution Modes ────────────────────────────────────────────────

describe('Execution Modes', () => {
  it('sequential mode runs guards in order', async () => {
    const order: number[] = [];

    const p = policy<TestContext>('Test', { mode: 'sequential' })
      .only('g1', async () => { await delay(20); order.push(1); return true; })
      .only('g2', async () => { await delay(10); order.push(2); return true; })
      .only('g3', async () => { order.push(3); return true; })
      .to((ctx) => ctx.amount);

    await p.execute(validContext);
    expect(order).toEqual([1, 2, 3]);
  });

  it('parallel mode runs guards concurrently', async () => {
    const order: number[] = [];

    const p = policy<TestContext>('Test', { mode: 'parallel' })
      .only('g1', async () => { await delay(30); order.push(1); return true; })
      .only('g2', async () => { await delay(10); order.push(2); return true; })
      .only('g3', async () => { order.push(3); return true; })
      .to((ctx) => ctx.amount);

    await p.execute(validContext);
    // In parallel, faster guards finish first
    expect(order).toEqual([3, 2, 1]);
  });

  it('sequential fail-fast stops on first failure', async () => {
    const g2Spy = vi.fn(() => true);

    const p = policy<TestContext>('Test', {
      mode: 'sequential',
      failureStrategy: 'fail-fast',
    })
      .only('fail', () => false)
      .only('g2', g2Spy)
      .to((ctx) => ctx.amount);

    await expect(p.execute(validContext)).rejects.toThrow(PolicyViolationError);
    expect(g2Spy).not.toHaveBeenCalled();
  });
});

// ─── 7. Context Strategies ─────────────────────────────────────────────

describe('Context Strategies', () => {
  it('reference strategy passes original context', async () => {
    let receivedCtx: unknown;

    const ctx = { ...validContext };
    const p = policy<TestContext>('Test', { contextStrategy: 'reference' })
      .to((c) => { receivedCtx = c; return c.amount; });

    await p.execute(ctx);
    expect(receivedCtx).toBe(ctx);
  });

  it('snapshot strategy creates a shallow copy', async () => {
    let receivedCtx: unknown;

    const ctx = { ...validContext };
    const p = policy<TestContext>('Test', { contextStrategy: 'snapshot' })
      .to((c) => { receivedCtx = c; return c.amount; });

    await p.execute(ctx);
    expect(receivedCtx).not.toBe(ctx);
    expect(receivedCtx).toEqual(ctx);
  });

  it('immutable strategy freezes context deeply without freezing caller objects', async () => {
    const ctx = { ...validContext, items: ['item1'] };
    const p = policy<TestContext>('Test', { contextStrategy: 'immutable' })
      .to((c) => {
        expect(Object.isFrozen(c)).toBe(true);
        expect(Object.isFrozen(c.items)).toBe(true);
        return c.amount;
      });

    const result = await p.execute(ctx);
    expect(result.success).toBe(true);
    // Original caller objects should remain unfrozen
    expect(Object.isFrozen(ctx)).toBe(false);
    expect(Object.isFrozen(ctx.items)).toBe(false);
  });

  it('immutable strategy does not freeze shared non-plain instances', async () => {
    class ServiceHandle {
      status = 'open';
    }

    const handle = new ServiceHandle();
    const ctx = { details: { count: 1 }, handle };
    const p = policy<typeof ctx>('Test', { contextStrategy: 'immutable' })
      .to((prepared) => {
        expect(prepared.details).not.toBe(ctx.details);
        expect(Object.isFrozen(prepared.details)).toBe(true);
        expect(prepared.handle).toBe(handle);
        expect(Object.isFrozen(prepared.handle)).toBe(false);
        return true;
      });

    await p.execute(ctx);
    expect(Object.isFrozen(handle)).toBe(false);
  });
});

// ─── 8. Timeouts ───────────────────────────────────────────────────────

describe('Timeouts', () => {
  it('times out when guard exceeds timeout', async () => {
    const p = policy<TestContext>('Test', { timeoutMs: 50 })
      .only('slow', async () => {
        await delay(200);
        return true;
      })
      .to((ctx) => ctx.amount);

    await expect(p.execute(validContext)).rejects.toThrow(PolicyTimeoutError);
  });

  it('does not time out when guard completes in time', async () => {
    const p = policy<TestContext>('Test', { timeoutMs: 200 })
      .only('fast', async () => {
        await delay(10);
        return true;
      })
      .to((ctx) => ctx.amount);

    const result = await p.execute(validContext);
    expect(result.success).toBe(true);
  });

  it('aborts the guard signal when a per-rule timeout expires', async () => {
    let observedSignal: AbortSignal | undefined;
    const p = policy<TestContext>('Test', { timeoutMs: 1000 })
      .only('short-timeout', async (_context, signal) => {
        observedSignal = signal;
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return true;
      }, { timeoutMs: 20 })
      .to((context) => context.amount);

    await expect(p.execute(validContext)).rejects.toThrow(PolicyTimeoutError);
    expect(observedSignal?.aborted).toBe(true);
    expect(observedSignal?.reason).toBeInstanceOf(PolicyTimeoutError);
  });
});

// ─── 9. Cancellation ──────────────────────────────────────────────────

describe('Cancellation', () => {
  it('cancels execution via AbortSignal', async () => {
    const controller = new AbortController();

    const p = policy<TestContext>('Test')
      .only('slow', async () => {
        await delay(500);
        return true;
      })
      .to((ctx) => ctx.amount);

    setTimeout(() => controller.abort(), 20);

    await expect(
      p.execute(validContext, { signal: controller.signal })
    ).rejects.toThrow(PolicyCancelledError);
  });

  it('rejects immediately if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const p = policy<TestContext>('Test')
      .only('guard', () => true)
      .to((ctx) => ctx.amount);

    await expect(
      p.execute(validContext, { signal: controller.signal })
    ).rejects.toThrow(PolicyCancelledError);
  });
});

// ─── 10. Reentrancy ───────────────────────────────────────────────────

describe('Reentrancy', () => {
  it('rejects concurrent execution with same context (reject mode)', async () => {
    const ctx = { ...validContext };

    const p = policy<TestContext>('Test', { reentrancy: 'reject' })
      .only('slow', async () => {
        await delay(100);
        return true;
      })
      .to((c) => c.amount);

    const exec1 = p.execute(ctx);
    const exec2 = p.execute(ctx);

    const results = await Promise.allSettled([exec1, exec2]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      PolicyReentrancyError
    );
  });

  it('allows concurrent execution with same context (allow mode)', async () => {
    const ctx = { ...validContext };

    const p = policy<TestContext>('Test', { reentrancy: 'allow' })
      .only('fast', () => true)
      .to((c) => c.amount);

    const [r1, r2] = await Promise.all([
      p.execute(ctx),
      p.execute(ctx),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it('allows concurrent execution with different contexts', async () => {
    const p = policy<TestContext>('Test', { reentrancy: 'reject' })
      .only('fast', async () => {
        await delay(20);
        return true;
      })
      .to((ctx) => ctx.amount);

    const [r1, r2] = await Promise.all([
      p.execute({ ...validContext }),
      p.execute({ ...validContext }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });
});

// ─── 11. Policy Introspection ─────────────────────────────────────────

describe('Policy Introspection (.describe())', () => {
  it('returns complete policy description', () => {
    const p = policy<TestContext>('Checkout', {
      mode: 'parallel',
      timeoutMs: 5000,
    })
      .only('auth', () => true, { tags: ['security'] })
      .only('billing', () => true, { tags: ['payment'] })
      .where('cart-valid', () => true)
      .to((ctx) => ctx.amount);

    const desc = p.describe();

    expect(desc.name).toBe('Checkout');
    expect(desc.mode).toBe('parallel');
    expect(desc.timeoutMs).toBe(5000);
    expect(desc.guards).toHaveLength(2);
    expect(desc.guards[0].id).toBe('auth');
    expect(desc.guards[1].id).toBe('billing');
    expect(desc.predicates).toHaveLength(1);
    expect(desc.predicates[0].id).toBe('cart-valid');
    expect(desc.hasAction).toBe(true);
  });
});

// ─── 12. Telemetry (.tap()) ───────────────────────────────────────────

describe('Telemetry (.tap())', () => {
  it('emits policy lifecycle events', async () => {
    const events: string[] = [];

    const p = policy<TestContext>('Test')
      .only('auth', () => true)
      .where('valid', () => true)
      .to((ctx) => ctx.amount)
      .tap((event) => events.push(event.type));

    await p.execute(validContext);

    expect(events).toContain('policy:start');
    expect(events).toContain('rule:start');
    expect(events).toContain('rule:success');
    expect(events).toContain('predicate:start');
    expect(events).toContain('predicate:success');
    expect(events).toContain('action:start');
    expect(events).toContain('action:success');
    expect(events).toContain('policy:success');
  });

  it('emits failure events on guard rejection', async () => {
    const events: string[] = [];

    const p = policy<TestContext>('Test')
      .only('fail', () => false)
      .to((ctx) => ctx.amount)
      .tap((event) => events.push(event.type));

    await expect(p.execute(validContext)).rejects.toThrow();

    expect(events).toContain('rule:failure');
    expect(events).toContain('policy:failure');
  });

  it('listener errors do not affect policy execution', async () => {
    const p = policy<TestContext>('Test')
      .only('auth', () => true)
      .to((ctx) => ctx.amount)
      .tap(() => { throw new Error('Listener crash'); });

    // Should succeed despite listener error
    const result = await p.execute(validContext);
    expect(result.success).toBe(true);
  });
});

// ─── 13. Policy Composition (.use()) ──────────────────────────────────

describe('Policy Composition (.use())', () => {
  it('composes guards from another policy', async () => {
    const authPolicy = policy<TestContext>('Auth')
      .only('authenticated', () => true)
      .to((ctx) => ctx);

    const checkoutPolicy = policy<TestContext>('Checkout')
      .use(authPolicy)
      .where('has-items', (ctx) => ctx.items.length > 0)
      .to((ctx) => ctx.amount);

    const result = await checkoutPolicy.execute(validContext);
    expect(result.success).toBe(true);

    const desc = checkoutPolicy.describe();
    expect(desc.guards).toHaveLength(1);
    expect(desc.guards[0].id).toBe('authenticated');
    expect(desc.composedPolicies).toContain('Auth');
  });

  it('composed guard failures prevent action execution', async () => {
    const actionSpy = vi.fn();

    const authPolicy = policy<TestContext>('Auth')
      .only('authenticated', () => false)
      .to((ctx) => ctx);

    const checkoutPolicy = policy<TestContext>('Checkout')
      .use(authPolicy)
      .to(actionSpy);

    await expect(checkoutPolicy.execute(validContext)).rejects.toThrow(
      PolicyViolationError
    );
    expect(actionSpy).not.toHaveBeenCalled();
  });
});

// ─── 14. Execution Result ─────────────────────────────────────────────

describe('Execution Result', () => {
  it('includes executionId and duration', async () => {
    const p = policy<TestContext>('Test')
      .to((ctx) => ctx.amount);

    const result = await p.execute(validContext);
    expect(result.executionId).toBeDefined();
    expect(result.executionId).toMatch(/^exec_/);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('uses custom executionId when provided', async () => {
    const p = policy<TestContext>('Test')
      .to((ctx) => ctx.amount);

    const result = await p.execute(validContext, {
      executionId: 'exec_custom_123',
    });
    expect(result.executionId).toBe('exec_custom_123');
  });
});

// ─── 15. Error Architecture ───────────────────────────────────────────

describe('Error Architecture', () => {
  it('PolicyViolationError has structured information', async () => {
    const p = policy<TestContext>('Checkout')
      .only('auth', () => 'Not authenticated')
      .to((ctx) => ctx.amount);

    try {
      await p.execute(validContext);
      expect.fail('Should have thrown');
    } catch (error) {
      const e = error as PolicyViolationError;
      expect(e.code).toBe('POLICY_VIOLATION');
      expect(e.violations).toHaveLength(1);
      expect(e.violations[0].ruleId).toBe('auth');
      expect(e.violations[0].phase).toBe('guard');
      expect(e.violations[0].reason).toBe('Not authenticated');
      expect(e.info.policy).toBe('Checkout');
      expect(e.timestamp).toBeDefined();
    }
  });

  it('PolicyExecutionError preserves the original error as cause', async () => {
    const originalError = new Error('Database connection lost');

    const p = policy<TestContext>('Test')
      .only('db-check', () => { throw originalError; })
      .to((ctx) => ctx.amount);

    try {
      await p.execute(validContext);
      expect.fail('Should have thrown');
    } catch (error) {
      const e = error as PolicyExecutionError;
      expect(e.cause).toBe(originalError);
      expect(e.info.ruleId).toBe('db-check');
    }
  });

  it('all error types extend OnlyCoreError', async () => {
    const { OnlyCoreError } = await import('../src/index.js');
    expect(new PolicyViolationError('test', [])).toBeInstanceOf(OnlyCoreError);
    expect(new PolicyTimeoutError('test', 1000)).toBeInstanceOf(OnlyCoreError);
    expect(new PolicyCancelledError('test')).toBeInstanceOf(OnlyCoreError);
    expect(new PolicyConfigurationError('test')).toBeInstanceOf(OnlyCoreError);
    expect(new PolicyExecutionError('test')).toBeInstanceOf(OnlyCoreError);
    expect(new PolicyReentrancyError('test')).toBeInstanceOf(OnlyCoreError);
  });
});

// ─── 16. Resource Safety ──────────────────────────────────────────────

describe('Resource Safety', () => {
  it('cleans up reentrancy tracking after execution', async () => {
    const ctx = { ...validContext };
    const p = policy<TestContext>('Test', { reentrancy: 'reject' })
      .to((c) => c.amount);

    await p.execute(ctx);
    // Should be able to execute again (reentrancy cleared)
    const result = await p.execute(ctx);
    expect(result.success).toBe(true);
  });

  it('cleans up reentrancy tracking after failed execution', async () => {
    const ctx = { ...validContext };
    const p = policy<TestContext>('Test', { reentrancy: 'reject' })
      .only('fail', () => false)
      .to((c) => c.amount);

    await expect(p.execute(ctx)).rejects.toThrow();
    // Should be able to execute again (reentrancy cleared despite failure)
    await expect(p.execute(ctx)).rejects.toThrow(PolicyViolationError);
  });

  it('handles repeated executions correctly', async () => {
    const p = policy<TestContext>('Test')
      .only('auth', () => true)
      .where('valid', (ctx) => ctx.amount > 0)
      .to((ctx) => ctx.amount);

    for (let i = 0; i < 50; i++) {
      const result = await p.execute(validContext);
      expect(result.success).toBe(true);
    }
  });
});

// ─── 17. Edge Cases ───────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('handles policy with no guards or predicates', async () => {
    const p = policy<TestContext>('Test')
      .to((ctx) => ctx.amount);

    const result = await p.execute(validContext);
    expect(result.success).toBe(true);
    expect(result.value).toBe(100);
  });

  it('handles guards only (no predicates)', async () => {
    const p = policy<TestContext>('Test')
      .only('auth', () => true)
      .to((ctx) => ctx.amount);

    const result = await p.execute(validContext);
    expect(result.success).toBe(true);
  });

  it('handles predicates only (no guards)', async () => {
    const p = policy<TestContext>('Test')
      .where('valid', (ctx) => ctx.amount > 0)
      .to((ctx) => ctx.amount);

    const result = await p.execute(validContext);
    expect(result.success).toBe(true);
  });

  it('handles null-like context values with reference strategy', async () => {
    const p = policy<null>('Test', {
      contextStrategy: 'reference',
      reentrancy: 'allow',
    })
      .to(() => 'done');

    const result = await p.execute(null);
    expect(result.success).toBe(true);
  });
});
