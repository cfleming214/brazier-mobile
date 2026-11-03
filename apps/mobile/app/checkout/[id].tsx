import { formatCents, type RetailerSlug } from '@brazier/shared';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, EmptyState, Panel, Screen, T } from '@/components/ui';
import { useCheckoutProfiles } from '@/hooks/useCheckoutProfiles';
import { markCartOpened, type RetailerState } from '@/lib/api';
import { copyFields } from '@/lib/checkoutProfile';
import { retailerNames } from '@/lib/format';
import { captureError, track } from '@/lib/monitoring';
import { openRetailer } from '@/lib/openRetailer';
import { useNow } from '@/hooks/useNow';
import { useStockEvents, useWatch } from '@/lib/queries';
import { colors, fonts, radius, space } from '@/lib/theme';

/**
 * Checkout Sheet (DROP-51). Opens the retailer's own app or site for the in-stock item and offers
 * copy chips from a device-only checkout profile. The user completes checkout themselves.
 */
export default function CheckoutSheet() {
  const { id, retailer } = useLocalSearchParams<{ id: string; retailer?: RetailerSlug }>();
  const { data: w } = useWatch(id);
  const { data: profiles = [] } = useCheckoutProfiles();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const now = useNow();
  const { data: events = [] } = useStockEvents(w?.product_id);
  const liveSince = [...events].reverse().find((e) => e.new_state === 'IN_STOCK')?.observed_at;

  useEffect(() => {
    track('checkout_sheet_opened');
  }, []);

  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0];
  const live = (w?.retailers ?? [])
    .filter((r) => r.state === 'IN_STOCK' && r.url)
    .sort((a, b) => (a.retailer_id === retailer ? -1 : b.retailer_id === retailer ? 1 : 0));

  async function go(r: RetailerState) {
    track('retailer_opened', { retailer: r.retailer_id });
    markCartOpened(id).catch((e) => captureError(e, { where: 'mark_cart_opened' }));
    await openRetailer(r);
  }

  async function copy(key: string, value: string) {
    await Clipboard.setStringAsync(value);
    setCopied(key);
    track('field_copied', { field: key });
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.header}>
          <T variant="display">CHECKOUT</T>
          <Pressable
            accessibilityRole="button"
            testID="close-checkout"
            onPress={() => router.back()}
          >
            <T variant="mono" style={{ color: colors.accent }}>
              CLOSE
            </T>
          </Pressable>
        </View>
        {w ? (
          <T testID="checkout-product" style={{ fontFamily: fonts.bodySemi, fontSize: 16 }}>
            {w.product_name}
          </T>
        ) : null}
        {liveSince && live.length > 0 ? (
          <T testID="checkout-elapsed" variant="mono" style={{ color: colors.live }}>
            IN STOCK FOR {formatElapsed(now - Date.parse(liveSince))}
          </T>
        ) : null}

        <Panel title="In stock now">
          {live.length === 0 ? (
            <T variant="muted" testID="checkout-none-live">
              Nothing is in stock right now. We’ll alert you the moment it is.
            </T>
          ) : (
            <View style={{ gap: space.sm }}>
              {live.map((r) => (
                <Pressable
                  key={r.retailer_id}
                  testID={`checkout-go-${r.retailer_id}`}
                  accessibilityRole="button"
                  onPress={() => go(r)}
                  style={styles.go}
                >
                  <T style={styles.goLabel}>{retailerNames[r.retailer_id]}</T>
                  <T style={styles.goLabel}>{formatCents(r.price_cents)} →</T>
                </Pressable>
              ))}
              <T variant="muted" style={{ fontSize: 12 }}>
                Opens the retailer’s app or website. Add to cart and pay there.
              </T>
            </View>
          )}
        </Panel>

        <Panel title="Copy your details">
          {profile ? (
            <View style={{ gap: space.sm }}>
              {profiles.length > 1 ? (
                <View style={styles.chips}>
                  {profiles.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => setProfileId(p.id)}
                      style={[styles.chip, p.id === profile.id && styles.chipOn]}
                    >
                      <T variant="mono">{p.label}</T>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={styles.chips}>
                {copyFields(profile).map((f) => (
                  <Pressable
                    key={f.key}
                    testID={`copy-${f.key}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Copy ${f.label}`}
                    onPress={() => copy(f.key, f.value)}
                    style={[styles.chip, copied === f.key && styles.chipCopied]}
                  >
                    <T variant="label" style={{ fontSize: 10 }}>
                      {copied === f.key ? 'COPIED' : f.label}
                    </T>
                    <T variant="mono" numberOfLines={1}>
                      {f.value}
                    </T>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <EmptyState
              title="No checkout profile"
              body="Save your shipping details on this device to copy them in one tap."
              action={
                <Button
                  testID="checkout-add-profile"
                  variant="ghost"
                  label="Add a profile"
                  onPress={() => router.push('/settings/checkout-profiles')}
                />
              }
            />
          )}
        </Panel>
      </ScrollView>
    </Screen>
  );
}

function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  go: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: space.md,
  },
  goLabel: { color: colors.accentInk, fontFamily: fonts.displaySemi, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel2,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    maxWidth: '100%',
  },
  chipOn: { borderColor: colors.accent },
  chipCopied: { borderColor: colors.live },
});
