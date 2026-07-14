import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('public timeline and tab shell render from the mobile codebase', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Mobil E2E sinyali')).toBeVisible();
  await expect(page.getByText('Global')).toBeVisible();
  await expect(page.getByText('Ara').last()).toBeVisible();
  await expect(page.getByText('Bildirimler').last()).toBeVisible();
});

test('mobile search debounces input and renders the matching result', async ({ page }) => {
  await page.goto('/search');
  const input = page.getByPlaceholder('Sinyal ara…');
  await input.fill('cloudflare');

  await expect(page.getByText('cloudflare mobil sonucu')).toBeVisible();
  await expect(page.getByText('@mobilee2e', { exact: false })).toBeVisible();
});

test('anonymous notifications route is guarded and opens login', async ({ page }) => {
  await page.goto('/notifications');
  await expect(page.getByText('Bu bölüm için giriş gerekli')).toBeVisible();

  await page.getByRole('button', { name: 'Giriş' }).click();
  await expect(page.getByText('E-posta', { exact: true })).toBeVisible();
});

test('magic-link request reaches the success state without a page reload', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('sen@ornek.com').fill('e2e@example.com');
  await page.getByRole('button', { name: 'Magic-link gönder' }).click();

  await expect(page.getByText('Bağlantı yolda')).toBeVisible();
});

test('theme toggle is accessible and persists through app reload', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Tema: Açık' });
  await toggle.click();

  await expect(page.getByRole('button', { name: 'Tema: Koyu' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Tema: Koyu' })).toBeVisible();
});
