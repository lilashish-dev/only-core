import { policy, PolicyViolationError } from '../dist/index.js';

if (typeof globalThis.gc !== 'function') {
  throw new Error('Run this benchmark with --expose-gc (npm run benchmark:memory).');
}

const iterationsPerSample = Number(process.env.MEMORY_ITERATIONS ?? 10000);
const sampleCount = 8;
const context = { jobId: 'retained-context', allowed: true };
const successful = policy('Memory success audit', { contextStrategy: 'reference' })
  .only('authorized', (value) => value.allowed)
  .to((value) => value.jobId);
const rejected = policy('Memory rejection audit', { contextStrategy: 'reference' })
  .only('authorized', (value) => value.allowed || 'Not authorized')
  .to((value) => value.jobId);
const rejectedContext = { jobId: 'rejected-job', allowed: false };

async function heapUsedAfterGc() {
  globalThis.gc();
  await new Promise((resolve) => setImmediate(resolve));
  return process.memoryUsage().heapUsed;
}

async function sample(policyToRun, input, shouldReject) {
  const retainedBytes = [];
  const baseline = await heapUsedAfterGc();
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    for (let index = 0; index < iterationsPerSample; index += 1) {
      if (shouldReject) {
        try {
          await policyToRun.execute(input);
          throw new Error('Expected a policy rejection');
        } catch (error) {
          if (!(error instanceof PolicyViolationError)) throw error;
        }
      } else {
        await policyToRun.execute(input);
      }
    }
    retainedBytes.push((await heapUsedAfterGc()) - baseline);
  }
  return retainedBytes.map((bytes, index) => ({
    sample: index + 1,
    executions: (index + 1) * iterationsPerSample,
    retainedKiBFromBaseline: Math.round(bytes / 1024),
  }));
}

console.log(`only-core retained-heap audit | node ${process.version} | ${process.platform}/${process.arch}`);
console.log(`forced GC between samples; ${sampleCount} samples x ${iterationsPerSample} executions per path`);
console.log('Heap deltas are diagnostic observations, not a portable leak threshold.');
console.log('Successful executions:');
console.table(await sample(successful, context, false));
console.log('Rejected executions:');
console.table(await sample(rejected, rejectedContext, true));
