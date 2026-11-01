// Worker service entry point. Scheduler, adapters, detector and notifier land in Phase 2 (DROP-27).
import type { RetailerAdapter } from '@drophawk/shared';

export const adapters: RetailerAdapter[] = [];
