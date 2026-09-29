/**
 * only-core — Policy Builder
 *
 * The fluent API for constructing policies.
 *
 * API:
 *   policy(name, config?)
 *     .only(guardFn)            — Add an external guard
 *     .only(id, guardFn)        — Add a named guard
 *     .only(id, guardFn, meta)  — Add a guard with metadata
 *     .where(predicateFn)       — Add a local predicate
 *     .where(id, predicateFn)   — Add a named predicate
 *     .to(actionFn)             — Set the action (seals the policy)
 *     .tap(listener)            — Add a telemetry listener
 *     .describe()               — Introspect the policy
 *     .execute(context, opts?)  — Execute the policy
 *
 * The policy is sealed after .to() is called:
 *   - No new guards or predicates can be added
 *   - The action cannot be changed
 *
 * Invariant: A sealed policy cannot be structurally modified.
 */

import type {
  GuardFn,
  PredicateFn,
  ActionFn,
  GuardRule,
  PredicateRule,
  RuleMetadata,
  PolicyConfig,
  ResolvedPolicyConfig,
  PolicyDescription,
  PolicyResult,
  ExecuteOptions,
  TelemetryListener,
} from '../types.js';
import { PolicyConfigurationError } from '../errors/index.js';
import { ExecutionEngine } from '../execution/index.js';
import { TelemetryEmitter } from '../telemetry/index.js';

// ─── Default Configuration ──────────────────────────────────────────────

const DEFAULT_CONFIG: ResolvedPolicyConfig = {
  timeoutMs: 30_000,
  mode: 'sequential',
  concurrency: Infinity,
  failureStrategy: 'fail-fast',
  contextStrategy: 'snapshot',
  reentrancy: 'reject',
};

/**
 * Resolves user config with defaults.
 */
function resolveConfig(config?: PolicyConfig): ResolvedPolicyConfig {
  if (!config) return DEFAULT_CONFIG;

  const resolved: ResolvedPolicyConfig = {
    timeoutMs: config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
    mode: config.mode ?? DEFAULT_CONFIG.mode,
    concurrency: config.concurrency ?? DEFAULT_CONFIG.concurrency,
    failureStrategy: config.failureStrategy ?? DEFAULT_CONFIG.failureStrategy,
    contextStrategy: config.contextStrategy ?? DEFAULT_CONFIG.contextStrategy,
    reentrancy: config.reentrancy ?? DEFAULT_CONFIG.reentrancy,
  };

  if (
    (resolved.timeoutMs !== Infinity &&
      (!Number.isFinite(resolved.timeoutMs) || resolved.timeoutMs < 0)) ||
    (resolved.concurrency !== Infinity &&
      (!Number.isInteger(resolved.concurrency) || resolved.concurrency < 1))
  ) {
    throw new PolicyConfigurationError(
      'Policy config requires timeoutMs to be non-negative and concurrency to be a positive integer or Infinity'
    );
  }

  if (!['sequential', 'parallel'].includes(resolved.mode)) {
    throw new PolicyConfigurationError(`Unsupported execution mode '${resolved.mode}'`);
  }
  if (!['fail-fast', 'aggregate'].includes(resolved.failureStrategy)) {
    throw new PolicyConfigurationError(`Unsupported failure strategy '${resolved.failureStrategy}'`);
  }
  if (!['reference', 'snapshot', 'immutable'].includes(resolved.contextStrategy)) {
    throw new PolicyConfigurationError(`Unsupported context strategy '${resolved.contextStrategy}'`);
  }
  if (!['reject', 'allow'].includes(resolved.reentrancy)) {
    throw new PolicyConfigurationError(`Unsupported reentrancy strategy '${resolved.reentrancy}'`);
  }

  return resolved;
}

/**
 * Extracts a stable rule ID from function name or explicit string.
 *
 * Function names aren't reliable identifiers:
 *   - Anonymous functions have no name
 *   - Minifiers can change function names
 *
 * Explicit IDs are strongly recommended for enterprise use.
 */
function extractRuleId(fnOrId: string | Function, index: number): string {
  if (typeof fnOrId === 'string') return fnOrId;
  return fnOrId.name || `rule_${index}`;
}

// ─── Policy Builder Interfaces ──────────────────────────────────────────

/**
 * Policy builder before .to() is called.
 * Allows adding guards, predicates, and composing policies.
 */
export interface PolicyBuilder<TContext> {
  /** Add a guard (external enforcement) */
  only(fn: GuardFn<TContext>): PolicyBuilder<TContext>;
  only(id: string, fn: GuardFn<TContext>): PolicyBuilder<TContext>;
  only(id: string, fn: GuardFn<TContext>, metadata: RuleMetadata): PolicyBuilder<TContext>;

  /** Add a predicate (local state check) */
  where(fn: PredicateFn<TContext>): PolicyBuilder<TContext>;
  where(id: string, fn: PredicateFn<TContext>): PolicyBuilder<TContext>;
  where(id: string, fn: PredicateFn<TContext>, metadata: RuleMetadata): PolicyBuilder<TContext>;

  /** Compose another policy's guards into this policy */
  use(otherPolicy: SealedPolicy<TContext, unknown>): PolicyBuilder<TContext>;

  /** Compose multiple policies into this policy */
  compose(...otherPolicies: SealedPolicy<TContext, unknown>[]): PolicyBuilder<TContext>;

  /** Set the action and seal the policy */
  to<TResult>(fn: ActionFn<TContext, TResult>): SealedPolicy<TContext, TResult>;
}

/**
 * A sealed policy after .to() is called.
 * Cannot be structurally modified. Can be executed and observed.
 */
export interface SealedPolicy<TContext, TResult> {
  /** Add a telemetry listener (does not modify policy structure) */
  tap(listener: TelemetryListener): SealedPolicy<TContext, TResult>;

  /** Execute the policy against the given context */
  execute(context: TContext, options?: ExecuteOptions): Promise<PolicyResult<TResult>>;

  /** Introspect the policy structure (read-only) */
  describe(): PolicyDescription;

  /** Extend this sealed policy to create a new one */
  extend(name: string, config?: PolicyConfig): PolicyBuilder<TContext>;

  /** The policy name */
  readonly name: string;

  /**
   * Internal: Get the guards and predicates for composition.
   * @internal
   */
  readonly _guards: readonly GuardRule<TContext>[];
  readonly _predicates: readonly PredicateRule<TContext>[];
}

// ─── Policy Builder Implementation ──────────────────────────────────────

class PolicyBuilderImpl<TContext> implements PolicyBuilder<TContext> {
  readonly #name: string;
  readonly #config: ResolvedPolicyConfig;
  readonly #guards: GuardRule<TContext>[] = [];
  readonly #predicates: PredicateRule<TContext>[] = [];
  readonly #composedPolicyNames: string[] = [];
  #guardCounter = 0;
  #predicateCounter = 0;

  constructor(name: string, config: ResolvedPolicyConfig) {
    this.#name = name;
    this.#config = config;
  }

  only(
    fnOrId: GuardFn<TContext> | string,
    maybeFn?: GuardFn<TContext>,
    metadata?: RuleMetadata
  ): PolicyBuilder<TContext> {
    let id: string;
    let fn: GuardFn<TContext>;

    if (typeof fnOrId === 'string') {
      id = fnOrId;
      if (!maybeFn) {
        throw new PolicyConfigurationError(
          `Guard '${id}' was registered with an ID but no function`,
          { policy: this.#name }
        );
      }
      fn = maybeFn;
    } else {
      id = extractRuleId(fnOrId, this.#guardCounter);
      fn = fnOrId;
    }

    this.#guards.push({
      id,
      fn,
      phase: 'guard',
      metadata: metadata ?? {},
    });

    this.#guardCounter++;
    return this;
  }

  where(
    fnOrId: PredicateFn<TContext> | string,
    maybeFn?: PredicateFn<TContext>,
    metadata?: RuleMetadata
  ): PolicyBuilder<TContext> {
    let id: string;
    let fn: PredicateFn<TContext>;

    if (typeof fnOrId === 'string') {
      id = fnOrId;
      if (!maybeFn) {
        throw new PolicyConfigurationError(
          `Predicate '${id}' was registered with an ID but no function`,
          { policy: this.#name }
        );
      }
      fn = maybeFn;
    } else {
      id = extractRuleId(fnOrId, this.#predicateCounter);
      fn = fnOrId;
    }

    this.#predicates.push({
      id,
      fn,
      phase: 'predicate',
      metadata: metadata ?? {},
    });

    this.#predicateCounter++;
    return this;
  }

  use(otherPolicy: SealedPolicy<TContext, unknown>): PolicyBuilder<TContext> {
    // Compose guards and predicates from another policy
    for (const guard of otherPolicy._guards) {
      this.#guards.push(guard);
      this.#guardCounter++;
    }
    for (const predicate of otherPolicy._predicates) {
      this.#predicates.push(predicate);
      this.#predicateCounter++;
    }
    this.#composedPolicyNames.push(otherPolicy.name);
    return this;
  }

  compose(...otherPolicies: SealedPolicy<TContext, unknown>[]): PolicyBuilder<TContext> {
    for (const p of otherPolicies) {
      this.use(p);
    }
    return this;
  }

  to<TResult>(fn: ActionFn<TContext, TResult>): SealedPolicy<TContext, TResult> {
    if (typeof fn !== 'function') {
      throw new PolicyConfigurationError(
        `Policy '${this.#name}': .to() requires a function`,
        { policy: this.#name }
      );
    }

    return new SealedPolicyImpl(
      this.#name,
      this.#config,
      [...this.#guards],
      [...this.#predicates],
      fn,
      [...this.#composedPolicyNames]
    );
  }
}

// ─── Sealed Policy Implementation ───────────────────────────────────────

class SealedPolicyImpl<TContext, TResult>
  implements SealedPolicy<TContext, TResult>
{
  readonly name: string;
  readonly #config: ResolvedPolicyConfig;
  readonly _guards: readonly GuardRule<TContext>[];
  readonly _predicates: readonly PredicateRule<TContext>[];
  readonly #action: ActionFn<TContext, TResult>;
  readonly #composedPolicyNames: readonly string[];
  readonly #telemetry: TelemetryEmitter;
  #engine: ExecutionEngine<TContext, TResult> | null = null;

  constructor(
    name: string,
    config: ResolvedPolicyConfig,
    guards: readonly GuardRule<TContext>[],
    predicates: readonly PredicateRule<TContext>[],
    action: ActionFn<TContext, TResult>,
    composedPolicyNames: readonly string[]
  ) {
    this.name = name;
    this.#config = config;
    this._guards = Object.freeze([...guards]);
    this._predicates = Object.freeze([...predicates]);
    this.#action = action;
    this.#composedPolicyNames = composedPolicyNames;
    this.#telemetry = new TelemetryEmitter();
  }

  tap(listener: TelemetryListener): SealedPolicy<TContext, TResult> {
    this.#telemetry.addListener(listener);
    return this;
  }

  async execute(
    context: TContext,
    options: ExecuteOptions = {}
  ): Promise<PolicyResult<TResult>> {
    // Lazily create the engine
    if (!this.#engine) {
      this.#engine = new ExecutionEngine(
        this.name,
        this.#config,
        this._guards,
        this._predicates,
        this.#action,
        this.#telemetry
      );
    }

    return this.#engine.execute(context, options);
  }

  describe(): PolicyDescription {
    return {
      name: this.name,
      mode: this.#config.mode,
      concurrency: this.#config.concurrency,
      failureStrategy: this.#config.failureStrategy,
      contextStrategy: this.#config.contextStrategy,
      reentrancy: this.#config.reentrancy,
      timeoutMs: this.#config.timeoutMs,
      guards: this._guards.map((g) => ({
        id: g.id,
        metadata: g.metadata,
      })),
      predicates: this._predicates.map((p) => ({
        id: p.id,
        metadata: p.metadata,
      })),
      hasAction: true,
      composedPolicies: [...this.#composedPolicyNames],
    };
  }

  extend(name: string, config?: PolicyConfig): PolicyBuilder<TContext> {
    return policy<TContext>(name, config).use(this);
  }
}

// ─── Public Factory Function ────────────────────────────────────────────

/**
 * Create a new policy.
 *
 * @param name - A stable name for telemetry and error reporting
 * @param config - Optional configuration overrides
 * @returns A PolicyBuilder for fluent chain construction
 *
 * @example
 * ```ts
 * const checkout = policy<CheckoutContext>('Checkout')
 *   .only('authenticated', isAuthenticated)
 *   .only('subscription', hasActiveSubscription)
 *   .where('cart-not-empty', ctx => ctx.items.length > 0)
 *   .to(processCheckout);
 *
 * const result = await checkout.execute(context);
 * ```
 */
export function policy<TContext = Record<string, unknown>>(
  name: string,
  config?: PolicyConfig
): PolicyBuilder<TContext> {
  if (!name || typeof name !== 'string') {
    throw new PolicyConfigurationError(
      'A policy requires a non-empty string name',
      {}
    );
  }

  return new PolicyBuilderImpl<TContext>(name, resolveConfig(config));
}
