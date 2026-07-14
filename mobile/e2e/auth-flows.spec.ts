import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('mobile magic-link errors remain visible and recoverable', async ({ page }) => {
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

  await page.goto('/login');
  const email = page.getByPlaceholder(/^(sen@ornek.com|you@example.com)$/);
  await email.fill('e2e@example.com');
  await page.getByRole('button', { name: /^(Magic-link gönder|Send magic link)$/ }).click();

  await expect(page.getByText(/^(Gönderim hatası|Send failed)$/)).toBeVisible();
  await expect(email).toBeEnabled();
});
