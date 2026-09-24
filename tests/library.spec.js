import { test, expect } from '@playwright/test';
import { seedSession } from './helpers/session.js';

// The Library is the Learner's study material for their grade + active Subject,
// and it is the one place the app talks to a server route: paper downloads go
// through `GET /api/download?id=<id>`, whose URL whitelist lives in serve.mjs.
// The route is tested for its contract (id-only, unknown ids rejected). Its
// happy path fetches an official paper from the internet, which the suite must
// not depend on, so that stays a manual/smoke check.

test('the Library renders the Learner\'s grade and their Subject\'s material', async ({ page }) => {
  await seedSession(page, { grade: '12', subject: 'Mathematics' });
  await page.goto('/library.html?agent=off');

  await expect(page.locator('#app .page-header h1')).toHaveText('Your Grade 12 Library');
  await expect(page.locator('.resource-card').first()).toBeVisible();

  // Papers link to the whitelist route by id — the browser never supplies a URL.
  await expect(page.locator('a[href^="/api/download?id="]').first()).toBeVisible();

  // Filtering: videos are their own type and open on YouTube.
  await page.getByRole('button', { name: 'Videos' }).click();
  await expect(
    page.locator('.resource-card a[href^="https://www.youtube.com/watch"]').first(),
  ).toBeVisible();

  // Narrowing to another Subject re-renders the grid in place.
  await page.getByRole('button', { name: 'Physical Sciences' }).click();
  await expect(page.getByRole('button', { name: 'Physical Sciences' })).toHaveClass(/active/);
  await expect(page.locator('.resource-card').first()).toBeVisible();
});

test('the download route rejects anything that is not a whitelisted id', async ({ request }) => {
  for (const url of ['/api/download', '/api/download?id=', '/api/download?id=9999', '/api/download?id=../serve.mjs']) {
    const response = await request.get(url);

    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: 'unknown resource id' });
  }
});

test('the download route leaves static serving untouched', async ({ request }) => {
  expect((await request.get('/index.html')).status()).toBe(200);
  expect(
    (await request.get('/core/demo-data/assessments/practice-factorisation.yaml')).status(),
  ).toBe(200);
  expect((await request.get('/nope.html')).status()).toBe(404);
});
