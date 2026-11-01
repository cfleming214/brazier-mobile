import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

/**
 * Crash reporting, tracing and product analytics.
 *  - Sentry: errors + performance traces. Disabled when EXPO_PUBLIC_SENTRY_DSN is unset (dev, tests).
 *  - Analytics: a small fixed set of product events written to `analytics_events` (RLS: insert own).
 *    No PII in properties; checkout profile data is never sent.
 */
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
export const monitoringEnabled = dsn.length > 0;

export function initMonitoring() {
  if (!monitoringEnabled) return;
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
    release: Constants.expoConfig?.version,
    tracesSampleRate: process.env.EXPO_PUBLIC_APP_ENV === 'production' ? 0.2 : 1.0,
    sendDefaultPii: false,
    beforeBreadcrumb: (b) => (b.category === 'console' ? null : b),
  });
}

export const AnalyticsEvent = [
  'watch_created',
  'watch_limit_hit',
  'paywall_viewed',
  'purchase_started',
  'purchase_completed',
  'purchase_restored',
  'alert_opened',
  'checkout_sheet_opened',
  'retailer_opened',
  'field_copied',
  'calendar_followed',
  'data_exported',
  'account_deleted',
] as const;
export type AnalyticsEvent = (typeof AnalyticsEvent)[number];

type Props = Record<string, string | number | boolean | null>;

export function track(event: AnalyticsEvent, props: Props = {}) {
  if (monitoringEnabled)
    Sentry.addBreadcrumb({ category: 'analytics', message: event, data: props });
  // Fire-and-forget; analytics must never break a user flow.
  void Promise.resolve(
    supabase
      .from('analytics_events')
      .insert({ event, props, platform: Constants.platform?.ios ? 'ios' : 'android' }),
  ).catch(() => {});
}

export function captureError(e: unknown, context?: Props) {
  if (monitoringEnabled) Sentry.captureException(e, { extra: context });
  else if (process.env.NODE_ENV !== 'test') console.warn(e);
}

export function identify(userId: string | null) {
  if (monitoringEnabled) Sentry.setUser(userId ? { id: userId } : null);
}

/** Wraps an async operation in a Sentry span (no-op without a DSN). */
export function traced<T>(name: string, op: string, fn: () => Promise<T>): Promise<T> {
  if (!monitoringEnabled) return fn();
  return Sentry.startSpan({ name, op }, fn);
}

export const wrapRoot = (C: () => React.ReactNode): (() => React.ReactNode) =>
  monitoringEnabled
    ? (Sentry.wrap(C as React.ComponentType<Record<string, unknown>>) as () => React.ReactNode)
    : C;
