import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { configureNotificationChannels, registerPushToken, routeForNotification } from '@/lib/push';
import { supabase } from '@/lib/supabase';

/** Register the device, set up categories, and route notification taps (cold start included). */
export function usePushSetup(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return;
    configureNotificationChannels().catch(() => {});
    registerPushToken().catch(() => {});

    const handle = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, unknown>;
      if (typeof data?.notificationId === 'string') {
        void supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', data.notificationId);
      }
      const route = routeForNotification(data, response.actionIdentifier);
      if (route) router.push(route as never);
      void Notifications.clearLastNotificationResponseAsync();
    };

    Notifications.getLastNotificationResponseAsync()
      .then(handle)
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, [signedIn]);
}
