// Push notifications (expo-notifications). Registers the device's Expo push
// token (ExponentPushToken[...]) with the server so the backend can fan pushes
// out via Expo's service (exp.host → APNs/FCM). Foreground notifications show a
// banner. Needs the EAS projectId (`eas init`) + a dev/standalone build with
// FCM/APNs creds — no-op until then. Registration + storage are complete here.

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';
import { activeDmThreadName } from './sound';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as { url?: string; kind?: string } | undefined;
    // Stay silent for the DM thread the user is actively reading — the in-app
    // chime already sounded, and a heads-up banner over the open conversation
    // is just noise. Every other notification sounds + shows normally.
    const active = activeDmThreadName();
    const suppress = data?.kind === 'dm' && !!active && data.url === `/dm/${active}`;
    return {
      shouldShowBanner: !suppress,
      shouldShowList: true,
      shouldPlaySound: !suppress,
      shouldSetBadge: true,
    };
  },
});

// Android needs a channel (importance + sound) for notifications to make noise,
// foreground included. Fire-and-forget at startup; no-op off Android.
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'Bildirimler',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 120, 60, 120],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  }).catch(() => {
    /* best-effort */
  });
}

let registered = false;

/** Ask permission, get the Expo push token, register it with the server. */
export async function registerPushToken(): Promise<void> {
  if (registered || !Device.isDevice) return; // simulators can't receive remote push
  // The backend delivers only to Expo tokens (ExponentPushToken[...]) via exp.host,
  // and getExpoPushTokenAsync needs the EAS projectId that `eas init` writes to
  // app.json (extra.eas.projectId). Until that exists we stay a no-op rather than
  // registering a raw device token the backend would drop.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
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
