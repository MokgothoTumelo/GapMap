import { test, expect } from '@playwright/test';

// Baseline: the demo's assessment flow must work end to end. These tests are
// intentionally behaviour-focused (drive the UI, assert outcomes) so they
// stay valid across the classic → ESM migration of the browser scripts.
//
// The Companion is live by default; these tests open with `?agent=off` so the
// suite stays key-free and network-free (no Firebase CDN bootstrap).

test('diagnostic loads, runs, and produces a per-Concept Gap Map breakdown', async ({
  page,
}) => {
  await page.goto('/diagnostic.html?agent=off');

  // The assessment loads from demo YAML → the intro shows item/concept counts.
  const itemCount = parseInt(
    await page.locator('#introQuestions').textContent(),
    10,
  );
  expect(itemCount).toBeGreaterThan(0);
  await expect(page.locator('#startBtn')).toBeEnabled();

  // The agent panel is present on the page.
  await expect(page.locator('.gm-agent-status-text')).toBeVisible();

  await page.click('#startBtn');

  // Answer every item with the first option, then advance.
  for (let i = 0; i < itemCount; i++) {
    await page.locator('.option').first().click();
    await page.click('#nextBtn');
  }

  // Results render with an overall score and a per-Concept breakdown.
  await expect(page.locator('#finalScore')).toContainText('%');
  await expect(page.locator('#miniBreakdown .mini-tag').first()).toBeVisible();

  const learnerRecord = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('gapmap.learner.learner-001')),
  );
  expect(Object.keys(learnerRecord.assessments)).toContain('diagnostic-g12-maths-html');
  expect(Object.keys(learnerRecord.attempts)).toHaveLength(1);
});

test('practice loads, and a wrong answer yields a Mistake-Diagnosis explanation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'gapmap_user',
      JSON.stringify({
        uid: 'learner-001',
        firstName: 'Demo',
        setupComplete: true,
      }),
    );
  });
  await page.goto('/concept.html?agent=off');

  // The practice assessment loads from demo YAML → the question renders.
  await expect(page.locator('#practiceQuestion')).not.toHaveText('');

  // The practice panel is behind a tab; activate it before interacting.
  await page.click('[data-tab="practice"]');

  // Pick the first option and check it. (Whether it is right or wrong, the
  // feedback box must render an explanation.)
  await page.locator('#practiceOptions .option').first().click();
  await page.click('#checkBtn');

  await expect(page.locator('#feedbackBox')).toHaveClass(/active/);
  await expect(page.locator('#feedbackBox')).not.toHaveText('');
});

test('landing page Start Diagnostic navigates to the diagnostic', async ({
  page,
}) => {
  await page.goto('/?agent=off');
  await page.getByRole('link', { name: /Start Diagnostic/ }).click();
  await expect(page).toHaveURL(/diagnostic\.html$/);
});

test('Companion surfaces the opted-out live agent instead of masking it', async ({ page }) => {
  await page.goto('/?agent=off');
  await expect(page.locator('.gm-agent-status-text')).toHaveText('Live agent unavailable');

  await page.getByRole('button', { name: 'Open GapMap companion' }).click();
  await page.locator('.gm-agent-input').fill('Help me understand factorisation');
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.locator('.gm-agent-message.is-assistant').last()).toContainText(
    'Firebase AI Logic is not configured',
  );
  await expect(page.locator('.gm-agent-activity-log')).toContainText('agent error');
});