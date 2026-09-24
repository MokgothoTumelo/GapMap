import { test, expect } from '@playwright/test';
import {
  composePractice,
  ensureComposedPracticeForLearner,
} from '../frontend/js/assessment-composer.js';
import { createMemoryStorage, createMockLearnerStore } from '../frontend/js/learner-store.js';
import { validateAssessment } from '../core/validate.js';

function mc(id, concept, prompt, correct = 0) {
  return {
    id,
    concept,
    prompt,
    prompt_type: 'multiple_choice',
    options: ['a', 'b', 'c', 'd'],
    correct,
  };
}

function poolAssessment(id, type, concepts, items, overrides = {}) {
  return {
    id,
    type,
    subject: 'Grade 12 Mathematics',
    language: 'en',
    explanation_level: 'Standard',
    concepts: concepts.map((name) => ({ name })),
    items,
    generated_at: overrides.generatedAt || '2026-01-01T00:00:00.000Z',
    generated_by: 'test',
    schema_version: '1.0.0',
  };
}

// The pool the AI generated: two assessments covering Factorisation (with one
// duplicate prompt across them) plus Algebra items the Learner has attempted.
function pool() {
  const assessmentA = poolAssessment('diagnostic-g12-mathematics-html', 'diagnostic', [
    'Factorisation',
    'Algebra',
  ], [
    mc('q1', 'Factorisation', 'POOL duplicate prompt'),
    mc('q2', 'Factorisation', 'POOL A seen prompt'),
    mc('q3', 'Algebra', 'POOL A algebra prompt'),
  ]);
  const assessmentB = poolAssessment('practice-generated-algebra', 'practice', ['Factorisation'], [
    mc('q1', 'Factorisation', 'POOL B unseen 1'),
    mc('q2', 'Factorisation', 'POOL B unseen 2'),
    mc('q3', 'Factorisation', 'POOL B unseen 3'),
  ]);
  const attemptOnA = {
    id: 'attempt-a',
    assessment_id: 'diagnostic-g12-mathematics-html',
    learner_id: 'learner-pool',
    started_at: '2026-01-02T00:00:00.000Z',
    completed_at: '2026-01-02T00:10:00.000Z',
    responses: [
      { item_id: 'q1', answer: 0, correct: true },
      { item_id: 'q2', answer: 1, correct: false },
    ],
    scores: [{ concept: 'Factorisation', correct: 1, total: 2, pct: 50, status: 'improve' }],
    overall_pct: 50,
  };
  return { assessments: [assessmentA, assessmentB], attempts: [attemptOnA] };
}

test('composes a valid Practice artefact for the Concept from the pool', () => {
  const { assessments } = pool();
  const composed = composePractice({
    assessments,
    targetConcept: 'Factorisation',
    itemCount: 4,
    seed: 'learner-pool',
  });

  expect(composed).not.toBeNull();
  const { assessment, sources } = composed;

  // The composed artefact is a schema-shaped Practice: validateAssessment is
  // the same semantic contract the store enforces on persistence.
  expect(() => validateAssessment(assessment)).not.toThrow();
  expect(assessment.type).toBe('practice');
  expect(assessment.concepts).toEqual([{ name: 'Factorisation' }]);
  expect(assessment.items).toHaveLength(4);
  // Item ids are renumbered into the schema's Item contract (q1..qN).
  assessment.items.forEach((item, index) => expect(item.id).toBe(`q${index + 1}`));
  assessment.items.forEach((item) => expect(item.concept).toBe('Factorisation'));
  // Provenance travels with the composition, not inside the artefact.
  expect(sources).toHaveLength(4);
  sources.forEach((source) => {
    expect(['diagnostic-g12-mathematics-html', 'practice-generated-algebra']).toContain(source);
  });
  // Frozen artefact fields come from the pool it was drawn from.
  expect(assessment.subject).toBe('Grade 12 Mathematics');
  expect(assessment.language).toBe('en');
  expect(assessment.explanation_level).toBe('Standard');
});

test('deduplicates Items that appear in more than one assessment', () => {
  const { assessments } = pool();
  const composed = composePractice({
    assessments,
    targetConcept: 'Factorisation',
    itemCount: 5,
    seed: 'learner-pool',
  });

  const prompts = composed.assessment.items.map((item) => item.prompt.toLowerCase());
  expect(new Set(prompts).size).toBe(prompts.length);
  expect(prompts).toContain('pool duplicate prompt');
});

test('unseen Items are preferred over Items the Learner has already attempted', () => {
  const { assessments } = pool();
  const attempted = assessments.find((a) => a.id === 'diagnostic-g12-mathematics-html');
  const composed = composePractice({
    assessments,
    // The seen set is normalized prompts from assessments the Learner attempted.
    seenPrompts: attempted.items.map((item) => item.prompt),
    targetConcept: 'Factorisation',
    itemCount: 3,
    seed: 'learner-pool',
  });

  const attemptedPrompts = new Set(attempted.items.map((item) => item.prompt.toLowerCase()));
  const selectedPrompts = composed.assessment.items.map((item) => item.prompt.toLowerCase());
  // Pool B is untouched by the Attempt, so it fills the composition first.
  selectedPrompts.forEach((prompt) => expect(attemptedPrompts.has(prompt)).toBe(false));
});

test('composition is deterministic for the same pool and seen state', () => {
  const { assessments, attempts } = pool();
  const first = composePractice({
    assessments,
    attempts,
    targetConcept: 'Factorisation',
    itemCount: 4,
    seed: 'learner-pool',
  });
  const second = composePractice({
    assessments,
    attempts,
    targetConcept: 'Factorisation',
    itemCount: 4,
    seed: 'learner-pool',
  });

  expect(first.assessment.items.map((item) => item.prompt)).toEqual(
    second.assessment.items.map((item) => item.prompt),
  );
});

test('refuses to compose when the pool cannot supply a Practice', () => {
  const thin = [poolAssessment('pool-thin', 'practice', ['Trigonometry'], [
    mc('q1', 'Trigonometry', 'only one'),
    mc('q2', 'Trigonometry', 'only two'),
  ])];

  expect(composePractice({ assessments: thin, targetConcept: 'Trigonometry' })).toBeNull();
});

test('returns no fresh Practice when every pooled Item is already seen', async () => {
  const store = createMockLearnerStore({ storage: createMemoryStorage() });
  const seed = poolAssessment('practice-seen-seed', 'practice', ['Factorisation'], [
    mc('q1', 'Factorisation', 'seen 1'),
    mc('q2', 'Factorisation', 'seen 2'),
    mc('q3', 'Factorisation', 'seen 3'),
  ]);
  await store.putAssessment('learner-pool', seed);
  await store.saveAttempt('learner-pool', {
    id: 'attempt-seen',
    assessment_id: seed.id,
    learner_id: 'learner-pool',
    started_at: '2026-01-02T00:00:00.000Z',
    responses: [
      { item_id: 'q1', answer: 0, correct: true },
      { item_id: 'q2', answer: 0, correct: true },
      { item_id: 'q3', answer: 0, correct: true },
    ],
    scores: [{ concept: 'Factorisation', correct: 3, total: 3, pct: 100, status: 'strong' }],
    overall_pct: 100,
  });

  const next = await ensureComposedPracticeForLearner({
    learnerId: 'learner-pool',
    targetConcept: 'Factorisation',
    store,
  });
  expect(next).toBeNull();
});
