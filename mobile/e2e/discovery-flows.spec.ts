import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('search discovery shows trending tags and navigates to a hashtag', async ({ page }) => {
  await page.goto('/search');
  await expect(page.getByText('#rust')).toBeVisible();

  await page.getByText('#rust').click();
  await expect(page).toHaveURL(/\/tag\/rust$/);
  await expect(page.getByText('#rust mobil etiket sonucu')).toBeVisible();
});

test('videos tab exposes a deterministic empty state', async ({ page }) => {
  await page.goto('/');
  await page.getByText(/^(Video|Videos)$/).last().click();

  await expect(page.getByText(/^(Henüz video yok|No videos yet)$/)).toBeVisible();
});

test('API docs route renders the fetched OpenAPI groups', async ({ page }) => {
  await page.goto('/docs');

  await expect(page.getByText(/^(API Dokümanı|API Docs)$/)).toBeVisible();
  await expect(page.getByText('/posts').first()).toBeVisible();
  await expect(page.getByText(/Create post|Gönderi/)).toBeVisible();
});
