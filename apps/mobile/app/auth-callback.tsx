import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Button, Screen, T } from '@/components/ui';
import { completeSignInFromUrl } from '@/lib/auth';
import { colors, space } from '@/lib/theme';

/** Landing route for the magic link (brazier://auth-callback). */
export default function AuthCallback() {
  const url = Linking.useLinkingURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    completeSignInFromUrl(url)
      .then(() => router.replace('/'))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Sign-in failed.'));
  }, [url]);

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.lg }}>
        {error ? (
          <>
            <T variant="title">That link didn't work</T>
            <T variant="muted">{error}</T>
            <Button label="Back to sign in" onPress={() => router.replace('/sign-in')} />
          </>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )}
      </View>
    </Screen>
  );
}
