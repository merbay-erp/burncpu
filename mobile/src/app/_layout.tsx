import { useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import {
  useFonts,
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from '@expo-google-fonts/geist';
import { GeistMono_400Regular, GeistMono_500Medium } from '@expo-google-fonts/geist-mono';

import { palettes, ThemeContext, type Scheme } from '@/theme';
import { hydrate as hydrateAuth } from '@/auth';
import { hydrateLocale } from '@/i18n';

SplashScreen.preventAutoHideAsync().catch(() => {});

const SCHEME_KEY = 'burncpu.theme';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_400Regular,
    GeistMono_500Medium,
  });
  const [scheme, setSchemeState] = useState<Scheme>('dark');
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [s] = await Promise.all([
          AsyncStorage.getItem(SCHEME_KEY),
          hydrateLocale(),
          hydrateAuth(),
        ]);
        if (s === 'light' || s === 'dark') setSchemeState(s);
      } catch {
        /* ignore */
      }
      setBooted(true);
    })();
  }, []);

  const colors = palettes[scheme];

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);

  const theme = useMemo(
    () => ({
      scheme,
      colors,
      setScheme: (s: Scheme) => {
        setSchemeState(s);
        AsyncStorage.setItem(SCHEME_KEY, s).catch(() => {});
      },
      toggle: () => {
        const next: Scheme = scheme === 'dark' ? 'light' : 'dark';
        setSchemeState(next);
        AsyncStorage.setItem(SCHEME_KEY, next).catch(() => {});
      },
    }),
    [scheme, colors],
  );

  const ready = fontsLoaded && booted;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <ThemeContext.Provider value={theme}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" options={{ presentation: 'modal' }} />
          <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
        </Stack>
      </ThemeContext.Provider>
    </GestureHandlerRootView>
  );
}
