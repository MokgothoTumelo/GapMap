import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { validateConceptGraph } from '../core/validate.js';
import {
  buildConceptGraphPrompt,
  createModelConceptGraphGenerator,
  createMockConceptGraphGenerator,
  generateConceptGraph,
} from '../frontend/js/concept-graph-generator.js';
import { conceptGraphFixtures } from '../frontend/js/concept-graph-fixtures.js';

const readYaml = (rel) =>
  yaml.load(readFileSync(join(process.cwd(), rel), 'utf8'), { schema: yaml.JSON_SCHEMA });

test.describe('Concept Graph generation seam (ADR-0006)', () => {
  test('the local fixture and the demo YAML never drift', () => {
    expect(structuredClone(conceptGraphFixtures['Grade 12 Mathematics'])).toEqual(
      readYaml('data/subjects/graph-g12-mathematics.yaml'),
    );
  });

  test('local generation is deterministic, typed, and semantically valid', async () => {
    const first = await generateConceptGraph({ id: 'graph-deterministic-test' });
    const second = await generateConceptGraph({ id: 'graph-deterministic-test' });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.type).toBe('concept-graph');
    expect(() => validateConceptGraph(first)).not.toThrow();
  });

  test('local generation refuses a Subject it has no fixture for', async () => {
    await expect(generateConceptGraph({ subject: 'Grade 11 Physical Sciences' })).rejects.toThrow(
      /No local Concept Graph fixture/,
    );
  });

  test('the model adapter authors a graph and app-owns the metadata', async () => {
    const modelGraph = {
      type: 'concept-graph',
      subject: 'Grade 10 Physical Sciences',
      nodes: [
        { concept: 'Measurement', grade: '8' },
        { concept: 'Forces', grade: '10' },
      ],
      edges: [{ requires: 'Measurement', for: 'Forces' }],
    };
    const prompts = [];
    const model = {
      async generateContent(request) {
        prompts.push(request.contents[0].parts[0].text);
        return { response: { text: () => JSON.stringify(modelGraph) } };
      },
    };

    const generate = createModelConceptGraphGenerator({ model });
    const graph = await generate({ subject: 'Grade 10 Physical Sciences', id: 'graph-model-test' });

    expect(graph.id).toBe('graph-model-test');
    expect(graph.generated_at).toBeTruthy();
    expect(graph.subject).toBe('Grade 10 Physical Sciences');
    expect(() => validateConceptGraph(graph)).not.toThrow();
    // The prompt asks for the prerequisite shape, including below-grade roots.
    expect(prompts[0]).toContain('prerequisites');
    expect(prompts[0]).toContain('Foundational Gap');
  });

  test('the model adapter retries with a corrective hint on a cyclic graph', async () => {
    const validGraph = structuredClone(conceptGraphFixtures['Grade 12 Mathematics']);
    const cyclic = structuredClone(validGraph);
    // The reverse of Factorisation → Quadratic Equations closes a cycle.
    cyclic.edges.push({ requires: 'Quadratic Equations', for: 'Factorisation' });

    let calls = 0;
    const model = {
      async generateContent(request) {
        const prompt = request.contents[0].parts[0].text;
        calls += 1;
        if (calls === 1) return { response: { text: () => JSON.stringify(cyclic) } };
        expect(prompt).toContain('rejected');
        return { response: { text: () => JSON.stringify(validGraph) } };
      },
    };

    const generate = createModelConceptGraphGenerator({ model });
    const graph = await generate({});
    expect(calls).toBe(2);
    expect(() => validateConceptGraph(graph)).not.toThrow();
  });

  test('buildConceptGraphPrompt names the Subject and the fix on retry', () => {
    const error = new Error('prerequisite cycle');
    const prompt = buildConceptGraphPrompt({ subject: 'Grade 12 Mathematics' }, error);
    expect(prompt).toContain('Grade 12 Mathematics');
    expect(prompt).toContain('prerequisite cycle');
  });
});