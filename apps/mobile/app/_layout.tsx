import { ChakraPetch_600SemiBold, ChakraPetch_700Bold } from '@expo-google-fonts/chakra-petch';
import { IBMPlexMono_400Regular, IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
} from '@expo-google-fonts/ibm-plex-sans';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { AuthProvider, useAuth } from '@/lib/auth';
import { QueryProvider, queryClient } from '@/lib/queryClient';
import { startTestModeController } from '@/lib/testMode/simulation';
import { usePushSetup } from '@/hooks/usePushSetup';
import { identify, initMonitoring, wrapRoot } from '@/lib/monitoring';
import { configurePurchases, resetPurchases } from '@/lib/purchases';
import { colors } from '@/lib/theme';

export { ErrorBoundary } from 'expo-router';

/**
 * Temporarily off: the app opens straight to the tabs without signing in.
 * Anything that saves per-user data (watches, reminders, push, purchases)
 * still needs a session. Set back to true to require sign-in again.
 */
const REQUIRE_SIGN_IN = false;

initMonitoring();
SplashScreen.preventAutoHideAsync();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.field,
    card: colors.panel,
    border: colors.line,
    primary: colors.accent,
    text: colors.ink,
  },
};

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    ChakraPetch_600SemiBold,
    ChakraPetch_700Bold,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_600SemiBold,
  });

  useEffect(() => {
    if (fontError) throw fontError;
  }, [fontError]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <QueryProvider>
          <ThemeProvider value={navTheme}>
            <StatusBar style="light" />
            <RootNavigator />
          </ThemeProvider>
        </QueryProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

export default wrapRoot(RootLayout);

/** Queries that read the test dataset, refreshed when test mode changes it. */
const TEST_DATA_QUERIES = new Set(['search', 'product', 'stock-events', 'calendar', 'adapter-health']);

function RootNavigator() {
  const { session, loading } = useAuth();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (loading) return;
    identify(userId);
    if (userId) void configurePurchases(userId).catch(() => {});
    else void resetPurchases();
  }, [loading, userId]);

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  // Test mode's simulated drop runs from anywhere in the app, so start it at the root.
  useEffect(
    () =>
      startTestModeController({
        onDataChanged: () =>
          void queryClient.invalidateQueries({
            predicate: (q) => TEST_DATA_QUERIES.has(String(q.queryKey[0])),
          }),
      }),
    [],
  );

  if (loading) return null;

  const signedIn = session != null;
  return <Navigator signedIn={signedIn} />;
}

function Navigator({ signedIn }: { signedIn: boolean }) {
  usePushSetup(signedIn);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.field } }}>
      <Stack.Protected guard={signedIn || !REQUIRE_SIGN_IN}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="add-watch" options={{ presentation: 'modal' }} />
        <Stack.Screen name="watch/[id]" />
        <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="calendar-submit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="settings/notifications" />
        <Stack.Screen name="settings/checkout-profiles" />
        <Stack.Screen name="checkout/[id]" options={{ presentation: 'formSheet' }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Screen name="auth-callback" />
    </Stack>
  );
}
