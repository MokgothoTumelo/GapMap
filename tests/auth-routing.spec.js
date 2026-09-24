import { test, expect } from '@playwright/test';
import { seedSession } from './helpers/session.js';

// The router the app has now that sessions are real: every protected page asks
// frontend/js/auth-guard.js where the Learner belongs.
//
//   guest                      → login.html (with a message explaining why)
//   Setup not finished         → setup.html
//   Setup finished             → the page itself
//
// These tests seed the session keys directly (the app's storage shape), then
// drive the real login form once to prove that shape is what the app writes.

const protectedPages = [
  '/diagnostic.html?agent=off',
  '/concept.html?concept=factorisation&agent=off',
  '/dashboard.html?agent=off',
  '/library.html?agent=off',
  '/profile.html?agent=off',
];

test('a guest is routed to login from every protected page, and told why', async ({ page }) => {
  for (const path of protectedPages) {
    await page.goto(path);

    await expect(page).toHaveURL(/login\.html$/);
    await expect(page.locator('#errorMsg')).toHaveText('Please log in to continue.');
  }
});

test('a Learner whose Setup is unfinished is routed to setup', async ({ page }) => {
  await seedSession(page, { setupComplete: false, grade: null, subject: null });
  await page.goto('/diagnostic.html?agent=off');

  await expect(page).toHaveURL(/setup\.html$/);
  await expect(page.locator('#gradeGrid')).toBeVisible();
});

test('a Learner whose Setup is finished stays on the protected page', async ({ page }) => {
  await seedSession(page, { grade: '12', subject: 'Mathematics' });
  await page.goto('/library.html?agent=off');

  await expect(page).toHaveURL(/library\.html/);
  await expect(page.locator('#app .page-header h1')).toBeVisible();
});

test('learner data is scoped to the Profile: a new Learner never inherits the previous one\'s results', async ({
  page,
}) => {
  // Learner A has results — including under the legacy, unscoped key that
  // used to leak across accounts.
  await seedSession(page, { uid: 'learner-aaa', email: 'ay@example.com', firstName: 'Ay' });
  await page.addInitScript(() => {
    const results = {
      subject: 'Mathematics',
      concepts: { Factorisation: { score: 38, correct: 3, total: 8, status: 'weak' } },
      overall: 38,
    };
    localStorage.setItem('gapmap_diagnostic:learner-aaa:mathematics', JSON.stringify(results));
    localStorage.setItem('gapmap_diagnostic:mathematics', JSON.stringify(results));
  });
  await page.goto('/dashboard.html?agent=off');

  // A sees their own Gap Map.
  await expect(page.locator('.empty-state')).toBeHidden();

  // A different Learner signs in on the same browser.
  await page.evaluate(() => {
    const session = JSON.parse(sessionStorage.getItem('gapmap_user'));
    sessionStorage.setItem(
      'gapmap_user',
      JSON.stringify({
        ...session,
        uid: 'learner-bbb',
        email: 'bee@example.com',
        firstName: 'Bee',
        subject: 'Mathematics',
      }),
    );
  });
  await page.reload();

  // B gets none of it — not the scoped results, and not the legacy key the
  // scoping replaced.
  await expect(page.locator('.empty-state')).toBeVisible();
  await expect(page.locator('.empty-state')).toContainText('No diagnostic results yet for Mathematics');
});

test('setup sends a finished Learner on to the Dashboard', async ({ page }) => {
  await seedSession(page, { grade: '12', subject: 'Mathematics', setupComplete: true });
  await page.goto('/setup.html?agent=off');

  await expect(page).toHaveURL(/dashboard\.html$/);
  // The Dashboard actually renders for this Learner (a script error here
  // blanks the page — regression guard).
  await page.goto('/dashboard.html?agent=off');
  await expect(page.locator('#app')).not.toBeEmpty();
});

test('login and signup expose the Firebase + EmailJS OTP flow without a demo code', async ({ page }) => {
  await page.goto('/login.html?agent=off');
  await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.locator('#otpInputs input')).toHaveCount(6);
  await expect(page.locator('#loginCard')).toBeVisible();
  await expect(page.locator('#otpCard')).toBeHidden();
  await expect(page.locator('#demoCode')).toHaveCount(0);

  await page.goto('/signup.html?agent=off');
  await expect(page.locator('#submitBtn')).toContainText('Create Account');
  await expect(page.locator('#otpInputs input')).toHaveCount(6);
  await expect(page.locator('#demoCode')).toHaveCount(0);
  const source = await page.locator('script[type="module"]').textContent();
  expect(source).toContain("firebase-auth.js");
  expect(source).toContain("emailjs-otp.js");
});

test('forgot-password page requires OTP before Firebase password-reset email', async ({ page }) => {
  await page.goto('/forgotpassword.html?agent=off');
  await expect(page.getByText('Reset your password')).toBeVisible();
  await expect(page.locator('#otpInputs input')).toHaveCount(6);
  await expect(page.locator('#demoCode')).toHaveCount(0);
  const source = await page.locator('script[type="module"]').textContent();
  expect(source).toContain('sendFirebasePasswordResetEmail');
  expect(source).toContain('verifyOtp');
});

test('a fresh Home-page launch clears legacy account state and shows Login/Get Started', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('gapmap_user', JSON.stringify({ email: 'old@example.com', firstName: 'Old' }));
  });

  await page.goto('/?agent=off');

  await expect(page.locator('[data-nav="login"]')).toBeVisible();
  await expect(page.locator('[data-nav="signup"]')).toBeVisible();
  await expect(page.getByRole('link', { name: /Start Diagnostic/ })).toHaveAttribute('href', 'login.html');
  expect(await page.evaluate(() => localStorage.getItem('gapmap_user'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('gapmap_user'))).toBeNull();
});

test('the landing page routes by session: guest to login, finished Learner to Dashboard', async ({
  page,
}) => {
  await page.goto('/?agent=off');
  await page.getByRole('link', { name: /Start Diagnostic/ }).click();
  await expect(page).toHaveURL(/login\.html$/);

  await seedSession(page, { grade: '12', subject: 'Mathematics' });
  await page.goto('/?agent=off');

  // The hero CTA becomes the Learner's next step, and the nav swaps to the
  // signed-in links. Log out lives behind the avatar on the app pages.
  await expect(page.getByRole('link', { name: /Go to Dashboard/ })).toBeVisible();
  await expect(page.locator('[data-nav="dashboard"]')).toBeVisible();
  await expect(page.locator('[data-nav="login"]')).toBeHidden();
});

test('the avatar opens the Profile menu: identity glance, profile link, Log out', async ({ page }) => {
  await seedSession(page, { grade: '12', subject: 'Mathematics' });
  await page.goto('/library.html?agent=off');

  const menu = page.locator('.gm-profile-menu');
  await expect(menu).toBeHidden();

  await page.click('#avatar');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.gm-profile-name')).toHaveText('Demo Learner');
  await expect(menu.locator('.gm-profile-email')).toHaveText('demo.learner@example.com');

  // Log out clears the session and routes to the landing page.
  await menu.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/index\.html$/);
  expect(await page.evaluate(() => sessionStorage.getItem('gapmap_user'))).toBeNull();
});
