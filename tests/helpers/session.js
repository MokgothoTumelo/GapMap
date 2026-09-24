import { expect } from '@playwright/test';

// Firebase Authentication is the account source of truth. Protected pages read
// `gapmap_user` as the lightweight sessionStorage snapshot written after
// OTP verification. Browser tests seed that snapshot directly so routing can
// be exercised without creating real Firebase accounts.
export function sessionUser(overrides = {}) {
  return {
    uid: 'learner-001',
    email: 'demo.learner@example.com',
    firstName: 'Demo',
    lastName: 'Learner',
    role: 'learner',
    language: 'English',
    explanationLevel: 'Standard',
    grade: '12',
    subject: 'Mathematics',
    setupComplete: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    loggedInAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function seedScript({ withSession, user }) {
  // Seed exactly once per document/session: addInitScript runs on every
  // navigation, so without this guard it would resurrect the session a Log
  // out just removed, and clobber what the app (or a switcher) wrote.
  if (sessionStorage.getItem('gapmap_test_seeded')) return;
  sessionStorage.setItem('gapmap_test_seeded', '1');

  if (withSession) {
    sessionStorage.setItem('gapmap_user', JSON.stringify(user));
    sessionStorage.setItem('gapmap_app_launch_initialized_v2', '1');
  }
}

/** Signs a Learner in: session + the account the login page would find. */
export async function seedSession(page, overrides = {}) {
  const user = sessionUser(overrides);
  await page.addInitScript(seedScript, {
    withSession: true,
    user,
  });
  return user;
}

/**
 * Answers the Item on screen: a value for written Items (numeric / short
 * answer), otherwise the first option. The Diagnostic and concept.html render
 * the same element ids, so both flows share this.
 */
export async function answerItem(page, { value = '1' } = {}) {
  if (await page.locator('#writtenContainer').isVisible()) {
    await page.locator('#writtenInput').fill(value);
    return 'written';
  }
  await page.locator('#optionsContainer .option').first().click();
  return 'option';
}

/** Walks a whole Assessment: answer, advance, and check the counter moved. */
export async function answerAllItems(page, count) {
  for (let index = 0; index < count; index += 1) {
    await answerItem(page);
    await page.locator('#nextBtn').click();
    if (index < count - 1) {
      await expect(page.locator('#currentNum')).toHaveText(String(index + 2));
    }
  }
}
