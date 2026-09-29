/**
 * only-core — Context Handling
 *
 * Implements three explicit context strategies:
 *
 * 1. `reference` — Use the original object. Fastest. No protection.
 * 2. `snapshot`  — Create a shallow copy. Good default.
 * 3. `immutable` — Deep-clone then deep-freeze. Expensive but safe.
 *
 * IMPORTANT: Context isolation reduces accidental or intentional mutation
 * of the execution snapshot. It is NOT a substitute for input sanitization,
 * schema validation, or application-level prototype-pollution defenses.
 */

import type { ContextStrategy } from '../types.js';

/**
 * Prepares the context according to the configured strategy.
 *
 * @param context - The raw input context
 * @param strategy - The context handling strategy
 * @returns The prepared context (possibly copied/frozen)
 */
export function prepareContext<TContext>(
  context: TContext,
  strategy: ContextStrategy
): Readonly<TContext> {
  switch (strategy) {
    case 'reference':
      return context as Readonly<TContext>;

    case 'snapshot':
      return createSnapshot(context);

    case 'immutable':
      // Deep-clone first so the caller's nested objects are never frozen,
      // then deep-freeze the independent clone.
      return deepFreeze(deepClone(context));
  }
}

/**
 * Creates a shallow snapshot of the context.
 * Handles plain objects and arrays. Primitives are returned as-is.
 *
 * NOTE: Nested objects are still shared with the original.
 * This is intentional — `snapshot` is a lightweight strategy.
 */
function createSnapshot<TContext>(context: TContext): TContext {
  if (context === null || context === undefined) {
    return context;
  }

  if (typeof context !== 'object') {
    return context;
  }

  if (Array.isArray(context)) {
    return [...context] as unknown as TContext;
  }

  return { ...context };
}

/**
 * Creates a deep clone of the context by recursively copying plain objects
 * and arrays. This ensures the returned value shares no object references
 * with the original — freezing the clone cannot affect the caller's data.
 *
 * Limitations (documented explicitly):
 * - Only clones own enumerable properties of plain objects and arrays
 * - Does not clone Map, Set, WeakMap, WeakSet, Date, RegExp, or class instances
 *   (they are copied by reference)
 * - Does not handle circular references
 *   (contexts with circular references should use 'snapshot' or 'reference')
 * - Does not clone typed arrays (they are copied by reference)
 */
function deepClone<TContext>(obj: TContext): TContext {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as unknown as TContext;
  }

  // Only deep-clone plain objects (not class instances, Date, RegExp, etc.)
  const proto = Object.getPrototypeOf(obj);
  if (proto !== null && proto !== Object.prototype) {
    // Non-plain object — copy by reference to avoid breaking class internals
    return obj;
  }

  const clone = {} as Record<string, unknown>;
  const propNames = Object.getOwnPropertyNames(obj) as string[];
  for (const name of propNames) {
    clone[name] = deepClone((obj as Record<string, unknown>)[name]);
  }

  return clone as TContext;
}

/**
 * Deep-freezes arrays and plain objects without freezing shared instances.
 *
 * This must only be called on an already-cloned object (never on the
 * caller's original) so that freezing cannot leak outside the policy.
 *
 * Limitations (documented explicitly):
 * - Only freezes arrays and plain objects
 * - Does not freeze Map, Set, WeakMap, WeakSet, Date, RegExp, class instances,
 *   or typed arrays
 */
function deepFreeze<TContext>(obj: TContext): Readonly<TContext> {
  if (obj === null || obj === undefined) {
    return obj as Readonly<TContext>;
  }

  if (typeof obj !== 'object') {
    return obj as Readonly<TContext>;
  }

  const prototype = Object.getPrototypeOf(obj);
  if (!Array.isArray(obj) && prototype !== null && prototype !== Object.prototype) {
    return obj as Readonly<TContext>;
  }

  Object.freeze(obj);

  const propNames = Object.getOwnPropertyNames(obj) as (keyof typeof obj)[];
  for (const name of propNames) {
    const value = obj[name];
    if (
      value !== null &&
      value !== undefined &&
      typeof value === 'object' &&
      !Object.isFrozen(value)
    ) {
      deepFreeze(value);
    }
  }

  return obj as Readonly<TContext>;
}

