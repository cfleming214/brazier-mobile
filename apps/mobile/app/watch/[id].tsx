import { formatCents, parsePriceToCents, type RetailerSlug } from '@drophawk/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { Sparkline, type StockPoint } from '@/components/Sparkline';
import { Button, EmptyState, Panel, Screen, T } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { liveRetailer } from '@/components/WatchCard';
import { pollTierLabel, retailerNames, statusColor, timeAgo } from '@/lib/format';
import { openRetailer } from '@/lib/openRetailer';
import { useDeleteWatch, useStockEvents, useUpdateWatch, useWatch } from '@/lib/queries';
import { typicalWindow, useRestockStats } from '@/lib/calendar';
import { colors, fonts, radius, space } from '@/lib/theme';

const stateColor: Record<string, string> = {
  IN_STOCK: colors.live,
  OUT_OF_STOCK: colors.dead,
  PREORDER: colors.accent,
  DELISTED: colors.muted,
  UNKNOWN: colors.muted,
};

/** Watch Detail. Deep-link target: drophawk://watch/:id (and ?go=1 from the alert action). */
export default function WatchDetail() {
  const { id, go } = useLocalSearchParams<{ id: string; go?: string }>();
  const now = useNow();
  const { data: w, isLoading, isError } = useWatch(id);
  const { data: events = [] } = useStockEvents(w?.product_id);
  const { data: stats = [] } = useRestockStats(w?.product_id);
  const update = useUpdateWatch();
  const remove = useDeleteWatch();
  const [maxPrice, setMaxPrice] = useState('');
  const [radiusKm, setRadiusKm] = useState('');

  useEffect(() => {
    if (!w) return;
    setMaxPrice(w.max_price_cents ? (w.max_price_cents / 100).toFixed(2) : '');
    setRadiusKm(w.pickup_radius_km ? String(w.pickup_radius_km) : '');
  }, [w?.watch_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Alert action "Go to Checkout" lands here with ?go=1.
  useEffect(() => {
    if (go === '1' && w) {
      if (liveRetailer(w)) router.push(`/checkout/${w.watch_id}`);
    }
  }, [go, w?.watch_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading)
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: 64 }} color={colors.accent} />
      </Screen>
    );
  if (isError || !w) {
    return (
      <Screen>
        <EmptyState
          title="Watch not found"
          body="It may have been deleted."
          action={<Button label="Back to Radar" onPress={() => router.replace('/')} />}
        />
      </Screen>
    );
  }

  const history: StockPoint[] = events.map((e) => ({
    at: new Date(e.observed_at).getTime(),
    inStock: e.new_state === 'IN_STOCK',
  }));
  const toggleRetailer = (r: RetailerSlug) => {
    const next = w.retailer_ids.includes(r)
      ? w.retailer_ids.filter((x) => x !== r)
      : [...w.retailer_ids, r];
    if (next.length === 0) return;
    update.mutate({ id: w.watch_id, patch: { retailer_ids: next } });
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.header}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            accessibilityRole="button"
          >
            <T variant="mono" style={{ color: colors.accent }}>
              ← RADAR
            </T>
          </Pressable>
          <T
            variant="mono"
            testID="watch-status"
            style={{
              color: w.paused ? colors.muted : statusColor[w.status],
              fontFamily: fonts.monoSemi,
            }}
          >
            {w.paused ? 'PAUSED' : w.status.replace('_', ' ').toUpperCase()}
          </T>
        </View>
        <T testID="watch-product-name" style={styles.title}>
          {w.product_name}
        </T>
        <T variant="mono" style={{ color: colors.muted }}>
          {[w.set_name, w.msrp_cents ? `${formatCents(w.msrp_cents)} MSRP` : null]
            .filter(Boolean)
            .join(' · ')}
        </T>

        <Panel title="Retailers">
          {w.retailers.map((r) => (
            <View key={r.retailer_id} style={styles.retailer}>
              <View style={[styles.dot, { backgroundColor: stateColor[r.state] }]} />
              <View style={{ flex: 1 }}>
                <T style={{ fontFamily: fonts.bodyMedium }}>{retailerNames[r.retailer_id]}</T>
                <T variant="mono" style={{ color: colors.muted, fontSize: 10 }}>
                  {r.state.replace('_', ' ')} · {pollTierLabel[r.poll_tier]} · checked{' '}
                  {timeAgo(r.last_checked_at, now)}
                </T>
              </View>
              <T variant="mono" style={{ marginRight: space.sm }}>
                {formatCents(r.price_cents)}
              </T>
              {r.url ? (
                <Pressable
                  testID={`open-${r.retailer_id}`}
                  onPress={() =>
                    r.state === 'IN_STOCK'
                      ? router.push(`/checkout/${w.watch_id}?retailer=${r.retailer_id}`)
                      : openRetailer(r)
                  }
                  style={[
                    styles.open,
                    r.state === 'IN_STOCK' && { backgroundColor: colors.accent },
                  ]}
                >
                  <T
                    style={{
                      color: r.state === 'IN_STOCK' ? colors.accentInk : colors.accent,
                      fontFamily: fonts.displaySemi,
                      fontSize: 12,
                    }}
                  >
                    {r.state === 'IN_STOCK' ? 'GO' : 'OPEN'}
                  </T>
                </Pressable>
              ) : null}
            </View>
          ))}
        </Panel>

        <Panel title="Stock history · 14 days">
          {history.length ? (
            <Sparkline points={history} now={now} height={40} />
          ) : (
            <T variant="muted">
              No restocks recorded yet. History builds as DropHawk watches this product.
            </T>
          )}
        </Panel>

        <Panel title="Alert me at">
          <View style={styles.chips}>
            {(
              [
                'bestbuy',
                'target',
                'walmart',
                'gamestop',
                'pokemoncenter',
                'amazon',
              ] as RetailerSlug[]
            )
              .filter(
                (r) => w.retailers.some((x) => x.retailer_id === r) || w.retailer_ids.includes(r),
              )
              .map((r) => {
                const on = w.retailer_ids.includes(r);
                return (
                  <Pressable
                    key={r}
                    testID={`toggle-${r}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    onPress={() => toggleRetailer(r)}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <T style={{ color: on ? colors.accentInk : colors.ink, fontSize: 13 }}>
                      {retailerNames[r]}
                    </T>
                  </Pressable>
                );
              })}
          </View>
          <T variant="label">Max price</T>
          <TextInput
            testID="detail-max-price"
            value={maxPrice}
            onChangeText={setMaxPrice}
            onEndEditing={() => {
              const cents = maxPrice.trim() ? parsePriceToCents(maxPrice) : null;
              if (maxPrice.trim() && !cents)
                return Alert.alert('Invalid price', 'Enter a price like 65 or 64.99.');
              update.mutate({ id: w.watch_id, patch: { max_price_cents: cents } });
            }}
            placeholder="Any price"
            placeholderTextColor={colors.muted}
            keyboardType="decimal-pad"
            style={styles.input}
          />
          <T variant="label">Store pickup radius (km)</T>
          <TextInput
            value={radiusKm}
            onChangeText={setRadiusKm}
            onEndEditing={() => {
              const km = radiusKm.trim() ? Number(radiusKm) : null;
              if (km != null && (!Number.isFinite(km) || km <= 0 || km > 500))
                return Alert.alert('Invalid radius', 'Use 1 to 500 km.');
              update.mutate({ id: w.watch_id, patch: { pickup_radius_km: km } });
            }}
            placeholder="Shipping only"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            style={styles.input}
          />
          <View style={styles.switchRow}>
            <T style={{ flex: 1 }}>Include marketplace sellers</T>
            <Switch
              value={w.include_marketplace}
              onValueChange={(v) =>
                update.mutate({ id: w.watch_id, patch: { include_marketplace: v } })
              }
              trackColor={{ true: colors.accent, false: colors.line }}
            />
          </View>
        </Panel>

        <Button
          testID="pause-watch"
          variant="ghost"
          label={w.paused ? 'Resume alerts' : 'Pause alerts'}
          onPress={() => update.mutate({ id: w.watch_id, patch: { paused: !w.paused } })}
        />
        <Button
          testID="delete-watch"
          variant="ghost"
          label="Delete watch"
          onPress={() =>
            Alert.alert('Delete this watch?', 'You will stop getting alerts for this product.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  remove.mutate(w.watch_id);
                  router.replace('/');
                },
              },
            ])
          }
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md, paddingBottom: 64 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28 },
  retailer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  open: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  input: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: 16,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm },
});
