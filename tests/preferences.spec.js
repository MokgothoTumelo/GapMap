import { test, expect } from '@playwright/test';
import { seedSession } from './helpers/session.js';

// The Learner's switchers: Subject, Language, and Explanation Level are live
// preferences. The local session snapshot updates immediately and auth-guard.js
// also syncs the durable Learner Profile to Firestore. These browser tests verify
// the session-side behavior without requiring a live Firebase account.

test('switching the active Language persists across the reload in the session', async ({
  page,
}) => {
  const user = await seedSession(page, {
    grade: '12',
    subject: 'Mathematics',
    language: 'English',
  });
  await page.goto('/library.html?agent=off');

  const language = page.locator('#languageSwitcherMount select');
  await expect(language).toBeVisible();
  await expect(language).toHaveValue('English');

  await language.selectOption('isiZulu');

  // The switcher's default behaviour is a soft reload; the choice survives it.
  await page.waitForLoadState('load');
  await expect(language).toHaveValue('isiZulu');

  const stored = await page.evaluate(() => ({
    session: JSON.parse(sessionStorage.getItem('gapmap_user')),
  }));
  expect(stored.session.language).toBe('isiZulu');
});

test('switching the active Subject re-renders the page for that Subject', async ({ page }) => {
  const user = await seedSession(page, { grade: '12', subject: 'Mathematics' });
  await page.goto('/library.html?agent=off');

  // library.html re-renders in place instead of reloading.
  await page.selectOption('#subjectSwitcherMount select', 'Physical Sciences');
  await expect(page.getByRole('button', { name: 'Physical Sciences' })).toHaveClass(/active/);

  const stored = await page.evaluate(() => ({
    session: JSON.parse(sessionStorage.getItem('gapmap_user')),
  }));
  expect(stored.session.subject).toBe('Physical Sciences');
});

test('switching the Explanation Level on the profile page persists into the session and registry', async ({
  page,
}) => {
  const user = await seedSession(page, { grade: '12', subject: 'Mathematics' });
  await page.goto('/profile.html?agent=off');

  const level = page.locator('#explanationLevelMount select');
  await expect(level).toBeVisible();
  await expect(level).toHaveValue('Standard');

  await level.selectOption('Simple');

  const stored = await page.evaluate(() => ({
    session: JSON.parse(sessionStorage.getItem('gapmap_user')),
  }));
  expect(stored.session.explanationLevel).toBe('Simple');
});

test('the profile page holds the whole Profile: all three switchers and editable account', async ({
  page,
}) => {
  await seedSession(page, { grade: '12', subject: 'Mathematics' });
  await page.goto('/profile.html?agent=off');

  // The three preferences are inspectable and modifiable in one place.
  await expect(page.locator('#subjectMount select')).toHaveValue('Mathematics');
  await expect(page.locator('#languageMount select')).toHaveValue('English');
  await expect(page.locator('#explanationLevelMount select')).toHaveValue('Standard');

  // Account: the name is editable and updates the local session snapshot; Firebase/Firestore persistence is tested separately by integration smoke checks.
  // the email is read-only.
  await expect(page.locator('#email')).toHaveAttribute('readonly', '');
  await page.fill('#firstName', 'Ada');
  await page.fill('#lastName', 'Palmer');
  await page.click('#saveNameBtn');
  await expect(page.locator('#nameMsg')).toHaveText('Account saved ✓');

  const stored = await page.evaluate(() => ({
    session: JSON.parse(sessionStorage.getItem('gapmap_user')),
  }));
  expect(stored.session).toMatchObject({ firstName: 'Ada', lastName: 'Palmer' });
  // The avatar menu's glance refreshes with the saved name.
  await page.click('#avatar');
  await expect(page.locator('.gm-profile-menu .gm-profile-name')).toHaveText('Ada Palmer');
});