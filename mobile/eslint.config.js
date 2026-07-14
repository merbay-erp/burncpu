const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  globalIgnores(['.expo/**', 'dist/**']),
  expoConfig,
  {
    // These screens intentionally kick off async loaders from effects. The
    // loading-state transition is part of that external synchronization.
    files: [
      'src/app/**/*.tsx',
      'src/components/FederatedFeed.tsx',
      'src/components/ProfileView.tsx',
    ],
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
  {
    // expo-video exposes an imperative player object by design.
    files: ['src/app/(tabs)/videos.tsx', 'src/components/VideoPlayer.tsx'],
    rules: { 'react-hooks/immutability': 'off' },
  },
]);
