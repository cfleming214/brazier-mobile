import { describe, expect, it } from 'vitest';
import { CircuitBreaker, RetailerGovernor, TokenBucket } from '../governor';
import { drain, MemoryQueue, MAX_ATTEMPTS } from '../queue';
import { Metrics } from '../metrics';

describe('TokenBucket', () => {
  it('never exceeds the policy rate over a minute', () => {
    let t = 0;
    const bucket = new TokenBucket(30, () => t);
    let allowed = 0;
    for (let i = 0; i < 600; i++) {
      if (bucket.tryTake()) allowed++;
      t += 100; // 60 seconds total
    }
    expect(allowed).toBeLessThanOrEqual(30 + 5); // rate plus initial burst
    expect(allowed).toBeGreaterThanOrEqual(28);
  });
});

describe('CircuitBreaker', () => {
  it('opens immediately on a block and closes after the backoff', () => {
    let t = 0;
    const b = new CircuitBreaker(60_000, 3, () => t);
    b.failure(true);
    expect(b.canRequest()).toBe(false);
    t = 59_000;
    expect(b.canRequest()).toBe(false);
    t = 60_001;
    expect(b.canRequest()).toBe(true);
    expect(b.state).toBe('half_open');
    b.success();
    expect(b.state).toBe('closed');
  });
  it('opens after repeated ordinary errors', () => {
    const b = new CircuitBreaker(1000, 3, () => 0);
    b.failure(false);
    b.failure(false);
    expect(b.canRequest()).toBe(true);
    b.failure(false);
    expect(b.canRequest()).toBe(false);
  });
});

describe('RetailerGovernor', () => {
  const policy = {
    enabled: true,
    maxRequestsPerMinute: 6,
    allowedEndpoints: ['api.bestbuy.com/v1'],
    automationAllowed: true,
    backoffSeconds: 120,
  };
  it('honours the kill switch and allowed endpoints', () => {
    expect(new RetailerGovernor({ ...policy, enabled: false }).acquire()).toBe(false);
    const g = new RetailerGovernor(policy);
    expect(g.allowsUrl('https://api.bestbuy.com/v1/products(sku=1)')).toBe(true);
    expect(g.allowsUrl('https://www.bestbuy.com/site/x')).toBe(false);
  });
});

describe('queue', () => {
  it('acks successes and dead-letters after max attempts', async () => {
    let t = 0;
    const q = new MemoryQueue(() => t);
    await q.send('poll_jobs', { n: 1 });
    await q.send('poll_jobs', { n: 2 });
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await drain<{ n: number }>(q, 'poll_jobs', 10, async (b) => {
        if (b.n === 2) throw new Error('boom');
      });
      t += 31_000;
    }
    expect(q.queues.get('poll_jobs')).toHaveLength(0);
    expect(q.queues.get('dead_letter')).toHaveLength(1);
  });
  it('hides delayed messages until due', async () => {
    let t = 0;
    const q = new MemoryQueue(() => t);
    await q.send('x', 1, 5);
    expect(await q.read('x', 10)).toHaveLength(0);
    t = 5000;
    expect(await q.read('x', 10)).toHaveLength(1);
  });
});

describe('Metrics', () => {
  it('computes p95 and checks per minute', () => {
    let t = 0;
    const m = new Metrics(() => t);
    for (let i = 1; i <= 100; i++) m.recordLatency(i * 10);
    expect(m.percentile(95)).toBe(950);
    m.recordCheck('target', true, 300, 5);
    expect(m.checksPerMinute()).toBe(5);
    t = 61_000;
    expect(m.checksPerMinute()).toBe(0);
  });
});
