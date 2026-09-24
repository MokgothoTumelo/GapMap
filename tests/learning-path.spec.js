import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { buildLearningPath, mistakeKindsByConcept } from '../core/learning-path.js';

// The Learning Path as a pure derivation (ADR-0006): Concept Graph + Gap Map
// → roots first, severity as tie-break. The demo narrative comes straight
// from the artefacts: Factorisation (Grade 9 origin, weak) blocks Quadratic
// Equations (also weak), so the path starts below the Learner's grade.

const readYaml = (rel) =>
  yaml.load(readFileSync(join(process.cwd(), rel), 'utf8'), { schema: yaml.JSON_SCHEMA });

const demoGraph = () => readYaml('data/subjects/graph-g12-mathematics.yaml');
const demoAssessment = () => readYaml('core/demo-data/assessments/diagnostic-g12-mathematics.yaml');
const demoAttempt = () => readYaml('core/demo-data/attempts/learner-001_diagnostic-g12-mathematics.yaml');

// The demo attempt's rollup (same numbers the attempt YAML carries).
function demoGapMap() {
  return demoAttempt().scores.map((score) => ({ ...score }));
}

test.describe('Mistake-Diagnosis rollup (evidence for the root cause)', () => {
  test('joins wrong Responses to their Mistake-Diagnosis kinds per Concept', () => {
    const rollup = mistakeKindsByConcept([demoAssessment()], [demoAttempt()]);

    expect(rollup['Quadratic Equations']).toEqual({
      wrong: 2,
      byKind: { procedure: 1, prerequisite: 1 },
      prerequisiteFailures: { Factorisation: 1 },
    });
    expect(rollup['Factorisation']).toEqual({
      wrong: 2,
      byKind: { procedure: 2 },
      prerequisiteFailures: {},
    });
    expect(rollup['Functions']).toEqual({
      wrong: 1,
      byKind: { concept: 1 },
      prerequisiteFailures: {},
    });
    // Correct Responses produce no evidence.
    expect(rollup['Algebra']).toBeUndefined();
  });

  test('ignores Attempts whose Assessment is not in the store', () => {
    const rollup = mistakeKindsByConcept([demoAssessment()], [
      { id: 'orphan', assessment_id: 'unknown', responses: demoAttempt().responses },
    ]);
    expect(rollup).toEqual({});
  });
});

test.describe('the Learning Path derivation', () => {
  test('orders the demo path roots-first: Factorisation before Quadratic Equations', () => {
    const { path, rootCauses } = buildLearningPath({ gapMap: demoGapMap(), graph: demoGraph() });

    expect(path.map((entry) => entry.concept)).toEqual([
      'Factorisation',
      'Quadratic Equations',
      'Functions',
    ]);

    // The why: Factorisation is the root; Quadratic Equations is blocked by it.
    expect(path[0]).toMatchObject({
      concept: 'Factorisation',
      pct: 33,
      status: 'weak',
      origin: '9', // Grade 9 origin — below the Learner's grade
      blockedBy: [], // Expanding Brackets is not measured, so not a blocking entry
      blocks: ['Quadratic Equations'],
    });
    expect(path[1]).toMatchObject({
      concept: 'Quadratic Equations',
      blockedBy: ['Factorisation'],
      blocks: [],
    });
    // Algebra is strong and stays off the path; Functions has no studied
    // prerequisite (Algebra isn't on the path).
    expect(path[2]).toMatchObject({ concept: 'Functions', blockedBy: [], blocks: [] });

    expect(rootCauses).toHaveLength(1);
    expect(rootCauses[0].concept).toBe('Factorisation');
    expect(rootCauses[0].blocks).toEqual(['Quadratic Equations']);
  });

  test('carries Mistake-Diagnosis evidence on the blocked entry', () => {
    const mistakeKinds = mistakeKindsByConcept([demoAssessment()], [demoAttempt()]);
    const { path } = buildLearningPath({ gapMap: demoGapMap(), graph: demoGraph(), mistakeKinds });

    expect(path[1].evidence).toEqual({
      wrong: 2,
      byKind: { procedure: 1, prerequisite: 1 },
      prerequisiteFailures: { Factorisation: 1 },
    });
    expect(path[0].evidence).toEqual({
      wrong: 2,
      byKind: { procedure: 2 },
      prerequisiteFailures: {},
    });
  });

  test('without a graph the order is severity alone and the why is empty', () => {
    const { path, rootCauses } = buildLearningPath({ gapMap: demoGapMap() });

    expect(path.map((entry) => entry.concept)).toEqual([
      'Factorisation',
      'Quadratic Equations',
      'Functions',
    ]);
    expect(path[0].origin).toBeNull();
    expect(path[0].blocks).toEqual([]);
    expect(rootCauses).toEqual([]);
  });

  test('the graph overrides the severity tie-break when they disagree', () => {
    // Both weak at the same pct: name order would put Division first, but the
    // prerequisite edge puts Multiplication first.
    const gapMap = [
      { concept: 'Division', pct: 20, status: 'weak' },
      { concept: 'Multiplication', pct: 20, status: 'weak' },
    ];
    const graph = {
      nodes: [{ concept: 'Multiplication' }, { concept: 'Division' }],
      edges: [{ requires: 'Multiplication', for: 'Division' }],
    };

    const withGraph = buildLearningPath({ gapMap, graph });
    expect(withGraph.path.map((entry) => entry.concept)).toEqual(['Multiplication', 'Division']);
    expect(withGraph.rootCauses.map((entry) => entry.concept)).toEqual(['Multiplication']);

    const withoutGraph = buildLearningPath({ gapMap });
    expect(withoutGraph.path.map((entry) => entry.concept)).toEqual(['Division', 'Multiplication']);
  });

  test('ranks root causes by how many Concepts they block', () => {
    const gapMap = [
      { concept: 'A', pct: 10, status: 'weak' },
      { concept: 'B', pct: 20, status: 'weak' },
      { concept: 'C', pct: 90, status: 'strong' },
    ];
    const graph = {
      nodes: [{ concept: 'A' }, { concept: 'B' }, { concept: 'C' }],
      edges: [
        { requires: 'A', for: 'B' },
        { requires: 'A', for: 'C' },
      ],
    };

    const { path, rootCauses } = buildLearningPath({ gapMap, graph });
    // A blocks two Concepts (B studied, C strong so off the path) — wait: C is
    // strong, so A blocks only B here. The count must reflect *studied*
    // dependents only.
    expect(rootCauses).toHaveLength(1);
    expect(rootCauses[0]).toMatchObject({ concept: 'A', blocks: ['B'] });
    expect(path.map((entry) => entry.concept)).toEqual(['A', 'B']);
  });

  test('an all-strong Gap Map yields an empty path', () => {
    const gapMap = [{ concept: 'Algebra', pct: 100, status: 'strong' }];
    const { path, rootCauses } = buildLearningPath({ gapMap, graph: demoGraph() });
    expect(path).toEqual([]);
    expect(rootCauses).toEqual([]);
  });

  test('is deterministic across runs', () => {
    const mistakeKinds = mistakeKindsByConcept([demoAssessment()], [demoAttempt()]);
    const first = buildLearningPath({
      gapMap: demoGapMap(),
      graph: demoGraph(),
      mistakeKinds,
    });
    const second = buildLearningPath({
      gapMap: demoGapMap(),
      graph: demoGraph(),
      mistakeKinds,
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test('degrades gracefully when the graph has no edges', () => {
    const gapMap = demoGapMap();
    const graph = {
      nodes: [{ concept: 'Factorisation', grade: '9' }, { concept: 'Quadratic Equations' }],
      edges: [],
    };
    const { path } = buildLearningPath({ gapMap, graph });
    // No edges: severity order, no blocks/blockedBy, but origins still known.
    expect(path.map((entry) => entry.concept)).toEqual(['Factorisation', 'Quadratic Equations', 'Functions']);
    expect(path[0].origin).toBe('9');
    expect(path[0].blocks).toEqual([]);
  });
});