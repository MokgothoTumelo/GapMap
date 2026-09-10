// Cross-field semantic validation of an assessment artefact — the checks the
// JSON Schemas (core/schema/) cannot express: the Concept-tag bridge
// (item.concept ∈ concepts[].name), wrong-explanation sanity, and the retest
// target match. Structural/type validation is the schemas' job, enforced by
// ajv at the LLM boundary (see tests/validate.spec.js and, when wired, the
// agent service).
//
// Pure, runtime-agnostic: no DOM, no fetch, no Node, no deps. Shared by the
// browser client and the agent service. Defensive about missing fields —
// structure is ajv's responsibility, not this layer's.

function fail(message) {
  throw new Error('Invalid assessment: ' + message);
}

export function validateAssessment(assessment) {
  if (!assessment || typeof assessment !== 'object') fail('expected an object');

  const concepts = new Set((assessment.concepts || []).map((c) => c && c.name));

  (assessment.items || []).forEach((item) => {
    const id = item && item.id ? item.id : 'item';
    if (item.concept != null && !concepts.has(item.concept)) {
      fail(id + ' refers to an unknown concept');
    }
    const explanations = item.wrong_explanations || [];
    const seen = new Set();
    explanations.forEach((entry) => {
      if (entry.answer === item.correct) {
        fail(id + ' explains the correct answer as wrong');
      }
      if (seen.has(entry.answer)) {
        fail(id + ' has duplicate wrong explanations');
      }
      seen.add(entry.answer);
    });
  });

  if (assessment.type === 'retest') {
    const firstConcept = (assessment.concepts || [])[0];
    if (assessment.target && firstConcept &&
        assessment.target.concept !== firstConcept.name) {
      fail('retest target must match its concept');
    }
  }

  return assessment;
}