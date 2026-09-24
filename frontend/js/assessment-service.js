import { learnerStore as defaultStore } from './learner-store.js';
import { generateAssessment as defaultGenerator } from './assessment-generator.js';

function assertLearnerId(learnerId) {
  if (typeof learnerId !== 'string' || learnerId.trim() === '') {
    throw new Error('learnerId must be a non-empty string');
  }
  return learnerId.trim();
}

// The service composes generation and storage without merging their
// responsibilities. A model-backed generator can be injected in production;
// the local deterministic generator is the default for the demo and tests.
export async function createAssessmentForLearner({
  learnerId,
  request,
  store = defaultStore,
  generator = defaultGenerator,
} = {}) {
  const id = assertLearnerId(learnerId);
  if (!store || typeof store.putAssessment !== 'function') {
    throw new Error('A Learner store with putAssessment is required');
  }
  if (typeof generator !== 'function') {
    throw new Error('An Assessment generator function is required');
  }

  const assessment = await generator(request);
  return store.putAssessment(id, assessment);
}

export async function retrieveAssessmentsForLearner({
  learnerId,
  type,
  store = defaultStore,
} = {}) {
  const id = assertLearnerId(learnerId);
  if (!store || typeof store.listAssessments !== 'function') {
    throw new Error('A Learner store with listAssessments is required');
  }

  return store.listAssessments(id, type ? { type } : {});
}

export async function retrieveAssessmentForLearner({
  learnerId,
  assessmentId,
  store = defaultStore,
} = {}) {
  const id = assertLearnerId(learnerId);
  if (!assessmentId) throw new Error('assessmentId is required');
  if (!store || typeof store.getAssessment !== 'function') {
    throw new Error('A Learner store with getAssessment is required');
  }

  return store.getAssessment(id, assessmentId);
}
