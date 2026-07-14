import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('magic-link login reaches the confirmation state', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.getByRole('link', { name: /giriş|sign in/i }).last().click();

  await page.getByLabel('Email').fill('e2e@example.com');
  await page.getByRole('button', { name: /^(Magic-link gönder|Send magic link)$/ }).click();
  await expect(page.getByText(/^Mail (yolda\.|on the way\.)$/)).toBeVisible();
});

test('login surfaces an API error and keeps the form usable', async ({ page }) => {
  await mockApi(page, async (route, url) => {
    if (url.pathname.endsWith('/auth/request')) {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'rate_limited', message: 'Çok fazla deneme' }),
      });
      return true;
    }
    return false;
  });
  await page.goto('/');
  await page.getByRole('link', { name: /giriş|sign in/i }).last().click();

  const email = page.getByLabel('Email');
  await email.fill('e2e@example.com');
  await page.getByRole('button', { name: /^(Magic-link gönder|Send magic link)$/ }).click();
  await expect(page.getByText('Çok fazla deneme')).toBeVisible();
  await expect(email).toBeEnabled();
});
