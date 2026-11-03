import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Button, EmptyState, Panel, Screen, T } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import {
  countdownLabel,
  filterAgenda,
  FILTERS,
  getFeedUrl,
  groupByDay,
  useAgenda,
  useReminder,
  type AgendaEvent,
  type AgendaFilter,
} from '@/lib/calendar';
import { retailerNames } from '@/lib/format';
import { colors, fonts, radius, space } from '@/lib/theme';

const typeLabel: Record<AgendaEvent['event_type'], string> = {
  set_release: 'SET RELEASE',
  preorder_open: 'PREORDER',
  retailer_street_date: 'IN STORES',
  prerelease: 'PRERELEASE',
  restock_window: 'RESTOCK',
  pc_drop: 'PC DROP',
};

export default function Calendar() {
  const now = useNow(30_000);
  const params = useLocalSearchParams<{ event?: string }>();
  const { data: events = [], isLoading, refetch, isRefetching } = useAgenda();
  const [filter, setFilter] = useState<AgendaFilter>('all');
  const [openId, setOpenId] = useState<string | null>(params.event ?? null);
  const reminder = useReminder();

  useEffect(() => {
    if (params.event) setOpenId(params.event);
  }, [params.event]);

  const groups = useMemo(() => groupByDay(filterAgenda(events, filter)), [events, filter]);

  async function subscribe() {
    try {
      const url = await getFeedUrl();
      Alert.alert(
        'Add to your calendar',
        'Your drops and reminders will appear in Google or Apple Calendar.',
        [
          { text: 'Copy link', onPress: () => Clipboard.setStringAsync(url) },
          {
            text: 'Open in Calendar',
            onPress: () => Linking.openURL(url.replace(/^https?:/, 'webcal:')),
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    } catch {
      Alert.alert('Could not create your calendar link', 'Check your connection and try again.');
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.header}>
          <T variant="display">CALENDAR</T>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Pressable testID="suggest-drop" onPress={() => router.push('/calendar-submit')}>
              <T variant="mono" style={{ color: colors.accent }}>
                + SUGGEST
              </T>
            </Pressable>
            <Pressable testID="subscribe-calendar" onPress={subscribe}>
              <T variant="mono" style={{ color: colors.accent }}>
                SUBSCRIBE
              </T>
            </Pressable>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pills}
        >
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              testID={`filter-${f.key}`}
              onPress={() => setFilter(f.key)}
              style={[styles.pill, filter === f.key && styles.pillOn]}
            >
              <T style={{ fontSize: 12, color: filter === f.key ? colors.accentInk : colors.ink }}>
                {f.label}
              </T>
            </Pressable>
          ))}
        </ScrollView>

        {!isLoading && groups.length === 0 ? (
          <Panel>
            <EmptyState
              title="No drops scheduled"
              body="Set releases, preorder windows and restock windows will show up here as they're announced."
            />
          </Panel>
        ) : (
          groups.map((g) => (
            <View key={g.day} style={{ gap: space.sm }}>
              <T variant="label">{g.day}</T>
              {g.events.map((e) => (
                <EventRow
                  key={e.id}
                  e={e}
                  now={now}
                  open={openId === e.id}
                  onToggle={() => setOpenId(openId === e.id ? null : e.id)}
                  onRemind={(minutes) =>
                    reminder.mutate(
                      { event: e, minutes },
                      { onError: (err) => Alert.alert('Reminder not saved', err.message) },
                    )
                  }
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function EventRow({
  e,
  now,
  open,
  onToggle,
  onRemind,
}: {
  e: AgendaEvent;
  now: number;
  open: boolean;
  onToggle: () => void;
  onRemind: (m: number | null) => void;
}) {
  const badge = e.sponsored
    ? { label: 'SPONSORED', color: colors.muted }
    : e.is_estimate
      ? { label: 'ESTIMATE', color: colors.watch }
      : e.status === 'confirmed'
        ? { label: 'CONFIRMED', color: colors.live }
        : { label: 'RUMORED', color: colors.warn };
  const time = new Date(e.starts_at).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const countdown = countdownLabel(e.starts_at, now);

  return (
    <Pressable
      testID={`event-${e.id}`}
      onPress={onToggle}
      style={[styles.event, open && { borderColor: colors.accent }]}
    >
      <View style={styles.eventTop}>
        <View
          style={[styles.chip, { borderColor: countdown === 'LIVE' ? colors.live : colors.accent }]}
        >
          <T
            variant="mono"
            style={{ fontSize: 11, color: countdown === 'LIVE' ? colors.live : colors.accent }}
          >
            {countdown}
          </T>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontFamily: fonts.bodySemi }}>{e.title}</T>
          <T variant="mono" style={{ fontSize: 10, color: colors.muted }}>
            {typeLabel[e.event_type]} · {time}
            {e.retailer_id ? ` · ${retailerNames[e.retailer_id].toUpperCase()}` : ''}
            {e.my_reminder != null ? ' · 🔔' : ''}
          </T>
        </View>
        <T
          variant="mono"
          style={{
            fontSize: 9.5,
            color: badge.color,
            borderColor: badge.color,
            borderWidth: 1,
            paddingHorizontal: 5,
            paddingVertical: 2,
            borderRadius: 4,
          }}
        >
          {badge.label}
        </T>
      </View>
      {open ? (
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          {e.is_estimate ? (
            <T variant="muted">This is an estimate based on past restocks, not an announcement.</T>
          ) : null}
          <T variant="label">Sources</T>
          {e.source_refs.map((r, i) => (
            <Pressable
              key={`${r.source}-${i}`}
              disabled={!r.url}
              onPress={() => r.url && Linking.openURL(r.url)}
            >
              <T
                variant="mono"
                style={{ fontSize: 11, color: r.url ? colors.accent : colors.muted }}
              >
                {r.source} · {r.trust}
                {r.url ? ' ↗' : ''}
              </T>
            </Pressable>
          ))}
          <T variant="label">Remind me</T>
          <View style={styles.remindRow}>
            {[15, 60, 1440].map((m) => (
              <Pressable
                key={m}
                testID={`remind-${m}`}
                onPress={() => onRemind(m)}
                style={[styles.pill, e.my_reminder === m && styles.pillOn]}
              >
                <T
                  style={{
                    fontSize: 12,
                    color: e.my_reminder === m ? colors.accentInk : colors.ink,
                  }}
                >
                  {m === 15 ? '15 min' : m === 60 ? '1 hour' : '1 day'}
                </T>
              </Pressable>
            ))}
            {e.my_reminder != null ? (
              <Pressable testID="remind-off" onPress={() => onRemind(null)} style={styles.pill}>
                <T style={{ fontSize: 12 }}>Off</T>
              </Pressable>
            ) : null}
          </View>
          <Button
            testID="watch-from-event"
            label="Watch this"
            onPress={() =>
              router.push(
                e.product_id
                  ? {
                      pathname: '/add-watch',
                      params: {
                        productId: e.product_id,
                        ...(e.retailer_id ? { retailer: e.retailer_id } : {}),
                      },
                    }
                  : { pathname: '/add-watch', params: { q: e.set_name ?? e.title } },
              )
            }
          />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: 48 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pills: { gap: space.sm },
  pill: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  event: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: space.md,
  },
  eventTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  chip: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    minWidth: 54,
    alignItems: 'center',
  },
  remindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
