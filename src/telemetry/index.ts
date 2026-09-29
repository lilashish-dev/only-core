/**
 * only-core — Telemetry Module
 *
 * Implements event-based observability that is completely zero-dependency.
 *
 * Architecture:
 *   only-core → events → adapter → observability platform
 *
 * Default behavior:
 *   - No console.log
 *   - No console.error
 *   - No telemetry
 *   - No network calls
 *   - No global state
 *
 * The library is silent unless explicitly configured via .tap().
 *
 * Invariant: Observability cannot change policy behavior.
 * If a telemetry listener throws, it must not affect execution.
 */

import type { TelemetryEvent, TelemetryListener, TelemetryEventType } from '../types.js';

/**
 * Internal telemetry emitter.
 * Manages listeners and emits events without affecting policy behavior.
 */
export class TelemetryEmitter {
  #listeners: TelemetryListener[] = [];

  /**
   * Register a listener for telemetry events.
   * Listeners receive events but cannot influence policy execution.
   */
  addListener(listener: TelemetryListener): void {
    this.#listeners.push(listener);
  }

  /**
   * Get the number of registered listeners.
   */
  get listenerCount(): number {
    return this.#listeners.length;
  }

  /**
   * Check if any listeners are registered.
   * Used to skip event construction when nobody is listening.
   */
  get hasListeners(): boolean {
    return this.#listeners.length > 0;
  }

  /**
   * Emit a telemetry event to all registered listeners.
   *
   * CRITICAL: Listener errors are silently caught. Observability must not
   * change policy behavior. This is a core invariant.
   */
  emit(event: TelemetryEvent): void {
    if (this.#listeners.length === 0) return;

    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Invariant: Observability cannot change policy behavior.
        // Listener errors are intentionally silenced.
      }
    }
  }
}

/**
 * Helper to create telemetry events with consistent structure.
 */
export function createEvent(
  type: TelemetryEventType,
  policyName: string,
  executionId: string,
  extra: Record<string, unknown> = {},
  metadata?: Record<string, unknown>
): TelemetryEvent {
  return {
    type,
    policyName,
    executionId,
    timestamp: Date.now(),
    ...(metadata ? { metadata } : {}),
    ...extra,
  } as TelemetryEvent;
}
