import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Button, T } from '@/components/ui';
import {
  getPushPermission,
  registerPushToken,
  requestPushPermission,
  type PushPermission,
} from '@/lib/push';
import { colors, radius, space } from '@/lib/theme';

/**
 * Shows remediation when notifications are off or downgraded. Without push, alerts can't reach the user,
 * so watches are not really "live" until this is resolved.
 */
export function AlertPermissionGate({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<PushPermission | null>(null);

  useFocusEffect(
    useCallback(() => {
      getPushPermission()
        .then(setStatus)
        .catch(() => setStatus('unsupported'));
    }, []),
  );

  if (status === null || status === 'granted' || status === 'unsupported') return null;

  return (
    <View style={styles.box} testID="alert-permission-gate">
      <T style={{ color: colors.warn, fontWeight: '600' }}>Alerts are off</T>
      {!compact ? (
        <T variant="muted">
          Brazier can't tell you when something restocks.{' '}
          {status === 'denied'
            ? 'Turn on notifications for Brazier in Settings.'
            : 'Allow notifications to get restock alerts.'}
        </T>
      ) : null}
      {status === 'denied' ? (
        <Button label="Open Settings" onPress={() => Linking.openSettings()} />
      ) : (
        <Button
          testID="enable-alerts"
          label="Turn on alerts"
          onPress={async () => {
            const s = await requestPushPermission();
            setStatus(s);
            if (s === 'granted') await registerPushToken().catch(() => {});
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: '#4a2e18',
    backgroundColor: '#1a1209',
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
});
