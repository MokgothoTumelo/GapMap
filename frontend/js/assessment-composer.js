import { learnerStore as defaultStore } from './learner-store.js';
import { validateAssessment } from '../../core/validate.js';

// The platform composes Practice from the pool the AI generated: the
// Companion (or any generator) authors Assessment artefacts into the Learner's
// store; this module cherry-picks Items for one Concept across that pool,
// randomizes deterministically, and freezes the result as a new Practice
// artefact. No AI at practice time — selection is data-driven (which Concepts
// matter, which Items the Learner has already seen) and reproducible.

const PRACTICE_MIN_ITEMS = 3;
const PRACTICE_MAX_ITEMS = 5;

function normalisePrompt(prompt) {
  return String(prompt || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Deterministic small PRNG (mulberry32) so the same pool + seen state yields
// the same composition on every visit.
function seedToRandom(seed) {
  let h = 1779033703 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    h = Math.imul(h ^ seed.charCodeAt(index), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function random() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function seededShuffle(values, seed) {
  const random = seedToRandom(seed);
  const shuffled = values.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}

/**
 * Cherry-picks Items for one Concept across the Learner's stored assessments
 * (the pool the AI generated) and freezes the selection as a Practice
 * artefact. Item ids are renumbered q1..qN to stay inside the schema's Item
 * contract; provenance is returned alongside (assessment id per selected
 * Item) without entering the artefact.
 *
 * Returns null when the pool cannot supply PRACTICE_MIN_ITEMS unique Items
 * for the Concept — callers fall back to their own content.
 *
 * pool:    Assessments from store.listAssessments (frozen clones).
 * seen:    Normalized prompts the Learner has already attempted — those Items
 *          are excluded from the fresh Practice composition.
 */
export function composePractice({
  assessments = [],
  seenPrompts = [],
  targetConcept,
  itemCount = PRACTICE_MAX_ITEMS,
  seed = '',
  grade = '',
} = {}) {
  if (!targetConcept) throw new Error('composePractice requires targetConcept');

  const seen = new Set(seenPrompts.map(normalisePrompt));
  const candidates = [];
  const knownPrompts = new Set();

  for (const assessment of assessments) {
    for (const item of assessment.items || []) {
      if (item.concept !== targetConcept) continue;
      const prompt = normalisePrompt(item.prompt);
      if (knownPrompts.has(prompt)) continue;
      knownPrompts.add(prompt);
      if (seen.has(prompt)) continue;
      candidates.push({
        item,
        assessmentId: assessment.id,
        subject: assessment.subject,
        language: assessment.language,
        explanationLevel: assessment.explanation_level,
      });
    }
  }

  const count = Math.min(itemCount || PRACTICE_MAX_ITEMS, PRACTICE_MAX_ITEMS, candidates.length);
  if (count < PRACTICE_MIN_ITEMS) return null;

  // Only unseen Items are eligible. If the pool cannot supply enough fresh
  // Items, the caller generates presentation-level variants instead of
  // repeating an exact prompt/options pair.
  const selected = seededShuffle(
    candidates,
    `${seed}|${targetConcept}|unseen`,
  ).slice(0, count);

  const first = selected[0];
  const assessment = {
    id: `practice-${targetConcept.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
    type: 'practice',
    subject: first.subject || 'General',
    language: first.language || 'en',
    explanation_level: first.explanationLevel || 'Standard',
    concepts: [{ name: targetConcept }],
    items: selected.map((candidate, index) => ({
      ...candidate.item,
      id: `q${index + 1}`,
    })),
    generated_at: new Date().toISOString(),
    generated_by: 'assessment-composer',
    schema_version: '1.0.0',
  };
  validateAssessment(assessment);

  return {
    assessment,
    sources: selected.map((candidate) => candidate.assessmentId),
  };
}

/**
 * Service shape: resolves the Practice a Learner should take for a Concept.
 * Reuses any unattempted Practice already in the pool for that Concept (one
 * the Companion generated, or a previous composition) instead of stacking
 * duplicates; composes and persists a fresh one otherwise. Returns null when
 * the pool cannot supply a Practice.
 */
export async function ensureComposedPracticeForLearner({
  learnerId,
  targetConcept,
  itemCount = PRACTICE_MAX_ITEMS,
  store = defaultStore,
  extraSeenPrompts = [],
  seed = '',
  grade = '',
} = {}) {
  if (!store || typeof store.listAssessments !== 'function') {
    throw new Error('A Learner store with listAssessments is required');
  }

  let assessments = await store.listAssessments(learnerId);
  if (grade) {
    const prefix = `Grade ${String(grade).trim()}`.toLowerCase();
    const gradeMatched = assessments.filter((assessment) => String(assessment.subject || '').toLowerCase().startsWith(prefix));
    if (gradeMatched.length) assessments = gradeMatched;
  }
  const attempts = await store.listAttempts(learnerId);

  // Always compose a fresh practice set. Reusing an unattempted set caused
  // refresh/restart to show the same questions repeatedly.
  const seenPrompts = Array.isArray(extraSeenPrompts) ? extraSeenPrompts.slice() : [];
  const seenPromptsSet = new Set(seenPrompts.map(normalisePrompt));
  for (const attempt of attempts) {
    const source = assessments.find((a) => a.id === attempt.assessment_id);
    for (const item of source?.items || []) {
      const prompt = normalisePrompt(item.prompt);
      if (!seenPromptsSet.has(prompt)) {
        seenPromptsSet.add(prompt);
        seenPrompts.push(prompt);
      }
    }
  }

  const composed = composePractice({
    assessments,
    seenPrompts,
    targetConcept,
    itemCount,
    seed: `${learnerId}|${seed || Date.now().toString(36)}|${Math.random().toString(36).slice(2)}`,
  });
  if (!composed) return null;

  const stored = await store.putAssessment(learnerId, composed.assessment);
  return { assessment: stored, reused: false, sources: composed.sources };
}