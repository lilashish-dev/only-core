import { policy } from '../dist/index.js';

const iterations = Number(process.env.BENCH_ITERATIONS ?? 5000);
const warmupIterations = Math.max(250, Math.floor(iterations / 10));
const sampleCount = 5;
const context = { value: 41 };
const action = (value) => value.value + 1;

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

async function measure(run) {
  for (let index = 0; index < warmupIterations; index += 1) await run();
  const samples = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const started = process.hrtime.bigint();
    for (let index = 0; index < iterations; index += 1) await run();
    const elapsedNs = Number(process.hrtime.bigint() - started);
    samples.push(elapsedNs / iterations / 1000);
  }
  return {
    medianUs: percentile(samples, 0.5),
    p95SampleUs: percentile(samples, 0.95),
    throughputPerSecond: 1_000_000 / percentile(samples, 0.5),
  };
}

const cases = [{ label: 'direct action', run: () => action(context) }];
for (const guardCount of [0, 1, 5, 10]) {
  for (const telemetryEnabled of [false, true]) {
    let eventCount = 0;
    let builder = policy(`benchmark-${guardCount}-${telemetryEnabled}`, {
      contextStrategy: 'snapshot',
    });
    for (let index = 0; index < guardCount; index += 1) {
      builder = builder.only(`pass-${index}`, () => true);
    }
    const sealed = builder.to(action);
    if (telemetryEnabled) sealed.tap(() => { eventCount += 1; });
    cases.push({
      label: `${guardCount} guards / telemetry ${telemetryEnabled ? 'on' : 'off'}`,
      run: async () => {
        const result = await sealed.execute(context);
        if (result.value !== 42) throw new Error('Unexpected action result');
      },
      get eventCount() { return eventCount; },
    });
  }
}

console.log(`only-core orchestration benchmark | node ${process.version} | ${process.platform}/${process.arch}`);
console.log(`warmup=${warmupIterations} iterations/sample=${iterations} samples=${sampleCount}`);
console.log('No performance thresholds; values are measurements, not pass/fail guarantees.');
const rows = [];
for (const benchmarkCase of cases) {
  rows.push({
    scenario: benchmarkCase.label,
    ...(await measure(benchmarkCase.run)),
    ...(benchmarkCase.eventCount === undefined ? {} : { eventsObserved: benchmarkCase.eventCount }),
  });
}
console.table(rows);
