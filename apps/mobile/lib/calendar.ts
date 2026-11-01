import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RetailerSlug } from '@drophawk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { env } from './env';
import { supabase } from './supabase';

export interface AgendaEvent {
  id: string;
  title: string;
  event_type:
    | 'set_release'
    | 'preorder_open'
    | 'retailer_street_date'
    | 'prerelease'
    | 'restock_window'
    | 'pc_drop';
  retailer_id: RetailerSlug | null;
  starts_at: string;
  timezone: string;
  status: 'rumored' | 'confirmed' | 'cancelled';
  confidence: number;
  is_estimate: boolean;
  sponsored: boolean;
  source_refs: { source: string; url: string | null; trust: string }[];
  product_id: string | null;
  set_name: string | null;
  product_name: string | null;
  my_reminder: number | null;
}

export type AgendaFilter = 'all' | 'releases' | 'preorders' | 'retailers' | 'restocks';

export const FILTERS: { key: AgendaFilter; label: string; types: AgendaEvent['event_type'][] }[] = [
  { key: 'all', label: 'All', types: [] },
  { key: 'releases', label: 'Set releases', types: ['set_release', 'prerelease'] },
  { key: 'preorders', label: 'Preorders', types: ['preorder_open', 'pc_drop'] },
  { key: 'retailers', label: 'Retailers', types: ['retailer_street_date'] },
  { key: 'restocks', label: 'Restock windows', types: ['restock_window'] },
];

export function filterAgenda(events: AgendaEvent[], f: AgendaFilter): AgendaEvent[] {
  const types = FILTERS.find((x) => x.key === f)?.types ?? [];
  return types.length ? events.filter((e) => types.includes(e.event_type)) : events;
}

/** Group by local calendar day, keeping order. */
export function groupByDay(events: AgendaEvent[]): { day: string; events: AgendaEvent[] }[] {
  const out: { day: string; events: AgendaEvent[] }[] = [];
  for (const e of events) {
    const day = new Date(e.starts_at).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const last = out.at(-1);
    if (last?.day === day) last.events.push(e);
    else out.push({ day, events: [e] });
  }
  return out;
}

/** "in 8m", "in 3h", "in 2d", "LIVE", "ENDED". */
export function countdownLabel(startsAt: string, now: number): string {
  const s = (Date.parse(startsAt) - now) / 1000;
  if (s <= 0) return s > -3600 ? 'LIVE' : 'ENDED';
  if (s < 3600) return `in ${Math.ceil(s / 60)}m`;
  if (s < 86_400) return `in ${Math.floor(s / 3600)}h`;
  return `in ${Math.floor(s / 86_400)}d`;
}

export const useAgenda = () =>
  useQuery({
    queryKey: ['calendar', 'agenda'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('calendar_agenda')
        .select('*')
        .neq('status', 'cancelled')
        .order('starts_at')
        .limit(200);
      if (error) throw error;
      return data as AgendaEvent[];
    },
    staleTime: 60_000,
  });

const reminderKey = (eventId: string) => `reminder:${eventId}`;

/** Follow an event (server push on changes + server reminder) and schedule a local reminder. */
export async function setReminder(e: AgendaEvent, minutesBefore: number) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error('Sign in required');
  const { error } = await supabase
    .from('calendar_follows')
    .upsert(
      { user_id: u.user.id, event_id: e.id, remind_minutes_before: minutesBefore },
      { onConflict: 'user_id,event_id' },
    );
  if (error) throw error;
  await cancelLocalReminder(e.id);
  const at = new Date(Date.parse(e.starts_at) - minutesBefore * 60_000);
  if (at.getTime() > Date.now()) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title:
          minutesBefore >= 60
            ? `Starting in ${Math.round(minutesBefore / 60)}h`
            : `Starting in ${minutesBefore} min`,
        body: e.title,
        data: { type: 'calendar', eventId: e.id, local: true },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
    await AsyncStorage.setItem(reminderKey(e.id), id);
  }
}

async function cancelLocalReminder(eventId: string) {
  const id = await AsyncStorage.getItem(reminderKey(eventId));
  if (id) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    await AsyncStorage.removeItem(reminderKey(eventId));
  }
}

export async function clearReminder(eventId: string) {
  await supabase.from('calendar_follows').delete().eq('event_id', eventId);
  await cancelLocalReminder(eventId);
}

export function useReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ event, minutes }: { event: AgendaEvent; minutes: number | null }) =>
      minutes == null ? clearReminder(event.id) : setReminder(event, minutes),
    onSettled: () => qc.invalidateQueries({ queryKey: ['calendar', 'agenda'] }),
  });
}

/** Personal ICS URL for Google/Apple Calendar (served by the ics_feed RPC). */
export async function getFeedUrl(): Promise<string> {
  let { data } = await supabase.from('calendar_feeds').select('token').maybeSingle();
  if (!data) {
    const { data: u } = await supabase.auth.getUser();
    const ins = await supabase
      .from('calendar_feeds')
      .insert({ user_id: u.user!.id })
      .select('token')
      .single();
    if (ins.error) throw ins.error;
    data = ins.data;
  }
  return `${env.supabaseUrl}/rest/v1/rpc/ics_feed?token=${data.token}&apikey=${env.supabaseAnonKey}`;
}

export async function submitDrop(input: {
  title: string;
  event_type: AgendaEvent['event_type'];
  retailer_id: RetailerSlug | null;
  starts_at: string;
  source_url: string | null;
  note: string | null;
}) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('calendar_submissions')
    .insert({ ...input, user_id: u.user!.id });
  if (error) throw error;
}

export interface RestockStats {
  retailer_sku_id: string;
  restocks_30d: number;
  restocks_90d: number;
  median_in_stock_min: number | null;
  typical_dow: number | null;
  typical_hour: number | null;
  pattern_share: number | null;
  last_restock_at: string | null;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Thu ~3am ET" when the pattern is strong enough to mention. */
export function typicalWindow(
  s: Pick<RestockStats, 'typical_dow' | 'typical_hour' | 'pattern_share' | 'restocks_90d'>,
): string | null {
  if (
    s.typical_dow == null ||
    s.typical_hour == null ||
    (s.pattern_share ?? 0) < 0.5 ||
    s.restocks_90d < 2
  )
    return null;
  const h = s.typical_hour;
  const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
  return `${DOW[s.typical_dow]} ~${label} ET`;
}

export const useRestockStats = (productId: string | undefined) =>
  useQuery({
    queryKey: ['restock-stats', productId],
    enabled: !!productId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('restock_stats')
        .select('*, retailer_skus!inner(retailer_id, product_id)')
        .eq('retailer_skus.product_id', productId!);
      if (error) throw error;
      return data as unknown as (RestockStats & { retailer_skus: { retailer_id: RetailerSlug } })[];
    },
    staleTime: 10 * 60_000,
  });

/** Parse "2026-11-07 03:00" (local time) into ISO. Exported for tests. */
export function parseLocalDateTime(input: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(input.trim());
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
  );
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
