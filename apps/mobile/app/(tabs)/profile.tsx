import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { AlertPermissionGate } from '@/components/AlertPermissionGate';
import { Button, Panel, Screen, T } from '@/components/ui';
import { signOut, useAuth } from '@/lib/auth';
import { colors, space } from '@/lib/theme';

export default function Profile() {
  const { session } = useAuth();
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
        <AlertPermissionGate />
        <Button
          testID="open-notification-settings"
          label="Notification settings"
          variant="ghost"
          onPress={() => router.push('/settings/notifications')}
        />
        <Panel title="Plan">
          <T variant="muted">Free · 3 watches</T>
        </Panel>
        <Button testID="sign-out" label="Sign out" variant="ghost" onPress={() => signOut()} />
        <T variant="mono" style={{ color: colors.muted, textAlign: 'center' }}>
          DropHawk v0.1
        </T>
      </ScrollView>
    </Screen>
  );
}
