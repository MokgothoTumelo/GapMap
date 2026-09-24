import { test, expect } from '@playwright/test';
import { answerAllItems, answerItem, seedSession } from './helpers/session.js';

// Baseline: the demo's assessment flow must work end to end. These tests are
// intentionally behaviour-focused (drive the UI, assert outcomes) so they stay
// valid across the classic → ESM migration of the browser scripts.
//
// Every screen below sits behind frontend/js/auth-guard.js, so each test seeds
// the session the guard reads (tests/helpers/session.js). Guest and Setup
// routing live in auth-routing.spec.js; the Library lives in library.spec.js.
//
// The Companion is live by default; these tests open with `?agent=off` so the
// suite stays key-free and network-free (no Firebase CDN bootstrap).

test('Diagnostic loads the Learner\'s grade + subject artefact and produces a per-Concept Gap Map', async ({
  page,
}) => {
  await seedSession(page, { grade: '12', subject: 'Mathematics' });
  await page.goto('/diagnostic.html?agent=off');

  // The Diagnostic resolves its artefact from the Learner's grade + subject:
  // Grade 12 Mathematics takes the mathematics artefact, not a leftover maths one.
  const itemCount = parseInt(
    await page.locator('#introQuestions').textContent(),
    10,
  );
  expect(itemCount).toBeGreaterThan(0);
  await expect(page.locator('#introSubject')).toHaveText('Mathematics');
  await expect(page.locator('#startBtn')).toBeEnabled();

  // The agent panel is present on the page.
  await expect(page.locator('.gm-agent-status-text')).toBeVisible();

  await page.click('#startBtn');
  await answerAllItems(page, itemCount);

  // Results render with an overall Score and a per-Concept breakdown.
  await expect(page.locator('#finalScore')).toContainText('%');
  await expect(page.locator('#miniBreakdown .mini-tag').first()).toBeVisible();

  // The Gap Map is stored per Subject, scoped to the Learner, and the Attempt
  // lands in the Learner's store.
  const stored = await page.evaluate(() => ({
    subject: JSON.parse(localStorage.getItem('gapmap_diagnostic:learner-001:mathematics')),
    history: JSON.parse(localStorage.getItem('gapmap_history:learner-001') || '[]'),
    record: JSON.parse(localStorage.getItem('gapmap.learner.learner-001')),
  }));

  expect(stored.subject.subject).toBe('Mathematics');
  expect(Object.keys(stored.subject.concepts).length).toBeGreaterThan(0);
  expect(stored.history).toHaveLength(1);
  expect(Object.keys(stored.record.assessments)).toContain(
    'diagnostic-g12-mathematics-html',
  );
  expect(Object.keys(stored.record.attempts)).toHaveLength(1);
});

test('Concept practice runs from the Gap Map to Results and stores the Concept Score', async ({
  page,
}) => {
  await seedSession(page, { grade: '12', subject: 'Mathematics' });
  await page.goto('/concept.html?concept=factorisation&agent=off');

  // Learn screen: the Concept, its explanation, and matching videos.
  await expect(page.locator('#conceptTitle')).toHaveText('Factorisation');
  await expect(page.locator('#explanationBody')).not.toBeEmpty();
  await expect(page.locator('#videosCard')).toBeVisible();
  await expect(page.locator('#videosBody a[href^="https://www.youtube.com/"]')).not.toHaveCount(0);

  await page.click('#startPracticeBtn');
  const itemCount = parseInt(
    await page.locator('#progressTotal').textContent(),
    10,
  );
  expect(itemCount).toBeGreaterThan(0);
  await answerAllItems(page, itemCount);

  // Results screen: the Score is a percentage of the Concept's Items.
  await expect(page.locator('#resultsScreen')).toBeVisible();
  await expect(page.locator('#finalScore')).toContainText('%');
  await expect(page.locator('#resultsLead')).toContainText(`out of ${itemCount}`);

  const practice = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('gapmap_practice:learner-001:mathematics:factorisation')),
  );
  expect(practice).toMatchObject({
    concept: 'factorisation',
    subject: 'Mathematics',
    total: itemCount,
  });
  expect(practice.score).toBeGreaterThanOrEqual(0);
  expect(practice.score).toBeLessThanOrEqual(100);
});

test('a Concept the bank does not cover says so instead of rendering an empty Practice', async ({
  page,
}) => {
  await seedSession(page);
  await page.goto('/concept.html?concept=organic-chemistry&agent=off');

  await expect(page.locator('#emptyScreen')).toBeVisible();
  await expect(page.locator('#emptyMessage')).toContainText('organic-chemistry');
  await expect(page.locator('#practiceScreen')).toBeHidden();
});

// The pool the AI generated lives in the Learner's store; the platform
// composes Practice from it (and reuses an unattempted one) instead of always
// falling back to the built-in bank.
const POOL_PRACTICE = {
  id: 'practice-pool-seed',
  type: 'practice',
  subject: 'Grade 12 Mathematics',
  language: 'en',
  explanation_level: 'Standard',
  concepts: [{ name: 'Algebra' }],
  items: [
    { id: 'q1', concept: 'Algebra', prompt: 'POOL-ALGEBRA-1', prompt_type: 'multiple_choice', options: ['a', 'b', 'c', 'd'], correct: 0 },
    { id: 'q2', concept: 'Algebra', prompt: 'POOL-ALGEBRA-2', prompt_type: 'numeric', correct: '7' },
    { id: 'q3', concept: 'Algebra', prompt: 'POOL-ALGEBRA-3', prompt_type: 'short_answer', correct: 'x + 1', correctAnswers: ['x+1'] },
  ],
  generated_at: '2026-01-01T00:00:00.000Z',
  generated_by: 'companion-agent',
  schema_version: '1.0.0',
};

async function seedPoolPractice(page, assessment) {
  await seedSession(page, { grade: '12', subject: 'Mathematics' });
  await page.addInitScript((record) => {
    if (sessionStorage.getItem('gapmap_test_store_seeded')) return;
    sessionStorage.setItem('gapmap_test_store_seeded', '1');
    localStorage.setItem('gapmap.learner.learner-001', JSON.stringify(record));
  }, {
    version: 1,
    learner_id: 'learner-001',
    assessments: { [assessment.id]: assessment },
    attempts: {},
    transcript: [],
  });
}

test('Practice draws from the Learner\'s pool instead of the built-in bank', async ({ page }) => {
  await seedPoolPractice(page, POOL_PRACTICE);
  await page.goto('/concept.html?concept=algebra&agent=off');

  await page.click('#startPracticeBtn');
  const prompt = await page.locator('#questionText').textContent();
  expect(['POOL-ALGEBRA-1', 'POOL-ALGEBRA-2', 'POOL-ALGEBRA-3']).toContain(prompt);
});

test('a pool-only Concept — generated by the agent, absent from the bank — is viewable and attemptable', async ({
  page,
}) => {
  const surds = {
    ...POOL_PRACTICE,
    id: 'practice-pool-surds',
    concepts: [{ name: 'Exponents & Surds' }],
    items: [
      { id: 'q1', concept: 'Exponents & Surds', prompt: 'POOL-SURDS-1', prompt_type: 'numeric', correct: '8' },
      { id: 'q2', concept: 'Exponents & Surds', prompt: 'POOL-SURDS-2', prompt_type: 'numeric', correct: '27' },
      { id: 'q3', concept: 'Exponents & Surds', prompt: 'POOL-SURDS-3', prompt_type: 'multiple_choice', options: ['a', 'b', 'c', 'd'], correct: 2 },
    ],
  };
  await seedPoolPractice(page, surds);
  await page.goto('/concept.html?concept=exponents-and-surds&agent=off');

  // The page is the view of the generated assessment: straight into Practice.
  await expect(page.locator('#practiceScreen')).toBeVisible();
  const prompt = await page.locator('#questionText').textContent();
  expect(['POOL-SURDS-1', 'POOL-SURDS-2', 'POOL-SURDS-3']).toContain(prompt);

  // Completing it writes an Attempt joined to the frozen artefact.
  for (let index = 0; index < 3; index += 1) {
    await answerItem(page);
    await page.locator('#nextBtn').click();
    if (index < 2) {
      await expect(page.locator('#currentNum')).toHaveText(String(index + 2));
    }
  }
  await expect(page.locator('#resultsScreen')).toBeVisible();

  const record = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('gapmap.learner.learner-001')),
  );
  const attempts = Object.values(record.attempts);
  expect(attempts).toHaveLength(1);
  expect(attempts[0].assessment_id).toBe('practice-pool-surds');
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


test('Diagnostic re-presents previously answered Items instead of repeating the exact form', async ({ page }) => {
  await seedSession(page, { grade: '12', subject: 'Mathematics' });
  await page.goto('/diagnostic.html?agent=off');
  const count = parseInt(await page.locator('#introQuestions').textContent(), 10);
  await page.click('#startBtn');

  const firstForm = [];
  for (let index = 0; index < count; index += 1) {
    firstForm.push(await page.locator('#questionText').textContent());
    await answerItem(page);
    await page.locator('#nextBtn').click();
  }
  await expect(page.locator('#resultsScreen')).toBeVisible();

  await page.goto('/diagnostic.html?agent=off');
  await expect(page.locator('#startBtn')).toBeEnabled();
  await page.click('#startBtn');
  const secondForm = [];
  for (let index = 0; index < count; index += 1) {
    secondForm.push(await page.locator('#questionText').textContent());
    await answerItem(page);
    await page.locator('#nextBtn').click();
  }

  expect(secondForm).not.toEqual(firstForm);
  expect(new Set(secondForm).size).toBe(count);
});

test('Diagnostic Language switching mid-attempt preserves the existing Response', async ({ page }) => {
  await seedSession(page, { grade: '12', subject: 'Mathematics', language: 'English' });
  await page.goto('/diagnostic.html?agent=off');
  await page.click('#startBtn');

  await page.locator('#optionsContainer .option').first().click();
  const selectedBefore = await page.locator('#optionsContainer .option.selected .option-text').textContent();
  const selectedIndexBefore = await page.locator('#optionsContainer .option').evaluateAll((nodes) =>
    nodes.findIndex((node) => node.classList.contains('selected')),
  );

  await page.locator('#languageSwitcherMount select').selectOption('Afrikaans');

  expect(await page.locator('#optionsContainer .option').evaluateAll((nodes) =>
    nodes.findIndex((node) => node.classList.contains('selected')),
  )).toBe(selectedIndexBefore);
  expect(await page.locator('#optionsContainer .option.selected .option-text').textContent()).toBe(selectedBefore);
});

test('Practice Language switching mid-attempt preserves the existing Response', async ({ page }) => {
  await seedSession(page, { grade: '12', subject: 'Mathematics', language: 'English' });
  await page.goto('/concept.html?concept=factorisation&agent=off');
  await page.click('#startPracticeBtn');

  await page.locator('#optionsContainer .option').first().click();
  const selectedIndexBefore = await page.locator('#optionsContainer .option').evaluateAll((nodes) =>
    nodes.findIndex((node) => node.classList.contains('selected')),
  );
  const selectedBefore = await page.locator('#optionsContainer .option.selected .option-text').textContent();

  await page.locator('#quizLanguage').selectOption('Afrikaans');

  expect(await page.locator('#optionsContainer .option').evaluateAll((nodes) =>
    nodes.findIndex((node) => node.classList.contains('selected')),
  )).toBe(selectedIndexBefore);
  expect(await page.locator('#optionsContainer .option.selected .option-text').textContent()).toBe(selectedBefore);
});
