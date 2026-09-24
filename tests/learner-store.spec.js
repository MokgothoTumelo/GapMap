import { test, expect } from '@playwright/test';
import {
  createMemoryStorage,
  createMockLearnerStore,
  getCurrentLearnerId,
} from '../frontend/js/learner-store.js';
import { generateAssessment } from '../frontend/js/assessment-generator.js';

async function practiceAssessment(id = 'practice-store-test') {
  return generateAssessment({ type: 'practice', id });
}

test.describe('mock Learner store', () => {
  test('keeps Assessments isolated by Learner and returns frozen copies', async () => {
    const store = createMockLearnerStore({ storage: createMemoryStorage() });
    const assessment = await practiceAssessment();

    await store.putAssessment('learner-a', assessment);

    const retrieved = await store.getAssessment('learner-a', assessment.id);
    expect(retrieved.id).toBe(assessment.id);
    expect(Object.isFrozen(retrieved)).toBe(true);
    expect(Object.isFrozen(retrieved.items[0])).toBe(true);
    expect(await store.getAssessment('learner-b', assessment.id)).toBeNull();

    expect(() => {
      retrieved.items[0].prompt = 'mutated outside the store';
    }).toThrow();
    const reread = await store.getAssessment('learner-a', assessment.id);
    expect(reread.items[0].prompt).toBe(assessment.items[0].prompt);
  });

  test('freezes an Assessment id and keeps retrieval separate from generation', async () => {
    const store = createMockLearnerStore({ storage: createMemoryStorage() });
    const assessment = await practiceAssessment();
    await store.putAssessment('learner-a', assessment);

    const equivalent = await store.putAssessment('learner-a', structuredClone(assessment));
    expect(equivalent.id).toBe(assessment.id);

    const replacement = structuredClone(assessment);
    replacement.items[0].prompt = 'a different Item';
    await expect(store.putAssessment('learner-a', replacement)).rejects.toThrow(/frozen/);

    expect((await store.listAssessments('learner-a', { type: 'practice' }))).toHaveLength(1);
    expect((await store.listAssessments('learner-a', { type: 'diagnostic' }))).toHaveLength(0);
  });

  test('stores append-only Attempts and derives the Gap Map context', async () => {
    const store = createMockLearnerStore({ storage: createMemoryStorage() });
    const assessment = await practiceAssessment('practice-context-test');
    await store.putAssessment('learner-a', assessment);

    const attempt = {
      id: 'attempt-context-test',
      assessment_id: assessment.id,
      learner_id: 'learner-a',
      started_at: '2026-01-01T10:00:00.000Z',
      completed_at: '2026-01-01T10:02:00.000Z',
      responses: [],
      scores: [
        { concept: 'Factorisation', correct: 1, total: 3, pct: 33, status: 'weak' },
      ],
      overall_pct: 33,
    };

    await store.saveAttempt('learner-a', attempt);
    const context = await store.getContext('learner-a');
    expect(context.gapMap).toEqual([
      { concept: 'Factorisation', correct: 1, total: 3, pct: 33, status: 'weak' },
    ]);
    expect(context.learningPath).toEqual(['Factorisation']);
    expect((await store.getAttempt('learner-a', assessment.id)).id).toBe(attempt.id);

    const replacement = structuredClone(attempt);
    replacement.overall_pct = 99;
    await expect(store.saveAttempt('learner-a', replacement)).rejects.toThrow(/append-only/);
  });

  test('uses the app Firebase getCurrentUser identity before the demo fallback', () => {
    expect(
      getCurrentLearnerId({
        getCurrentUser: () => ({ uid: 'app-project-learner' }),
        storage: createMemoryStorage(),
      }),
    ).toBe('app-project-learner');
  });

  test('prefers the Learner Profile\'s minted uid over the email hash', () => {
    const storage = createMemoryStorage({
      gapmap_user: JSON.stringify({
        email: 'thabo@example.com',
        uid: 'learner-minted-1',
      }),
    });

    expect(getCurrentLearnerId({ storage })).toBe('learner-minted-1');
  });

  test('derives a stable id from the email for Profiles created before minting', () => {
    const storage = createMemoryStorage({
      gapmap_user: JSON.stringify({ email: 'thabo@example.com' }),
    });

    expect(getCurrentLearnerId({ storage })).toMatch(/^demo-/);
  });

  test('persists a per-Learner Companion transcript and can reset it', async () => {
    const store = createMockLearnerStore({ storage: createMemoryStorage() });

    await store.appendTranscript('learner-a', { role: 'user', content: 'Explain factorisation' });
    await store.appendTranscript('learner-a', { role: 'assistant', content: 'Look for patterns.' });

    expect(await store.getTranscript('learner-a')).toEqual([
      { role: 'user', content: 'Explain factorisation', at: expect.any(String) },
      { role: 'assistant', content: 'Look for patterns.', at: expect.any(String) },
    ]);
    expect(await store.clearTranscript('learner-a')).toEqual([]);
    expect(await store.getTranscript('learner-a')).toEqual([]);
  });
});
