import { expect, test } from '@playwright/test';
import { mockApi, post } from './fixtures';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('profile deep link renders profile metadata and its timeline', async ({ page }) => {
  await page.goto(`/u/${post.author.username}`);

  await expect(page.getByRole('heading', { name: post.author.display_name })).toBeVisible();
  await expect(page.getByText(`@${post.author.username}`).first()).toBeVisible();
  await expect(page.getByText('E2E profil açıklaması')).toBeVisible();
  await expect(page.getByText('Deterministik E2E sinyali')).toBeVisible();
});

test('post deep link renders the conversation tree', async ({ page }) => {
  await page.goto(`/posts/${post.id}`);

  await expect(page.getByRole('heading', { name: /^(Konuşma|Conversation)$/ })).toBeVisible();
  await expect(page.getByText('Deterministik E2E sinyali')).toBeVisible();
  await expect(page.getByText('Deterministik yanıt')).toBeVisible();
  await expect(page.getByText(/1 (yanıt|repl)/i)).toBeVisible();
});

test('hashtag deep link renders tagged results', async ({ page }) => {
  await page.goto('/hashtag/rust');

  await expect(page.getByRole('heading', { name: '#rust' })).toBeVisible();
  await expect(page.getByText('#rust etiketiyle deterministik sonuç')).toBeVisible();
  await expect(page.getByText(/1 (sonuç|results?)/i)).toBeVisible();
});
