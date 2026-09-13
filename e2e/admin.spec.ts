import { expect, test } from '@playwright/test';

test('admin command center remains usable on desktop and mobile', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'AI investigation control panel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Deep Investigation' })).toBeVisible();

  const fitsViewport = await page.locator('.shell').evaluate(
    (element) => element.scrollWidth <= window.innerWidth,
  );
  expect(fitsViewport).toBe(true);
});

test('public Integritas website remains independently available', async ({ page }) => {
  await page.goto('https://integritass.com', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/Integritas/i);
  await expect(
    page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Contact' }),
  ).toBeVisible();
});
