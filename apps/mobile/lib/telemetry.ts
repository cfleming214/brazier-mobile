import type { RetailerSlug } from '@brazier/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from './supabase';
import { testCatalog } from './testMode/catalog';
import { currentDataSource, useDataSource } from './testMode/settings';

export interface AdapterHealth {
  retailer_id: RetailerSlug;
  status: 'ok' | 'degraded' | 'backoff' | 'down' | 'disabled' | 'unknown';
  latency_ms: number | null;
  success_rate: number | null;
  checks_per_min: number;
  active_protections: string[];
  updated_at: string;
}

export interface PollerMetrics {
  online?: boolean;
  p50Ms?: number | null;
  p95Ms?: number | null;
  checksPerMin?: number;
}

export interface ActivityEvent {
  id: number;
  retailer_id: RetailerSlug | null;
  kind:
    'poll' | 'in_stock' | 'out_of_stock' | 'suppressed' | 'push' | 'flap' | 'protection' | 'error';
  message: string;
  created_at: string;
}

export interface InboxItem {
  id: string;
  category: 'restock' | 'bot_status' | 'drop_updates' | 'reminders' | 'community';
  title: string;
  body: string;
  data: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

export const telemetryKeys = {
  health: ['adapter-health'] as const,
  metrics: ['system-metrics'] as const,
  activity: ['activity'] as const,
  inbox: ['inbox'] as const,
};

export const useAdapterHealth = () =>
  useQuery({
    queryKey: [...telemetryKeys.health, useDataSource()],
    queryFn: async () => {
      if ((await currentDataSource()) === 'test') return testCatalog.adapterHealth();
      const { data, error } = await supabase
        .from('adapter_health')
        .select('*')
        .order('retailer_id');
      if (error) throw error;
      return data as AdapterHealth[];
    },
    refetchInterval: 15_000,
  });

export const usePollerMetrics = () =>
  useQuery({
    queryKey: telemetryKeys.metrics,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_metrics')
        .select('value, updated_at')
        .eq('key', 'poller')
        .maybeSingle();
      if (error) throw error;
      return data
        ? { ...(data.value as PollerMetrics), updatedAt: data.updated_at as string }
        : null;
    },
    refetchInterval: 10_000,
  });

export const useActivity = () =>
  useQuery({
    queryKey: telemetryKeys.activity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_events')
        .select('id, retailer_id, kind, message, created_at')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as ActivityEvent[];
    },
  });

export const useInbox = () =>
  useQuery({
    queryKey: telemetryKeys.inbox,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, category, title, body, data, created_at, read_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as InboxItem[];
    },
  });

/** Subscribe to Supabase Realtime and refresh the affected queries as rows arrive. */
export function useRealtimeRadar(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`radar-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_events',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          qc.setQueryData<ActivityEvent[]>(telemetryKeys.activity, (old) =>
            [payload.new as ActivityEvent, ...(old ?? [])].slice(0, 30),
          );
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: telemetryKeys.inbox });
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'adapter_health' }, () => {
        qc.invalidateQueries({ queryKey: telemetryKeys.health });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'retailer_skus' }, () => {
        qc.invalidateQueries({ queryKey: ['watches'] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, userId]);
}

/** The poller is online if it reported in the last 30 seconds and didn't sign off. */
export function pollerOnline(
  m: (PollerMetrics & { updatedAt: string }) | null | undefined,
  now: number,
): boolean {
  return !!m && m.online !== false && now - Date.parse(m.updatedAt) < 30_000;
}
