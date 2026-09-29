/**
 * only-core — Basic Usage Example
 *
 * Demonstrates the core API: policy(), .only(), .where(), .to(), .execute()
 */

import {
  policy,
  PolicyViolationError,
  PolicyTimeoutError,
  PolicyCancelledError,
} from '../src/index.js';

// ─── 1. Define your context type ────────────────────────────────────────

interface OrderContext {
  userId: string;
  items: Array<{ name: string; price: number }>;
  shippingCountry: string;
  paymentMethod: 'card' | 'wallet' | 'crypto';
}

// ─── 2. Define guard functions (external enforcement) ───────────────────

/** Simulates an async authentication check */
async function isAuthenticated(
  ctx: Readonly<OrderContext>,
  _signal: AbortSignal
): Promise<boolean | string> {
  // In production: verify JWT, check session, etc.
  if (!ctx.userId) return 'User must be authenticated';
  return true;
}

/** Simulates checking if country is supported */
function isShippingSupported(
  ctx: Readonly<OrderContext>
): boolean | string {
  const supported = ['US', 'UK', 'IN', 'DE', 'JP'];
  return supported.includes(ctx.shippingCountry)
    || `Shipping not available to ${ctx.shippingCountry}`;
}

// ─── 3. Build the policy ────────────────────────────────────────────────

const orderPolicy = policy<OrderContext>('PlaceOrder', {
  timeoutMs: 10000,
  mode: 'sequential',
  contextStrategy: 'snapshot',
})
  // Guards: external enforcement
  .only('authenticated', isAuthenticated, {
    description: 'Verifies user authentication',
    tags: ['security'],
    severity: 'critical',
  })
  .only('shipping-supported', isShippingSupported, {
    description: 'Checks if shipping destination is supported',
    tags: ['logistics'],
  })
  // Predicates: local state checks
  .where('cart-not-empty', (ctx) =>
    ctx.items.length > 0 || 'Cart cannot be empty'
  )
  .where('valid-total', (ctx) => {
    const total = ctx.items.reduce((sum, item) => sum + item.price, 0);
    return total > 0 || 'Order total must be positive';
  })
  // Action: the protected business logic
  .to(async (ctx) => {
    const total = ctx.items.reduce((sum, item) => sum + item.price, 0);
    return {
      orderId: `ord_${Date.now()}`,
      items: ctx.items.length,
      total,
      payment: ctx.paymentMethod,
    };
  });

// ─── 4. Add observability ───────────────────────────────────────────────

orderPolicy.tap((event) => {
  console.log(`  [${event.type}] execution=${event.executionId}`);
});

// ─── 5. Execute ─────────────────────────────────────────────────────────

async function main() {
  console.log('=== Successful Execution ===\n');

  try {
    const result = await orderPolicy.execute({
      userId: 'user_alice',
      items: [
        { name: 'TypeScript Handbook', price: 29.99 },
        { name: 'Mechanical Keyboard', price: 149.99 },
      ],
      shippingCountry: 'US',
      paymentMethod: 'card',
    });

    console.log('\n  Result:', result.value);
    console.log('  Duration:', result.duration, 'ms');
    console.log('  Execution ID:', result.executionId);
  } catch (error) {
    console.error('  Unexpected error:', error);
  }

  console.log('\n=== Policy Violation (empty cart) ===\n');

  try {
    await orderPolicy.execute({
      userId: 'user_bob',
      items: [],
      shippingCountry: 'US',
      paymentMethod: 'wallet',
    });
  } catch (error) {
    if (error instanceof PolicyViolationError) {
      console.log('  Violation code:', error.code);
      console.log('  Violations:');
      for (const v of error.violations) {
        console.log(`    - [${v.phase}] ${v.ruleId}: ${v.reason}`);
      }
    }
  }

  console.log('\n=== Policy Violation (unsupported country) ===\n');

  try {
    await orderPolicy.execute({
      userId: 'user_charlie',
      items: [{ name: 'Widget', price: 9.99 }],
      shippingCountry: 'XX',
      paymentMethod: 'crypto',
    });
  } catch (error) {
    if (error instanceof PolicyViolationError) {
      console.log('  Violation:', error.violations[0].reason);
    }
  }

  console.log('\n=== Cancellation ===\n');

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    await orderPolicy.execute(
      {
        userId: 'user_dave',
        items: [{ name: 'Slow Item', price: 1.00 }],
        shippingCountry: 'US',
        paymentMethod: 'card',
      },
      { signal: controller.signal }
    );
  } catch (error) {
    if (error instanceof PolicyCancelledError) {
      console.log('  Cancelled:', error.message);
    }
  }

  console.log('\n=== Policy Introspection ===\n');

  const desc = orderPolicy.describe();
  console.log('  Policy:', desc.name);
  console.log('  Mode:', desc.mode);
  console.log('  Timeout:', desc.timeoutMs, 'ms');
  console.log('  Guards:');
  for (const g of desc.guards) {
    console.log(`    - ${g.id} (${g.metadata.tags?.join(', ') || 'no tags'})`);
  }
  console.log('  Predicates:');
  for (const p of desc.predicates) {
    console.log(`    - ${p.id}`);
  }
}

main().catch(console.error);
