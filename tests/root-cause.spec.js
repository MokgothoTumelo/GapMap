import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { seedSession } from './helpers/session.js';

// The root-cause experience (ADR-0006): the dashboard reads the Subject's
// Concept Graph and the Learner's Mistake-Diagnosis evidence, and renders the
// Learning Path as a dependency chain — the root first, with the *why* —
// instead of a severity-sorted list. The concept page answers "why am I here".
//
// Seeded from the demo artefacts themselves (assessment + attempt + graph),
// so the browser test exercises the same join the demo shows a judge.

const readYaml = (rel) =>
  yaml.load(readFileSync(join(process.cwd(), rel), 'utf8'), { schema: yaml.JSON_SCHEMA });

const demoAssessment = readYaml('core/demo-data/assessments/diagnostic-g12-mathematics.yaml');
const demoAttempt = readYaml('core/demo-data/attempts/learner-001_diagnostic-g12-mathematics.yaml');

// The Gap Map narrative from the demo attempt: Factorisation and Quadratic
// Equations both weak at 33%, Functions improve, Algebra strong.
const demoResults = {
  overall: demoAttempt.overall_pct,
  concepts: Object.fromEntries(
    demoAttempt.scores.map((score) => [
      score.concept,
      { score: score.pct, correct: score.correct, total: score.total, status: score.status },
    ]),
  ),
  totalCorrect: 7,
  totalQuestions: 12,
  takenAt: demoAttempt.completed_at,
  subject: 'Mathematics',
};

async function seedDashboardData(page) {
  await seedSession(page, { grade: '12', subject: 'Mathematics' });
  await page.addInitScript(({ results, record }) => {
    // The diagnostic results and the Learner-store record, seeded directly:
    // this spec has no logout flow, so the once-guard seedSession uses does
    // not apply here (it would bail before this script runs at all).
    localStorage.setItem('gapmap_diagnostic:learner-001:mathematics', JSON.stringify(results));
    localStorage.setItem('gapmap.learner.learner-001', JSON.stringify(record));
  }, {
    results: demoResults,
    record: {
      version: 1,
      learner_id: 'learner-001',
      assessments: { [demoAssessment.id]: demoAssessment },
      attempts: { [demoAttempt.id]: demoAttempt },
      transcript: [],
    },
  });
}

test.describe('root-cause experience (ADR-0006)', () => {
  test('the dashboard names the root and orders the path roots-first', async ({ page }) => {
    await seedDashboardData(page);
    await page.goto('/dashboard.html?agent=off');

    // The root-cause banner: Factorisation, a Grade 9 Concept, blocks
    // Quadratic Equations — and the evidence sentence cites the Learner's own
    // prerequisite failures.
    const banner = page.locator('#rootCauseBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Root cause');
    await expect(banner).toContainText('Factorisation');
    await expect(banner).toContainText('Grade 9');
    await expect(banner).toContainText('Quadratic Equations depend');
    await expect(banner).toContainText(
      '1 of your 2 wrong Quadratic Equations responses were prerequisite failures pointing back here.',
    );

    // The Learning Path is the derived chain, not the severity sort with
    // unearned priority labels: the root leads, with its origin chip and a
    // connector naming what it unblocks (flow: see-why-you're-stuck, step 3).
    const firstItem = page.locator('.path-item').first();
    await expect(firstItem).toContainText('Factorisation');
    await expect(firstItem).toContainText('Grade 9');
    await expect(firstItem).toContainText('Root');
    const connector = page.locator('.path-connector').first();
    await expect(connector).toContainText('unblocks Quadratic Equations');
    const secondItem = page.locator('.path-item').nth(1);
    await expect(secondItem).toContainText('Quadratic Equations');
    await expect(secondItem).toContainText('Currently 33%');

    // The CTA starts at the root of the path.
    await expect(page.locator('.cta-row .btn-primary')).toContainText('Start with Factorisation');
  });

  test('the derived path object is inspectable — the same data the Companion gets', async ({ page }) => {
    await seedDashboardData(page);
    await page.goto('/dashboard.html?agent=off');

    // Flow: see-why-you're-stuck, step 5. The provenance note names the
    // derivation; "View as data" reveals the derived object the Companion's
    // getLearningPath tool returns — entries, roots, evidence.
    await expect(page.locator('.path-source-note')).toContainText(
      "Derived from your Gap Map and the Subject's Concept Graph",
    );
    await expect(page.locator('.path-source-note')).toContainText('graph-g12-mathematics');

    const pre = page.locator('#pathData');
    await expect(pre).toBeHidden();
    await page.click('#pathDataToggle');
    await expect(pre).toBeVisible();
    await expect(pre).toContainText('"learningPath"');
    await expect(pre).toContainText('"concept": "Factorisation"');
    await expect(pre).toContainText('"blocks"');
    await expect(pre).toContainText('"rootCauses"');
    await expect(pre).toContainText('"prerequisiteFailures"');
    await expect(page.locator('#pathDataToggle')).toHaveText('Hide data');

    await page.click('#pathDataToggle');
    await expect(pre).toBeHidden();
    await expect(page.locator('#pathDataToggle')).toHaveText('View as data');
  });

  test('the concept page says why the Concept is on the path', async ({ page }) => {
    await seedDashboardData(page);
    await page.goto('/concept.html?concept=factorisation&agent=off');

    const why = page.locator('#pathWhy');
    await expect(why).toBeVisible();
    await expect(why).toContainText('Why this is on your path');
    await expect(why).toContainText('at 33%');
    await expect(why).toContainText('first taught in Grade 9');
    await expect(why).toContainText('unblocks Quadratic Equations');
  });

  test('a strong Concept gets no "why on path" chip', async ({ page }) => {
    await seedDashboardData(page);
    await page.goto('/concept.html?concept=algebra&agent=off');

    await expect(page.locator('#conceptTitle')).toHaveText('Algebra');
    await expect(page.locator('#pathWhy')).toBeHidden();
  });
});