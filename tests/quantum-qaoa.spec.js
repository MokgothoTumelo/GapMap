import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import jsyaml from 'js-yaml';
import {
  buildStudyProblem,
  toIsing,
  studyEnergy,
  isingEnergy,
  isFeasible,
  bruteForceOptimum,
  optimiseStudyPlan,
  MAX_PLAN_CONCEPTS,
} from '../core/quantum-qaoa.js';

const graph = jsyaml.load(fs.readFileSync('data/subjects/graph-g12-mathematics.yaml', 'utf8'));
const gapMap = [
  { concept: 'Linear Equations', pct: 75, status: 'improve' },
  { concept: 'Expanding Brackets', pct: 55, status: 'improve' },
  { concept: 'Factorisation', pct: 40, status: 'weak' },
  { concept: 'Algebra', pct: 60, status: 'improve' },
  { concept: 'Exponents & Surds', pct: 90, status: 'strong' },
  { concept: 'Functions', pct: 70, status: 'improve' },
  { concept: 'Quadratic Equations', pct: 30, status: 'weak' },
];

test.describe('QAOA study-plan optimiser', () => {
  test('the Ising form gives the same cost as the QUBO for every possible plan', () => {
    const problem = buildStudyProblem({ gapMap, graph, budget: 3 });
    const ising = toIsing(problem);
    for (let mask = 0; mask < (1 << problem.n); mask += 1) {
      expect(isingEnergy(ising, mask, problem.n)).toBeCloseTo(studyEnergy(problem, mask), 9);
    }
  });

  test('only weak Concepts become qubits; strong ones are left out', () => {
    const problem = buildStudyProblem({ gapMap, graph, budget: 3 });
    expect(problem.n).toBe(6);
    expect(problem.concepts.map((c) => c.concept)).not.toContain('Exponents & Surds');
  });

  test('the cheapest plan overall is a valid one (penalties are strong enough)', () => {
    for (const budget of [1, 2, 3, 4]) {
      const problem = buildStudyProblem({ gapMap, graph, budget });
      expect(bruteForceOptimum(problem).groundStateIsValid).toBe(true);
    }
  });

  test('a plan that studies a Concept before its prerequisite is invalid', () => {
    const problem = buildStudyProblem({ gapMap, graph, budget: 1 });
    const index = (name) => problem.concepts.findIndex((c) => c.concept === name);
    expect(isFeasible(problem, 1 << index('Factorisation'))).toBe(false); // needs Expanding Brackets
    expect(isFeasible(problem, 1 << index('Expanding Brackets'))).toBe(true);
  });

  test('QAOA finds the classical optimum for every budget on the demo graph', () => {
    for (const budget of [1, 2, 3, 4]) {
      const plan = optimiseStudyPlan({ gapMap, graph, budget });
      expect(plan.selected).toHaveLength(budget);
      expect(plan.matchesClassical).toBe(true);
      expect(plan.usedQuantumResult).toBe(true);
    }
  });

  test('recommends the root cause first: Expanding Brackets → Factorisation', () => {
    const plan = optimiseStudyPlan({ gapMap, graph, budget: 2 });
    expect(plan.selected.map((s) => s.concept)).toEqual(['Expanding Brackets', 'Factorisation']);
    expect(plan.selected[1].unlocks).toContain('Quadratic Equations');
    expect(plan.deferred.map((d) => d.concept)).toContain('Quadratic Equations');
  });

  test('the selected plan is ordered prerequisites-first', () => {
    const plan = optimiseStudyPlan({ gapMap, graph, budget: 4 });
    const order = plan.selected.map((s) => s.concept);
    for (const edge of graph.edges) {
      if (order.includes(edge.requires) && order.includes(edge.for)) {
        expect(order.indexOf(edge.requires)).toBeLessThan(order.indexOf(edge.for));
      }
    }
  });

  test('reports honest circuit statistics', () => {
    const { qaoa } = optimiseStudyPlan({ gapMap, graph, budget: 3 });
    expect(qaoa.qubits).toBe(6);
    expect(qaoa.layers).toBe(2);
    expect(qaoa.shots).toBeGreaterThan(0);
    expect(qaoa.gates.length).toBe(qaoa.gateCount);
    expect(qaoa.optimumProbability).toBeGreaterThan(qaoa.randomGuessProbability);
  });

  test('is deterministic: same input, same plan and same statistics', () => {
    const a = optimiseStudyPlan({ gapMap, graph, budget: 3 });
    const b = optimiseStudyPlan({ gapMap, graph, budget: 3 });
    expect(a.selected).toEqual(b.selected);
    expect(a.qaoa.optimumProbability).toBe(b.qaoa.optimumProbability);
  });

  test('without a graph it still plans, by size of gap alone', () => {
    const plan = optimiseStudyPlan({ gapMap, graph: null, budget: 2 });
    expect(plan.matchesClassical).toBe(true);
    expect(plan.selected.map((s) => s.concept).sort()).toEqual(['Factorisation', 'Quadratic Equations']);
  });

  test('all-strong Gap Map yields an empty plan; a single weak Concept is not "optimised"', () => {
    const strong = optimiseStudyPlan({ gapMap: [{ concept: 'A', pct: 95, status: 'strong' }], budget: 3 });
    expect(strong.selected).toEqual([]);
    expect(strong.qaoa).toBeNull();

    const one = optimiseStudyPlan({ gapMap: [{ concept: 'A', pct: 30, status: 'weak' }], budget: 3 });
    expect(one.selected.map((s) => s.concept)).toEqual(['A']);
    expect(one.qaoa).toBeNull();
  });

  test('a budget larger than the number of weak Concepts is clamped', () => {
    const plan = optimiseStudyPlan({ gapMap, graph, budget: 99 });
    expect(plan.budget).toBe(6);
    expect(plan.selected).toHaveLength(6);
  });

  test('more Concepts than the register holds are truncated and flagged', () => {
    const many = Array.from({ length: 14 }, (_v, i) => ({ concept: `C${i}`, pct: 10 + i * 3, status: 'weak' }));
    const plan = optimiseStudyPlan({ gapMap: many, graph: null, budget: 3 });
    expect(plan.truncated).toBe(true);
    expect(plan.concepts).toHaveLength(MAX_PLAN_CONCEPTS);
    expect(plan.selected).toHaveLength(3);
  });
});
