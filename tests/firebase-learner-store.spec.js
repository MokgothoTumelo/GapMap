import { test, expect } from '@playwright/test';
import { createMemoryStorage, createMockLearnerStore } from '../frontend/js/learner-store.js';
import { generateAssessment } from '../frontend/js/assessment-generator.js';
import { createFirebaseLearnerStore } from '../frontend/js/firebase-learner-store.js';

const silentLog = { warn: () => {} };

/**
 * An in-memory stand-in for the flat firebase-data-store.js seam — the same
 * functions, same per-uid keys — so the adapter is tested offline (no test
 * ever touches a real database, per learner-store.md).
 */
function fakeDb({ fail = false } = {}) {
  // Same path shape as the seam: learners/{uid}/assessments|attempts|messages.
  const state = { assessments: {}, attempts: {}, messages: {} };
  function throwIfOffline() {
    if (fail) throw new Error('provider unavailable');
  }
  return {
    state,
    async saveAssessment(uid, assessment) {
      throwIfOffline();
      const owned = (state.assessments[uid] ||= {});
      if (owned[assessment.id]) return owned[assessment.id];
      const copy = JSON.parse(JSON.stringify(assessment));
      owned[assessment.id] = copy;
      return copy;
    },
    async getAssessment(uid, assessmentId) {
      throwIfOffline();
      return state.assessments[uid]?.[assessmentId] || null;
    },
    async listAssessments(uid) {
      throwIfOffline();
      return Object.values(state.assessments[uid] || {});
    },
    async saveAttempt(uid, attempt) {
      throwIfOffline();
      const owned = (state.attempts[uid] ||= {});
      if (owned[attempt.id]) return owned[attempt.id];
      const copy = JSON.parse(JSON.stringify(attempt));
      owned[attempt.id] = copy;
      return copy;
    },
    async getAttempt(uid, attemptId) {
      throwIfOffline();
      return state.attempts[uid]?.[attemptId] || null;
    },
    async listAttempts(uid) {
      throwIfOffline();
      return Object.values(state.attempts[uid] || {});
    },
    async saveCompanionMessage(uid, message) {
      throwIfOffline();
      const owned = (state.messages[uid] ||= []);
      owned.push(JSON.parse(JSON.stringify(message)));
      return `msg-${owned.length}`;
    },
    async listCompanionMessages(uid) {
      throwIfOffline();
      return (state.messages[uid] || []).map((message, index) => ({
        id: `msg-${index + 1}`,
        role: message.role,
        content: message.content,
        at: message.at || null,
      }));
    },
  };
}

async function practiceFixture() {
  return generateAssessment({ type: 'practice' });
}

function attemptFor(assessment, overrides = {}) {
  return {
    id: 'attempt-1',
    assessment_id: assessment.id,
    learner_id: 'learner-a',
    started_at: '2026-03-01T10:00:00.000Z',
    completed_at: '2026-03-01T10:05:00.000Z',
    responses: assessment.items.map((item) => ({ item_id: item.id, answer: 0, correct: true })),
    scores: (assessment.concepts || []).map((concept) => ({
      concept: concept.name,
      correct: 1,
      total: 2,
      pct: 50,
      status: 'improve',
    })),
    ...overrides,
  };
}

test.describe('Firebase-backed Learner store', () => {
  test('putAssessment validates through the store contract and reaches Firestore', async () => {
    const db = fakeDb();
    const store = await createFirebaseLearnerStore({
      fallbackStore: createMockLearnerStore({ storage: createMemoryStorage() }),
      dataStore: db,
      log: silentLog,
    });
    const assessment = await practiceFixture();

    const stored = await store.putAssessment('learner-a', assessment);
    expect(stored.id).toBe(assessment.id);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(db.state.assessments['learner-a'][assessment.id].type).toBe('practice');

    // Per-Learner isolation is exact; a foreign uid reads nothing.
    expect((await store.getAssessment('learner-b', assessment.id))).toBeNull();
  });

  test('a re-put of the same Assessment id stays frozen and idempotent; a changed one is rejected', async () => {
    const db = fakeDb();
    const store = await createFirebaseLearnerStore({
      fallbackStore: createMockLearnerStore({ storage: createMemoryStorage() }),
      dataStore: db,
      log: silentLog,
    });
    const assessment = await practiceFixture();
    await store.putAssessment('learner-a', assessment);

    await store.putAssessment('learner-a', JSON.parse(JSON.stringify(assessment)));
    await expect(
      store.putAssessment('learner-a', { ...assessment, items: [] }),
    ).rejects.toThrow(/frozen|Item/);
  });

  test('reads Firestore first and keeps locally-only records in the merged view', async () => {
    const db = fakeDb();
    const store = await createFirebaseLearnerStore({
      fallbackStore: createMockLearnerStore({ storage: createMemoryStorage() }),
      dataStore: db,
      log: silentLog,
    });
    const remoteAssessment = await practiceFixture();
    await db.saveAssessment('learner-a', remoteAssessment);

    const localAssessment = await practiceFixture();
    await store.putAssessment('learner-a', localAssessment);

    const ids = (await store.listAssessments('learner-a')).map((entry) => entry.id);
    expect(ids).toHaveLength(2);
    // Newest generated_at first — the locally-generated one came later.
    expect(ids[0]).toBe(localAssessment.id);
    expect(ids).toContain(remoteAssessment.id);
  });

  test('attempts are append-only in both stores; the joined Assessment hydrates locally', async () => {
    const db = fakeDb();
    const local = createMockLearnerStore({ storage: createMemoryStorage() });
    const store = await createFirebaseLearnerStore({
      fallbackStore: local,
      dataStore: db,
      log: silentLog,
    });
    const assessment = await practiceFixture();
    const attempt = attemptFor(assessment);
    // The Assessment was created on another browser: Firestore has it, the
    // local store has nothing yet.
    await db.saveAssessment('learner-a', assessment);

    await store.saveAttempt('learner-a', attempt);
    // The mirror hydrates the joined Assessment into the local store so the
    // offline Gap Map derivation keeps working.
    expect(await local.getAssessment('learner-a', assessment.id)).not.toBeNull();
    expect(await store.getAttempt('learner-a', attempt.id)).not.toBeNull();

    const replay = JSON.parse(JSON.stringify(attempt));
    await store.saveAttempt('learner-a', replay);
    const changed = JSON.parse(JSON.stringify(attempt));
    changed.started_at = '2026-03-01T11:00:00.000Z';
    await expect(store.saveAttempt('learner-a', changed)).rejects.toThrow(/append-only/);
  });

  test('transcript replay is ordered, ordered by the time, and clear is local (cloud is append-only)', async () => {
    const db = fakeDb();
    const store = await createFirebaseLearnerStore({
      fallbackStore: createMockLearnerStore({ storage: createMemoryStorage() }),
      dataStore: db,
      log: silentLog,
    });

    await store.appendTranscript('learner-a', { role: 'user', content: 'second', at: '2026-03-01T10:02:00.000Z' });
    await store.appendTranscript('learner-a', { role: 'assistant', content: 'second reply', at: '2026-03-01T10:03:00.000Z' });

    const turns = await store.getTranscript('learner-a');
    expect(turns.map((turn) => turn.content)).toEqual(['second', 'second reply']);

    await store.clearTranscript('learner-a');
    expect(await store.getTranscript('learner-a')).toHaveLength(0);
    // Cloud copy is untouched (append-only by rule); later turns stay visible.
    expect(db.state.messages['learner-a']).toHaveLength(2);
  });

  test('getContext derives the Gap Map from Firestore attempts, weak-first, flat path', async () => {
    const db = fakeDb();
    const store = await createFirebaseLearnerStore({
      fallbackStore: createMockLearnerStore({ storage: createMemoryStorage() }),
      dataStore: db,
      log: silentLog,
    });
    const assessment = await practiceFixture();
    await db.saveAssessment('learner-a', assessment);
    await db.saveAttempt('learner-a', attemptFor(assessment));

    const context = await store.getContext('learner-a');
    expect(Object.keys(context)).toEqual(
      expect.arrayContaining(['learnerId', 'gapMap', 'learningPath', 'assessments', 'attempts', 'transcript']),
    );
    expect(context.gapMap.every((entry) => entry.status === 'improve')).toBe(true);
    expect(context.learningPath).toEqual(context.gapMap.map((entry) => entry.concept));
  });

  test('when Firestore is unreachable the store degrades to the local store without failing', async () => {
    const store = await createFirebaseLearnerStore({
      fallbackStore: createMockLearnerStore({ storage: createMemoryStorage() }),
      dataStore: fakeDb({ fail: true }),
      log: silentLog,
    });
    const assessment = await practiceFixture();
    await store.putAssessment('learner-a', assessment);
    expect((await store.getAssessment('learner-a', assessment.id)).id).toBe(assessment.id);
    expect(await store.listAssessments('learner-a')).toHaveLength(1);
    await store.saveAttempt('learner-a', attemptFor(assessment));
    expect(await store.listAttempts('learner-a')).toHaveLength(1);
  });
});
