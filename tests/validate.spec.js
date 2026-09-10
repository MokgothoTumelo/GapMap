import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import yaml from 'js-yaml';
import { validateAssessment } from '../core/validate.js';

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
  'retest',
  'attempt',
  'assessment',
];
const schemas = Object.fromEntries(
  schemaNames.map((n) => [n, readJson(`core/schema/${n}.schema.json`)]),
);

const ajv = new Ajv({ strict: false, validateFormats: false });
// Register the referenced subschemas by $id so $ref resolves.
['assessment-common', 'assessment-item', 'diagnostic', 'practice', 'retest'].forEach(
  (n) => ajv.addSchema(schemas[n]),
);
const validateAssessmentStructure = ajv.compile(schemas.assessment); // oneOf union
const validateAttemptStructure = ajv.compile(schemas.attempt);

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
  'core/demo-data/assessments/diagnostic-g12-maths.yaml',
  'core/demo-data/assessments/diagnostic-g12-maths-html.yaml',
  'core/demo-data/assessments/practice-factorisation.yaml',
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
      readYaml('core/demo-data/attempts/learner-001_diagnostic-g12-maths.yaml'),
      'attempt',
    );
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
});