// Push notifications (expo-notifications). Registers the device's native APNs/
// FCM token with the server so the backend can deliver pushes. Foreground
// notifications show a banner. Real delivery needs a dev build + the server's
// APNs/FCM credentials (see README) — registration + storage are complete here.

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

let registered = false;

/** Ask permission, get the native push token, register it with the server. */
export async function registerPushToken(): Promise<void> {
  if (registered || !Device.isDevice) return; // simulators can't receive remote push
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const token = (await Notifications.getDevicePushTokenAsync()).data;
    await api.post('/push/device', { token: String(token), platform: Platform.OS });
    registered = true;
  } catch {
    /* ignore — push is best-effort */
  }
}

/** Listen for taps on a notification → returns an unsubscribe fn. */
export function onNotificationTap(handler: (data: Record<string, unknown>) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((res) => {
    handler(res.notification.request.content.data ?? {});
  });
  return () => sub.remove();
}
