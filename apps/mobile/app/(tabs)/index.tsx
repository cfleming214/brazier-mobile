import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { AdapterGrid } from '@/components/AdapterGrid';
import { AlertPermissionGate } from '@/components/AlertPermissionGate';
import { CountdownRing } from '@/components/CountdownRing';
import { EventStream } from '@/components/EventStream';
import { Icon } from '@/components/Icon';
import type { StockPoint } from '@/components/Sparkline';
import { Button, EmptyState, Panel, Screen, T } from '@/components/ui';
import { WatchCard } from '@/components/WatchCard';
import { WatchRow } from '@/components/WatchRow';
import { useNow } from '@/hooks/useNow';
import type { WatchOverview, WatchStatus } from '@/lib/api';
import { retailerNames, timeAgo } from '@/lib/format';
import { summarize } from '@/lib/radar';
import { useAuth } from '@/lib/auth';
import {
  useDeleteWatch,
  useNextEvent,
  useStockEvents,
  useUpdateWatch,
  useWatches,
} from '@/lib/queries';
import { useRestockStats } from '@/lib/calendar';
import {
  pollerOnline,
  useActivity,
  useAdapterHealth,
  useInbox,
  usePollerMetrics,
  useRealtimeRadar,
} from '@/lib/telemetry';
import { colors, fonts, radius, space } from '@/lib/theme';

type Filter = 'all' | WatchStatus;

export default function Radar() {
  const now = useNow();
  const { data: watches = [], isLoading, isRefetching, refetch, isError } = useWatches();
  const { data: nextEvent } = useNextEvent();
  const update = useUpdateWatch();
  const remove = useDeleteWatch();
  const [filter, setFilter] = useState<Filter>('all');
  const { session } = useAuth();
  useRealtimeRadar(session?.user.id);
  const { data: health = [] } = useAdapterHealth();
  const { data: metrics } = usePollerMetrics();
  const { data: activity = [] } = useActivity();
  const { data: inbox = [] } = useInbox();
  const unread = inbox.filter((n) => !n.read_at).length;
  const online = pollerOnline(metrics, now);
  const upCount = health.filter((h) => h.status === 'ok').length;
  const enabledCount = health.filter(
    (h) => h.status !== 'disabled' && h.retailer_id !== 'tcgplayer',
  ).length;

  const s = useMemo(() => summarize(watches), [watches]);
  const filtered =
    filter === 'all' ? watches : watches.filter((w) => w.status === filter && !w.paused);
  const live = filtered.filter((w) => w.status === 'live' && !w.paused);
  const rest = filtered.filter((w) => !(w.status === 'live' && !w.paused));

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.header}>
          <View>
            <T variant="display">RADAR</T>
            <T variant="mono" style={{ color: colors.muted, letterSpacing: 1.2 }}>
              OPS · POKÉMON TCG
            </T>
          </View>
          <View style={styles.headerIcons}>
            <Pressable
              accessibilityLabel="Add watch"
              style={styles.iconBtn}
              onPress={() => router.push('/add-watch')}
            >
              <Icon name="search" color={colors.ink} size={18} />
            </Pressable>
            <Pressable
              testID="open-inbox"
              accessibilityLabel={`Notifications, ${unread} unread`}
              style={styles.iconBtn}
              onPress={() => router.push('/notifications')}
            >
              <Icon name="bell" color={colors.ink} size={18} />
              {unread > 0 ? <View style={styles.unreadDot} /> : null}
            </Pressable>
          </View>
        </View>

        <View style={styles.sys} testID="system-strip">
          <View style={[styles.dot, { backgroundColor: online ? colors.live : colors.muted }]} />
          <T
            variant="mono"
            style={{ color: online ? colors.live : colors.muted, fontFamily: fonts.monoSemi }}
          >
            {online ? 'POLLER ONLINE' : 'POLLER OFFLINE'}
          </T>
          {online ? (
            <T variant="mono" style={{ color: colors.muted }}>
              · p95 {metrics?.p95Ms != null ? `${(metrics.p95Ms / 1000).toFixed(1)}s` : '—'} ·{' '}
              {metrics?.checksPerMin ?? 0}/min
            </T>
          ) : (
            <T variant="mono" style={{ color: colors.muted }}>
              · last check {timeAgo(s.lastChecked, now)}
            </T>
          )}
        </View>

        <AlertPermissionGate compact />

        <View style={styles.kpis}>
          <Kpi
            testID="kpi-live"
            value={s.live}
            label="Live now"
            color={colors.live}
            active={filter === 'live'}
            onPress={() => setFilter(filter === 'live' ? 'all' : 'live')}
          />
          <Kpi
            testID="kpi-watching"
            value={s.monitoring}
            label="Watching"
            color={colors.watch}
            active={filter === 'monitoring'}
            onPress={() => setFilter(filter === 'monitoring' ? 'all' : 'monitoring')}
          />
          <Kpi
            testID="kpi-sold-out"
            value={s.soldOut}
            label="Sold out"
            color={colors.dead}
            active={filter === 'sold_out'}
            onPress={() => setFilter(filter === 'sold_out' ? 'all' : 'sold_out')}
          />
          <Kpi
            testID="kpi-total"
            value={s.total}
            label="Watches"
            color={colors.accent}
            active={filter === 'all'}
            onPress={() => setFilter('all')}
          />
        </View>

        {health.length ? (
          <Panel
            title="Retailer adapters"
            right={
              <T variant="mono" style={{ color: colors.accent }}>
                {upCount}/{enabledCount} UP
              </T>
            }
          >
            <AdapterGrid health={health} />
          </Panel>
        ) : null}

        {nextEvent ? (
          <Panel
            title="Next window"
            right={
              <Pressable onPress={() => router.push('/calendar')}>
                <T variant="mono" style={{ color: colors.accent }}>
                  CALENDAR →
                </T>
              </Pressable>
            }
          >
            <View style={styles.next}>
              <CountdownRing
                secondsLeft={(new Date(nextEvent.starts_at).getTime() - now) / 1000}
                testID="next-window-ring"
              />
              <View style={{ flex: 1, gap: 4 }}>
                <T style={{ fontFamily: fonts.bodySemi }}>{nextEvent.title}</T>
                <T
                  variant="mono"
                  style={{
                    color: nextEvent.status === 'confirmed' ? colors.live : colors.warn,
                    fontSize: 10,
                  }}
                >
                  {nextEvent.status.toUpperCase()}
                  {nextEvent.retailer_id
                    ? ` · ${retailerNames[nextEvent.retailer_id].toUpperCase()}`
                    : ''}
                </T>
              </View>
            </View>
          </Panel>
        ) : null}

        {isError && watches.length === 0 ? (
          <Panel>
            <EmptyState
              title="Can't reach Brazier"
              body="Check your connection. Your watches will appear here once we reconnect."
            />
          </Panel>
        ) : !isLoading && watches.length === 0 ? (
          <Panel title="Your watches">
            <EmptyState
              title="Nothing on radar yet"
              body="Add a product and Brazier will watch every retailer that carries it."
              action={
                <Button
                  testID="radar-add-watch"
                  label="Add a watch"
                  onPress={() => router.push('/add-watch')}
                />
              }
            />
          </Panel>
        ) : (
          <>
            {live.length > 0 ? (
              <Panel
                title={`Live now · ${live.length}`}
                right={
                  <T variant="mono" style={{ color: colors.live }}>
                    ACT FAST
                  </T>
                }
              >
                <View style={{ gap: space.sm }}>
                  {live.map((w) => (
                    <LiveCard
                      key={w.watch_id}
                      watch={w}
                      now={now}
                      onPress={() => router.push(`/watch/${w.watch_id}`)}
                      onGo={() => router.push(`/checkout/${w.watch_id}`)}
                      onPause={() =>
                        update.mutate({ id: w.watch_id, patch: { paused: !w.paused } })
                      }
                      onEdit={() => router.push(`/watch/${w.watch_id}`)}
                      onDelete={() => remove.mutate(w.watch_id)}
                    />
                  ))}
                </View>
              </Panel>
            ) : null}
            {rest.length > 0 ? (
              <Panel title={`Monitoring · ${rest.length}`}>
                <View>
                  {rest.map((w) => (
                    <WatchRow
                      key={w.watch_id}
                      watch={w}
                      now={now}
                      onPress={() => router.push(`/watch/${w.watch_id}`)}
                    />
                  ))}
                </View>
              </Panel>
            ) : null}
          </>
        )}

        <Panel
          title="Event stream"
          right={
            <T variant="mono" style={{ color: online ? colors.live : colors.muted }}>
              {online ? '● LIVE' : 'PAUSED'}
            </T>
          }
        >
          <EventStream events={activity} />
        </Panel>
      </ScrollView>
    </Screen>
  );
}

/** WatchCard with restock stats (typical sellout) and 14-day history for its product. */
function LiveCard(props: Omit<Parameters<typeof WatchCard>[0], 'typicalSelloutMin' | 'history'>) {
  const { data: stats = [] } = useRestockStats(props.watch.product_id);
  const { data: events = [] } = useStockEvents(props.watch.product_id);
  const medians = stats
    .map((s) => s.median_in_stock_min)
    .filter((m): m is number => m != null)
    .sort((a, b) => a - b);
  const history = events.length
    ? events.map((e) => ({
        at: new Date(e.observed_at).getTime(),
        inStock: e.new_state === 'IN_STOCK',
      }))
    : historyFromRetailers(props.watch);
  return (
    <WatchCard
      {...props}
      history={history}
      typicalSelloutMin={medians.length ? medians[Math.floor(medians.length / 2)]! : null}
    />
  );
}

/** Fallback before any history exists: show the current live period only. */
function historyFromRetailers(w: WatchOverview): StockPoint[] {
  return w.retailers
    .filter((r) => r.state === 'IN_STOCK' && r.last_checked_at)
    .map((r) => ({ at: new Date(r.last_checked_at!).getTime(), inStock: true }));
}

function Kpi({
  value,
  label,
  color,
  active,
  onPress,
  testID,
}: {
  value: number;
  label: string;
  color: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.kpi, active && { borderColor: color }]}
    >
      <View style={[styles.kpiStripe, { backgroundColor: color }]} />
      <T style={{ fontFamily: fonts.display, fontSize: 24, color, fontVariant: ['tabular-nums'] }}>
        {value}
      </T>
      <T variant="mono" style={{ color: colors.muted, fontSize: 9, letterSpacing: 1 }}>
        {label.toUpperCase()}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md, paddingBottom: 48 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerIcons: { flexDirection: 'row', gap: space.sm },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sys: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  unreadDot: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  kpis: { flexDirection: 'row', gap: 6 },
  kpi: {
    flex: 1,
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 8,
    overflow: 'hidden',
  },
  kpiStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  next: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
