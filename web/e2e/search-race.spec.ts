import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

test('URL state wins over a slower stale search response', async ({ page }) => {
  await mockApi(page, async (route, url) => {
    if (!url.pathname.endsWith('/search')) return false;
    const query = url.searchParams.get('q') ?? '';
    await new Promise((resolve) => setTimeout(resolve, query === 'rust' ? 500 : 20));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        hits: [{
          id: query,
          author_username: 'e2euser',
          body: query === 'rust' ? 'ESKİ RUST SONUCU' : 'GÜNCEL CLOUDFLARE SONUCU',
          created_at: 1_752_490_800,
        }],
        estimatedTotalHits: 1,
        processingTimeMs: 1,
      }),
    });
    return true;
  });

  await page.goto('/search?q=rust');
  const input = page.getByRole('searchbox');
  await input.fill('cloudflare');
  await expect(page).toHaveURL(/q=cloudflare/);
  await expect(page.getByText('GÜNCEL CLOUDFLARE SONUCU')).toBeVisible();
  await expect(page.getByText('ESKİ RUST SONUCU')).toHaveCount(0);

  await page.reload();
  await expect(input).toHaveValue('cloudflare');
  await expect(page.getByText('GÜNCEL CLOUDFLARE SONUCU')).toBeVisible();
});
