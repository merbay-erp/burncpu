import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('trending filters keep the selected time window', async ({ page }) => {
  await page.goto('/trending');

  await expect(page.getByRole('heading', { name: /^(Trend|Trending)$/ })).toBeVisible();
  const sevenDays = page.getByRole('button', { name: /^(7 gün|7d)$/ });
  await sevenDays.click();
  await expect(sevenDays).toHaveClass(/bg-primary/);
  await expect(page.getByRole('link', { name: /#rust/ }).first()).toBeVisible();
});

test('federated discovery has an explicit empty state', async ({ page }) => {
  await page.goto('/federated');

  await expect(page.getByRole('heading', { name: /^(Federe Akış|Federated)$/ })).toBeVisible();
  await expect(page.getByText(/^(Henüz federe içerik yok|Nothing federated yet)$/)).toBeVisible();
});

test('videos discovery has an explicit empty state', async ({ page }) => {
  await page.goto('/videos');

  await expect(page.getByRole('heading', { name: /^(Videolar|Videos)$/ })).toBeVisible();
  await expect(page.getByText(/^(Henüz video yok|No videos yet)$/)).toBeVisible();
});
