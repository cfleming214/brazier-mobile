import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';

/** Worker error reporting (DROP-53). Disabled when SENTRY_DSN is unset (local, tests). */
export function initSentry(dsn: string | undefined, release?: string) {
  if (!dsn) return false;
  Sentry.init({
    dsn,
    release,
    environment: process.env.APP_ENV ?? 'development',
    tracesSampleRate: 0.1,
  });
  return true;
}

export function reportError(e: unknown, context: Record<string, unknown> = {}) {
  Sentry.captureException(e, { extra: context });
}

export const newTraceId = () => randomUUID().replace(/-/g, '');

/**
 * One structured line per pipeline stage, all sharing a trace_id from the first read of a restock
 * through confirmation to the push, so a slow or missing alert can be followed end to end.
 */
export function traceLog(
  traceId: string,
  stage: 'observed' | 'confirmed' | 'pushed',
  fields: Record<string, unknown>,
) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
  console.log(
    JSON.stringify({ trace_id: traceId, stage, at: new Date().toISOString(), ...fields }),
  );
}
