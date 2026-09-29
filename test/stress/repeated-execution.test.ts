import { describe, expect, it } from 'vitest';
import { PolicyViolationError, policy } from '../../src/index.js';

describe('repeated execution resource stress', () => {
  it('reuses one context safely across thousands of successful executions', async () => {
    const context = { id: 'job-1', allowed: true };
    const guarded = policy<typeof context>('Repeated job dispatch', {
      contextStrategy: 'reference',
    })
      .only('dispatch-authorized', (value) => value.allowed)
      .to((value) => value.id);

    for (let index = 0; index < 5000; index += 1) {
      const result = await guarded.execute(context);
      expect(result.value).toBe('job-1');
    }
  });

  it('releases reentrancy tracking after repeated rejected executions', async () => {
    const context = { id: 'job-2', allowed: false };
    const guarded = policy<typeof context>('Repeated rejected dispatch', {
      contextStrategy: 'reference',
    })
      .only('dispatch-authorized', (value) => value.allowed || 'Dispatch is not authorized')
      .to((value) => value.id);

    for (let index = 0; index < 500; index += 1) {
      await expect(guarded.execute(context)).rejects.toBeInstanceOf(PolicyViolationError);
    }
  });
});
