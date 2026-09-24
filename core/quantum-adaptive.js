// Quantum Adaptive Practice (v2 — simulated qubits, real quantum circuits)
//
// Honest framing: this runs on a CLASSICAL computer. It uses a state-vector
// simulator (core/quantum-sim.js) to execute real quantum gates, so the same
// circuit could be exported to a quantum processor. It is not a quantum
// computer and never claims to be one.
//
// What is actually quantum here (v1 only used the vocabulary):
//  1. AMPLITUDE ENCODING — the Diagnostic evidence becomes a probability
//     distribution over the learner's Knowledge Gaps, loaded into ceil(log2 N)
//     qubits with a tree of Ry rotations (N Concepts fit in log2 N qubits).
//  2. AMPLITUDE AMPLIFICATION (Grover-style) — an oracle marks the ROOT-CAUSE
//     Concepts (they block other weak Concepts in the Concept Graph, or the
//     Diagnostic's Mistake Diagnoses point back at them). One round of
//     "tag the marked amplitudes with a phase, then invert about the initial
//     state" makes the marked amplitudes interfere constructively; the phase
//     is tuned so the boost stops at ~75% instead of overshooting. That is
//     genuine quantum interference — it cannot be reproduced by just
//     re-weighting a list.
//  3. BORN-RULE MEASUREMENT — the result is read by measuring the register
//     `shots` times, like a real device would. The most frequent outcome is the
//     Concept "collapsed" onto. (Seeded, so the same Diagnostic gives the same
//     plan and the tests are reproducible.)
//
// The classical part is stated plainly: the initial probabilities come from an
// ordinary scoring heuristic (score deficit, mistake density, uncertainty).
// Quantum computing does not replace that step; it acts on its output.

import {
  StateVector,
  createRng,
  hashSeed,
  amplitudeEncodingGates,
  invertCircuit,
  describeCircuit,
} from './quantum-sim.js';

const KIND_WEIGHT = {
  concept: 1.35,
  prerequisite: 1.30,
  procedure: 1.15,
  misread: 1.00,
};

const DEFAULT_ITEM_COUNT = 5;
const MAX_CONCEPTS = 16; // 16 Concepts = 4 qubits
const DEFAULT_SHOTS = 1024;
// Root-cause Concepts should end up holding about three quarters of the state.
const AMPLIFICATION_TARGET = 0.75;

function normalise(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function scoreGapWeight(entry, evidenceCount, total) {
  const pct = Math.max(0, Math.min(100, numeric(entry?.pct ?? entry?.score)));
  const deficit = (100 - pct) / 100;
  const uncertainty = 1 / Math.sqrt(Math.max(1, numeric(entry?.total ?? total)));
  const mistakeDensity = evidenceCount / Math.max(1, numeric(entry?.total ?? total));
  const statusBoost = entry?.status === 'weak' ? 0.28 : entry?.status === 'improve' ? 0.12 : 0;
  return Math.max(
    0.01,
    0.65 * deficit +
    0.25 * Math.min(1, mistakeDensity * 2) +
    0.12 * Math.min(1, uncertainty) +
    statusBoost,
  );
}

function prerequisiteEvidence(concept, graph, mistakes) {
  const direct = (mistakes || []).filter((mistake) =>
    normalise(mistake?.concept) === normalise(concept) &&
    mistake?.kind === 'prerequisite' &&
    mistake?.prerequisite,
  );
  const graphEdges = (graph?.edges || []).filter((edge) =>
    normalise(edge?.for) === normalise(concept),
  );
  return {
    mistakes: direct,
    graphPrerequisites: graphEdges.map((edge) => edge.requires).filter(Boolean),
  };
}

function candidateFocusKinds(concept, mistakes) {
  const counts = new Map();
  for (const mistake of mistakes || []) {
    if (normalise(mistake?.concept) !== normalise(concept)) continue;
    const kind = String(mistake?.kind || 'concept');
    counts.set(kind, (counts.get(kind) || 0) + (KIND_WEIGHT[kind] || 1));
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind]) => kind);
}

function samePrompt(left, right) {
  return normalise(left?.prompt) === normalise(right?.prompt);
}

function itemTargetScore(item, focusKinds, mistakes, seenPrompts) {
  let value = 0;

  if (item?.correct_explanation) value += 1.5;
  if (item?.wrong_explanations?.length) value += 1.2;

  const wrongKinds = new Set(
    (item.wrong_explanations || []).map((entry) => entry?.kind).filter(Boolean),
  );
  for (const kind of focusKinds) {
    if (wrongKinds.has(kind)) value += 2.6 / (focusKinds.indexOf(kind) + 1);
  }

  const evidenceAnswers = new Set(
    (mistakes || [])
      .map((mistake) => String(mistake?.answer ?? ''))
      .filter(Boolean),
  );
  const relevantWrong = (item.wrong_explanations || []).some((entry) =>
    evidenceAnswers.has(String(entry?.answer ?? '')),
  );
  if (relevantWrong) value += 2.8;

  const seen = (seenPrompts || []).some((prompt) => normalise(prompt) === normalise(item?.prompt));
  if (seen) return -1000;

  const prompt = normalise(item?.prompt);
  if (/factor|expand|solve|simplify|substitut|discriminant|exponent|gradient|domain/i.test(prompt)) {
    value += 0.5;
  }

  return value;
}

function uniqueItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const key = normalise(item?.prompt) + '|' + JSON.stringify(item?.options || []) + '|' + String(item?.correct ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * Root-cause Concepts = the ones the oracle "marks". A Concept is marked when
 * it is itself in the pool AND either (a) the Concept Graph says another pool
 * Concept requires it, or (b) a Mistake Diagnosis on another Concept names it
 * as the missing prerequisite. Without a graph or diagnoses nothing is marked,
 * and the circuit honestly skips amplification.
 */
function markRootCauses(poolNames, graph, mistakes) {
  const inPool = new Map(poolNames.map((name) => [normalise(name), name]));
  const marked = new Set();
  for (const edge of graph?.edges || []) {
    const required = inPool.get(normalise(edge?.requires));
    const dependent = inPool.get(normalise(edge?.for));
    if (required && dependent && required !== dependent) marked.add(required);
  }
  for (const mistake of mistakes || []) {
    if (mistake?.kind !== 'prerequisite' || !mistake?.prerequisite) continue;
    const required = inPool.get(normalise(mistake.prerequisite));
    if (required && normalise(mistake.concept) !== normalise(mistake.prerequisite)) {
      marked.add(required);
    }
  }
  return marked;
}

/**
 * Amplitude amplification with a tunable phase φ. One round
 *   Q(φ) = A · S₀(φ) · A† · S_f(φ)
 * takes a marked probability `a` to  P(φ) = a·|1 − 2u + u²a|²  with u = 1 − e^(iφ).
 * φ = π is textbook Grover (which overshoots or does nothing for many values of
 * a — e.g. no gain at a = 0.5). Choosing φ lets us stop at the boost we want.
 */
function amplifiedMass(a, phi) {
  const ur = 1 - Math.cos(phi);
  const ui = -Math.sin(phi);
  const re = 1 - 2 * ur + (ur * ur - ui * ui) * a;
  const im = -2 * ui + 2 * ur * ui * a;
  return a * (re * re + im * im);
}

function chooseAmplificationPhase(a, target = AMPLIFICATION_TARGET) {
  let reachable = 0;
  const steps = 1800;
  for (let k = 0; k <= steps; k += 1) reachable = Math.max(reachable, amplifiedMass(a, (Math.PI * k) / steps));
  const goal = Math.min(target, reachable);
  let bestPhi = Math.PI;
  let bestGap = Infinity;
  for (let k = 0; k <= steps; k += 1) {
    const phi = (Math.PI * k) / steps;
    const gap = Math.abs(amplifiedMass(a, phi) - goal);
    if (gap < bestGap - 1e-12) {
      bestGap = gap;
      bestPhi = phi;
    }
  }
  return bestPhi;
}

export function buildQuantumLearningState({
  gapMap = [],
  mistakes = [],
  graph = null,
  targetConcept = '',
  shots = DEFAULT_SHOTS,
  seed = null,
  amplify = true,
} = {}) {
  const candidates = (gapMap || []).filter((entry) => entry?.concept);
  const focused = targetConcept
    ? candidates.filter((entry) => normalise(entry.concept) === normalise(targetConcept))
    : candidates.filter((entry) => entry.status !== 'strong');

  const pool = focused.length ? focused : candidates;

  // ── Classical step: evidence → a weight per Knowledge Gap ────────────────
  let weighted = pool.map((entry) => {
    const evidence = (mistakes || []).filter((mistake) =>
      normalise(mistake?.concept) === normalise(entry.concept),
    );
    const root = prerequisiteEvidence(entry.concept, graph, mistakes);
    const baseWeight = scoreGapWeight(entry, evidence.length, entry.total);
    const prerequisiteBoost = Math.min(0.25, root.mistakes.length * 0.08);
    return {
      concept: entry.concept,
      score: numeric(entry.pct ?? entry.score),
      status: entry.status || 'improve',
      weight: Math.max(0.01, baseWeight + prerequisiteBoost),
      evidenceCount: evidence.length,
      focusKinds: candidateFocusKinds(entry.concept, mistakes),
      prerequisites: root.graphPrerequisites,
    };
  });

  const method =
    'amplitude encoding + Grover-style amplitude amplification + Born-rule measurement ' +
    '(state-vector simulation on a classical computer)';

  if (!weighted.length) {
    return {
      model: 'quantum-simulated-adaptive-learning',
      version: '2.0',
      state: [],
      collapsedConcept: targetConcept || null,
      confidence: 0,
      method,
      circuit: null,
    };
  }

  // Keep the strongest signals if there are more Concepts than 4 qubits hold,
  // then fix a stable order so basis-state index i always means the same Concept.
  if (weighted.length > MAX_CONCEPTS) {
    weighted = weighted.sort((a, b) => b.weight - a.weight).slice(0, MAX_CONCEPTS);
  }
  weighted.sort((a, b) => a.concept.localeCompare(b.concept));

  const count = weighted.length;
  const qubits = Math.max(1, Math.ceil(Math.log2(count)));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const prior = weighted.map((entry) => entry.weight / total);

  // ── Quantum step 1: amplitude encoding  |ψ⟩ = Σ √pᵢ |i⟩ ─────────────────
  const prep = amplitudeEncodingGates(prior, qubits);
  let register = new StateVector(qubits).applyAll(prep);

  // ── Quantum step 2: amplitude amplification of root causes ──────────────
  const markedNames = markRootCauses(weighted.map((entry) => entry.concept), graph, mistakes);
  const markedIndices = weighted
    .map((entry, index) => (markedNames.has(entry.concept) ? index : -1))
    .filter((index) => index >= 0);
  const massOf = (probabilities) =>
    markedIndices.reduce((sum, index) => sum + probabilities[index], 0);

  const markedBefore = massOf(register.probabilities());
  const amplification = {
    applied: false,
    rounds: 0,
    markedConcepts: markedIndices.map((index) => weighted[index].concept),
    markedProbabilityBefore: markedBefore,
    markedProbabilityAfter: markedBefore,
    phase: null,
    targetMass: AMPLIFICATION_TARGET,
    note: 'No root-cause Concepts identified, so no amplification was applied.',
  };

  if (amplify && markedIndices.length > 0 && markedIndices.length < count &&
      markedBefore < AMPLIFICATION_TARGET) {
    // One phase-tuned round: oracle S_f(φ) → A† → S₀(φ) → A.
    // Kept only if interference really did raise the root-cause probability.
    const phi = chooseAmplificationPhase(markedBefore);
    const trial = register.clone();
    trial.phaseShift(markedIndices, phi);
    trial.applyAll(invertCircuit(prep));
    trial.phaseShift([0], phi);
    trial.applyAll(prep);
    const markedAfter = massOf(trial.probabilities());
    if (markedAfter > markedBefore + 1e-9) {
      register = trial;
      amplification.applied = true;
      amplification.rounds = 1;
      amplification.phase = phi;
      amplification.markedProbabilityAfter = markedAfter;
      amplification.note = 'One phase-tuned amplitude-amplification round raised the root-cause probability.';
    }
  } else if (markedIndices.length > 0 && markedBefore >= AMPLIFICATION_TARGET) {
    amplification.note = 'Root causes already dominate the state, so amplification was skipped.';
  }

  // ── Quantum step 3: measure (Born rule) ──────────────────────────────────
  const finalProbabilities = register.probabilities();
  const usedSeed = seed ?? hashSeed(
    weighted.map((entry) => `${entry.concept}:${entry.score}:${entry.evidenceCount}`).join('|'),
  );
  const counts = register.sample(shots, createRng(usedSeed));
  const measuredTotal = weighted.reduce((sum, _entry, index) => sum + counts[index], 0) || 1;

  const state = weighted
    .map((entry, index) => ({
      concept: entry.concept,
      score: entry.score,
      status: entry.status,
      amplitude: Math.hypot(register.re[index], register.im[index]),
      priorProbability: prior[index],
      probability: finalProbabilities[index],
      measuredFrequency: counts[index] / measuredTotal,
      isRootCause: markedNames.has(entry.concept),
      unnormalisedProbability: entry.weight,
      evidenceCount: entry.evidenceCount,
      focusKinds: entry.focusKinds,
      prerequisites: entry.prerequisites,
    }))
    .sort((a, b) =>
      b.measuredFrequency - a.measuredFrequency ||
      b.probability - a.probability ||
      a.score - b.score ||
      a.concept.localeCompare(b.concept),
    );

  const collapsed = state[0] || null;
  return {
    model: 'quantum-simulated-adaptive-learning',
    version: '2.0',
    state,
    collapsedConcept: collapsed?.concept || targetConcept || null,
    confidence: collapsed?.measuredFrequency || 0,
    method,
    circuit: {
      simulated: true,
      qubits,
      concepts: count,
      shots,
      seed: usedSeed,
      gateCount: register.log.length,
      gates: describeCircuit(register.log),
      amplification,
    },
  };
}

export function selectQuantumPracticeItems({
  bankItems = [],
  concept = '',
  mistakes = [],
  itemCount = DEFAULT_ITEM_COUNT,
  seenPrompts = [],
} = {}) {
  const filtered = uniqueItems((bankItems || []).filter(
    (item) => normalise(item?.concept) === normalise(concept),
  ));

  const focusKinds = candidateFocusKinds(concept, mistakes);
  const ranked = filtered
    .map((item) => ({
      item,
      targetScore: itemTargetScore(item, focusKinds, mistakes, seenPrompts),
    }))
    .filter((entry) => entry.targetScore > -100)
    .sort((a, b) =>
      b.targetScore - a.targetScore ||
      normalise(a.item.prompt).localeCompare(normalise(b.item.prompt)),
    );

  const count = Math.max(3, Math.min(Number(itemCount) || DEFAULT_ITEM_COUNT, 5));
  const selected = ranked.slice(0, count).map((entry, index) => ({
    ...entry.item,
    quantum_stage: index < 2 ? 'repair' : index < count - 1 ? 'transfer' : 'check',
  }));

  return {
    concept,
    focusKinds,
    items: selected,
    itemCount: selected.length,
  };
}

export function prepareQuantumPractice({
  gapMap = [],
  mistakes = [],
  graph = null,
  bankItems = [],
  targetConcept = '',
  itemCount = DEFAULT_ITEM_COUNT,
  seenPrompts = [],
  preparedAt = new Date().toISOString(),
  shots = DEFAULT_SHOTS,
  seed = null,
} = {}) {
  const state = buildQuantumLearningState({ gapMap, mistakes, graph, targetConcept, shots, seed });
  const concept = state.collapsedConcept || targetConcept;
  const selection = concept
    ? selectQuantumPracticeItems({
      bankItems,
      concept,
      mistakes,
      itemCount,
      seenPrompts,
    })
    : { concept: '', focusKinds: [], items: [], itemCount: 0 };

  return {
    preparedAt,
    quantum: state,
    targetConcept: concept,
    focusKinds: selection.focusKinds,
    itemIds: selection.items.map((item) => item.id),
    stages: selection.items.map((item) => item.quantum_stage),
    explanation: concept
      ? `A simulated ${state.circuit?.qubits ?? 1}-qubit circuit encoded your Diagnostic evidence, ` +
        `${state.circuit?.amplification?.applied ? 'amplified the root-cause Concepts, ' : ''}` +
        `and ${state.circuit?.shots ?? DEFAULT_SHOTS} measurements collapsed it onto ${concept}.`
      : 'No Knowledge Gap was available to focus the next Practice.',
  };
}

function mathExplanation(prompt, correct) {
  const source = String(prompt || '').trim();
  const answer = String(correct ?? '');

  let match = source.match(/(\d+)x\s*([+-])\s*(\d+)\s*=\s*(\d+)/i);
  if (match && /solve|find|determine/i.test(source)) {
    const a = Number(match[1]);
    const b = Number(match[3]);
    const c = Number(match[4]);
    const sign = match[2] === '+' ? b : -b;
    const x = sign >= 0
      ? `${c} − ${b}`
      : `${c} + ${b}`;
    return `Move the constant to the other side, then divide by the coefficient of x: ${a}x = ${x}, so x = ${answer}.`;
  }

  match = source.match(/x\s*([+-])\s*(\d+)\s*=\s*(\d+)/i);
  if (match && /solve|find|determine/i.test(source)) {
    const b = Number(match[2]);
    const c = Number(match[3]);
    return `Undo the constant ${match[1]} ${b} first, then isolate x. This gives x = ${answer}.`;
  }

  match = source.match(/2x\s*([+-])\s*(\d+)/i);
  if (match && /expand|simplify/i.test(source)) {
    return `Apply the operation to each term, combine like terms, and check the simplified expression against ${answer}.`;
  }

  match = source.match(/x²\s*[−-]\s*(\d+)/i);
  if (match && /factor/i.test(source)) {
    const n = Math.sqrt(Number(match[1]));
    if (Number.isInteger(n)) {
      return `Recognise a difference of squares: x² − ${n * n} = x² − ${n}² = (x − ${n})(x + ${n}).`;
    }
  }

  match = source.match(/f\(x\)\s*=\s*(\d+)x\s*([+-])\s*(\d+).*f\(([-\d]+)\)/i);
  if (match) {
    const a = Number(match[1]);
    const b = Number(match[3]) * (match[2] === '-' ? -1 : 1);
    const x = Number(match[4]);
    const value = a * x + b;
    return `Substitute x = ${x}: f(${x}) = ${a}(${x}) ${b >= 0 ? '+' : '−'} ${Math.abs(b)} = ${value}.`;
  }

  match = source.match(/\((\d+)².*×.*(\d+)⁴.*\).*÷.*(\d+)³/i);
  if (match && /simplify/i.test(source)) {
    return 'For the same base, multiply by adding exponents and divide by subtracting exponents: 2 + 4 − 3 = 3.';
  }

  if (/expand/i.test(source)) {
    return `Distribute each factor, then combine like terms. The simplified result is ${answer}.`;
  }
  if (/factor/i.test(source)) {
    return `Look for the factor pattern, multiply the factors back together to verify, then use ${answer}.`;
  }
  if (/discriminant/i.test(source)) {
    return `Use Δ = b² − 4ac, substitute the coefficients carefully, and simplify to ${answer}.`;
  }
  if (/gradient/i.test(source)) {
    return `In y = mx + c, the coefficient of x is the gradient, giving ${answer}.`;
  }
  if (/domain/i.test(source)) {
    return `Find the restriction that keeps the expression defined, then state the allowed x-values: ${answer}.`;
  }
  if (/exponent|index|surds/i.test(source)) {
    return `Apply the relevant exponent or surd law step by step, then simplify to ${answer}.`;
  }

  return `Identify the rule being assessed, apply it to the given values, and verify that the result is ${answer}.`;
}

export function explainAnswer(item, answer, { correct = false } = {}) {
  const correctText = Array.isArray(item?.options) && Number.isInteger(Number(item?.correct))
    ? String(item.options[Number(item.correct)] ?? '')
    : String(item?.correct ?? '');

  const matchedWrong = (item?.wrong_explanations || []).find(
    (entry) => String(entry?.answer ?? '') === String(answer ?? ''),
  );

  return {
    correctAnswer: correctText || String(item?.correct ?? ''),
    mistakeKind: matchedWrong?.kind || (correct ? null : 'concept'),
    mistakeExplanation: matchedWrong?.explanation || '',
    how: item?.correct_explanation || mathExplanation(item?.prompt, correctText || item?.correct),
    source: item?.correct_explanation ? 'authored' : 'rule-based',
  };
}

export function saveQuantumPlan(storage, key, plan) {
  try {
    storage.setItem(key, JSON.stringify(plan));
    return true;
  } catch (_) {
    return false;
  }
}

export function readQuantumPlan(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}
