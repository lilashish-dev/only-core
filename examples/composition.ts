/**
 * only-core — Policy Composition Example
 *
 * Demonstrates reusable policies composed together for enterprise use.
 */

import { policy } from '../src/index.js';

// ─── Shared Context ─────────────────────────────────────────────────────

interface AppContext {
  userId: string;
  role: 'user' | 'admin' | 'superadmin';
  subscriptionTier: 'free' | 'pro' | 'enterprise';
  accountVerified: boolean;
  region: string;
}

// ─── Reusable Policies ──────────────────────────────────────────────────

/** Security policy: authentication + verification */
const securityPolicy = policy<AppContext>('Security')
  .only('authenticated', (ctx) =>
    ctx.userId !== '' || 'Authentication required'
  )
  .only('verified-account', (ctx) =>
    ctx.accountVerified || 'Account must be verified'
  )
  .to((ctx) => ctx);

/** Billing policy: subscription checks */
const billingPolicy = policy<AppContext>('Billing')
  .only('active-subscription', (ctx) =>
    ctx.subscriptionTier !== 'free' || 'Paid subscription required'
  )
  .to((ctx) => ctx);

/** Admin policy: role-based access */
const adminPolicy = policy<AppContext>('Admin')
  .where('is-admin', (ctx) =>
    ['admin', 'superadmin'].includes(ctx.role) || 'Admin access required'
  )
  .to((ctx) => ctx);

// ─── Composed Application Policies ──────────────────────────────────────

/** User dashboard: requires auth + verification */
const dashboardPolicy = policy<AppContext>('Dashboard')
  .use(securityPolicy)
  .to((ctx) => ({
    welcome: `Hello, ${ctx.userId}!`,
    tier: ctx.subscriptionTier,
  }));

/** Premium feature: requires auth + verification + paid subscription */
const premiumFeaturePolicy = policy<AppContext>('PremiumFeature')
  .use(securityPolicy)
  .use(billingPolicy)
  .to((ctx) => ({
    feature: 'advanced-analytics',
    tier: ctx.subscriptionTier,
  }));

/** Admin panel: requires auth + verification + admin role */
const adminPanelPolicy = policy<AppContext>('AdminPanel')
  .use(securityPolicy)
  .use(adminPolicy)
  .to((ctx) => ({
    panel: 'admin-dashboard',
    role: ctx.role,
  }));

// ─── Usage ──────────────────────────────────────────────────────────────

async function main() {
  const proUser: AppContext = {
    userId: 'user_pro',
    role: 'user',
    subscriptionTier: 'pro',
    accountVerified: true,
    region: 'US',
  };

  const adminUser: AppContext = {
    userId: 'admin_1',
    role: 'admin',
    subscriptionTier: 'enterprise',
    accountVerified: true,
    region: 'EU',
  };

  // Dashboard: accessible by any authenticated, verified user
  const dashResult = await dashboardPolicy.execute(proUser);
  console.log('Dashboard:', dashResult.value);

  // Premium feature: requires paid subscription
  const premiumResult = await premiumFeaturePolicy.execute(proUser);
  console.log('Premium:', premiumResult.value);

  // Admin panel: requires admin role
  const adminResult = await adminPanelPolicy.execute(adminUser);
  console.log('Admin:', adminResult.value);

  // Introspect composed policies
  console.log('\n--- Policy Structure ---');
  for (const p of [dashboardPolicy, premiumFeaturePolicy, adminPanelPolicy]) {
    const desc = p.describe();
    console.log(`\n${desc.name}:`);
    console.log(`  Guards: ${desc.guards.map(g => g.id).join(', ') || 'none'}`);
    console.log(`  Predicates: ${desc.predicates.map(p => p.id).join(', ') || 'none'}`);
    console.log(`  Composed from: ${desc.composedPolicies.join(', ') || 'none'}`);
  }
}

main().catch(console.error);
