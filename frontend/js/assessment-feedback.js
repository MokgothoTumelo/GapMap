// Answer-specific explanation lookup for immediate feedback and
// agent-generated guidance. Pure, runtime-agnostic.

export function explanationForAnswer(item, answer) {
  if (answer === item.correct) return item.correct_explanation || '';
  const match = (item.wrong_explanations || []).find((entry) => entry.answer === answer);
  return match ? match.explanation : '';
}