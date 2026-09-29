# Recipes

Practical patterns for using only-core in real applications.

---

## E-Commerce Checkout

```typescript
import { policy } from 'only-core';

interface CheckoutContext {
  userId: string;
  sessionToken: string;
  items: Array<{ id: string; price: number; quantity: number }>;
  couponCode?: string;
  shippingAddress: { country: string; zip: string };
}

// Reusable auth policy
const authPolicy = policy<CheckoutContext>('Auth')
  .only('authenticated', async (ctx, signal) => {
    const session = await verifySession(ctx.sessionToken, { signal });
    return session.valid || 'Session expired';
  })
  .to((ctx) => ctx);

// Checkout policy composes auth
const checkout = policy<CheckoutContext>('Checkout', {
  timeoutMs: 10000,
  mode: 'sequential',
})
  .use(authPolicy)
  .only('inventory', async (ctx, signal) => {
    for (const item of ctx.items) {
      const available = await checkInventory(item.id, item.quantity, { signal });
      if (!available) return `Item ${item.id} is out of stock`;
    }
    return true;
  }, { tags: ['inventory'], severity: 'high' })
  .where('cart-not-empty', (ctx) =>
    ctx.items.length > 0 || 'Cart is empty'
  )
  .where('valid-total', (ctx) => {
    const total = ctx.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    return total > 0 || 'Order total must be positive';
  })
  .to(async (ctx, signal) => {
    const orderId = await createOrder(ctx, { signal });
    return { orderId, itemCount: ctx.items.length };
  });
```

---

## API Rate Limiting Guard

```typescript
import { policy } from 'only-core';

interface ApiContext {
  apiKey: string;
  endpoint: string;
  ip: string;
}

const apiPolicy = policy<ApiContext>('ApiAccess', {
  timeoutMs: 3000,
  mode: 'parallel',       // Independent guards can run concurrently
  failureStrategy: 'fail-fast',
})
  .only('valid-key', async (ctx, signal) => {
    return await validateApiKey(ctx.apiKey, { signal });
  }, { severity: 'critical' })
  .only('rate-limit', async (ctx) => {
    const remaining = await checkRateLimit(ctx.apiKey);
    return remaining > 0 || 'Rate limit exceeded';
  }, { tags: ['rate-limiting'] })
  .only('ip-allowlist', (ctx) => {
    return isAllowedIp(ctx.ip) || 'IP not in allowlist';
  })
  .to(async (ctx, signal) => {
    return await handleRequest(ctx, { signal });
  });
```

---

## Feature Flags with Policy Enforcement

```typescript
import { policy } from 'only-core';

interface FeatureContext {
  userId: string;
  featureId: string;
  userTier: 'free' | 'pro' | 'enterprise';
}

const featureAccess = policy<FeatureContext>('FeatureAccess')
  .only('feature-enabled', async (ctx) => {
    const flag = await getFeatureFlag(ctx.featureId);
    return flag.enabled || `Feature '${ctx.featureId}' is not enabled`;
  })
  .where('tier-sufficient', (ctx) => {
    const requiredTier = getRequiredTier(ctx.featureId);
    const tierOrder = { free: 0, pro: 1, enterprise: 2 };
    return tierOrder[ctx.userTier] >= tierOrder[requiredTier]
      || `Feature requires ${requiredTier} tier`;
  })
  .to((ctx) => ({ allowed: true, featureId: ctx.featureId }));
```

---

## With Observability (OpenTelemetry Adapter)

```typescript
import { policy } from 'only-core';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('only-core');

const myPolicy = policy<MyContext>('MyPolicy')
  .only('check', myGuard)
  .to(myAction)
  .tap((event) => {
    // Connect to OpenTelemetry without only-core depending on it
    const span = tracer.startSpan(`policy.${event.type}`, {
      attributes: {
        'policy.name': event.policyName,
        'policy.executionId': event.executionId,
      },
    });
    span.end();
  });
```

---

## With Request Cancellation (Express.js)

```typescript
import express from 'express';
import { policy, PolicyCancelledError, PolicyViolationError } from 'only-core';

const app = express();

app.post('/checkout', async (req, res) => {
  // Create an AbortController linked to the request lifecycle
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  try {
    const result = await checkoutPolicy.execute(req.body, {
      signal: controller.signal,
      executionId: req.headers['x-request-id'] as string,
    });
    res.json(result.value);
  } catch (error) {
    if (error instanceof PolicyCancelledError) {
      // Client disconnected
      return;
    }
    if (error instanceof PolicyViolationError) {
      res.status(403).json({
        error: error.code,
        violations: error.violations,
      });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

---

## Testing Policies

```typescript
import { describe, it, expect } from 'vitest';
import { myPolicy, PolicyViolationError } from './policies';

describe('Checkout Policy', () => {
  it('rejects unauthenticated users', async () => {
    const ctx = { userId: '', items: ['item1'], amount: 100 };

    try {
      await myPolicy.execute(ctx);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PolicyViolationError);
      const violation = error as PolicyViolationError;
      expect(violation.violations[0].ruleId).toBe('authenticated');
      expect(violation.code).toBe('POLICY_VIOLATION');
    }
  });

  it('describes its structure for verification', () => {
    const desc = myPolicy.describe();
    expect(desc.guards.map(g => g.id)).toContain('authenticated');
    expect(desc.predicates.map(p => p.id)).toContain('cart-not-empty');
  });
});
```
