// The Learning Path as a pure derivation (ADR-0006): Concept Graph + Gap Map
// → topologically ordered Concepts, roots first, severity as tie-break, each
// entry carrying the *why* (what it blocks, what blocks it, where it's from).
// Computed on read, never stored as a per-Learner artefact — the same pattern
// as the Gap Map rollup itself. Pure, runtime-agnostic: no DOM, no fetch, no
// Node, no deps.
//
// Graceful degradation is the honesty rule: without a graph the order falls
// back to severity alone; without Mistake-Diagnosis kinds the evidence counts
// are simply absent. The UI says what the data supports and nothing more.

const STATUS_ORDER = { weak: 0, improve: 1, strong: 2 };

function severityKey(entry) {
  return [
    STATUS_ORDER[entry.status] ?? 3,
    entry.pct ?? 0,
    entry.concept,
  ];
}

function bySeverity(left, right) {
  const leftKey = severityKey(left);
  const rightKey = severityKey(right);
  if (leftKey[0] !== rightKey[0]) return leftKey[0] - rightKey[0];
  if (leftKey[1] !== rightKey[1]) return leftKey[1] - rightKey[1];
  return leftKey[2].localeCompare(rightKey[2]);
}

/**
 * Rolls Mistake Diagnoses out of the Learner's Attempts: joins each wrong
 * Response to its Item's wrong_explanations entry (by answer) and buckets the
 * kind per Concept. Pure over the artefacts.
 *
 * @param {Array} assessments  the Learner's stored Assessments (with items)
 * @param {Array} attempts     the Learner's stored Attempts (with responses)
 * @returns {Object} per Concept: { wrong, byKind, prerequisiteFailures }
 */
export function mistakeKindsByConcept(assessments, attempts) {
  const byId = new Map((assessments || []).map((assessment) => [assessment.id, assessment]));
  const rollup = {};

  (attempts || []).forEach((attempt) => {
    const assessment = byId.get(attempt.assessment_id);
    if (!assessment) return;
    const itemById = new Map((assessment.items || []).map((item) => [item.id, item]));

    (attempt.responses || []).forEach((response) => {
      if (response.correct) return;
      const item = itemById.get(response.item_id);
      if (!item) return;
      const entry = (item.wrong_explanations || []).find(
        (candidate) => candidate.answer === response.answer,
      );
      if (!entry || !entry.kind) return;

      const concept = item.concept;
      if (!rollup[concept]) {
        rollup[concept] = { wrong: 0, byKind: {}, prerequisiteFailures: {} };
      }
      const conceptRollup = rollup[concept];
      conceptRollup.wrong += 1;
      conceptRollup.byKind[entry.kind] = (conceptRollup.byKind[entry.kind] || 0) + 1;
      if (entry.kind === 'prerequisite' && entry.prerequisite) {
        conceptRollup.prerequisiteFailures[entry.prerequisite] =
          (conceptRollup.prerequisiteFailures[entry.prerequisite] || 0) + 1;
      }
    });
  });

  return rollup;
}

/**
 * The Learning Path: the Learner's non-strong measured Concepts, ordered
 * roots-first through the Concept Graph's prerequisite edges, severity as
 * tie-break. Without a graph, severity order alone.
 *
 * @param {Object} options
 * @param {Array}  gapMap       [{ concept, pct, status, correct?, total? }]
 * @param {Object|null} graph  a parsed Concept Graph (nodes/edges) or null
 * @param {Object} mistakeKinds output of mistakeKindsByConcept (optional)
 * @returns {{ path: Array, rootCauses: Array }}
 *   path entries: { concept, pct, status, correct?, total?, origin,
 *                   blockedBy, blocks, evidence? }
 *   rootCauses:   path entries with blocks.length > 0, most blocking first.
 */
export function buildLearningPath({ gapMap, graph = null, mistakeKinds = {} } = {}) {
  const toStudy = (gapMap || [])
    .filter((entry) => entry && entry.status !== 'strong')
    .map((entry) => ({ ...entry }));

  if (!toStudy.length) return { path: [], rootCauses: [] };

  const nodes = new Map();
  const prerequisitesByConcept = new Map();
  const dependentsByConcept = new Map();

  if (graph && Array.isArray(graph.nodes)) {
    graph.nodes.forEach((node) => {
      if (node && node.concept) {
        nodes.set(node.concept, { grade: node.grade || null, description: node.description || null });
      }
    });
    (graph.edges || []).forEach((edge) => {
      if (!nodes.has(edge.requires) || !nodes.has(edge.for)) return;
      if (!prerequisitesByConcept.has(edge.for)) {
        prerequisitesByConcept.set(edge.for, new Set());
      }
      prerequisitesByConcept.get(edge.for).add(edge.requires);
      if (!dependentsByConcept.has(edge.requires)) {
        dependentsByConcept.set(edge.requires, new Set());
      }
      dependentsByConcept.get(edge.requires).add(edge.for);
    });
  }

  const studied = new Set(toStudy.map((entry) => entry.concept));

  // Kahn's algorithm over the studied subgraph, with severity as the
  // deterministic tie-break between ready entries.
  const entries = new Map(toStudy.map((entry) => [entry.concept, entry]));
  const blockedByAll = new Map(toStudy.map((entry) => [entry.concept, new Set()]));
  entries.forEach((entry, concept) => {
    const prerequisites = prerequisitesByConcept.get(concept) || new Set();
    prerequisites.forEach((prerequisite) => {
      if (studied.has(prerequisite) && concept !== prerequisite) {
        blockedByAll.get(concept).add(prerequisite);
      }
    });
  });

  const path = [];
  const placed = new Set();
  while (entries.size > 0) {
    const ready = Array.from(entries.keys()).filter((concept) => {
      for (const prerequisite of blockedByAll.get(concept)) {
        if (!placed.has(prerequisite)) return false;
      }
      return true;
    });
    // A cycle can only reach this branch with an unvalidated graph; break it
    // deterministically by severity rather than spinning.
    const candidates = ready.length ? ready : Array.from(entries.keys());
    candidates.sort((left, right) => bySeverity(entries.get(left), entries.get(right)));
    const concept = candidates[0];
    const entry = entries.get(concept);
    entries.delete(concept);
    placed.add(concept);

    const blockedBy = Array.from(blockedByAll.get(concept)).sort();
    const blocks = Array.from(dependentsByConcept.get(concept) || new Set())
      .filter((dependent) => studied.has(dependent) && dependent !== concept)
      .sort();

    const node = nodes.get(concept);
    const pathEntry = {
      concept,
      pct: entry.pct,
      status: entry.status,
      origin: node ? node.grade : null,
      blockedBy,
      blocks,
    };
    if (entry.correct !== undefined) pathEntry.correct = entry.correct;
    if (entry.total !== undefined) pathEntry.total = entry.total;
    const evidence = mistakeKinds && mistakeKinds[concept];
    if (evidence) pathEntry.evidence = evidence;

    path.push(pathEntry);
  }

  const rootCauses = path
    .filter((entry) => entry.blocks.length > 0)
    .sort((left, right) => {
      if (right.blocks.length !== left.blocks.length) {
        return right.blocks.length - left.blocks.length;
      }
      return bySeverity(left, right);
    });

  return { path, rootCauses };
}