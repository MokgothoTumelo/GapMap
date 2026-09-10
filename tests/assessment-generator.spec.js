import { test, expect } from '@playwright/test';
import { validateAssessment } from '../core/validate.js';
import {
  createModelAssessmentGenerator,
  createMockAssessmentGenerator,
  generateAssessment,
} from '../frontend/js/assessment-generator.js';
import {
  createAssessmentForLearner,
  retrieveAssessmentForLearner,
  retrieveAssessmentsForLearner,
} from '../frontend/js/assessment-service.js';

function validModelResponse() {
  return {
    id: 'practice-model-test',
    type: 'practice',
    subject: 'Grade 12 Mathematics',
    language: 'en',
    explanation_level: 'standard',
    concepts: [{ name: 'Factorisation' }],
    items: [
      {
        id: 'q1',
        concept: 'Factorisation',
        prompt: 'Factorise x² − 4.',
        prompt_type: 'multiple_choice',
        options: ['(x − 2)(x + 2)', 'x − 4'],
        correct: 0,
        wrong_explanations: [{ answer: 1, explanation: 'It is not a product of factors.' }],
      },
      {
        id: 'q2',
        concept: 'Factorisation',
        prompt: 'Factorise x² − 9.',
        prompt_type: 'multiple_choice',
        options: ['(x − 3)(x + 3)', 'x − 9'],
        correct: 0,
        wrong_explanations: [{ answer: 1, explanation: 'It is not the factorised form.' }],
      },
      {
        id: 'q3',
        concept: 'Factorisation',
        prompt: 'Factorise x² − 25.',
        prompt_type: 'multiple_choice',
        options: ['(x − 5)(x + 5)', 'x − 25'],
        correct: 0,
        wrong_explanations: [{ answer: 1, explanation: 'It is not the factorised form.' }],
      },
    ],
    generated_at: '2026-01-01T00:00:00.000Z',
  };
}

test.describe('Assessment generation seam', () => {
  test('local generation is deterministic, typed, and semantically valid', async () => {
    const first = await generateAssessment({
      type: 'practice',
      id: 'practice-deterministic-test',
      targetConcept: 'Factorisation',
    });
    const second = await generateAssessment({
      type: 'practice',
      id: 'practice-deterministic-test',
      targetConcept: 'Factorisation',
    });

    expect(first).toEqual(second);
    expect(first.type).toBe('practice');
    expect(first.items).toHaveLength(3);
    expect(() => validateAssessment(first)).not.toThrow();
  });

  test('retest generation carries the requested target and prior Attempt context', async () => {
    const generate = createMockAssessmentGenerator({
      idFactory: () => 'retest-request-test',
    });
    const assessment = await generate({
      type: 'retest',
      targetConcept: 'Factorisation',
      previousAttemptId: 'attempt-before-retest',
      previousScore: 42,
    });

    expect(assessment.target).toEqual({
      concept: 'Factorisation',
      previous_attempt_id: 'attempt-before-retest',
      previous_score: 42,
    });
    expect(assessment.concepts[0].name).toBe('Factorisation');
    expect(assessment.items.every((item) => item.concept === 'Factorisation')).toBe(true);
    expect(() => validateAssessment(assessment)).not.toThrow();
  });

  test('model generation parses JSON and validates the returned Assessment', async () => {
    let prompt = '';
    let generationConfig = null;
    const model = {
      async generateContent(request) {
        prompt = request.contents[0].parts[0].text;
        generationConfig = request.generationConfig;
        return { response: { text: () => JSON.stringify(validModelResponse()) } };
      },
    };

    let structureChecked = false;
    const generate = createModelAssessmentGenerator({
      model,
      validateStructure(value) {
        structureChecked = value.id === 'practice-model-test';
        return structureChecked;
      },
    });
    const assessment = await generate({
      type: 'practice',
      targetConcept: 'Factorisation',
      id: 'practice-model-test',
    });

    expect(assessment.id).toBe('practice-model-test');
    expect(prompt).toContain('Generate exactly one GapMap Assessment as JSON.');
    expect(prompt).toContain('Factorisation');
    // Structured output is wired so the model cannot omit required fields.
    expect(generationConfig.responseMimeType).toBe('application/json');
    expect(generationConfig.responseSchema.required).toContain('id');
    expect(structureChecked).toBe(true);
  });

  test('model generation rejects malformed JSON instead of persisting it', async () => {
    const generate = createModelAssessmentGenerator({
      model: {
        async generateContent() {
          return { response: { text: () => 'not json' } };
        },
      },
    });

    await expect(generate({ type: 'diagnostic' })).rejects.toThrow(/invalid JSON/);
  });

  test('the Learner Assessment service composes create and retrieve without coupling generation to storage', async () => {
    const records = [];
    const store = {
      async putAssessment(learnerId, assessment) {
        records.push({ learnerId, assessment });
        return assessment;
      },
      async listAssessments(learnerId, options) {
        return records
          .filter(({ learnerId: storedLearner }) => storedLearner === learnerId)
          .filter(({ assessment }) => !options.type || assessment.type === options.type)
          .map(({ assessment }) => assessment);
      },
      async getAssessment(learnerId, assessmentId) {
        return records.find(
          ({ learnerId: storedLearner, assessment }) =>
            storedLearner === learnerId && assessment.id === assessmentId,
        )?.assessment || null;
      },
    };
    const generator = async () => generateAssessment({ type: 'practice', id: 'service-test' });

    const created = await createAssessmentForLearner({
      learnerId: 'learner-service-test',
      request: { type: 'practice' },
      store,
      generator,
    });
    expect(created.id).toBe('service-test');
    expect(records).toHaveLength(1);

    expect(
      await retrieveAssessmentsForLearner({
        learnerId: 'learner-service-test',
        type: 'practice',
        store,
      }),
    ).toEqual([created]);
    expect(
      await retrieveAssessmentForLearner({
        learnerId: 'learner-service-test',
        assessmentId: created.id,
        store,
      }),
    ).toEqual(created);
  });
});
