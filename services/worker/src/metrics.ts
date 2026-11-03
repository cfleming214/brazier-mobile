/** Rolling metrics: detection-to-push latency percentiles and checks per minute. */
export class Metrics {
  private latencies: number[] = [];
  private checks: number[] = [];
  private perRetailer = new Map<
    string,
    { ok: number; fail: number; latency: number[]; checks: number[] }
  >();
  constructor(private now: () => number = Date.now) {}

  reset() {
    this.latencies = [];
    this.checks = [];
    this.perRetailer.clear();
  }

  recordLatency(ms: number) {
    this.latencies.push(ms);
    if (this.latencies.length > 500) this.latencies.shift();
  }

  recordCheck(retailer: string, ok: boolean, latencyMs: number, count = 1) {
    const t = this.now();
    for (let i = 0; i < count; i++) this.checks.push(t);
    const r = this.perRetailer.get(retailer) ?? { ok: 0, fail: 0, latency: [], checks: [] };
    if (ok) r.ok++;
    else r.fail++;
    r.latency.push(latencyMs);
    if (r.latency.length > 50) r.latency.shift();
    for (let i = 0; i < count; i++) r.checks.push(t);
    this.perRetailer.set(retailer, r);
  }

  private trim(arr: number[]) {
    const cutoff = this.now() - 60_000;
    while (arr.length && arr[0]! < cutoff) arr.shift();
    return arr.length;
  }

  checksPerMinute(): number {
    return this.trim(this.checks);
  }

  percentile(p: number): number | null {
    if (this.latencies.length === 0) return null;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
  }

  retailer(retailer: string) {
    const r = this.perRetailer.get(retailer);
    if (!r) return null;
    const total = r.ok + r.fail;
    const lat = [...r.latency].sort((a, b) => a - b);
    return {
      successRate: total ? r.ok / total : null,
      latencyMs: lat.length ? lat[Math.floor(lat.length / 2)]! : null,
      checksPerMin: this.trim(r.checks),
    };
  }

  snapshot() {
    return {
      p50Ms: this.percentile(50),
      p95Ms: this.percentile(95),
      checksPerMin: this.checksPerMinute(),
      samples: this.latencies.length,
    };
  }
}
