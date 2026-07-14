import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('fonts, icons and the PWA shell stay on the application origin', async ({ page }) => {
  await mockApi(page);
  const requestedOrigins = new Set<string>();
  page.on('request', (request) => requestedOrigins.add(new URL(request.url()).origin));

  await page.goto('/');
  const fontsReady = await page.evaluate(async () => {
    await document.fonts.load('400 16px "Geist Variable"');
    await document.fonts.load('400 24px "Material Symbols Outlined Variable"');
    return document.fonts.check('400 16px "Geist Variable"')
      && document.fonts.check('400 24px "Material Symbols Outlined Variable"');
  });
  expect(fontsReady).toBe(true);

  const preloads = await page.locator('link[rel="preload"][as="font"]').evaluateAll((links) =>
    links.map((link) => (link as HTMLLinkElement).href),
  );
  expect(preloads.length).toBeGreaterThanOrEqual(3);
  expect(preloads.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);

  await expect.poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()))).toBe(true);
  expect([...requestedOrigins]).not.toContain('https://fonts.googleapis.com');
  expect([...requestedOrigins]).not.toContain('https://fonts.gstatic.com');

  const fontResources = await page.evaluate(() => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => /\.(woff2?|ttf)(\?|$)/.test(name)));
  const applicationOrigin = new URL(page.url()).origin;
  expect(fontResources.length).toBeGreaterThan(0);
  expect(fontResources.every((url) => new URL(url).origin === applicationOrigin)).toBe(true);
});
