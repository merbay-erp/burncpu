// burncpu mobile — the Ember design system, ported 1:1 from the web's
// styles.css CSS variables. Dark "turtle-moss" (default) + a soft sage light.
// Keeping the exact RGB values guarantees the app is colour-identical to web.

import { createContext, useContext } from 'react';

export type Scheme = 'dark' | 'light';

export interface Palette {
  background: string;
  surfaceLowest: string;
  surfaceLow: string;
  surface: string;
  surfaceHigh: string;
  surfaceHighest: string;
  onBackground: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  primary: string;
  onPrimary: string;
  error: string;
  codeBg: string;
  codeFg: string;
  // convenience aliases mirroring the web's legacy --fg/--bg vars
  fg3: string;
}

export const palettes: Record<Scheme, Palette> = {
  // :root  (23 19 17 … etc.)
  dark: {
    background: '#171311',
    surfaceLowest: '#120f0d',
    surfaceLow: '#1f1a17',
    surface: '#261f1c',
    surfaceHigh: '#302823',
    surfaceHighest: '#3c322c',
    onBackground: '#f0e8e2',
    onSurface: '#f0e8e2',
    onSurfaceVariant: '#d1bcae',
    outline: '#8a7466',
    outlineVariant: '#4a382e',
    primary: '#ff8a3c',
    onPrimary: '#261004',
    error: '#ffb4ab',
    codeBg: '#120f0d',
    codeFg: '#e8ddd4',
    fg3: '#9a8a7e',
  },
  // html.light
  light: {
    background: '#f4ece4',
    surfaceLowest: '#fbf6f0',
    surfaceLow: '#efe6dc',
    surface: '#eae0d5',
    surfaceHigh: '#e2d7ca',
    surfaceHighest: '#d6c9ba',
    onBackground: '#2a1e16',
    onSurface: '#2a1e16',
    onSurfaceVariant: '#6b5446',
    outline: '#a08b7c',
    outlineVariant: '#dccfc0',
    primary: '#c44d12',
    onPrimary: '#fff5ec',
    error: '#ba1a1a',
    codeBg: '#ece1d4',
    codeFg: '#3a2a1e',
    fg3: '#93826f',
  },
};

// Loaded by @expo-google-fonts/geist + geist-mono. The strings are the family
// names those packages register; see _layout.tsx useFonts().
export const fonts = {
  sans: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
} as const;

export const radius = 8; // --radius: 8px

// Brand status-bar / splash colours (theme.ts apply() on web).
export const brand = {
  darkBg: '#171311',
  lightBg: '#f4ece4',
  flame: '#ff8a3c',
};

export interface ThemeValue {
  scheme: Scheme;
  colors: Palette;
  setScheme: (s: Scheme) => void;
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeValue>({
  scheme: 'dark',
  colors: palettes.dark,
  setScheme: () => {},
  toggle: () => {},
});

export const useTheme = () => useContext(ThemeContext);
