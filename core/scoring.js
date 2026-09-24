// Per-Concept rollup → Gap Map. Pure, runtime-agnostic: no DOM, no fetch, no
// Node. Imported by the browser client and the Companion tooling.
// Status thresholds are app policy (see core/README.md) — this module is the
// ONLY place they live; no page hand-rolls a percentage or a status.

const STRONG_PCT = 80;
const IMPROVE_PCT = 50;

export function statusFor(pct) {
  if (pct >= STRONG_PCT) return 'strong';
  if (pct >= IMPROVE_PCT) return 'improve';
  return 'weak';
}

function rollup(items, correctFlags) {
  const byConcept = {};
  items.forEach((item, index) => {
    if (!byConcept[item.concept]) byConcept[item.concept] = { correct: 0, total: 0 };
    byConcept[item.concept].total += 1;
    if (correctFlags[index]) byConcept[item.concept].correct += 1;
  });

  const scores = Object.keys(byConcept).map((concept) => {
    const result = byConcept[concept];
    const pct = Math.round((result.correct / result.total) * 100);
    return { concept, correct: result.correct, total: result.total, pct, status: statusFor(pct) };
  });
  const totalQuestions = items.length;
  const totalCorrect = scores.reduce((sum, result) => sum + result.correct, 0);

  return {
    overall_pct: totalQuestions ? Math.round((totalCorrect / totalQuestions) * 100) : 0,
    total_correct: totalCorrect,
    total_questions: totalQuestions,
    scores,
  };
}

/**
 * The rollup when per-Item correctness is already known — written answers are
 * matched against accepted variants before rolling up, so pages hand over
 * flags instead of re-deriving percentages by hand. Every Score and Mastery
 * classification in the product comes from here (core/scoring.js is the only
 * correct one).
 */
export function scoreFromFlags(items, correctFlags) {
  return rollup(items || [], correctFlags || []);
}

export function score(assessment, answers) {
  return scoreFromFlags(
    assessment.items,
    (assessment.items || []).map(
      (item, index) =>
        answers[index] !== null && answers[index] !== undefined && answers[index] === item.correct,
    ),
  );
}