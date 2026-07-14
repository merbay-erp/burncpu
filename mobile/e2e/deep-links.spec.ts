import { expect, test } from '@playwright/test';
import { mockApi, post } from './fixtures';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('search result deep link opens the post and its reply', async ({ page }) => {
  await page.goto('/search');
  const input = page.getByPlaceholder(/Sinyal ara|Search signals/);
  await input.fill('cloudflare');
  await expect(page.getByText('cloudflare mobil sonucu')).toBeVisible();

  await page.getByText('cloudflare mobil sonucu').click();
  await expect(page).toHaveURL(new RegExp(`/post/${post.id}$`));
  await expect(page.getByText('Mobil E2E sinyali')).toBeVisible();
  await expect(page.getByText('Mobil deterministik yanıt')).toBeVisible();
});

test('profile deep link renders the mobile profile header and post', async ({ page }) => {
  await page.goto(`/u/${post.author.username}`);

  await expect(page.getByText(post.author.display_name).first()).toBeVisible();
  await expect(page.getByText(`@${post.author.username}`).first()).toBeVisible();
  await expect(page.getByText('Mobil E2E profil açıklaması')).toBeVisible();
  await expect(page.getByText('Mobil E2E sinyali')).toBeVisible();
});

test('hashtag deep link renders normalized search hits', async ({ page }) => {
  await page.goto('/tag/rust');

  await expect(page.getByText('#rust', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('#rust mobil etiket sonucu')).toBeVisible();
});
