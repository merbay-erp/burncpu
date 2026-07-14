import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('public timeline renders API data and primary navigation works', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Deterministik E2E sinyali')).toBeVisible();
  await expect(page.getByText('@e2euser').first()).toBeVisible();

  await page.goto('/docs');
  await expect(page.getByRole('heading', { name: /API|Dokümantasyon|Documentation/i }).first()).toBeVisible();
});

test('anonymous protected routes fail closed behind the login gate', async ({ page }) => {
  await page.goto('/notifications');

  await expect(page.getByRole('heading', { name: /Bildirimlerini görmek için giriş yap|Sign in to see your notifications/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /giriş yap|sign in/i }).last()).toHaveAttribute('href', '/login');
});

test('theme choice survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Açık|Light/ }).click();

  await expect(page.locator('html')).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/light/);
  await expect(page.getByRole('button', { name: /Koyu|Dark/ })).toBeVisible();
});

test('unknown routes render the application 404 boundary', async ({ page }) => {
  await page.goto('/e2e-olmayan-rota');
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
});
