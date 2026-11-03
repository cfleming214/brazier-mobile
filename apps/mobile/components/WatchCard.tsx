import { formatCents } from '@brazier/shared';
import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Sparkline, type StockPoint } from '@/components/Sparkline';
import { T } from '@/components/ui';
import type { RetailerState, WatchOverview } from '@/lib/api';
import { formatDuration, retailerNames, statusColor } from '@/lib/format';
import { colors, fonts, radius, space } from '@/lib/theme';

export interface WatchCardProps {
  watch: WatchOverview;
  now: number;
  history?: StockPoint[];
  /** Median minutes an item stays in stock (Phase 3 restock stats). */
  typicalSelloutMin?: number | null;
  onPress?: () => void;
  onGo?: (r: RetailerState) => void;
  onPause?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

/** The retailer that is live (cheapest first) or null. */
export function liveRetailer(w: WatchOverview): RetailerState | null {
  const live = w.retailers.filter((r) => r.state === 'IN_STOCK');
  live.sort((a, b) => (a.price_cents ?? Infinity) - (b.price_cents ?? Infinity));
  return live[0] ?? null;
}

export function priceDelta(
  priceCents: number | null,
  msrpCents: number | null,
): { label: string; color: string } {
  if (priceCents == null || msrpCents == null) return { label: '', color: colors.muted };
  const diff = priceCents - msrpCents;
  if (Math.abs(diff) < 50) return { label: 'MSRP', color: colors.live };
  const pct = Math.round((diff / msrpCents) * 100);
  return diff > 0
    ? { label: `+${pct}%`, color: colors.dead }
    : { label: `${pct}%`, color: colors.live };
}

export function WatchCard({
  watch,
  now,
  history = [],
  typicalSelloutMin,
  onPress,
  onGo,
  onPause,
  onEdit,
  onDelete,
}: WatchCardProps) {
  const swipe = useRef<SwipeableMethods>(null);
  const live = liveRetailer(watch);
  const liveSince = live?.last_checked_at
    ? (now - new Date(live.last_checked_at).getTime()) / 1000
    : null;
  const delta = priceDelta(live?.price_cents ?? null, watch.msrp_cents);
  const accent = statusColor[watch.status];

  const actions = () => (
    <View style={styles.actions}>
      {onPause ? (
        <Action
          label={watch.paused ? 'Resume' : 'Pause'}
          color={colors.watch}
          onPress={() => {
            swipe.current?.close();
            onPause();
          }}
        />
      ) : null}
      {onEdit ? (
        <Action
          label="Edit"
          color={colors.accent}
          onPress={() => {
            swipe.current?.close();
            onEdit();
          }}
        />
      ) : null}
      {onDelete ? (
        <Action
          label="Delete"
          color={colors.dead}
          onPress={() => {
            swipe.current?.close();
            onDelete();
          }}
        />
      ) : null}
    </View>
  );

  return (
    <Swipeable ref={swipe} renderRightActions={actions} overshootRight={false}>
      <Pressable
        testID={`watch-card-${watch.watch_id}`}
        onPress={onPress}
        style={[styles.card, { borderColor: watch.status === 'live' ? '#1d4a3a' : colors.line }]}
      >
        <View style={[styles.stripe, { backgroundColor: accent }]} />
        <View style={styles.top}>
          <View style={{ flex: 1, gap: 2 }}>
            <T style={styles.name} numberOfLines={2}>
              {watch.product_name}
            </T>
            <T variant="mono" style={{ color: colors.muted, fontSize: 10 }}>
              {live
                ? `${retailerNames[live.retailer_id].toUpperCase()} · ${live.retailer_sku}`
                : (watch.set_name?.toUpperCase() ?? '')}
            </T>
          </View>
          {watch.status === 'live' ? (
            <View style={styles.badge}>
              <T style={styles.badgeText}>IN STOCK</T>
            </View>
          ) : watch.paused ? (
            <T variant="mono" style={{ color: colors.muted }}>
              PAUSED
            </T>
          ) : null}
        </View>

        <View style={styles.stats}>
          <Stat
            k="Price"
            v={formatCents(live?.price_cents ?? watch.msrp_cents)}
            d={delta.label}
            dColor={delta.color}
          />
          <Stat
            k="Live for"
            v={liveSince != null ? formatDuration(liveSince) : '—'}
            testID="live-for"
          />
          <Stat
            k="Typ. sellout"
            v={typicalSelloutMin != null ? `~${typicalSelloutMin} min` : '—'}
          />
        </View>

        <View style={styles.bottom}>
          <View style={{ flex: 1 }}>
            <Sparkline points={history} now={now} />
          </View>
          {live && onGo ? (
            <Pressable
              testID="go-button"
              accessibilityRole="button"
              accessibilityLabel={`Go to ${retailerNames[live.retailer_id]}`}
              onPress={() => onGo(live)}
              style={styles.go}
            >
              <T style={styles.goText}>GO →</T>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </Swipeable>
  );
}

function Stat({
  k,
  v,
  d,
  dColor,
  testID,
}: {
  k: string;
  v: string;
  d?: string;
  dColor?: string;
  testID?: string;
}) {
  return (
    <View style={styles.stat}>
      <T variant="mono" style={styles.statK}>
        {k.toUpperCase()}
      </T>
      <T variant="mono" style={styles.statV} testID={testID}>
        {v}{' '}
        {d ? (
          <T variant="mono" style={{ fontSize: 10, color: dColor }}>
            {d}
          </T>
        ) : null}
      </T>
    </View>
  );
}

function Action({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.action, { backgroundColor: color }]}
    >
      <T style={{ color: colors.bg, fontFamily: fonts.displaySemi, fontSize: 12 }}>{label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    paddingLeft: space.md + 3,
    gap: space.sm,
    overflow: 'hidden',
  },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  top: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  name: { fontFamily: fonts.bodySemi, fontSize: 14, lineHeight: 18 },
  badge: {
    backgroundColor: colors.live,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  badgeText: { color: '#052016', fontFamily: fonts.monoSemi, fontSize: 10, letterSpacing: 1 },
  stats: { flexDirection: 'row', gap: space.xs },
  stat: {
    flex: 1,
    backgroundColor: 'rgba(7,11,16,0.55)',
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 7,
    padding: 6,
  },
  statK: { color: colors.muted, fontSize: 8.5, letterSpacing: 1 },
  statV: { fontFamily: fonts.monoSemi, fontSize: 12.5, marginTop: 2 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  go: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  goText: { color: colors.accentInk, fontFamily: fonts.display, fontSize: 13, letterSpacing: 1.3 },
  actions: { flexDirection: 'row', alignItems: 'stretch', marginLeft: space.sm, gap: 4 },
  action: { justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.md },
});
