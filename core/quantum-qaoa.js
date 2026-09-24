// Quantum study-plan optimiser — QAOA on a simulated quantum computer.
//
// Question answered: "I can only study K Concepts this week. Which K, given
// that some Concepts can't be learned before their prerequisites?"
//
// That is a constrained optimisation problem over yes/no choices — exactly the
// shape quantum optimisers (QAOA, quantum annealing) are designed for. This
// file:
//   1. writes the problem as a QUBO (Quadratic Unconstrained Binary Optimisation),
//   2. converts it to an Ising cost function (the form a QAOA circuit needs),
//   3. builds and runs the QAOA circuit on the simulator in core/quantum-sim.js,
//   4. tunes the circuit's angles with a classical optimiser that scores each
//      try by the average cost of its best 10% of outcomes (CVaR — this hybrid
//      quantum/classical loop is how QAOA runs on real hardware too),
//   5. measures the circuit and keeps the best VALID answer it produced,
//   6. checks the result against exhaustive classical search.
//
// Honesty notes: this is a simulation on a classical computer. With ≤10
// Concepts, brute force is instant and QAOA has no speed advantage — the point
// is that the formulation and circuit are real and carry over to hardware,
// where the Concept Graph for a whole curriculum would be far too large to
// enumerate. Step 6 exists so the demo can prove the quantum answer is correct.
//
// Pure and runtime-agnostic: no DOM, no fetch, no Node APIs.

import { StateVector, createRng, hashSeed, describeCircuit } from './quantum-sim.js';
import { buildLearningPath } from './learning-path.js';

export const MAX_PLAN_CONCEPTS = 10; // 10 qubits = 1024 amplitudes; instant in a browser
const UNLOCK_WEIGHT = 1; // how strongly "holds back other weak Concepts" raises a gap's value
const PENALTY_FACTOR = 2; // constraint penalties = PENALTY_FACTOR × largest benefit
const DEFAULT_LAYERS = 2;
const DEFAULT_SHOTS = 2048;
// Random restarts of the classical angle-tuning loop. Small problems can afford
// more; larger ones need fewer (tested: still optimal at 9–10 Concepts).
const restartsFor = (n) => (n <= 7 ? 5 : n === 8 ? 4 : 3);

const normalise = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const numeric = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const bit = (mask, i) => (mask >> i) & 1;
const popcount = (mask) => {
  let count = 0;
  for (let m = mask; m; m &= m - 1) count += 1;
  return count;
};

// ── 1. The problem ─────────────────────────────────────────────────────────

/**
 * Build the study-planning problem.
 *   xᵢ = 1 means "study Concept i this week".
 *   Minimise  H(x) = − Σ bᵢ xᵢ                    (reward: big gaps + Concepts that unlock others)
 *                    + A (Σ xᵢ − K)²               (penalty: study exactly K Concepts)
 *                    + C Σ_{j→i} xᵢ (1 − xⱼ)       (penalty: studying i without its prerequisite j)
 * Every term is at most quadratic in x, so this is a QUBO.
 */
export function buildStudyProblem({ gapMap = [], graph = null, budget = 3 } = {}) {
  let entries = (gapMap || [])
    .filter((entry) => entry?.concept && entry.status !== 'strong')
    .map((entry) => ({
      concept: entry.concept,
      pct: Math.max(0, Math.min(100, numeric(entry.pct ?? entry.score))),
      status: entry.status || 'improve',
    }));

  // Prerequisite edges [required, dependent] between Concepts that are both weak.
  const edgesFor = (list) => {
    const at = new Map(list.map((entry, i) => [normalise(entry.concept), i]));
    const found = [];
    for (const edge of graph?.edges || []) {
      const req = at.get(normalise(edge?.requires));
      const dep = at.get(normalise(edge?.for));
      if (req !== undefined && dep !== undefined && req !== dep) found.push([req, dep]);
    }
    return found;
  };
  // Benefit of closing a gap = its size, scaled up by how much weak work hangs
  // off it:  bᵢ = dᵢ · (1 + Σ_{dependents} d_dep),  where d = (100 − score)/100.
  const benefitsFor = (list, edges) => list.map((entry, i) => {
    const deficit = (100 - entry.pct) / 100;
    const unlocked = edges
      .filter(([req]) => req === i)
      .reduce((sum, [, dep]) => sum + (100 - list[dep].pct) / 100, 0);
    return deficit * (1 + UNLOCK_WEIGHT * unlocked);
  });

  // Too many Concepts for the register? Keep the ones with the most to gain.
  let truncated = false;
  if (entries.length > MAX_PLAN_CONCEPTS) {
    truncated = true;
    const benefits = benefitsFor(entries, edgesFor(entries));
    entries = entries
      .map((entry, i) => ({ entry, benefit: benefits[i] }))
      .sort((a, b) => b.benefit - a.benefit || a.entry.concept.localeCompare(b.entry.concept))
      .slice(0, MAX_PLAN_CONCEPTS)
      .map((item) => item.entry);
  }

  // Stable order (by name) so qubit i always means the same Concept.
  entries.sort((a, b) => a.concept.localeCompare(b.concept));
  const n = entries.length;
  const edges = edgesFor(entries);
  const benefits = benefitsFor(entries, edges);
  const concepts = entries.map((entry, i) => ({
    ...entry,
    blocks: edges.filter(([req]) => req === i).map(([, dep]) => entries[dep].concept),
    benefit: benefits[i],
  }));

  const K = Math.max(1, Math.min(n || 1, Math.round(numeric(budget)) || 1));
  const bMax = concepts.reduce((max, c) => Math.max(max, c.benefit), 0) || 1;
  const A = PENALTY_FACTOR * bMax;
  const C = PENALTY_FACTOR * bMax;

  // Expand H(x) into QUBO form: Σ cᵢ xᵢ + Σ_{i<j} qᵢⱼ xᵢ xⱼ + constant  (using xᵢ² = xᵢ).
  const linear = new Array(n).fill(0);
  const pair = new Map(); // "i,j" (i<j) → coefficient
  const addPair = (a, b, value) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    pair.set(key, (pair.get(key) || 0) + value);
  };
  let constant = A * K * K;
  concepts.forEach((c, i) => {
    linear[i] += -c.benefit; // reward
    linear[i] += A * (1 - 2 * K); // budget: Σ xᵢ(1−2K)
  });
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) addPair(i, j, 2 * A); // budget: 2 Σ xᵢxⱼ
  }
  for (const [req, dep] of edges) {
    linear[dep] += C; //          + C·x_dep
    addPair(req, dep, -C); //     − C·x_dep·x_req
  }
  const quadratic = [...pair.entries()]
    .map(([key, value]) => {
      const [i, j] = key.split(',').map(Number);
      return { i, j, q: value };
    })
    .filter((term) => Math.abs(term.q) > 1e-12);

  return {
    concepts,
    edges,
    budget: K,
    n,
    truncated,
    penalties: { budget: A, prerequisite: C },
    qubo: { linear, quadratic, constant },
  };
}

/** Cost H(x) of a selection (bitmask), straight from the QUBO. */
export function studyEnergy(problem, mask) {
  const { linear, quadratic, constant } = problem.qubo;
  let energy = constant;
  for (let i = 0; i < problem.n; i += 1) if (bit(mask, i)) energy += linear[i];
  for (const { i, j, q } of quadratic) if (bit(mask, i) && bit(mask, j)) energy += q;
  return energy;
}

/** A selection is valid when it has exactly K Concepts and respects every prerequisite. */
export function isFeasible(problem, mask) {
  if (popcount(mask) !== problem.budget) return false;
  return problem.edges.every(([req, dep]) => !bit(mask, dep) || bit(mask, req));
}

// ── 2. QUBO → Ising (the form a QAOA circuit needs) ────────────────────────

/**
 * Substitute xᵢ = (1 − zᵢ)/2 with zᵢ ∈ {+1, −1} (the eigenvalues of a qubit's Z
 * operator). The cost becomes Σ hᵢ zᵢ + Σ Jᵢⱼ zᵢ zⱼ + offset.
 */
export function toIsing(problem) {
  const { linear, quadratic, constant } = problem.qubo;
  const h = linear.map((c) => -c / 2);
  const J = [];
  let offset = constant + linear.reduce((sum, c) => sum + c / 2, 0);
  for (const { i, j, q } of quadratic) {
    h[i] -= q / 4;
    h[j] -= q / 4;
    J.push({ i, j, J: q / 4 });
    offset += q / 4;
  }
  return { h, J, offset };
}

/** Cost of a selection evaluated through the Ising form (must equal studyEnergy). */
export function isingEnergy(ising, mask, n) {
  let energy = ising.offset;
  for (let i = 0; i < n; i += 1) energy += ising.h[i] * (bit(mask, i) ? -1 : 1);
  for (const { i, j, J } of ising.J) {
    energy += J * (bit(mask, i) ? -1 : 1) * (bit(mask, j) ? -1 : 1);
  }
  return energy;
}

// ── 3. Classical reference (for verification only) ─────────────────────────

/** Exhaustive search over all 2ⁿ selections. Used to CHECK the quantum answer. */
export function bruteForceOptimum(problem) {
  let best = null;
  let lowest = Infinity;
  let highest = -Infinity;
  for (let mask = 0; mask < (1 << problem.n); mask += 1) {
    const energy = studyEnergy(problem, mask);
    if (energy < lowest) lowest = energy;
    if (energy > highest) highest = energy;
    if (isFeasible(problem, mask) && (best === null || energy < best.energy - 1e-12)) {
      best = { mask, energy };
    }
  }
  return {
    mask: best ? best.mask : null,
    energy: best ? best.energy : null,
    lowestEnergy: lowest,
    highestEnergy: highest,
    groundStateIsValid: best !== null && Math.abs(best.energy - lowest) < 1e-9,
  };
}

// ── 4. The QAOA circuit ────────────────────────────────────────────────────

/**
 * Build (and run) the p-layer QAOA circuit:
 *   |+⟩^n  →  [ cost layer(γₗ) · mixer layer(βₗ) ] × p
 * Cost layer: Rz for each linear term, Rzz for each pair term — this "paints"
 * the cost of every selection onto its amplitude's phase. Mixer layer: Rx on
 * every qubit — lets amplitudes flow between selections, so good ones
 * interfere constructively and bad ones cancel.
 */
function runQaoaCircuit(problem, ising, scale, gammas, betas, { record }) {
  const sv = new StateVector(problem.n, { record });
  for (let q = 0; q < problem.n; q += 1) sv.h(q);
  for (let layer = 0; layer < gammas.length; layer += 1) {
    const gamma = gammas[layer];
    for (let q = 0; q < problem.n; q += 1) {
      if (Math.abs(ising.h[q]) > 1e-12) sv.rz(q, (2 * gamma * ising.h[q]) / scale);
    }
    for (const { i, j, J } of ising.J) sv.rzz(i, j, (2 * gamma * J) / scale);
    for (let q = 0; q < problem.n; q += 1) sv.rx(q, 2 * betas[layer]);
  }
  return sv;
}

/**
 * Run QAOA end to end and return what a quantum run would return: tuned
 * angles, the measured samples, and the best valid selection among them.
 */
export function solveQaoa(problem, {
  layers = DEFAULT_LAYERS,
  shots = DEFAULT_SHOTS,
  restarts = null,
  seed = null,
  objective = 'cvar',
  alpha = 0.1,
} = {}) {
  restarts = restarts ?? restartsFor(problem.n);
  const ising = toIsing(problem);
  const scale =
    ising.h.reduce((sum, v) => sum + Math.abs(v), 0) +
    ising.J.reduce((sum, term) => sum + Math.abs(term.J), 0) || 1;
  const usedSeed = seed ?? hashSeed(problem.concepts.map((c) => `${c.concept}:${c.pct}`).join('|') + `#${problem.budget}`);
  const rng = createRng(usedSeed);
  let evaluations = 0;

  // Cost of every possible outcome, sorted best-first. On hardware you would
  // compute the cost of each *measured* bitstring classically (it is cheap);
  // the simulator can afford to do it for all outcomes at once.
  const dim = 1 << problem.n;
  const energyTable = new Float64Array(dim);
  for (let mask = 0; mask < dim; mask += 1) energyTable[mask] = studyEnergy(problem, mask);
  const bestFirst = Array.from({ length: dim }, (_, i) => i).sort((a, b) => energyTable[a] - energyTable[b]);

  // CVaR objective: the average cost of the best `alpha` share of outcomes.
  // Tuning the circuit to make its BEST outcomes good (rather than its average
  // outcome) concentrates probability on the optimum — standard CVaR-QAOA.
  const cvar = (probabilities) => {
    let mass = 0;
    let total = 0;
    for (const index of bestFirst) {
      const take = Math.min(probabilities[index], alpha - mass);
      total += take * energyTable[index];
      mass += take;
      if (mass >= alpha - 1e-15) break;
    }
    return total / alpha;
  };
  const mean = (probabilities) => {
    let total = 0;
    for (let mask = 0; mask < dim; mask += 1) total += probabilities[mask] * energyTable[mask];
    return total;
  };

  const evaluate = (params) => {
    evaluations += 1;
    const sv = runQaoaCircuit(problem, ising, scale, params.slice(0, layers), params.slice(layers), { record: false });
    const probabilities = sv.probabilities();
    return (objective === 'mean' ? mean(probabilities) : cvar(probabilities)) / scale;
  };

  // Classical outer loop: multi-start compass search over (γ₁..γp, β₁..βp).
  let bestParams = null;
  let bestValue = Infinity;
  for (let r = 0; r < restarts; r += 1) {
    let params = [];
    for (let l = 0; l < layers; l += 1) params.push(rng() * Math.PI); // γ
    for (let l = 0; l < layers; l += 1) params.push(rng() * (Math.PI / 2)); // β
    let value = evaluate(params);
    let step = 0.4;
    for (let sweep = 0; sweep < 80 && step > 0.01; sweep += 1) {
      let improved = false;
      for (let d = 0; d < params.length; d += 1) {
        for (const direction of [1, -1]) {
          const candidate = params.slice();
          candidate[d] += direction * step;
          const candidateValue = evaluate(candidate);
          if (candidateValue < value - 1e-10) {
            params = candidate;
            value = candidateValue;
            improved = true;
          }
        }
      }
      if (!improved) step /= 2;
    }
    if (value < bestValue) {
      bestValue = value;
      bestParams = params;
    }
  }

  // Final run with the tuned angles: keep the circuit, then MEASURE it.
  const gammas = bestParams.slice(0, layers);
  const betas = bestParams.slice(layers);
  const circuit = runQaoaCircuit(problem, ising, scale, gammas, betas, { record: true });
  const probabilities = circuit.probabilities();
  const counts = circuit.sample(shots, createRng(usedSeed ^ 0x9e3779b9));

  const samples = [];
  for (let mask = 0; mask < counts.length; mask += 1) {
    if (counts[mask] > 0) {
      samples.push({
        mask,
        count: counts[mask],
        energy: studyEnergy(problem, mask),
        valid: isFeasible(problem, mask),
      });
    }
  }
  samples.sort((a, b) => b.count - a.count || a.energy - b.energy);
  const validSamples = samples
    .filter((sample) => sample.valid)
    .sort((a, b) => a.energy - b.energy || b.count - a.count);

  const expectedEnergy = mean(probabilities);
  const validShots = samples.filter((s) => s.valid).reduce((sum, s) => sum + s.count, 0);

  return {
    layers,
    shots,
    seed: usedSeed,
    restarts,
    evaluations,
    qubits: problem.n,
    gammas,
    betas,
    expectedEnergy,
    probabilities,
    best: validSamples[0] || null,
    topSamples: samples.slice(0, 5),
    validShotFraction: validShots / shots,
    gateCount: circuit.log.length,
    gates: describeCircuit(circuit.log),
  };
}

// ── 5. Everything together ─────────────────────────────────────────────────

/**
 * The public entry point. Returns the recommended set of Concepts for the
 * week, ordered roots-first (via the existing Learning Path derivation), plus
 * the evidence needed to explain and defend the result.
 */
export function optimiseStudyPlan({
  gapMap = [],
  graph = null,
  budget = 3,
  layers = DEFAULT_LAYERS,
  shots = DEFAULT_SHOTS,
  restarts = null,
  seed = null,
} = {}) {
  const problem = buildStudyProblem({ gapMap, graph, budget });
  const empty = {
    budget: problem.budget,
    concepts: problem.concepts,
    selected: [],
    deferred: [],
    qaoa: null,
    classical: null,
    matchesClassical: null,
    usedQuantumResult: false,
    truncated: problem.truncated,
    note: 'No weak Concepts to plan.',
  };
  if (problem.n === 0) return empty;

  const classical = bruteForceOptimum(problem);

  // One Concept: nothing to optimise — say so instead of running a 1-qubit circuit for show.
  if (problem.n === 1) {
    const only = problem.concepts[0];
    return {
      ...empty,
      selected: [{ concept: only.concept, pct: only.pct, status: only.status, reason: `Currently ${only.pct}% — your only weak Concept`, unlocks: [] }],
      classical: { selected: [only.concept], energy: classical.energy },
      note: 'Only one weak Concept, so there is nothing to optimise.',
    };
  }

  const qaoa = solveQaoa(problem, { layers, shots, restarts, seed });
  const chosenMask = qaoa.best ? qaoa.best.mask : classical.mask;
  const usedQuantumResult = Boolean(qaoa.best);
  const namesOf = (mask) => problem.concepts.filter((_c, i) => bit(mask, i)).map((c) => c.concept);

  const chosen = new Set(namesOf(chosenMask));
  const chosenEntries = problem.concepts.filter((c) => chosen.has(c.concept));
  const ordered = buildLearningPath({
    gapMap: chosenEntries.map((c) => ({ concept: c.concept, pct: c.pct, status: c.status })),
    graph,
  }).path.map((entry) => entry.concept);

  const byName = new Map(problem.concepts.map((c) => [c.concept, c]));
  const selected = ordered.map((name) => {
    const c = byName.get(name);
    return {
      concept: c.concept,
      pct: c.pct,
      status: c.status,
      unlocks: c.blocks,
      reason: c.blocks.length
        ? `Unlocks ${c.blocks.join(' and ')}`
        : `Currently ${c.pct}% — large gap to close`,
    };
  });
  const deferred = problem.concepts
    .filter((c) => !chosen.has(c.concept))
    .sort((a, b) => a.pct - b.pct)
    .map((c) => ({ concept: c.concept, pct: c.pct, status: c.status, reason: 'Outside this week’s budget' }));

  const span = classical.highestEnergy - classical.lowestEnergy || 1;
  const optimumProbability = classical.mask === null ? 0 : qaoa.probabilities[classical.mask];

  return {
    budget: problem.budget,
    concepts: problem.concepts,
    selected,
    deferred,
    truncated: problem.truncated,
    usedQuantumResult,
    matchesClassical: classical.mask !== null && chosenMask === classical.mask,
    qaoa: {
      qubits: qaoa.qubits,
      layers: qaoa.layers,
      shots: qaoa.shots,
      seed: qaoa.seed,
      evaluations: qaoa.evaluations,
      gateCount: qaoa.gateCount,
      gates: qaoa.gates,
      gammas: qaoa.gammas,
      betas: qaoa.betas,
      expectedEnergy: qaoa.expectedEnergy,
      approximationRatio: (classical.highestEnergy - qaoa.expectedEnergy) / span,
      optimumProbability,
      randomGuessProbability: 1 / (1 << problem.n),
      validShotFraction: qaoa.validShotFraction,
      bestSampleCount: qaoa.best ? qaoa.best.count : 0,
      topSamples: qaoa.topSamples.map((sample) => ({
        concepts: namesOf(sample.mask),
        count: sample.count,
        energy: sample.energy,
        valid: sample.valid,
      })),
    },
    classical: {
      selected: classical.mask === null ? [] : namesOf(classical.mask),
      energy: classical.energy,
      groundStateIsValid: classical.groundStateIsValid,
    },
    note: null,
  };
}
