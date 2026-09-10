// Per-Concept rollup → Gap Map. Pure, runtime-agnostic: no DOM, no fetch, no
// Node. Imported by the browser client and (planned) the agent service.
// Status thresholds are app policy (see core/README.md).

const STRONG_PCT = 80;
const IMPROVE_PCT = 50;

export function statusFor(pct) {
  if (pct >= STRONG_PCT) return 'strong';
  if (pct >= IMPROVE_PCT) return 'improve';
  return 'weak';
}

export function score(assessment, answers) {
  const byConcept = {};
  assessment.items.forEach((item, index) => {
    if (!byConcept[item.concept]) byConcept[item.concept] = { correct: 0, total: 0 };
    byConcept[item.concept].total += 1;
    if (answers[index] !== null && answers[index] !== undefined && answers[index] === item.correct) {
      byConcept[item.concept].correct += 1;
    }
  });

  const scores = Object.keys(byConcept).map((concept) => {
    const result = byConcept[concept];
    const pct = Math.round((result.correct / result.total) * 100);
    return { concept, correct: result.correct, total: result.total, pct, status: statusFor(pct) };
  });
  const totalQuestions = assessment.items.length;
  const totalCorrect = scores.reduce((sum, result) => sum + result.correct, 0);

  return {
    overall_pct: totalQuestions ? Math.round((totalCorrect / totalQuestions) * 100) : 0,
    total_correct: totalCorrect,
    total_questions: totalQuestions,
    scores,
  };
}