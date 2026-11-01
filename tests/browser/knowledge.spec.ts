import { test, expect } from '@playwright/test';

// Override only for this read-only library suite when testing an isolated server.
test.use({ baseURL: process.env.KNOWLEDGE_TEST_URL || 'http://127.0.0.1:8000' });

test('expanded physics library exposes regimes and reference-only boundaries', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/physics');
  const topics = await (await page.request.get('/api/knowledge')).json();
  expect(topics.length).toBeGreaterThanOrEqual(120);
  await expect(page.locator('.physics-topic-count')).toHaveText(`${topics.length} topics`);
  await page.getByLabel('Search physics library').fill('frame-dragging');
  await page.locator('.topic-list').getByRole('button', { name: /Frame dragging and Lense-Thirring/ }).click();
  await expect(page.locator('.topic-content h2')).toHaveText('Frame dragging and Lense-Thirring precession');
  await expect(page.locator('.physics-status')).toHaveText('Reference only');
  await expect(page.locator('.physics-regime')).toContainText('weak-field');
  await expect(page.locator('.physics-implementation')).toContainText('does not enable');
  await page.locator('.graph-children').getByRole('button', { name: /Kerr rotation/ }).click();
  await expect(page.locator('.topic-content h2')).toHaveText('Kerr rotation, spin and horizon radius');
  for (const link of await page.locator('.source-list a').all()) {
    expect(await link.getAttribute('href')).toMatch(/^https:\/\//);
    expect(await link.getAttribute('rel')).toContain('noreferrer');
  }
  expect(errors).toEqual([]);
});

test('blackhole and separation search reach their scenario concepts', async ({ page }) => {
  await page.goto('/physics');
  await page.getByLabel('Search physics library').fill('blackhole swingby');
  await page.locator('.topic-list').getByRole('button', { name: /Relativistic black-hole flyby planning/ }).click();
  await expect(page.locator('.physics-implementation')).toContainText('Knowledge reference only');
  await expect(page.locator('.topic-content')).toContainText('80 r_s Newtonian flyby');
  await page.getByLabel('Search physics library').fill('stage separation');
  await page.locator('.topic-list').getByRole('button', { name: /Stage separation, recoil and tip-off/ }).click();
  await expect(page.locator('.equation')).toContainText('J/m1');
  await expect(page.locator('.topic-content')).toContainText('total momentum');
});

test('mobile library remains scrollable and equations stay inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/physics');
  await page.getByLabel('Search physics library').fill('Maxwell');
  await page.locator('.topic-list').getByRole('button', { name: /Maxwell equations/ }).click();
  await expect(page.locator('.topic-content h2')).toHaveText('Maxwell equations and electromagnetic waves');
  const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
});
