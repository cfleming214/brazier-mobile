import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Panel, Screen, T } from '@/components/ui';
import { FREE_WATCH_LIMIT } from '@/lib/api';
import { captureError, track } from '@/lib/monitoring';
import {
  loadOffers,
  purchase,
  purchasesEnabled,
  restore,
  type PaywallOffer,
} from '@/lib/purchases';
import { accountKeys, keys } from '@/lib/queries';
import { colors, fonts, radius, space } from '@/lib/theme';

const PERKS = [
  'Unlimited watches',
  'Fastest polling tier on hot drops',
  'Calendar reminders for every release',
  'Restock history and typical-window stats',
  'Unlimited checkout profiles',
];

/** Paywall (DROP-52). Shown from Profile, or when the free 3-watch limit blocks a new watch. */
export default function Paywall() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const qc = useQueryClient();
  const [offers, setOffers] = useState<PaywallOffer[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    track('paywall_viewed', { reason: reason ?? 'profile' });
    loadOffers()
      .then((o) => {
        setOffers(o);
        setSelected(o.find((x) => x.period === 'annual')?.id ?? o[0]?.id ?? null);
      })
      .catch((e) => {
        captureError(e);
        setMessage('Plans could not be loaded. Check your connection.');
        setOffers([]);
      });
  }, [reason]);

  async function done() {
    // The webhook updates profiles.plan; refetch so limits and Profile reflect it.
    await qc.invalidateQueries({ queryKey: accountKeys.profile });
    await qc.invalidateQueries({ queryKey: keys.watches });
    router.back();
  }

  async function buy() {
    const offer = offers?.find((o) => o.id === selected);
    if (!offer) return;
    setBusy(true);
    setMessage(null);
    track('purchase_started', { offer: offer.id });
    try {
      const outcome = await purchase(offer);
      if (outcome === 'purchased') {
        track('purchase_completed', { offer: offer.id });
        await done();
      } else if (outcome === 'unavailable') {
        setMessage('Purchases are not available in this build.');
      }
    } catch (e) {
      captureError(e, { where: 'purchase' });
      setMessage('The purchase did not go through. You have not been charged.');
    } finally {
      setBusy(false);
    }
  }

  async function onRestore() {
    setBusy(true);
    try {
      if (await restore()) {
        track('purchase_restored');
        await done();
      } else setMessage('No active subscription was found for this account.');
    } catch (e) {
      captureError(e, { where: 'restore' });
      setMessage('Restore failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.header}>
          <T variant="display">DROPHAWK PRO</T>
          <Pressable
            accessibilityRole="button"
            testID="close-paywall"
            onPress={() => router.back()}
          >
            <T variant="mono" style={{ color: colors.accent }}>
              CLOSE
            </T>
          </Pressable>
        </View>
        {reason === 'limit' ? (
          <T testID="paywall-limit" style={{ color: colors.warn }}>
            The free plan watches up to {FREE_WATCH_LIMIT} products. Upgrade to add more, or pause a
            watch to make room.
          </T>
        ) : null}
        {reason === 'profiles' ? (
          <T style={{ color: colors.warn }}>
            The free plan saves one checkout profile. Pro saves as many as you need.
          </T>
        ) : null}
        <Panel>
          {PERKS.map((p) => (
            <T key={p} style={{ marginVertical: 2 }}>
              <T style={{ color: colors.live }}>✓ </T>
              {p}
            </T>
          ))}
        </Panel>
        {offers === null ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          offers.map((o) => (
            <Pressable
              key={o.id}
              testID={`offer-${o.id}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: o.id === selected }}
              onPress={() => setSelected(o.id)}
              style={[styles.offer, o.id === selected && styles.offerOn]}
            >
              <T style={{ fontFamily: fonts.bodySemi }}>{o.title}</T>
              <T variant="mono">{o.price}</T>
            </Pressable>
          ))
        )}
        {message ? (
          <T testID="paywall-message" variant="muted">
            {message}
          </T>
        ) : null}
        <Button
          testID="paywall-buy"
          label="Continue"
          loading={busy}
          disabled={!selected || !purchasesEnabled}
          onPress={buy}
        />
        <Button variant="ghost" label="Restore purchases" disabled={busy} onPress={onRestore} />
        <T variant="muted" style={{ fontSize: 11, textAlign: 'center' }}>
          Subscriptions renew automatically until cancelled in your App Store or Google Play
          settings.
        </T>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  offer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
  },
  offerOn: { borderColor: colors.accent },
});
