// Cross-field semantic validation of an assessment artefact — the checks the
// JSON Schemas (core/schema/) cannot express: the Concept-tag bridge
// (item.concept ∈ concepts[].name) and wrong-explanation sanity. Structural
// type validation is the schemas' job, enforced by
// ajv at the LLM boundary (see tests/validate.spec.js and, when wired, the
// agent service).
//
// Also: the Concept Graph's semantic checks (ADR-0006) — edge endpoints must
// exist, no cycles, no self-edges — the checks concept-graph.schema.json
// cannot express.
//
// Pure, runtime-agnostic: no DOM, no fetch, no Node, no deps. Shared by the
// browser client and the agent service. Defensive about missing fields —
// structure is ajv's responsibility, not this layer's.

function fail(message) {
  throw new Error('Invalid assessment: ' + message);
}

function failGraph(message) {
  throw new Error('Invalid concept graph: ' + message);
}

const MISTAKE_KINDS = new Set(['misread', 'procedure', 'concept', 'prerequisite']);

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
      // Mistake-Diagnosis kind (ADR-0006): a prerequisite kind must name the
      // blocking Concept; unknown kinds are rejected outright.
      if (entry.kind != null) {
        if (!MISTAKE_KINDS.has(entry.kind)) {
          fail(id + ' has an unknown Mistake Diagnosis kind: ' + entry.kind);
        }
        if (entry.kind === 'prerequisite' && !entry.prerequisite) {
          fail(id + ' has a prerequisite Mistake Diagnosis without a prerequisite Concept');
        }
      }
    });
  });

  return assessment;
}

// The Concept Graph's cross-field checks: every edge endpoint is a node, no
// self-edges, and no prerequisite cycles — a cycle would make the Learning
// Path's topological ordering undefined.
export function validateConceptGraph(graph) {
  if (!graph || typeof graph !== 'object') failGraph('expected an object');

  const nodes = new Set((graph.nodes || []).map((node) => node && node.concept));

  (graph.edges || []).forEach((edge) => {
    if (!nodes.has(edge.requires)) {
      failGraph('edge requires an unknown Concept: ' + edge.requires);
    }
    if (!nodes.has(edge.for)) {
      failGraph('edge for an unknown Concept: ' + edge.for);
    }
    if (edge.requires === edge.for) {
      failGraph('self-edge on Concept: ' + edge.for);
    }
  });

  const prerequisitesOf = new Map();
  (graph.edges || []).forEach((edge) => {
    if (!prerequisitesOf.has(edge.for)) prerequisitesOf.set(edge.for, []);
    prerequisitesOf.get(edge.for).push(edge.requires);
  });

  const state = new Map(); // node → 'visiting' | 'done'
  function visit(node, trail) {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'visiting') {
      failGraph('prerequisite cycle: ' + [...trail, node].join(' → '));
    }
    state.set(node, 'visiting');
    (prerequisitesOf.get(node) || []).forEach((prerequisite) =>
      visit(prerequisite, [...trail, node]),
    );
    state.set(node, 'done');
  }
  Array.from(nodes).forEach((node) => visit(node, []));

  return graph;
}