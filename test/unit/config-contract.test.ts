import { describe, expect, it } from 'vitest';
import { PolicyConfigurationError, policy } from '../../src/index.js';

describe('v1 configuration contract', () => {
  it('rejects invalid timeout and concurrency values', () => {
    expect(() => policy('zero-concurrency', { concurrency: 0 })).toThrow(PolicyConfigurationError);
    expect(() => policy('fractional-concurrency', { concurrency: 1.5 })).toThrow(PolicyConfigurationError);
    expect(() => policy('negative-timeout', { timeoutMs: -1 })).toThrow(PolicyConfigurationError);
    expect(() => policy('nan-timeout', { timeoutMs: Number.NaN })).toThrow(PolicyConfigurationError);
  });

  it('reports configured parallel concurrency in policy descriptions', () => {
    const description = policy<{ value: number }>('bounded-policy', {
      mode: 'parallel',
      concurrency: 3,
    })
      .only('allowed', () => true)
      .to((context) => context.value)
      .describe();

    expect(description.concurrency).toBe(3);
  });
});
