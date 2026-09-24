import { score } from '../../core/scoring.js';
import { validateAssessment } from '../../core/validate.js';

const STORE_VERSION = 1;
const DEFAULT_NAMESPACE = 'gapmap.learner';
const DEFAULT_LEARNER_ID = 'learner-001';

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function defaultStorage() {
  try {
    if (globalThis.localStorage) {
      const probe = '__gapmap_storage_probe__';
      globalThis.localStorage.setItem(probe, '1');
      globalThis.localStorage.removeItem(probe);
      return globalThis.localStorage;
    }
  } catch (_error) {
    // Private browsing and restricted frames can expose localStorage but reject
    // writes. Fall through to the process-local store in that case.
  }

  return createMemoryStorage();
}

export function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(String(key));
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

function assertLearnerId(learnerId) {
  if (typeof learnerId !== 'string' || learnerId.trim() === '') {
    throw new Error('learnerId must be a non-empty string');
  }
  return learnerId.trim();
}

function assertAssessmentPersistenceShape(assessment) {
  if (!assessment || typeof assessment !== 'object') {
    throw new Error('Assessment must be an object');
  }

  const required = [
    'id',
    'type',
    'subject',
    'language',
    'explanation_level',
    'concepts',
    'items',
    'generated_at',
  ];

  required.forEach((field) => {
    if (assessment[field] === undefined || assessment[field] === null) {
      throw new Error(`Assessment is missing ${field}`);
    }
  });

  if (!/^[a-z0-9-]+$/.test(assessment.id)) {
    throw new Error('Assessment id must contain lowercase letters, numbers, and hyphens');
  }

  if (!['diagnostic', 'practice'].includes(assessment.type)) {
    throw new Error(`Unsupported Assessment type: ${assessment.type}`);
  }

  if (!Array.isArray(assessment.concepts) || assessment.concepts.length === 0) {
    throw new Error('Assessment must declare at least one Concept');
  }

  if (!Array.isArray(assessment.items) || assessment.items.length === 0) {
    throw new Error('Assessment must contain at least one Item');
  }

  assessment.items.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Assessment Item ${index + 1} must be an object`);
    }
    if (typeof item.id !== 'string' || item.id === '') {
      throw new Error(`Assessment Item ${index + 1} is missing an id`);
    }
    if (typeof item.concept !== 'string' || item.concept === '') {
      throw new Error(`Assessment Item ${item.id} is missing its Concept`);
    }
  });
}

function validateAssessmentForPersistence(assessment) {
  assertAssessmentPersistenceShape(assessment);
  return validateAssessment(assessment);
}

function assertAttemptPersistenceShape(learnerId, attempt) {
  if (!attempt || typeof attempt !== 'object') {
    throw new Error('Attempt must be an object');
  }

  ['id', 'assessment_id', 'learner_id', 'started_at', 'responses', 'scores'].forEach(
    (field) => {
      if (attempt[field] === undefined || attempt[field] === null) {
        throw new Error(`Attempt is missing ${field}`);
      }
    },
  );

  if (attempt.learner_id !== learnerId) {
    throw new Error('Attempt learner_id does not match the store Learner');
  }
  if (!Array.isArray(attempt.responses) || !Array.isArray(attempt.scores)) {
    throw new Error('Attempt responses and scores must be arrays');
  }
}

function emptyRecord(learnerId) {
  return {
    version: STORE_VERSION,
    learner_id: learnerId,
    assessments: {},
    attempts: {},
    transcript: [],
  };
}

function recordKey(namespace, learnerId) {
  return `${namespace}.${encodeURIComponent(learnerId)}`;
}

function readRecord(storage, key, learnerId) {
  const raw = storage.getItem(key);
  if (!raw) return emptyRecord(learnerId);

  try {
    const record = JSON.parse(raw);
    if (
      record.version !== STORE_VERSION ||
      record.learner_id !== learnerId ||
      !record.assessments ||
      !record.attempts ||
      !Array.isArray(record.transcript)
    ) {
      return emptyRecord(learnerId);
    }
    return record;
  } catch (_error) {
    return emptyRecord(learnerId);
  }
}

function writeRecord(storage, key, record) {
  storage.setItem(key, JSON.stringify(record));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sortedByDate(records, dateField) {
  return records.sort((left, right) => {
    const leftDate = Date.parse(left[dateField] || '') || 0;
    const rightDate = Date.parse(right[dateField] || '') || 0;
    if (rightDate !== leftDate) return rightDate - leftDate;
    return String(right.id).localeCompare(String(left.id));
  });
}

function scoresForAttempt(record, attempt) {
  if (attempt.scores?.length) return attempt.scores;

  const assessment = record.assessments[attempt.assessment_id];
  if (!assessment) return [];

  const responses = new Map((attempt.responses || []).map((response) => [response.item_id, response]));
  const answers = assessment.items.map((item) => responses.get(item.id)?.answer ?? null);
  return score(assessment, answers).scores;
}

function scoresFromAttempts(record, attempts) {
  const latestByConcept = new Map();
  sortedByDate([...attempts], 'completed_at').forEach((attempt) => {
    scoresForAttempt(record, attempt).forEach((conceptScore) => {
      if (!latestByConcept.has(conceptScore.concept)) {
        latestByConcept.set(conceptScore.concept, clone(conceptScore));
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

function learnerContext(record) {
  const assessments = Object.values(record.assessments).map(clone);
  const attempts = sortedByDate(Object.values(record.attempts).map(clone), 'started_at');
  const gapMap = scoresFromAttempts(record, attempts);

  return {
    learnerId: record.learner_id,
    gapMap,
    learningPath: gapMap
      .filter((conceptScore) => conceptScore.status !== 'strong')
      .map((conceptScore) => conceptScore.concept),
    assessments,
    attempts,
    transcript: record.transcript.map(clone),
  };
}

export function createMockLearnerStore({
  storage = defaultStorage(),
  namespace = DEFAULT_NAMESPACE,
} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new Error('A storage object with getItem and setItem is required');
  }

  function withRecord(learnerId, callback) {
    const normalizedLearnerId = assertLearnerId(learnerId);
    const key = recordKey(namespace, normalizedLearnerId);
    const record = readRecord(storage, key, normalizedLearnerId);
    return callback(record, key, normalizedLearnerId);
  }

  return {
    async putAssessment(learnerId, assessment) {
      return withRecord(learnerId, (record, key, normalizedLearnerId) => {
        validateAssessmentForPersistence(assessment);
        const stored = clone(assessment);
        const existing = record.assessments[stored.id];

        if (existing && !sameValue(existing, stored)) {
          throw new Error(`Assessment ${stored.id} is frozen and cannot be replaced`);
        }

        if (!existing) {
          record.assessments[stored.id] = stored;
          writeRecord(storage, key, record);
        }

        return freeze(clone(record.assessments[stored.id]));
      });
    },

    async getAssessment(learnerId, assessmentId) {
      return withRecord(learnerId, (record) => {
        const assessment = record.assessments[assessmentId];
        return assessment ? freeze(clone(assessment)) : null;
      });
    },

    async listAssessments(learnerId, { type } = {}) {
      return withRecord(learnerId, (record) => {
        const assessments = Object.values(record.assessments)
          .filter((assessment) => !type || assessment.type === type)
          .map(clone);
        return sortedByDate(assessments, 'generated_at').map(freeze);
      });
    },

    async saveAttempt(learnerId, attempt) {
      return withRecord(learnerId, (record, key, normalizedLearnerId) => {
        assertAttemptPersistenceShape(normalizedLearnerId, attempt);
        if (!record.assessments[attempt.assessment_id]) {
          throw new Error(`Cannot save Attempt for unknown Assessment ${attempt.assessment_id}`);
        }

        const stored = clone(attempt);
        const existing = record.attempts[stored.id];
        if (existing && !sameValue(existing, stored)) {
          throw new Error(`Attempt ${stored.id} is append-only and cannot be replaced`);
        }

        if (!existing) {
          record.attempts[stored.id] = stored;
          writeRecord(storage, key, record);
        }

        return freeze(clone(record.attempts[stored.id]));
      });
    },

    async getAttempt(learnerId, attemptOrAssessmentId) {
      return withRecord(learnerId, (record) => {
        const direct = record.attempts[attemptOrAssessmentId];
        if (direct) return freeze(clone(direct));

        const matching = sortedByDate(
          Object.values(record.attempts).filter(
            (attempt) => attempt.assessment_id === attemptOrAssessmentId,
          ),
          'started_at',
        )[0];
        return matching ? freeze(clone(matching)) : null;
      });
    },

    async listAttempts(learnerId) {
      return withRecord(learnerId, (record) =>
        sortedByDate(Object.values(record.attempts).map(clone), 'started_at').map(freeze),
      );
    },

    async getTranscript(learnerId) {
      return withRecord(learnerId, (record) => record.transcript.map(clone));
    },

    async appendTranscript(learnerId, turn) {
      return withRecord(learnerId, (record, key) => {
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
        record.transcript.push(stored);
        writeRecord(storage, key, record);
        return record.transcript.map(clone);
      });
    },

    async clearTranscript(learnerId) {
      return withRecord(learnerId, (record, key) => {
        record.transcript = [];
        writeRecord(storage, key, record);
        return [];
      });
    },

    async getContext(learnerId) {
      return withRecord(learnerId, (record) => learnerContext(record));
    },
  };
}

const fallbackStorage = defaultStorage();
export const learnerStore = createMockLearnerStore({ storage: fallbackStorage });

function demoUser(storage) {
  try {
    const raw = storage.getItem('gapmap_user');
    if (raw) return JSON.parse(raw);
  } catch (_error) {}

  // The real app keeps its authentication snapshot in sessionStorage so a
  // fresh run cannot inherit the previous Learner. Keep the offline/mock seam
  // compatible with that session-scoped identity as well.
  try {
    const rawSession = globalThis.sessionStorage?.getItem('gapmap_user');
    return rawSession ? JSON.parse(rawSession) : null;
  } catch (_error) {
    return null;
  }
}

function stableDemoId(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `demo-${(hash >>> 0).toString(36)}`;
}

export function getCurrentLearner({
  auth = globalThis.auth,
  getCurrentUser = globalThis.getCurrentUser,
  storage = defaultStorage(),
} = {}) {
  let firebaseUser = null;
  try {
    firebaseUser = auth?.currentUser ||
      (typeof getCurrentUser === 'function' ? getCurrentUser() : null) ||
      null;
  } catch (_error) {
    // A missing or unavailable app Auth instance should not disable the
    // key-free demo; the local Learner fallback below remains usable.
  }
  if (firebaseUser?.uid) {
    return { learnerId: firebaseUser.uid, source: 'firebase-auth', user: firebaseUser };
  }

  const localUser = demoUser(storage);
  // The Learner Profile owns the demo identity: signup mints `uid` onto it and
  // the Learner store joins the Learner's data by it. Profiles created before
  // minting carry no uid and fall through to the email hash below.
  if (localUser?.uid || localUser?.id) {
    return {
      learnerId: localUser.uid || localUser.id,
      source: 'demo-auth',
      user: localUser,
    };
  }
  if (localUser?.email) {
    return {
      learnerId: stableDemoId(localUser.email.toLowerCase()),
      source: 'demo-email',
      user: localUser,
    };
  }

  return { learnerId: DEFAULT_LEARNER_ID, source: 'demo-default', user: null };
}

export function getCurrentLearnerId(options = {}) {
  return getCurrentLearner(options).learnerId;
}

export { STORE_VERSION };
