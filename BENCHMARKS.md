# Benchmark and Memory Report

## Scope

These are local diagnostic measurements of policy orchestration overhead and retained JavaScript heap. They are not service-level objectives, production workload results, or proof of leak-freedom.

## Environment

- Run date: 2026-09-29
- Runtime: Node.js v24.18.1
- Platform: Linux x64
- Benchmark: 2,000 warmup calls, then five measured samples of 20,000 calls per scenario
- Memory audit: `node --expose-gc`, eight samples of 10,000 executions per path, forced garbage collection between samples

The benchmark script's warmup is 10% of the configured measured iteration count, with a floor of 250. For the reported 20,000-iteration run, that is 2,000 warmup executions per scenario. The harness reports the median and maximum of five measured samples, not a statistically robust p95.

## Latency Results

Median microseconds per execution from the recorded run:

| Scenario | Median latency | Approx. throughput |
|----------|---------------:|-------------------:|
| Direct synchronous action | 0.182 µs | 5.49M calls/s |
| Policy, 0 guards, telemetry off | 10.766 µs | 92.9K calls/s |
| Policy, 0 guards, telemetry on | 10.886 µs | 91.9K calls/s |
| Policy, 1 guard, telemetry off | 23.612 µs | 42.4K calls/s |
| Policy, 1 guard, telemetry on | 26.461 µs | 37.8K calls/s |
| Policy, 5 guards, telemetry off | 61.895 µs | 16.2K calls/s |
| Policy, 5 guards, telemetry on | 65.955 µs | 15.2K calls/s |
| Policy, 10 guards, telemetry off | 112.746 µs | 8.87K calls/s |
| Policy, 10 guards, telemetry on | 114.949 µs | 8.70K calls/s |

The direct baseline is a synchronous function invoked in the same async measurement loop; policy cases include async execution, context preparation, rule evaluation, result construction, and optional event delivery. The comparison illustrates the cost of the complete policy boundary, not a like-for-like function-call overhead measurement. Guards are synchronous in-memory functions; no database, network, or model-provider I/O is represented.

Small differences between telemetry-on/off runs are measurement noise and runtime effects, not evidence that telemetry is always free or faster. Maximum sample latency in the latest run ranged from 0.224 µs for direct action to 137.271 µs for ten guards without telemetry. Five samples are too few for a statistically robust tail-latency claim.

## Retained-Heap Results

After each batch and forced GC, retained heap relative to the initial forced-GC baseline was observed as follows:

- 80,000 successful executions: about **872 KiB** above baseline at the final sample (sample deltas started around 736 KiB and varied/generally trended upward).
- 80,000 rejected executions: about **170 KiB** above baseline at the final sample (sample deltas remained around 152–173 KiB).

These deltas include runtime/JIT/allocator and benchmark-harness effects. The success-path upward drift is a signal to continue profiling under longer, isolated runs; it is not by itself proof of a retained-object leak. The result does not prove leak-freedom. For deeper investigation, run the benchmark repeatedly in a fresh process and use Node heap snapshots or a dedicated allocation profiler.

## Reproduce

From the cloned repository root:

```bash
npm install
npm run benchmark
BENCH_ITERATIONS=20000 npm run benchmark
npm run benchmark:memory
MEMORY_ITERATIONS=25000 npm run benchmark:memory
```

`npm run benchmark` builds `dist/` and runs `benchmarks/policy.mjs`. `npm run benchmark:memory` builds and starts Node with `--expose-gc`, required for the audit. Results vary with Node version, CPU scheduling, power mode, and background load. Compare runs only on the same machine/runtime and do not use these microbenchmarks as a production capacity estimate.
