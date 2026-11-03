import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, View } from 'react-native';
import { AlertPermissionGate } from '@/components/AlertPermissionGate';
import { TestModeToggle } from '@/components/TestModeToggle';
import { Button, Panel, Screen, T } from '@/components/ui';
import { useCheckoutProfiles } from '@/hooks/useCheckoutProfiles';
import { deleteMyAccount, exportMyData, FREE_WATCH_LIMIT } from '@/lib/api';
import { signOut, useAuth } from '@/lib/auth';
import { clearProfiles } from '@/lib/checkoutProfile';
import { captureError, track } from '@/lib/monitoring';
import { planLabel, resetPurchases } from '@/lib/purchases';
import { useHitRate, useMyProfile, useWatches } from '@/lib/queries';
import { queryClient } from '@/lib/queryClient';
import { formatResponseTime } from '@/lib/format';
import { colors, fonts, space } from '@/lib/theme';
import Constants from 'expo-constants';

/** Profile & Settings (DROP-56). */
export default function Profile() {
  const { session } = useAuth();
  const { data: me } = useMyProfile();
  const { data: hit } = useHitRate();
  const { data: watches = [] } = useWatches();
  const { data: profiles = [] } = useCheckoutProfiles();
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);

  const plan = me?.plan ?? 'free';
  const active = watches.filter((w) => !w.paused).length;
  const hitRate =
    hit && hit.alerts_received > 0
      ? `${Math.round((hit.carts_opened / hit.alerts_received) * 100)}%`
      : '—';

  async function onExport() {
    setBusy('export');
    try {
      const data = await exportMyData();
      track('data_exported');
      await Share.share({ title: 'Brazier data export', message: JSON.stringify(data, null, 2) });
    } catch (e) {
      captureError(e, { where: 'export' });
      Alert.alert('Export failed', 'Try again in a moment.');
    } finally {
      setBusy(null);
    }
  }

  function onDelete() {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your watches, alerts and settings. Subscriptions must be cancelled separately in your app store.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy('delete');
            try {
              track('account_deleted');
              await deleteMyAccount();
              await clearProfiles();
              await resetPurchases();
              queryClient.clear();
              await signOut();
            } catch (e) {
              captureError(e, { where: 'delete_account' });
              Alert.alert('Could not delete account', 'Try again or contact support.');
              setBusy(null);
            }
          },
        },
      ],
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <T variant="display">PROFILE</T>
        <Panel title="Account">
          <View style={{ gap: space.xs }}>
            <T variant="muted">Signed in as</T>
            <T testID="profile-email">{session?.user.email ?? '—'}</T>
          </View>
        </Panel>

        <Panel
          title="Plan"
          right={
            <T testID="profile-plan" variant="mono" style={{ color: colors.accent }}>
              {planLabel[plan].toUpperCase()}
            </T>
          }
        >
          {plan === 'free' ? (
            <View style={{ gap: space.sm }}>
              <T variant="muted" testID="profile-watch-usage">
                {active} of {FREE_WATCH_LIMIT} active watches used
              </T>
              <Button
                testID="profile-upgrade"
                label="Upgrade to Pro"
                onPress={() => router.push('/paywall')}
              />
            </View>
          ) : (
            <T variant="muted">
              Unlimited watches
              {me?.plan_expires_at
                ? ` · renews ${new Date(me.plan_expires_at).toLocaleDateString()}`
                : ''}
            </T>
          )}
        </Panel>

        <Panel title="Hit rate">
          <View style={styles.stats}>
            <Stat label="Alerts" value={String(hit?.alerts_received ?? 0)} />
            <Stat label="Opened" value={String(hit?.carts_opened ?? 0)} />
            <Stat label="Hit rate" value={hitRate} testID="profile-hit-rate" />
            <Stat label="Avg response" value={formatResponseTime(hit?.avg_response_seconds)} />
          </View>
        </Panel>

        <AlertPermissionGate />
        <Button
          testID="open-notification-settings"
          label="Notification settings"
          variant="ghost"
          onPress={() => router.push('/settings/notifications')}
        />
        <Button
          testID="open-checkout-profiles"
          label={`Checkout profiles · ${profiles.length}`}
          variant="ghost"
          onPress={() => router.push('/settings/checkout-profiles')}
        />

        <TestModeToggle />

        <Panel title="Your data">
          <View style={{ gap: space.sm }}>
            <Button
              testID="export-data"
              variant="ghost"
              label="Export my data"
              loading={busy === 'export'}
              onPress={onExport}
            />
            <Button
              testID="delete-account"
              variant="ghost"
              label="Delete account"
              loading={busy === 'delete'}
              onPress={onDelete}
            />
          </View>
        </Panel>

        <Button testID="sign-out" label="Sign out" variant="ghost" onPress={() => signOut()} />
        <T variant="mono" style={{ color: colors.muted, textAlign: 'center' }}>
          Brazier v{Constants.expoConfig?.version ?? '0.1'}
        </T>
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.stat}>
      <T testID={testID} style={{ fontFamily: fonts.display, fontSize: 20 }}>
        {value}
      </T>
      <T variant="label" style={{ fontSize: 10 }}>
        {label}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
});
