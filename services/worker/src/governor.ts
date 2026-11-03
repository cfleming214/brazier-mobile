import type { RetailerPolicy } from '@brazier/shared';

/** Token bucket: at most `perMinute` requests per rolling minute, smoothly refilled. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private perMinute: number,
    private now: () => number = Date.now,
    private burst = Math.max(1, Math.ceil(perMinute / 6)),
  ) {
    this.tokens = this.burst;
    this.last = now();
  }
  private refill() {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 60_000) * this.perMinute);
    this.last = t;
  }
  /** Take n tokens, refusing if that would leave fewer than `keep` in the bucket. */
  tryTake(n = 1, keep = 0): boolean {
    this.refill();
    if (this.tokens - n < keep) return false;
    this.tokens -= n;
    return true;
  }
  /** Milliseconds until n tokens are available. */
  waitMs(n = 1): number {
    this.refill();
    return this.tokens >= n ? 0 : Math.ceil(((n - this.tokens) / this.perMinute) * 60_000);
  }
}

export type BreakerState = 'closed' | 'open' | 'half_open';

/** Opens after repeated 429/403 (or errors) and stays open for the policy's backoff. */
export class CircuitBreaker {
  state: BreakerState = 'closed';
  private failures = 0;
  openUntil = 0;
  constructor(
    private backoffMs: number,
    private threshold = 3,
    private now: () => number = Date.now,
  ) {}
  canRequest(): boolean {
    if (this.state === 'open' && this.now() >= this.openUntil) this.state = 'half_open';
    return this.state !== 'open';
  }
  success() {
    this.failures = 0;
    this.state = 'closed';
  }
  failure(blocked: boolean) {
    this.failures += blocked ? this.threshold : 1; // a 429/403 opens immediately
    if (this.state === 'half_open' || this.failures >= this.threshold) {
      this.state = 'open';
      this.openUntil = this.now() + this.backoffMs * (this.state === 'open' && blocked ? 1 : 1);
      this.failures = 0;
    }
  }
}

/** Rate governor per retailer, built from its policy. */
export class RetailerGovernor {
  readonly bucket: TokenBucket;
  readonly breaker: CircuitBreaker;
  constructor(
    readonly policy: RetailerPolicy,
    now: () => number = Date.now,
  ) {
    this.bucket = new TokenBucket(policy.maxRequestsPerMinute, now);
    this.breaker = new CircuitBreaker(policy.backoffSeconds * 1000, 3, now);
  }
  /**
   * True when a request may be made right now (and consumes a token). Routine polls leave one token
   * in reserve so a restock's confirming read never queues behind them; the overall rate is unchanged.
   */
  acquire(priority: 'confirm' | 'routine' = 'routine'): boolean {
    if (!this.policy.enabled || !this.breaker.canRequest()) return false;
    const reserve = priority === 'routine' && this.policy.maxRequestsPerMinute >= 12 ? 1 : 0;
    return this.bucket.tryTake(1, reserve);
  }
  allowsUrl(url: string): boolean {
    const bare = url.replace(/^https?:\/\//, '');
    return this.policy.allowedEndpoints.some((p) => bare.startsWith(p));
  }
}
