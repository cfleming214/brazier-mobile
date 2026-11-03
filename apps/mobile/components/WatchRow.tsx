import { Pressable, StyleSheet, View } from 'react-native';
import { T } from '@/components/ui';
import type { WatchOverview } from '@/lib/api';
import { pollTierLabel, retailerCodes, timeAgo } from '@/lib/format';
import { colors, fonts, space } from '@/lib/theme';
import { formatCents } from '@brazier/shared';

/** Compact monitoring row: state, retailers, poll tier, filters, last checked. */
export function WatchRow({
  watch,
  now,
  onPress,
}: {
  watch: WatchOverview;
  now: number;
  onPress?: () => void;
}) {
  const lastChecked = watch.retailers
    .map((r) => r.last_checked_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const fastest = watch.retailers.some((r) => r.poll_tier === 'burst')
    ? 'burst'
    : watch.retailers.some((r) => r.poll_tier === 'hot')
      ? 'hot'
      : watch.retailers.some((r) => r.poll_tier === 'normal')
        ? 'normal'
        : 'cold';
  const color = watch.paused
    ? colors.muted
    : fastest === 'burst'
      ? colors.accent
      : watch.status === 'sold_out'
        ? colors.dead
        : colors.watch;
  const stateLabel = watch.paused
    ? 'PAUSED'
    : fastest === 'burst'
      ? 'ARMED'
      : watch.status === 'sold_out'
        ? 'OOS'
        : 'WATCH';
  const codes = watch.retailer_ids.map((r) => retailerCodes[r]);
  const retailerText =
    codes.length > 3 ? `${codes.slice(0, 3).join(' ')} +${codes.length - 3}` : codes.join(' ');

  return (
    <Pressable
      testID={`watch-row-${watch.watch_id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.panel2 }]}
    >
      <View style={[styles.bar, { backgroundColor: color }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <T style={styles.name} numberOfLines={1}>
          {watch.product_name}
        </T>
        <T variant="mono" style={styles.meta} numberOfLines={1}>
          {retailerText} · {pollTierLabel[fastest]}
          {watch.max_price_cents ? ` · ≤ ${formatCents(watch.max_price_cents)}` : ''}
          {watch.pickup_radius_km ? ` · pickup ≤ ${watch.pickup_radius_km}km` : ''}
        </T>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <T
          variant="mono"
          style={{ color, fontFamily: fonts.monoSemi, fontSize: 11, letterSpacing: 1 }}
        >
          {stateLabel}
        </T>
        <T variant="mono" style={styles.meta}>
          {timeAgo(lastChecked, now)}
        </T>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  bar: { width: 4, height: 30, borderRadius: 2 },
  name: { fontFamily: fonts.bodyMedium, fontSize: 13 },
  meta: { color: colors.muted, fontSize: 10 },
});
