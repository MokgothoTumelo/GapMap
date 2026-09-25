// Firestore-backed Learner store: the interface the mock store
// (`learner-store.js`) exposes, backed by the existing Firestore seam in
// `firebase-data-store.js`. The database itself does not change: reads walk
// the same paths the pages already write (all owner-readable under the
// checked-in rules; no new collections, no payload changes, no index), and
// writes go through the same flat save* functions the pages call today.
//
// Composition rule: Firestore (project A) is the durable copy, the mock store
// is the offline fallback. Reads prefer Firestore and merge in anything that
// only exists locally (created while offline); writes are dual-write —
// Firestore first, mock best-effort — so the key-free demo and the browser
// tests never require a live project. Every Firestore access is wrapped: an
// outage degrades to the local store instead of breaking the session.
//
// The store invariants are enforced client-side exactly as the pages do
// today (the security rules deny updates/deletes regardless):
// - Assessments are frozen once written (create-only; an identical re-put is
//   idempotent; the mock store runs the persistence validation).
// - Attempts are append-only (a changed re-save is rejected).
// - Transcript turns are appended, never rewritten; `clearTranscript` clears
//   the local copy and hides earlier turns behind a per-Learner marker, since
//   the cloud transcript is append-only by rule.
//
// Unit tests inject a fake `dataStore`; in the browser the real module is
// imported lazily so a CDN outage leaves the local store fully usable.

import { score as rollupScores } from '../../core/scoring.js';
import { createMockLearnerStore } from './learner-store.js';

// Lazy so the key-free demo and tests never load the Cloud SDK stand-in.
let authServicesPromise = null;
function authenticatedAuth() {
  if (!authServicesPromise) {
    authServicesPromise = import('./firebase-app.js')
      .then(({ getFirebaseAuth }) => getFirebaseAuth())
      .catch(() => null);
  }
  return authServicesPromise.then((auth) => (auth?.currentUser?.uid ? auth : null));
}

const DB_UNAVAILABLE = Symbol('db-unavailable');
const MARKER_PREFIX = 'gapmap.companion.cleared.';

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function assertLearnerId(learnerId) {
  const value = typeof learnerId === 'string' ? learnerId.trim() : '';
  if (!value) throw new Error('learnerId must be a non-empty string');
  return value;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The app-owned fields of a stored doc (server extras are not comparable). */
function appFieldsOf(doc) {
  const { storedAt, createdAt, updatedAt, learner_id: _learnerId, ...rest } = doc;
  return rest;
}

function sortedByIsoField(docs, field) {
  return [...docs].sort((left, right) => {
    const leftDate = Date.parse(left[field] || '') || 0;
    const rightDate = Date.parse(right[field] || '') || 0;
    if (rightDate !== leftDate) return rightDate - leftDate;
    return String(right.id ?? '').localeCompare(String(left.id ?? ''));
  });
}

function mergeById(dbDocs, localDocs) {
  const byId = new Map(dbDocs.map((doc) => [doc.id, doc]));
  for (const local of localDocs) {
    if (local?.id && !byId.has(local.id)) byId.set(local.id, local);
  }
  return Array.from(byId.values());
}

/**
 * The Firestore transcript stores turns without the mock's `at` stamp, so a
 * remote-empty read must not mask turns that only exist locally. A remote
 * transcript with any turns wins (remote is the durable copy); empty means
 * "seen nothing" and defers to the local copy.
 */
function mergeTranscripts(remoteTurns, localTurns) {
  if (remoteTurns.length || !localTurns.length) return remoteTurns;
  return localTurns;
}

export async function createFirebaseLearnerStore({
  fallbackStore = createMockLearnerStore(),
  dataStore = null,
  storage = defaultStorage(),
  log = console,
} = {}) {
  if (!fallbackStore || typeof fallbackStore.putAssessment !== 'function') {
    throw new Error('A fallback Learner store is required');
  }
  // An injected dataStore is trusted (unit tests hand in a fake; no CDN
  // roundtrip to avoid). The real module only engages once a signed-in
  // Firebase Auth identity exists, so the signed-out page never attempts a
  // read the rules would deny anyway.
  let authGated = false;
  if (!dataStore) {
    authGated = true;
    try {
      dataStore = await import('./firebase-data-store.js');
    } catch (_error) {
      dataStore = null;
    }
  }

  let db = dataStore;

  async function tryDb(run, action) {
    if (!db) return DB_UNAVAILABLE;
    if (authGated && !(await authenticatedAuth())) return DB_UNAVAILABLE;
    try {
      return await run();
    } catch (error) {
      log?.warn?.(`[Firebase Learner store] ${action} failed; using the local store.`, error);
      return DB_UNAVAILABLE;
    }
  }

  function clearedAtKey(learnerId) {
    return `${MARKER_PREFIX}${encodeURIComponent(learnerId)}`;
  }

  function getClearedAt(learnerId) {
    try {
      return storage.getItem(clearedAtKey(learnerId));
    } catch (_error) {
      return null;
    }
  }

  function setClearedAt(learnerId) {
    try {
      storage.setItem(clearedAtKey(learnerId), new Date().toISOString());
    } catch (_error) {
      // Session-scoped storage (or none): the clear then only lasts this run.
    }
  }

  function filterCleared(turns, learnerId) {
    const cleared = Date.parse(getClearedAt(learnerId) || '');
    if (!cleared) return turns;
    return turns.filter((turn) => (Date.parse(turn?.at || '') || 0) >= cleared);
  }

  const store = {
    async putAssessment(learnerId, assessment) {
      const id = assertLearnerId(learnerId);
      // The mock is the validation contract: shape invariants, immutable ids,
      // and the Concept-tag bridge (core/validate.js) run before any write.
      const stored = await fallbackStore.putAssessment(id, assessment);
      const result = await tryDb(
        () => db.saveAssessment(id, JSON.parse(JSON.stringify(stored))),
        'Assessment write',
      );
      if (result === DB_UNAVAILABLE) {
        // The local copy stands in; the next successful write reconciles.
      }
      return stored;
    },

    async getAssessment(learnerId, assessmentId) {
      const id = assertLearnerId(learnerId);
      if (!assessmentId) return null;
      const remote = await tryDb(
        () => db.getAssessment(id, assessmentId),
        'Assessment read',
      );
      if (remote !== DB_UNAVAILABLE) {
        if (remote) return freeze(JSON.parse(JSON.stringify(remote)));
        // Not in Firestore — it may exist only in the local store.
      }
      return fallbackStore.getAssessment(id, assessmentId);
    },

    async listAssessments(learnerId, { type } = {}) {
      const id = assertLearnerId(learnerId);
      const remote = await tryDb(() => db.listAssessments(id, { type }), 'Assessments read');
      if (remote === DB_UNAVAILABLE) return fallbackStore.listAssessments(id, { type });

      const local = await fallbackStore.listAssessments(id, { type });
      const merged = mergeById(remote, local).filter(
        (assessment) => !type || assessment.type === type,
      );
      return sortedByIsoField(merged, 'generated_at').map(freeze);
    },

    async saveAttempt(learnerId, attempt) {
      const id = assertLearnerId(learnerId);
      if (!attempt || typeof attempt !== 'object') throw new Error('Attempt must be an object');
      if (attempt.learner_id !== id) {
        throw new Error('Attempt learner_id does not match the store Learner');
      }
      if (
        ['id', 'assessment_id', 'started_at'].some((field) => attempt[field] === undefined || attempt[field] === null) ||
        !Array.isArray(attempt.responses) ||
        !Array.isArray(attempt.scores)
      ) {
        throw new Error('Attempt is not in the app-written shape');
      }
      const payload = JSON.parse(JSON.stringify(attempt));

      // Append-only across both stores: an identical retry is fine, a changed
      // payload is not. Checked before any write so the guard is observable.
      const [remoteExisting, localExisting] = await Promise.all([
        tryDb(() => db.getAttempt(id, attempt.id), 'Attempt read'),
        fallbackStore.getAttempt(id, attempt.id).catch(() => null),
      ]);
      for (const existing of [remoteExisting, localExisting]) {
        if (existing && existing !== DB_UNAVAILABLE &&
            !sameValue(appFieldsOf(existing), appFieldsOf(payload))) {
          throw new Error(`Attempt ${attempt.id} is append-only and cannot be replaced`);
        }
      }

      await tryDb(() => db.saveAttempt(id, payload), 'Attempt write');

      // Mirror to the local store, seeding the Assessment it joins to (the
      // mock rejects an Attempt for an Assessment it has not seen), so the
      // offline Gap Map derivation keeps working after an outage.
      try {
        if (!(await fallbackStore.getAssessment(id, attempt.assessment_id))) {
          const assessment = await this.getAssessment(id, attempt.assessment_id);
          if (assessment) await fallbackStore.putAssessment(id, JSON.parse(JSON.stringify(assessment)));
        }
        await fallbackStore.saveAttempt(id, JSON.parse(JSON.stringify(attempt)));
      } catch (error) {
        log?.warn?.('[Firebase Learner store] Local Attempt mirror skipped.', error);
      }
      return freeze(JSON.parse(JSON.stringify(attempt)));
    },

    async getAttempt(learnerId, attemptOrAssessmentId) {
      const id = assertLearnerId(learnerId);
      if (!attemptOrAssessmentId) return null;
      const remote = await tryDb(() => db.getAttempt(id, attemptOrAssessmentId), 'Attempt read');
      if (remote !== DB_UNAVAILABLE && remote) {
        return freeze(JSON.parse(JSON.stringify(remote)));
      }
      const all = await this.listAttempts(id);
      return (
        all.find((attempt) => attempt.id === attemptOrAssessmentId) ||
        all.find((attempt) => attempt.assessment_id === attemptOrAssessmentId) ||
        null
      );
    },

    async listAttempts(learnerId) {
      const id = assertLearnerId(learnerId);
      const remote = await tryDb(() => db.listAttempts(id), 'Attempt reads');
      if (remote === DB_UNAVAILABLE) return fallbackStore.listAttempts(id);

      const local = await fallbackStore.listAttempts(id);
      return sortedByIsoField(mergeById(remote, local), 'started_at');
    },

    async getTranscript(learnerId) {
      const id = assertLearnerId(learnerId);
      const remote = await tryDb(() => db.listCompanionMessages(id), 'Transcript read');
      if (remote === DB_UNAVAILABLE) {
        return filterCleared(await fallbackStore.getTranscript(id), id);
      }
      return filterCleared(mergeTranscripts(remote, await fallbackStore.getTranscript(id)), id);
    },

    async appendTranscript(learnerId, turn) {
      const id = assertLearnerId(learnerId);
      if (!turn || !['user', 'assistant'].includes(turn.role)) {
        throw new Error('Transcript turn role must be user or assistant');
      }
      if (typeof turn.content !== 'string' || turn.content.trim() === '') {
        throw new Error('Transcript turn content must be a non-empty string');
      }
      const stored = {
        role: turn.role,
        content: turn.content,
        at: turn.at || new Date().toISOString(),
      };

      await tryDb(
        () => db.saveCompanionMessage(id, JSON.parse(JSON.stringify(stored))),
        'Transcript write',
      );
      try {
        await fallbackStore.appendTranscript(id, JSON.parse(JSON.stringify(stored)));
      } catch (error) {
        log?.warn?.('[Firebase Learner store] Local transcript mirror skipped.', error);
      }
      return this.getTranscript(id);
    },

    async clearTranscript(learnerId) {
      const id = assertLearnerId(learnerId);
      // The Firestore transcript is append-only by rule; the clear is local:
      // a marker hides everything before "now" from replay on this browser.
      setClearedAt(id);
      try {
        await fallbackStore.clearTranscript(id);
      } catch (error) {
        log?.warn?.('[Firebase Learner store] Local transcript clear skipped.', error);
      }
      return this.getTranscript(id);
    },

    async getContext(learnerId) {
      const id = assertLearnerId(learnerId);
      const [assessments, attempts] = await Promise.all([
        this.listAssessments(id),
        this.listAttempts(id),
      ]);
      const gapMap = scoresFromAttempts(assessments, attempts);
      return {
        learnerId: id,
        gapMap,
        learningPath: gapMap
          .filter((entry) => entry.status !== 'strong')
          .map((entry) => entry.concept),
        assessments: JSON.parse(JSON.stringify(assessments)),
        attempts: JSON.parse(JSON.stringify(attempts)),
        transcript: await this.getTranscript(id),
      };
    },
  };

  function scoresFromAttempts(assessments, attempts) {
    const latestByConcept = new Map();
    sortedByIsoField(attempts, 'started_at').forEach((attempt) => {
      scoresForAttempt(assessments, attempt).forEach((conceptScore) => {
        if (!latestByConcept.has(conceptScore.concept)) {
          latestByConcept.set(conceptScore.concept, JSON.parse(JSON.stringify(conceptScore)));
        }
      });
    });

    return Array.from(latestByConcept.values()).sort((left, right) => {
      const statusOrder = { weak: 0, improve: 1, strong: 2 };
      const byStatus = (statusOrder[left.status] ?? 3) - (statusOrder[right.status] ?? 3);
      if (byStatus !== 0) return byStatus;
      if (left.pct !== right.pct) return left.pct - right.pct;
      return left.concept.localeCompare(right.concept);
    });
  }

  function scoresForAttempt(assessments, attempt) {
    if (attempt.scores?.length) return attempt.scores;
    const assessment = assessments.find((entry) => entry.id === attempt.assessment_id);
    if (!assessment) return [];
    const responses = new Map((attempt.responses || []).map((response) => [response.item_id, response]));
    const answers = (assessment.items || []).map((item) => responses.get(item.id)?.answer ?? null);
    return rollupScores(assessment, answers).scores;
  }

  return store;
}

function defaultStorage() {
  try {
    if (globalThis.localStorage) {
      const probe = '__gapmap_fb_store_probe__';
      globalThis.localStorage.setItem(probe, '1');
      globalThis.localStorage.removeItem(probe);
      return globalThis.localStorage;
    }
  } catch (_error) {
    // Restricted frames: the clear marker then lives for this run only.
  }
  const values = new Map();
  return {
    getItem: (key) => (values.has(String(key)) ? values.get(String(key)) : null),
    setItem: (key, value) => {
      values.set(String(key), String(value));
    },
    removeItem: (key) => {
      values.delete(String(key));
    },
  };
}
