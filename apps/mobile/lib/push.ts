import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

import { GO_ACTION } from './notificationRoutes';

export const RESTOCK_CATEGORY = 'restock';
export { GO_ACTION };

// Show alerts while the app is open, too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/** Notification categories (action buttons) and Android channels. Safe to call repeatedly. */
export async function configureNotificationChannels() {
  await Notifications.setNotificationCategoryAsync(RESTOCK_CATEGORY, [
    {
      identifier: GO_ACTION,
      buttonTitle: 'Go to Checkout',
      options: { opensAppToForeground: true },
    },
  ]);
  if (Platform.OS === 'android') {
    const channels: [string, string, Notifications.AndroidImportance][] = [
      ['restock', 'Restock alerts', Notifications.AndroidImportance.MAX],
      ['bot_status', 'Bot status', Notifications.AndroidImportance.HIGH],
      ['drop_updates', 'Drop updates', Notifications.AndroidImportance.DEFAULT],
      ['reminders', 'Reminders', Notifications.AndroidImportance.HIGH],
      ['community', 'Community', Notifications.AndroidImportance.LOW],
    ];
    for (const [id, name, importance] of channels) {
      await Notifications.setNotificationChannelAsync(id, {
        name,
        importance,
        lightColor: '#ffb547',
        vibrationPattern: [0, 250, 250, 250],
      });
    }
  }
}

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function getPushPermission(): Promise<PushPermission> {
  if (!Device.isDevice) return 'unsupported';
  const { status } = await Notifications.getPermissionsAsync();
  return status as PushPermission;
}

export async function requestPushPermission(): Promise<PushPermission> {
  if (!Device.isDevice) return 'unsupported';
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return status as PushPermission;
}

/** Register this device's Expo push token for the signed-in user. Returns the token or null. */
export async function registerPushToken(): Promise<string | null> {
  if ((await getPushPermission()) !== 'granted') return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return null;
  const { error } = await supabase.from('push_tokens').upsert(
    {
      user_id: user.user.id,
      expo_token: token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,expo_token' },
  );
  if (error) throw error;
  return token;
}

export { routeForNotification } from './notificationRoutes';
