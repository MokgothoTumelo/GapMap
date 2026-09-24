// Concept Graph generation (ADR-0006): the model may propose the Subject's
// prerequisite edges, but the artefact is schema- and semantics-validated at
// the LLM boundary and frozen per Subject — ADR-0001's discipline applied to
// the graph. The local adapter serves the demo fixture deterministically;
// the model adapter authors arbitrary Subjects. The demo path reads the
// authored YAML under core/demo-data/graphs/ either way; this seam is for
// generating a graph for a Subject that has none.
import { validateConceptGraph } from '../../core/validate.js';
import { conceptGraphFixtures } from './concept-graph-fixtures.js';

const GRAPH_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['concept-graph'] },
    subject: { type: 'string' },
    language: { type: 'string' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          concept: { type: 'string' },
          grade: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['concept'],
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requires: { type: 'string' },
          for: { type: 'string' },
        },
        required: ['requires', 'for'],
      },
    },
    generated_at: { type: 'string', format: 'date-time' },
    generated_by: { type: 'string' },
    schema_version: { type: 'string' },
  },
  required: ['id', 'type', 'subject', 'nodes', 'edges', 'generated_at'],
};

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function defaultIdFactory(request, sequence) {
  return `graph-${sequence}`;
}

export function createMockConceptGraphGenerator({
  fixtures = conceptGraphFixtures,
  idFactory = defaultIdFactory,
} = {}) {
  let sequence = 0;

  return async function generateMockConceptGraph(request = {}) {
    const subject = request.subject || 'Grade 12 Mathematics';
    const fixture = fixtures[subject];
    if (!fixture) {
      throw new Error(`No local Concept Graph fixture for ${subject}; use the model generator`);
    }

    sequence += 1;
    const graph = clone(fixture);
    graph.id = request.id || idFactory(request, sequence);
    graph.subject = subject;
    if (request.generatedAt) graph.generated_at = request.generatedAt;
    if (request.generatedBy) graph.generated_by = request.generatedBy;
    validateConceptGraph(graph);
    return graph;
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
    throw new Error('Concept graph generator returned invalid JSON');
  }
}

export function buildConceptGraphPrompt(request, validationError) {
  const subject = request.subject || 'Grade 12 Mathematics';
  const lines = [
    'Generate exactly one GapMap Concept Graph as JSON.',
    'Return only the JSON object; do not wrap it in markdown.',
    'Nodes are Concepts of the Subject, each with the grade where it is first taught.',
    'Edges are prerequisites: `requires` must be mastered before `for`.',
    'Include below-grade Concepts the Subject builds on — a Learner may have a Foundational Gap there.',
    'No prerequisite cycles; every edge endpoint must be a node.',
    'Use the Concept Graph JSON Schema contract in core/schema/.',
  ];
  if (validationError) {
    lines.push(
      `The previous attempt was rejected: ${validationError.message}. Fix the issue and try again.`,
    );
  }
  lines.push(JSON.stringify({ type: 'concept-graph', subject, language: request.language || 'en' }, null, 2));
  return lines.join('\n\n');
}

export function createModelConceptGraphGenerator({
  model,
  validateStructure,
  maxAttempts = 2,
  idFactory = defaultIdFactory,
} = {}) {
  if (!model || typeof model.generateContent !== 'function') {
    throw new Error('A model with generateContent(prompt) is required');
  }

  let sequence = 0;

  return async function generateModelConceptGraph(request = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: buildConceptGraphPrompt(request, lastError) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: GRAPH_RESPONSE_SCHEMA,
          },
        });
        const graph = parseJson(modelText(result));
        sequence += 1;
        // The id and metadata are app-owned; the model authors the content.
        graph.id = request.id || idFactory(request, sequence);
        graph.subject = request.subject || graph.subject;
        graph.generated_at = request.generatedAt || new Date().toISOString();
        validateConceptGraph(graph);

        if (validateStructure) {
          const valid = validateStructure(graph);
          if (valid === false) {
            throw new Error('Concept graph generator returned an invalid schema artefact');
          }
        }

        return graph;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts - 1) throw error;
      }
    }
    throw lastError;
  };
}

const localGenerator = createMockConceptGraphGenerator();

export async function generateConceptGraph(request = {}) {
  return localGenerator(request);
}