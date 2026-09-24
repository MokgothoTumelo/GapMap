import { validateAssessment } from '../../core/validate.js';
import { assessmentFixtures } from './assessment-fixtures.js';

// Structured-output schema (SDK SchemaRequest format) for the model-backed
// generator. It constrains the model to emit a structurally valid Assessment
// (required fields present, correct types); the semantic checks (concept-tag
// bridge, item counts) still run in validateAssessment.
const ASSESSMENT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['diagnostic', 'practice'] },
    subject: { type: 'string' },
    language: { type: 'string' },
    explanation_level: { type: 'string', enum: ['Simple', 'Standard', 'Detailed'] },
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          concept: { type: 'string' },
          difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
          prompt: { type: 'string' },
          prompt_type: { type: 'string', enum: ['multiple_choice', 'short_answer', 'numeric'] },
          options: { type: 'array', items: { type: 'string' } },
          correct: { anyOf: [{ type: 'integer' }, { type: 'number' }, { type: 'string' }] },
          correct_explanation: { type: 'string' },
          wrong_explanations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                answer: { anyOf: [{ type: 'integer' }, { type: 'number' }, { type: 'string' }] },
                explanation: { type: 'string' },
                kind: { type: 'string', enum: ['misread', 'procedure', 'concept', 'prerequisite'] },
                prerequisite: { type: 'string' },
              },
              required: ['answer', 'explanation'],
            },
          },
        },
        required: ['id', 'concept', 'prompt', 'prompt_type', 'correct'],
      },
    },
    generated_at: { type: 'string', format: 'date-time' },
    generated_by: { type: 'string' },
    schema_version: { type: 'string' },
  },
  required: ['id', 'type', 'subject', 'language', 'explanation_level', 'concepts', 'items', 'generated_at'],
};

const ASSESSMENT_TYPES = new Set(['diagnostic', 'practice']);

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normaliseRequest(request = {}) {
  const type = request.type || request.assessmentType;
  if (!ASSESSMENT_TYPES.has(type)) {
    throw new Error('Assessment generation requires type: diagnostic or practice');
  }

  return {
    ...request,
    type,
    subject: request.subject || 'Grade 12 Mathematics',
    language: request.language || 'en',
    explanationLevel: request.explanationLevel || 'Standard',
  };
}

function conceptName(value) {
  return typeof value === 'string' ? value : value?.name;
}

function applyRequest(fixture, request, id) {
  const assessment = clone(fixture);
  assessment.id = id;
  assessment.subject = request.subject;
  assessment.language = request.language;
  assessment.explanation_level = request.explanationLevel;
  assessment.generated_at = request.generatedAt || assessment.generated_at;
  assessment.generated_by = request.generatedBy || assessment.generated_by;

  const requestedConcepts = (request.concepts || [])
    .map(conceptName)
    .filter(Boolean);
  const requestedTarget = request.targetConcept || request.concept;
  const fixtureConcepts = assessment.concepts.map((concept) => concept.name);

  if (request.type === 'diagnostic' && requestedConcepts.length >= 2) {
    const sameConcepts = requestedConcepts.length === fixtureConcepts.length &&
      requestedConcepts.every((name, index) => name === fixtureConcepts[index]);
    if (!sameConcepts) {
      throw new Error(
        `Local ${request.type} generation only supports: ${fixtureConcepts.join(', ')}`,
      );
    }
  }

  if (request.type === 'practice' && requestedTarget) {
    if (requestedTarget !== fixtureConcepts[0]) {
      throw new Error(
        `Local ${request.type} generation only supports: ${fixtureConcepts[0]}; use the model generator for ${requestedTarget}`,
      );
    }
  }

  const requestedCount = Number(request.itemCount);
  const minimum = request.type === 'diagnostic' ? 1 : 3;
  if (request.itemCount !== undefined) {
    if (!Number.isInteger(requestedCount) ||
        requestedCount < minimum ||
        requestedCount > assessment.items.length) {
      throw new Error(
        `Local ${request.type} fixture supports ${minimum}-${assessment.items.length} Items`,
      );
    }
    assessment.items = assessment.items.slice(0, requestedCount);
  }

  return assessment;
}

function defaultIdFactory(request, sequence) {
  return `${request.type}-${sequence}`;
}

export function createMockAssessmentGenerator({
  fixtures = assessmentFixtures,
  idFactory = defaultIdFactory,
} = {}) {
  let sequence = 0;

  return async function generateMockAssessment(request = {}) {
    const normalised = normaliseRequest(request);
    const fixture = fixtures[normalised.type];
    if (!fixture) {
      throw new Error(`No local Assessment fixture for ${normalised.type}`);
    }

    sequence += 1;
    const id = normalised.id || idFactory(normalised, sequence);
    const assessment = applyRequest(fixture, normalised, id);
    validateAssessment(assessment);
    return assessment;
  };
}

function modelText(result) {
  const response = result?.response || result;
  if (typeof response?.text === 'function') return response.text();
  if (typeof response?.text === 'string') return response.text;
  if (typeof result?.text === 'function') return result.text();
  if (typeof result?.text === 'string') return result.text;
  return '';
}

function parseJson(text) {
  const cleaned = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch (_error) {
    throw new Error('Assessment generator returned invalid JSON');
  }
}

export function buildAssessmentPrompt(request, validationError) {
  const normalised = normaliseRequest(request);
  const lines = [
    'Generate exactly one GapMap Assessment as JSON.',
    'Return only the JSON object; do not wrap it in markdown.',
    'Every Item must declare exactly one Concept from concepts[].',
    'Tag each wrong_explanations entry with a kind: misread | procedure | concept | prerequisite.',
    'A prerequisite kind must also name the prerequisite Concept the Item depends on (in `prerequisite`).',
    'Use the Assessment JSON Schema contract in core/schema/.',
    "Ground the Assessment in the Learner's Gap Map and Learning Path below.",
  ];
  if (validationError) {
    lines.push(
      `The previous attempt was rejected: ${validationError.message}. Fix the issue and try again.`,
    );
  }
  lines.push(JSON.stringify({
    type: normalised.type,
    subject: normalised.subject,
    concepts: normalised.concepts || [],
    targetConcept: normalised.targetConcept || normalised.concept,
    language: normalised.language,
    explanationLevel: normalised.explanationLevel,
    itemCount: normalised.itemCount,
    gapMap: normalised.gapMap || [],
    learningPath: normalised.learningPath || [],
  }, null, 2));
  return lines.join('\n\n');
}

export function createModelAssessmentGenerator({
  model,
  validateStructure,
  maxAttempts = 2,
  idFactory = defaultIdFactory,
} = {}) {
  if (!model || typeof model.generateContent !== 'function') {
    throw new Error('A model with generateContent(prompt) is required');
  }

  let sequence = 0;

  return async function generateModelAssessment(request = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: buildAssessmentPrompt(request, lastError) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: ASSESSMENT_RESPONSE_SCHEMA,
          },
        });
        const assessment = parseJson(modelText(result));
        sequence += 1;
        const normalised = normaliseRequest(request);
        // The id and metadata are app-owned; the model authors the content.
        assessment.id = request.id || idFactory(normalised, sequence);
        assessment.subject = normalised.subject;
        assessment.language = normalised.language;
        assessment.explanation_level = normalised.explanationLevel;
        assessment.generated_at = request.generatedAt || new Date().toISOString();
        validateAssessment(assessment);

        if (validateStructure) {
          const valid = validateStructure(assessment);
          if (valid === false) {
            throw new Error('Assessment generator returned an invalid schema artefact');
          }
        }

        return assessment;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts - 1) throw error;
      }
    }
    throw lastError;
  };
}

const localGenerator = createMockAssessmentGenerator();

export async function generateAssessment(request = {}) {
  return localGenerator(request);
}
