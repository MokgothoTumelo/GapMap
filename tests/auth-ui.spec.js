import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const placeholderChecks = {
  '/login.html?agent=off': {
    '#email': 'Enter your email address',
    '#password': 'Enter your password',
  },
  '/signup.html?agent=off': {
    '#firstname': 'Enter your first name',
    '#lastname': 'Enter your last name',
    '#email': 'Enter your email address',
    '#password': 'Create a password (6+ characters)',
  },
  '/forgotpassword.html?agent=off': {
    '#email': 'Enter your account email',
  },
};

test('public account edit fields expose useful placeholders', async ({ page }) => {
  for (const [path, selectors] of Object.entries(placeholderChecks)) {
    await page.goto(path);
    for (const [selector, expected] of Object.entries(selectors)) {
      await expect(page.locator(selector)).toHaveAttribute('placeholder', expected);
    }
  }
});

test('profile source restores placeholders on editable account/password fields', async () => {
  const source = fs.readFileSync('profile.html', 'utf8');
  expect(source).toContain('placeholder="Enter your first name"');
  expect(source).toContain('placeholder="Enter your last name"');
  expect(source).toContain('placeholder="Enter your current password"');
  expect(source).toContain('placeholder="Create a new password (6+ characters)"');
});

test('Firebase user-not-found messaging is account-specific', async () => {
  const source = fs.readFileSync('frontend/js/firebase-auth.js', 'utf8');
  expect(source).toContain("case 'auth/user-not-found': return 'No GapMap account was found for this email. Please create an account first.';");
  expect(source).not.toContain("case 'auth/user-not-found': return 'Email or password is incorrect.';");
  expect(source).not.toContain('Email or password is incorrect.');
});

test('public navigation keeps the Login button', async ({ page }) => {
  for (const path of ['/index.html?agent=off', '/howitworks.html?agent=off', '/features.html?agent=off']) {
    await page.goto(path);
    const login = page.locator('a[data-nav="login"]');
    await expect(login).toHaveText('Login');
    await expect(login).toHaveAttribute('href', 'login.html');
  }
});
