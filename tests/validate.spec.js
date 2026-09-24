import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import yaml from 'js-yaml';
import { validateAssessment, validateConceptGraph } from '../core/validate.js';

// The JSON Schemas are the structural contract at the LLM boundary; this test
// enforces them with ajv (server-side, where the boundary lives). The
// cross-field semantic checks the schemas cannot express live in
// core/validate.js and are exercised here too. Run with `npm test`.

const readJson = (rel) => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8'));
const readYaml = (rel) =>
  yaml.load(readFileSync(join(process.cwd(), rel), 'utf8'), {
    schema: yaml.JSON_SCHEMA,
  });

const schemaNames = [
  'assessment-common',
  'assessment-item',
  'diagnostic',
  'practice',
  'attempt',
  'assessment',
  'concept-graph',
];
const schemas = Object.fromEntries(
  schemaNames.map((n) => [n, readJson(`core/schema/${n}.schema.json`)]),
);

const ajv = new Ajv({ strict: false, validateFormats: false });
// Register the referenced subschemas by $id so $ref resolves.
['assessment-common', 'assessment-item', 'diagnostic', 'practice'].forEach(
  (n) => ajv.addSchema(schemas[n]),
);
const validateAssessmentStructure = ajv.compile(schemas.assessment); // oneOf union
const validateAttemptStructure = ajv.compile(schemas.attempt);
const validateConceptGraphStructure = ajv.compile(schemas['concept-graph']);

function assertValid(validator, data, label) {
  const ok = validator(data);
  if (!ok) {
    throw new Error(
      `${label} failed schema validation:\n` +
        JSON.stringify(validator.errors, null, 2),
    );
  }
  expect(ok).toBe(true);
}

const demoAssessments = [
  // The demo path's Grade 12 Mathematics artefacts (page-loaded + the
  // Mistake-Diagnosis sample that pairs with the demo attempt)
  'core/demo-data/assessments/diagnostic-g12-mathematics-html.yaml',
  'core/demo-data/assessments/diagnostic-g12-mathematics.yaml',
  'core/demo-data/assessments/practice-factorisation.yaml',
  // Additional grade/subject HTML diagnostics (same schema contract)
  'core/demo-data/assessments/diagnostic-g10-mathematics-html.yaml',
  'core/demo-data/assessments/diagnostic-g11-mathematics-html.yaml',
  'core/demo-data/assessments/diagnostic-g12-physical-science-html.yaml',
  'core/demo-data/assessments/diagnostic-g12-english-html.yaml',
  'core/demo-data/assessments/diagnostic-g12-life-science-html.yaml',
  'core/demo-data/assessments/diagnostic-g12-agriculture-html.yaml',
];

test.describe('schema is the structural contract (ajv)', () => {
  for (const file of demoAssessments) {
    test(`${file} conforms to the assessment schema`, () => {
      assertValid(validateAssessmentStructure, readYaml(file), file);
    });
  }

  test('demo attempt conforms to the attempt schema', () => {
    assertValid(
      validateAttemptStructure,
      readYaml('core/demo-data/attempts/learner-001_diagnostic-g12-mathematics.yaml'),
      'attempt',
    );
  });

  test('the demo Concept Graph conforms to the concept-graph schema', () => {
    assertValid(
      validateConceptGraphStructure,
      readYaml('data/subjects/graph-g12-mathematics.yaml'),
      'concept graph',
    );
  });

  test('every demo Subject has a schema-valid Concept Graph (no severity fallback)', () => {
    // ADR-0006 + the 2026-09-21 porting decision: the graceful degradation
    // path is gone — every Subject a Learner can assess has a graph. The
    // slug follows the subject store's policy from the Profile's subject
    // name (auth-guard's SUBJECTS_BY_GRADE), not the assessment's label.
    const canonicalSubjects = ['Mathematics', 'Physical Sciences', 'English Home Language', 'Life Sciences', 'Agricultural Sciences'];
    const canonicalFromLabel = (label) =>
      canonicalSubjects.find(
        (canonical) =>
          canonical.toLowerCase() === label.toLowerCase() ||
          label.toLowerCase().replace(/\s+science$/, ' sciences') === canonical.toLowerCase(),
      ) || label;

    for (const file of demoAssessments) {
      const assessment = readYaml(file);
      const grade = (assessment.subject.match(/Grade (\d+)/) || [])[1];
      const subject = canonicalFromLabel(assessment.subject.replace(/^Grade \d+\s+/, ''));
      const graphPath = `data/subjects/graph-g${grade}-${subject.toLowerCase().replace(/\s+/g, '-')}.yaml`;
      const graph = readYaml(graphPath);
      assertValid(validateConceptGraphStructure, graph, graphPath);
      expect(() => validateConceptGraph(graph)).not.toThrow();
      // Every Concept the assessment measures exists in the Subject's graph,
      // so the derivation can always see the prerequisite chain.
      const nodeNames = new Set(graph.nodes.map((node) => node.concept));
      for (const concept of assessment.concepts) {
        expect(nodeNames.has(concept.name), `${concept.name} in ${graphPath}`).toBe(true);
      }
    }
  });
});

test.describe('cross-field semantic checks (core/validate.js)', () => {
  for (const file of demoAssessments) {
    test(`${file} passes semantic validation`, () => {
      expect(() => validateAssessment(readYaml(file))).not.toThrow();
    });
  }

  test('rejects an item with an undeclared concept', () => {
    const bad = readYaml(demoAssessments[0]);
    bad.items[0].concept = 'Nonexistent';
    expect(() => validateAssessment(bad)).toThrow(/unknown concept/);
  });

  test('rejects a wrong explanation of the correct answer', () => {
    const bad = readYaml(demoAssessments[0]);
    const item = bad.items[0];
    item.wrong_explanations = [{ answer: item.correct, explanation: 'nope' }];
    expect(() => validateAssessment(bad)).toThrow(/correct answer as wrong/);
  });

  test('every wrong explanation in the demo data carries a Mistake-Diagnosis kind', () => {
    // The 2026-09-21 porting decision: no artefact ships a kindless Mistake
    // Diagnosis — the evidence readout never has an empty source to fall
    // back on when a diagnosis exists.
    for (const file of [...demoAssessments, 'core/demo-data/assessments/practice-factorisation.yaml']) {
      const assessment = readYaml(file);
      const entries = assessment.items.flatMap((item) => item.wrong_explanations || []);
      for (const entry of entries) {
        expect(entry.kind, `${file}: ${entry.explanation?.slice(0, 40)}`).toBeTruthy();
      }
    }
  });

  test('the demo artefacts carry Mistake-Diagnosis kinds (ADR-0006)', () => {
    const assessment = readYaml('core/demo-data/assessments/diagnostic-g12-mathematics.yaml');
    const kinds = assessment.items
      .flatMap((item) => item.wrong_explanations || [])
      .map((entry) => entry.kind)
      .filter(Boolean);
    expect(kinds.length).toBeGreaterThan(0);
    // The demo narrative: a prerequisite failure pointing at Factorisation.
    expect(
      assessment.items
        .flatMap((item) => item.wrong_explanations || [])
        .some((entry) => entry.kind === 'prerequisite' && entry.prerequisite === 'Factorisation'),
    ).toBe(true);
  });

  test('rejects an unknown Mistake-Diagnosis kind', () => {
    const bad = readYaml('core/demo-data/assessments/diagnostic-g12-mathematics.yaml');
    bad.items[0].wrong_explanations.push({ answer: 3, explanation: 'nope', kind: 'vibe' });
    expect(() => validateAssessment(bad)).toThrow(/unknown Mistake Diagnosis kind/);
  });

  test('rejects a prerequisite Mistake Diagnosis without a prerequisite Concept', () => {
    const bad = readYaml('core/demo-data/assessments/diagnostic-g12-mathematics.yaml');
    bad.items[0].wrong_explanations.push({ answer: 3, explanation: 'nope', kind: 'prerequisite' });
    expect(() => validateAssessment(bad)).toThrow(/without a prerequisite Concept/);
  });
});

test.describe('Concept Graph checks (ADR-0006)', () => {
  const demoGraph = () => readYaml('data/subjects/graph-g12-mathematics.yaml');

  test('the demo graph passes semantic validation', () => {
    expect(() => validateConceptGraph(demoGraph())).not.toThrow();
  });

  test('rejects an edge to an unknown Concept', () => {
    const bad = demoGraph();
    bad.edges.push({ requires: 'Factorisation', for: 'Nonexistent' });
    expect(() => validateConceptGraph(bad)).toThrow(/unknown Concept/);
  });

  test('rejects a self-edge', () => {
    const bad = demoGraph();
    bad.edges.push({ requires: 'Factorisation', for: 'Factorisation' });
    expect(() => validateConceptGraph(bad)).toThrow(/self-edge/);
  });

  test('rejects a prerequisite cycle', () => {
    const bad = demoGraph();
    // Factorisation → Quadratic Equations exists; the reverse closes a cycle.
    bad.edges.push({ requires: 'Quadratic Equations', for: 'Factorisation' });
    expect(() => validateConceptGraph(bad)).toThrow(/cycle/);
  });
});