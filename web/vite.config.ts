import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  build: {
    target: 'es2022',
    // Do not publish source maps with the public production assets. Add a
    // private error-reporting upload step before re-enabling them.
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'https://burncpu.com',
      '/rss': 'https://burncpu.com',
    },
  },
});
