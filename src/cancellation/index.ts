/**
 * only-core — Cancellation Module
 *
 * Implements first-class cancellation using the platform's AbortSignal model.
 *
 * Cancellation flow:
 *   request cancelled → policy execution cancelled → guards receive cancellation → action receives cancellation
 *
 * Important distinction:
 *   Timeout = "The policy waited too long."
 *   Cancellation = "The caller no longer wants this operation."
 *
 * Both coexist: the timeout handler fires AbortController.abort() so that
 * guards/actions that respect AbortSignal can clean up.
 */

import { PolicyCancelledError, PolicyTimeoutError } from '../errors/index.js';
import type { ErrorInfo } from '../errors/index.js';

/**
 * Creates an internal AbortController that is linked to an optional external signal.
 * When the external signal aborts, the internal controller also aborts.
 *
 * @param externalSignal - Optional AbortSignal from the caller
 * @returns The internal AbortController
 */
export function createLinkedAbortController(
  externalSignal?: AbortSignal
): AbortController {
  const controller = new AbortController();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
      return controller;
    }

    const onAbort = () => {
      controller.abort(externalSignal.reason);
    };

    externalSignal.addEventListener('abort', onAbort, { once: true });

    // Clean up the listener when the internal controller aborts
    controller.signal.addEventListener(
      'abort',
      () => {
        externalSignal.removeEventListener('abort', onAbort);
      },
      { once: true }
    );
  }

  return controller;
}

/**
 * Sets up a timeout that aborts the controller after the specified duration.
 * Returns a cleanup function to clear the timer.
 *
 * Invariant: Timeouts cannot leave internal timers alive.
 *
 * @param controller - The AbortController to abort on timeout
 * @param timeoutMs - Timeout duration in milliseconds
 * @param info - Error context info for the timeout error
 * @returns Cleanup function to clear the timer
 */
export function setupTimeout(
  controller: AbortController,
  timeoutMs: number,
  info: ErrorInfo
): () => void {
  if (timeoutMs <= 0 || !Number.isFinite(timeoutMs)) {
    return () => {};
  }

  const timer = setTimeout(() => {
    const error = new PolicyTimeoutError(
      `Policy execution exceeded timeout of ${timeoutMs}ms`,
      timeoutMs,
      info
    );
    controller.abort(error);
  }, timeoutMs);

  return () => {
    clearTimeout(timer);
  };
}

/**
 * Checks if the signal has been aborted and throws the appropriate error.
 *
 * @param signal - The AbortSignal to check
 * @param info - Error context info
 */
export function throwIfAborted(signal: AbortSignal, info: ErrorInfo): void {
  if (!signal.aborted) return;

  const reason = signal.reason;

  if (reason instanceof PolicyTimeoutError) {
    throw reason;
  }

  if (reason instanceof PolicyCancelledError) {
    throw reason;
  }

  throw new PolicyCancelledError(
    reason?.message ?? 'Policy execution was cancelled',
    info
  );
}

/**
 * Races a promise against an AbortSignal.
 * If the signal fires first, the appropriate error is thrown.
 *
 * IMPORTANT: This does not cancel the underlying operation of the promise.
 * It only ensures the policy stops waiting. Operations that respect
 * AbortSignal should handle cancellation internally.
 *
 * @param promise - The promise to race
 * @param signal - The AbortSignal
 * @param info - Error context info
 * @returns The resolved value if the promise completes before abort
 */
export function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  info: ErrorInfo
): Promise<T> {
  if (signal.aborted) {
    throwIfAborted(signal, info);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      const reason = signal.reason;
      if (reason instanceof PolicyTimeoutError) {
        reject(reason);
      } else if (reason instanceof PolicyCancelledError) {
        reject(reason);
      } else {
        reject(
          new PolicyCancelledError(
            reason?.message ?? 'Policy execution was cancelled',
            info
          )
        );
      }
    };

    signal.addEventListener('abort', onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}
