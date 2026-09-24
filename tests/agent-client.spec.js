import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import {
  buildCompanionPrompt,
  buildLearnerSnapshot,
  createAgentClient,
  COMPANION_SYSTEM_PROMPT,
  COMPANION_TOOLS,
} from '../frontend/js/agent-client.js';
import { createMemoryStorage, createMockLearnerStore } from '../frontend/js/learner-store.js';
import { generateAssessment } from '../frontend/js/assessment-generator.js';

function clientOptions(model = null) {
  return {
    model,
    store: createMockLearnerStore({ storage: createMemoryStorage() }),
    getLearnerId: () => 'learner-agent-test',
    getLearnerProfile: () => ({ grade: '12', subject: 'Mathematics', firstName: 'Demo' }),
    getLearnerContext: async () => ({
      gapMap: [{ concept: 'Factorisation', pct: 33, status: 'weak' }],
      learningPath: ['Factorisation'],
    }),
  };
}

// A model fake that plays scripted turns: each turn either emits function
// calls (as raw candidate parts, carrying a thoughtSignature sibling like the
// real Gemini API) or a text reply, and records every request it receives.
// An optional `generateContent` implementation lets it also stand in for the
// model-backed Assessment generator.
function toolTurnModel(turns, generateContent) {
  let index = 0;
  const requests = [];
  return {
    requests,
    async generateContentStream(request) {
      requests.push(request);
      const turn = turns[Math.min(index, turns.length - 1)];
      index += 1;
      const parts = [];
      if (turn.calls) {
        for (const call of turn.calls) {
          parts.push({ functionCall: call, thoughtSignature: `sig-${call.name}` });
        }
      }
      if (turn.text) parts.push({ text: turn.text });
      const response = {
        candidates: [{ content: { role: 'model', parts } }],
        text: () => turn.text || '',
      };
      return {
        stream: (async function* () {
          if (turn.text) yield { text: () => turn.text };
        })(),
        response: Promise.resolve(response),
      };
    },
    ...(generateContent ? { generateContent } : {}),
  };
}

// A store seeded with one practice Assessment (Factorisation Items) and one
// Attempt with a weak Factorisation score.
async function seededToolStore() {
  const store = createMockLearnerStore({ storage: createMemoryStorage() });
  const assessment = await generateAssessment({ type: 'practice', id: 'tool-practice' });
  await store.putAssessment('learner-tool', assessment);
  await store.saveAttempt('learner-tool', {
    id: 'attempt-tool',
    assessment_id: assessment.id,
    learner_id: 'learner-tool',
    started_at: '2026-01-01T10:00:00.000Z',
    completed_at: '2026-01-01T10:02:00.000Z',
    responses: [],
    scores: [
      { concept: 'Factorisation', correct: 1, total: 3, pct: 33, status: 'weak' },
    ],
    overall_pct: 33,
  });
  return store;
}

// Pulls the functionResponse the client sent back to the model on the second
// request (after the model emitted a tool call).
function functionResponseFrom(model) {
  const secondContents = model.requests[1].contents;
  const userTurn = secondContents.find(
    (content) => content.role === 'user' && content.parts.some((part) => part.functionResponse),
  );
  return userTurn.parts[0].functionResponse;
}

function toolClient(model, store) {
  return createAgentClient({
    model,
    store,
    getLearnerId: () => 'learner-tool',
    getLearnerContext: async () => ({}),
  });
}

test.describe('Learning Companion client seam', () => {
  test('builds a prompt from Learner context and transcript', () => {
    const prompt = buildCompanionPrompt({
      message: 'What should I study next?',
      learnerId: 'learner-prompt-test',
      learnerContext: { learningPath: ['Factorisation'] },
      transcript: [{ role: 'user', content: 'Hello' }],
    });

    expect(prompt).toContain('learner-prompt-test');
    expect(prompt).toContain('Factorisation');
    expect(prompt).toContain('Learner: Hello');
    expect(prompt).toContain('What should I study next?');
  });

  test('builds a bounded snapshot from the full learner context', () => {
    const snapshot = buildLearnerSnapshot({
      learnerId: 'learner-1',
      gapMap: [{ concept: 'Factorisation', pct: 25, status: 'weak' }],
      learningPath: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      assessments: [{ id: 'a1' }],
      attempts: [{ id: 't1' }],
      transcript: [{ role: 'user', content: 'hi' }],
      language: 'English',
      explanationLevel: 'Simple',
      subject: 'Mathematics',
    });

    expect(snapshot.assessments).toBeUndefined();
    expect(snapshot.attempts).toBeUndefined();
    expect(snapshot.transcript).toBeUndefined();
    expect(snapshot.learningPath).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(snapshot.gapMap).toEqual([{ concept: 'Factorisation', pct: 25, status: 'weak' }]);
    expect(snapshot.language).toBe('English');
    expect(snapshot.explanationLevel).toBe('Simple');
    expect(snapshot.subject).toBe('Mathematics');
  });

  test('keeps the current surface and active Subject in the per-turn context snapshot', () => {
    const snapshot = buildLearnerSnapshot({
      learner: { firstName: 'Demo', grade: '12' },
      subject: 'Mathematics',
      currentSurface: 'dashboard',
      language: 'English',
      explanationLevel: 'Standard',
      gapMap: [],
      learningPath: [],
    });

    expect(snapshot.subject).toBe('Mathematics');
    expect(snapshot.currentSurface).toBe('dashboard');
    expect(snapshot.learner.grade).toBe('12');
  });

  test('injects only a bounded snapshot into the prompt', async () => {
    const store = createMockLearnerStore({ storage: createMemoryStorage() });
    for (let i = 0; i < 20; i += 1) {
      await store.appendTranscript('learner-bounded', { role: 'user', content: `turn ${i}` });
    }

    let capturedPrompt = '';
    const model = {
      async generateContentStream(request) {
        capturedPrompt = request.contents[0].parts[0].text;
        return {
          stream: (async function* () {
            yield { text: () => 'OK.' };
          })(),
        };
      },
    };

    const client = createAgentClient({
      model,
      store,
      getLearnerId: () => 'learner-bounded',
      getLearnerContext: async () => ({
        gapMap: [{ concept: 'Factorisation', pct: 25, status: 'weak' }],
        learningPath: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
        assessments: [{ id: 'assessment-1', items: [{ prompt: 'SECRET-ASSESSMENT' }] }],
        attempts: [{ id: 'attempt-1', responses: [{ item_id: 'q1', answer: 'SECRET-ATTEMPT' }] }],
        language: 'English',
        explanationLevel: 'Simple',
        subject: 'Mathematics',
        learner: { firstName: 'Thabo' },
      }),
    });

    await client.send('What should I study next?');

    expect(capturedPrompt).toContain('Factorisation');
    expect(capturedPrompt).toContain('Thabo');
    expect(capturedPrompt).toContain('"A"');
    expect(capturedPrompt).not.toContain('"H"');
    expect(capturedPrompt).not.toContain('SECRET-ASSESSMENT');
    expect(capturedPrompt).not.toContain('SECRET-ATTEMPT');
    expect(capturedPrompt).toContain('turn 19');
    expect(capturedPrompt).not.toContain('turn 0');
  });

  test('does not mask missing live setup with a local response', async () => {
    const client = createAgentClient(clientOptions());

    await expect(client.send('Help me understand factorisation')).rejects.toThrow(
      /Firebase AI Logic is not configured/,
    );
    expect(await client.getTranscript()).toEqual([]);
  });

  test('the prompt asks the Companion to use the Learner\'s name and answer site questions via getPlatformHelp', () => {
    expect(COMPANION_SYSTEM_PROMPT).toContain("use it naturally");
    expect(COMPANION_SYSTEM_PROMPT).toContain('getPlatformHelp');
    expect(buildCompanionPrompt({ message: 'hi' })).toContain('getPlatformHelp');
  });

  test('streams a Firebase AI Logic-compatible model response', async () => {
    const chunks = [];
    const model = {
      async generateContentStream(request) {
        const prompt = request.contents[0].parts[0].text;
        expect(prompt).toContain('learner-agent-test');
        return {
          stream: (async function* () {
            yield { text: () => 'Use ' };
            yield { text: () => 'the pattern.' };
          })(),
        };
      },
    };

    const client = createAgentClient(clientOptions(model));
    const result = await client.send('Explain the next step', {
      onToken: (token) => chunks.push(token),
    });

    expect(result.source).toBe('firebase-ai-logic');
    expect(result.text).toBe('Use the pattern.');
    expect(chunks).toEqual(['Use ', 'the pattern.']);
  });

  test('retries a transient capacity failure before using the model response', async () => {
    let calls = 0;
    const client = createAgentClient({
      ...clientOptions(),
      models: [{
        name: 'gemini-3.5-flash-lite',
        model: {
          async generateContentStream() {
            calls += 1;
            if (calls === 1) throw new Error('500 high demand');
            return {
              stream: (async function* () {
                yield { text: () => 'Retry works.' };
              })(),
            };
          },
        },
      }],
      retryAttempts: 1,
      retryDelayMs: 0,
    });
    const result = await client.send('Explain the next step');

    expect(calls).toBe(2);
    expect(result.source).toBe('firebase-ai-logic');
    expect(result.modelName).toBe('gemini-3.5-flash-lite');
    expect(result.text).toBe('Retry works.');
  });

  test('moves to the fallback model after a transient capacity failure', async () => {
    const client = createAgentClient({
      ...clientOptions(),
      models: [
        {
          name: 'gemini-3.5-flash-lite',
          model: {
            async generateContentStream() {
              return {
                stream: (async function* () {
                  yield { text: () => 'Fallback works.' };
                })(),
              };
            },
          },
        },
      ],
      retryAttempts: 0,
    });
    const result = await client.send('Explain the next step');

    expect(result.source).toBe('firebase-ai-logic');
    expect(result.modelName).toBe('gemini-3.5-flash-lite');
    expect(result.text).toBe('Fallback works.');
  });

  test('surfaces App Check failures instead of masking them', async () => {
    const client = createAgentClient({
      ...clientOptions({
        async generateContentStream() {
          throw new Error('App Check unavailable');
        },
      }),
      retryAttempts: 0,
    });

    await expect(client.send('Help me with a difficult Item')).rejects.toThrow(
      /App Check unavailable/,
    );
  });

  test('replaces a partial stream when the live model fails mid-response', async () => {
    const client = createAgentClient({
      ...clientOptions({
        async generateContentStream() {
          return {
            stream: (async function* () {
              yield { text: () => 'partial reply' };
              throw new Error('stream interrupted');
            })(),
          };
        },
      }),
      retryAttempts: 0,
    });
    let resetCount = 0;
    await expect(client.send('Help me with a difficult Item', {
      onReset: () => {
        resetCount += 1;
      },
    })).rejects.toThrow(/stream interrupted/);

    expect(resetCount).toBe(1);
  });

  test('declares the getPlatformHelp discovery tool', () => {
    const names = COMPANION_TOOLS[0].functionDeclarations.map((tool) => tool.name);
    expect(names).toContain('getPlatformHelp');
  });

  test('executes the getPlatformHelp tool and grounds it in this Learner', async () => {
    const store = createMockLearnerStore({ storage: createMemoryStorage() });
    const practice = await generateAssessment({ type: 'practice', id: 'platform-practice' });
    await store.putAssessment('learner-tool', practice);
    const diagnostic = await generateAssessment({ type: 'diagnostic', id: 'tool-diagnostic' });
    await store.putAssessment('learner-tool', diagnostic);
    await store.saveAttempt('learner-tool', {
      id: 'attempt-tool',
      assessment_id: 'tool-diagnostic',
      learner_id: 'learner-tool',
      started_at: '2026-01-01T10:00:00.000Z',
      completed_at: '2026-01-01T10:02:00.000Z',
      responses: [],
      scores: [
        { concept: 'Factorisation', correct: 1, total: 3, pct: 33, status: 'weak' },
      ],
      overall_pct: 33,
    });

    const model = toolTurnModel([
      { calls: [{ name: 'getPlatformHelp', args: {} }], text: '' },
      { calls: undefined, text: 'Open the dashboard — your Gap Map is ready.' },
    ]);

    const client = createAgentClient({
      model,
      store,
      getLearnerId: () => 'learner-tool',
      getLearnerProfile: () => ({ grade: '12', subject: 'Mathematics' }),
      getLearnerContext: async () => ({}),
    });

    const result = await client.send('How does the site work?');
    expect(result.text).toBe('Open the dashboard — your Gap Map is ready.');

    const secondContents = model.requests[1].contents;
    const userTurn = secondContents.find(
      (content) => content.role === 'user' && content.parts.some((part) => part.functionResponse),
    );
    const functionResponse = userTurn.parts[0].functionResponse;
    expect(functionResponse.name).toBe('getPlatformHelp');
    // Grounded in the Learner's state, not generic directions.
    expect(functionResponse.response.grade).toBe('12');
    expect(functionResponse.response.subject).toBe('Mathematics');
    expect(functionResponse.response.hasGapMap).toBe(true);
    expect(functionResponse.response.nextConcepts).toEqual(['Factorisation']);
    expect(functionResponse.response.hasUnattemptedPractice).toBe(true);
    expect(functionResponse.response.unattemptedPractice.id).toBe('platform-practice');
    const surfaceNames = functionResponse.response.surfaces.map((surface) => surface.name);
    expect(surfaceNames).toContain('Dashboard (dashboard.html)');
    expect(surfaceNames).toContain('Library (library.html)');
    expect(surfaceNames).toContain('Profile & preferences (profile.html, behind the avatar)');
  });

  test('executes the getGapMap tool and feeds the real Gap Map back to the model', async () => {
    const store = createMockLearnerStore({ storage: createMemoryStorage() });
    const assessment = await generateAssessment({ type: 'practice', id: 'tool-practice' });
    await store.putAssessment('learner-tool', assessment);
    await store.saveAttempt('learner-tool', {
      id: 'attempt-tool',
      assessment_id: assessment.id,
      learner_id: 'learner-tool',
      started_at: '2026-01-01T10:00:00.000Z',
      completed_at: '2026-01-01T10:02:00.000Z',
      responses: [],
      scores: [
        { concept: 'Factorisation', correct: 1, total: 3, pct: 33, status: 'weak' },
      ],
      overall_pct: 33,
    });

    const model = toolTurnModel([
      { calls: [{ name: 'getGapMap', args: {} }], text: '' },
      { calls: undefined, text: 'Your weakest Concept is Factorisation.' },
    ]);

    const toolCalls = [];
    const client = createAgentClient({
      model,
      store,
      getLearnerId: () => 'learner-tool',
      getLearnerContext: async () => ({}),
    });

    const result = await client.send('What should I study next?', {
      onToolCall: (name, args) => toolCalls.push({ name, args }),
    });
    expect(result.text).toBe('Your weakest Concept is Factorisation.');

    // The panel is notified of each tool call for visual feedback.
    expect(toolCalls).toEqual([{ name: 'getGapMap', args: {} }]);

    // The tools were declared to the model on the first request.
    expect(model.requests[0].tools).toEqual(COMPANION_TOOLS);

    // The second request echoes the functionCall part back verbatim (the
    // thoughtSignature sibling is preserved) and carries the function response
    // with the real Gap Map.
    const secondContents = model.requests[1].contents;
    const modelTurn = secondContents.find((content) => content.role === 'model');
    expect(modelTurn.parts[0].functionCall.name).toBe('getGapMap');
    expect(modelTurn.parts[0].thoughtSignature).toBe('sig-getGapMap');

    const userTurn = secondContents.find(
      (content) => content.role === 'user' && content.parts.some((part) => part.functionResponse),
    );
    const functionResponse = userTurn.parts[0].functionResponse;
    expect(functionResponse.name).toBe('getGapMap');
    expect(functionResponse.response.gapMap).toEqual([
      { concept: 'Factorisation', correct: 1, total: 3, pct: 33, status: 'weak' },
    ]);
    expect(functionResponse.response.learningPath).toEqual(['Factorisation']);
  });

  test('getLearningPath returns the full ordered path', async () => {
    const store = await seededToolStore();
    const model = toolTurnModel([
      { calls: [{ name: 'getLearningPath', args: {} }], text: '' },
      { calls: undefined, text: 'Here is your path.' },
    ]);

    await toolClient(model, store).send('What is my full path?');
    const fr = functionResponseFrom(model);
    expect(fr.name).toBe('getLearningPath');
    expect(fr.response.learningPath).toEqual(['Factorisation']);
  });

  test('getConcept returns the Items covering a Concept', async () => {
    const store = await seededToolStore();
    const assessment = await store.getAssessment('learner-tool', 'tool-practice');
    const model = toolTurnModel([
      { calls: [{ name: 'getConcept', args: { concept: 'Factorisation' } }], text: '' },
      { calls: undefined, text: 'Here are the items.' },
    ]);

    await toolClient(model, store).send('Show me Factorisation content');
    const fr = functionResponseFrom(model);
    expect(fr.name).toBe('getConcept');
    expect(fr.response.concept).toBe('Factorisation');
    expect(fr.response.items).toHaveLength(assessment.items.length);
    expect(fr.response.items[0].concept).toBe('Factorisation');
  });

  test('getSubjectConcepts returns the active Subject concept vocabulary', async () => {
    const store = await seededToolStore();
    const model = toolTurnModel([
      { calls: [{ name: 'getSubjectConcepts', args: {} }], text: '' },
      { calls: undefined, text: 'Here are the Concepts.' },
    ]);
    const client = createAgentClient({
      model,
      store,
      getLearnerId: () => 'learner-tool',
      getLearnerProfile: () => ({ grade: '12', subject: 'Mathematics' }),
      getSubjectConcepts: async () => ({
        grade: '12',
        subject: 'Mathematics',
        concepts: [
          { concept: 'Factorisation', description: 'Common factors and trinomials', originGrade: '9' },
          { concept: 'Quadratic Equations', description: 'Solving quadratic equations', originGrade: '11' },
        ],
      }),
      getLearnerContext: async () => ({}),
    });

    await client.send('What Concepts are in my active Subject?');
    const fr = functionResponseFrom(model);
    expect(fr.name).toBe('getSubjectConcepts');
    expect(fr.response.subject).toBe('Mathematics');
    expect(fr.response.concepts.map((entry) => entry.concept)).toEqual([
      'Factorisation',
      'Quadratic Equations',
    ]);
  });

  test('getConcept rejects a Concept outside the active Subject', async () => {
    const store = createMockLearnerStore({ storage: createMemoryStorage() });
    const assessment = await generateAssessment({ type: 'practice', id: 'science-practice' });
    assessment.subject = 'Physical Sciences';
    assessment.concepts = [{ name: 'Newton Laws' }];
    assessment.items.forEach((item) => { item.concept = 'Newton Laws'; });
    await store.putAssessment('learner-tool', assessment);

    const model = toolTurnModel([
      { calls: [{ name: 'getConcept', args: { concept: 'Newton Laws' } }], text: '' },
      { calls: undefined, text: 'That Concept is not in the active Subject.' },
    ]);

    await createAgentClient({
      model,
      store,
      getLearnerId: () => 'learner-tool',
      getLearnerProfile: () => ({ grade: '12', subject: 'Mathematics' }),
      getConceptGraph: async () => ({ nodes: [], edges: [] }),
      getLearnerContext: async () => ({}),
    }).send('Explain Newton Laws');

    const fr = functionResponseFrom(model);
    expect(fr.response.available).toBe(false);
    expect(fr.response.items).toEqual([]);
  });

  test('getMistakeDiagnosis returns the stored diagnosis for a wrong Response', async () => {
    const store = createMockLearnerStore({ storage: createMemoryStorage() });
    const assessment = await generateAssessment({ type: 'practice', id: 'diagnosis-practice' });
    assessment.items[0].wrong_explanations = [{
      answer: 999,
      explanation: 'You used the wrong sign when substituting the value.',
      kind: 'misread',
    }];
    await store.putAssessment('learner-tool', assessment);
    await store.saveAttempt('learner-tool', {
      id: 'attempt-diagnosis',
      assessment_id: assessment.id,
      learner_id: 'learner-tool',
      started_at: '2026-01-01T10:00:00.000Z',
      completed_at: '2026-01-01T10:02:00.000Z',
      responses: [{ item_id: assessment.items[0].id, answer: 999, correct: false }],
      scores: [{ concept: assessment.items[0].concept, correct: 0, total: 1, pct: 0, status: 'weak' }],
      overall_pct: 0,
    });

    const model = toolTurnModel([
      { calls: [{ name: 'getMistakeDiagnosis', args: { itemId: assessment.items[0].id } }], text: '' },
      { calls: undefined, text: 'Here is the Mistake Diagnosis.' },
    ]);
    await createAgentClient({
      model,
      store,
      getLearnerId: () => 'learner-tool',
      getLearnerProfile: () => ({ grade: '12', subject: 'Mathematics' }),
      getLearnerContext: async () => ({}),
    }).send('Why did I get this wrong?');

    const fr = functionResponseFrom(model);
    expect(fr.name).toBe('getMistakeDiagnosis');
    expect(fr.response.found).toBe(true);
    expect(fr.response.diagnoses[0].diagnosis).toEqual({
      explanation: 'You used the wrong sign when substituting the value.',
      kind: 'misread',
      prerequisite: null,
    });
  });

  test('getMistakeDiagnosis reports missing stored data instead of fabricating it', async () => {
    const store = await seededToolStore();
    const model = toolTurnModel([
      { calls: [{ name: 'getMistakeDiagnosis', args: { itemId: 'missing-item' } }], text: '' },
      { calls: undefined, text: 'No stored Mistake Diagnosis is available for that Response.' },
    ]);
    await toolClient(model, store).send('Why was I wrong?');
    const fr = functionResponseFrom(model);
    expect(fr.response.found).toBe(false);
    expect(fr.response.diagnoses).toEqual([]);
    expect(fr.response.reason).toMatch(/No stored Mistake Diagnosis/);
  });

  test('navigateTo executes only through the injected panel navigation seam', async () => {
    const store = await seededToolStore();
    const navigations = [];
    const model = toolTurnModel([
      { calls: [{ name: 'navigateTo', args: { surface: 'library' } }], text: '' },
      { calls: undefined, text: 'Opening the Library.' },
    ]);
    await createAgentClient({
      model,
      store,
      getLearnerId: () => 'learner-tool',
      getLearnerContext: async () => ({}),
      navigate: async (target) => navigations.push(target),
    }).send('Open the Library');

    const fr = functionResponseFrom(model);
    expect(navigations).toEqual([{ surface: 'library', concept: null, url: 'library.html' }]);
    expect(fr.response).toMatchObject({ navigated: true, surface: 'library', url: 'library.html' });
  });

  test('getItem returns a specific Item with its Assessment', async () => {
    const store = await seededToolStore();
    const assessment = await store.getAssessment('learner-tool', 'tool-practice');
    const itemId = assessment.items[0].id;
    const model = toolTurnModel([
      { calls: [{ name: 'getItem', args: { itemId } }], text: '' },
      { calls: undefined, text: 'Here is the item.' },
    ]);

    await toolClient(model, store).send('Show me that item');
    const fr = functionResponseFrom(model);
    expect(fr.name).toBe('getItem');
    expect(fr.response.item.id).toBe(itemId);
    expect(fr.response.assessmentId).toBe('tool-practice');
  });

  test('getItem reports a missing Item instead of inventing one', async () => {
    const store = await seededToolStore();
    const model = toolTurnModel([
      { calls: [{ name: 'getItem', args: { itemId: 'does-not-exist' } }], text: '' },
      { calls: undefined, text: 'I could not find that Item.' },
    ]);

    await toolClient(model, store).send('Show me that item');
    const fr = functionResponseFrom(model);
    expect(fr.response.item).toBeNull();
  });

  test('getAttemptHistory returns past Attempts for a Concept', async () => {
    const store = await seededToolStore();
    const model = toolTurnModel([
      { calls: [{ name: 'getAttemptHistory', args: { concept: 'Factorisation' } }], text: '' },
      { calls: undefined, text: 'Here is your history.' },
    ]);

    await toolClient(model, store).send('How have I done on Factorisation?');
    const fr = functionResponseFrom(model);
    expect(fr.name).toBe('getAttemptHistory');
    expect(fr.response.concept).toBe('Factorisation');
    expect(fr.response.history).toHaveLength(1);
    expect(fr.response.history[0].conceptScore).toEqual({
      concept: 'Factorisation',
      correct: 1,
      total: 3,
      pct: 33,
      status: 'weak',
    });
  });

  test('surfaces an unknown tool instead of masking it', async () => {
    const store = await seededToolStore();
    const model = toolTurnModel([
      { calls: [{ name: 'notARealTool', args: {} }], text: '' },
    ]);

    await expect(toolClient(model, store).send('Do the thing')).rejects.toThrow(
      /Unknown Companion tool/,
    );
  });

  test('generateAssessment persists a grounded Assessment and returns a summary', async () => {
    const store = await seededToolStore();
    const model = toolTurnModel([
      { calls: [{ name: 'generateAssessment', args: { type: 'practice' } }], text: '' },
      { calls: undefined, text: 'I generated a Practice for you.' },
    ]);

    await toolClient(model, store).send('Generate a practice for me');
    const fr = functionResponseFrom(model);
    expect(fr.name).toBe('generateAssessment');
    expect(fr.response.type).toBe('practice');
    expect(fr.response.targetConcept).toBe('Factorisation'); // Learning Path head
    expect(fr.response.itemCount).toBeGreaterThan(0);

    const persisted = await store.getAssessment('learner-tool', fr.response.id);
    expect(persisted).not.toBeNull();
    expect(persisted.type).toBe('practice');
  });

  test('generateAssessment uses the model-backed generator when a live model is available', async () => {
    const store = await seededToolStore();
    const localAssessment = await generateAssessment({ type: 'practice', id: 'model-practice' });
    const model = toolTurnModel(
      [
        { calls: [{ name: 'generateAssessment', args: { type: 'practice' } }], text: '' },
        { calls: undefined, text: 'I generated a Practice for you.' },
      ],
      async function generateContent(request) {
        const prompt = request.contents[0].parts[0].text;
        // The generator prompt is grounded in the Learner's Gap Map / Learning
        // Path and carries the known Concepts so Items can be tagged.
        expect(prompt).toContain('Factorisation');
        expect(prompt).toContain('"concepts"');
        return { response: { text: () => JSON.stringify(localAssessment) } };
      },
    );

    await toolClient(model, store).send('Generate a practice for me');
    const fr = functionResponseFrom(model);
    expect(fr.response.type).toBe('practice');
    const persisted = await store.getAssessment('learner-tool', fr.response.id);
    expect(persisted).not.toBeNull();
  });

  test('generateAssessment retries the model-backed generator with a corrective hint', async () => {
    const store = await seededToolStore();
    const localAssessment = await generateAssessment({ type: 'practice', id: 'retry-practice' });
    const invalid = structuredClone(localAssessment);
    invalid.items[0].concept = 'NotARealConcept';

    let calls = 0;
    const model = toolTurnModel(
      [
        { calls: [{ name: 'generateAssessment', args: { type: 'practice' } }], text: '' },
        { calls: undefined, text: 'I generated a Practice for you.' },
      ],
      async function generateContent(request) {
        const prompt = request.contents[0].parts[0].text;
        calls += 1;
        if (calls === 1) {
          return { response: { text: () => JSON.stringify(invalid) } };
        }
        expect(prompt).toContain('rejected');
        return { response: { text: () => JSON.stringify(localAssessment) } };
      },
    );

    await toolClient(model, store).send('Generate a practice for me');
    expect(calls).toBe(2);
    const fr = functionResponseFrom(model);
    expect(fr.response.type).toBe('practice');
  });

  test('generateAssessment rejects an invalid type', async () => {
    const store = await seededToolStore();
    const model = toolTurnModel([
      { calls: [{ name: 'generateAssessment', args: { type: 'quiz' } }], text: '' },
    ]);

    await expect(toolClient(model, store).send('Generate a quiz')).rejects.toThrow(
      /requires type/,
    );
  });

  test('guards against a model that calls tools indefinitely', async () => {
    const model = toolTurnModel([
      { calls: [{ name: 'getGapMap', args: {} }], text: '' },
    ]);
    const client = createAgentClient({
      model,
      store: createMockLearnerStore({ storage: createMemoryStorage() }),
      getLearnerId: () => 'learner-tool',
      getLearnerContext: async () => ({}),
    });

    await expect(client.send('Keep calling tools')).rejects.toThrow(/too many tools/);
  });
});

test.describe('root-cause tools (ADR-0006)', () => {
  const demoGraph = () =>
    yaml.load(
      readFileSync(join(process.cwd(), 'data/subjects/graph-g12-mathematics.yaml'), 'utf8'),
      { schema: yaml.JSON_SCHEMA },
    );

  // Two weak Concepts with a prerequisite edge between them — the demo
  // narrative: Factorisation blocks Quadratic Equations at the same Score.
  async function seededGraphStore() {
    const store = createMockLearnerStore({ storage: createMemoryStorage() });
    const assessment = await generateAssessment({ type: 'practice', id: 'graph-practice' });
    await store.putAssessment('learner-tool', assessment);
    await store.saveAttempt('learner-tool', {
      id: 'attempt-graph',
      assessment_id: assessment.id,
      learner_id: 'learner-tool',
      started_at: '2026-01-01T10:00:00.000Z',
      completed_at: '2026-01-01T10:02:00.000Z',
      responses: [],
      scores: [
        { concept: 'Factorisation', correct: 1, total: 3, pct: 33, status: 'weak' },
        { concept: 'Quadratic Equations', correct: 1, total: 3, pct: 33, status: 'weak' },
      ],
      overall_pct: 33,
    });
    return store;
  }

  test('getGapMap returns the derived root-cause chain when the Subject has a Concept Graph', async () => {
    const store = await seededGraphStore();
    const model = toolTurnModel([
      { calls: [{ name: 'getGapMap', args: {} }], text: '' },
      { calls: undefined, text: 'Factorisation is the root.' },
    ]);

    await createAgentClient({
      model,
      store,
      getLearnerId: () => 'learner-tool',
      getLearnerContext: async () => ({}),
      getConceptGraph: async () => demoGraph(),
    }).send('Why am I stuck?');

    const fr = functionResponseFrom(model);
    expect(fr.name).toBe('getGapMap');
    expect(fr.response.learningPath.map((entry) => entry.concept)).toEqual([
      'Factorisation',
      'Quadratic Equations',
    ]);
    expect(fr.response.learningPath[0]).toMatchObject({
      concept: 'Factorisation',
      origin: '9',
      blocks: ['Quadratic Equations'],
    });
    expect(fr.response.rootCauses).toHaveLength(1);
    expect(fr.response.rootCauses[0]).toMatchObject({
      concept: 'Factorisation',
      blocks: ['Quadratic Equations'],
    });
  });

  test('getLearningPath carries the derived chain and roots', async () => {
    const store = await seededGraphStore();
    const model = toolTurnModel([
      { calls: [{ name: 'getLearningPath', args: {} }], text: '' },
      { calls: undefined, text: 'Here is your path.' },
    ]);

    await createAgentClient({
      model,
      store,
      getLearnerId: () => 'learner-tool',
      getLearnerContext: async () => ({}),
      getConceptGraph: async () => demoGraph(),
    }).send('What is my path?');

    const fr = functionResponseFrom(model);
    expect(fr.response.learningPath[0]).toMatchObject({ concept: 'Factorisation', origin: '9' });
    expect(fr.response.rootCauses[0].concept).toBe('Factorisation');
  });

  test('a Subject without a graph keeps the flat path even with a provider', async () => {
    const store = await seededToolStore();
    const model = toolTurnModel([
      { calls: [{ name: 'getGapMap', args: {} }], text: '' },
      { calls: undefined, text: 'Factorisation is next.' },
    ]);

    await createAgentClient({
      model,
      store,
      getLearnerId: () => 'learner-tool',
      getLearnerContext: async () => ({}),
      // The provider exists but this Subject has no graph (404 → null).
      getConceptGraph: async () => null,
    }).send('What should I study next?');

    const fr = functionResponseFrom(model);
    expect(fr.response.learningPath).toEqual(['Factorisation']);
    expect(fr.response.rootCauses).toBeUndefined();
  });

  test('getConcept returns the prerequisite chain for a Concept', async () => {
    const store = await seededGraphStore();
    const model = toolTurnModel([
      { calls: [{ name: 'getConcept', args: { concept: 'Factorisation' } }], text: '' },
      { calls: undefined, text: 'It blocks Quadratic Equations.' },
    ]);

    await createAgentClient({
      model,
      store,
      getLearnerId: () => 'learner-tool',
      getLearnerContext: async () => ({}),
      getConceptGraph: async () => demoGraph(),
    }).send('Tell me about Factorisation');

    const fr = functionResponseFrom(model);
    expect(fr.response.prerequisites).toEqual(['Expanding Brackets']);
    expect(fr.response.dependents).toEqual(['Quadratic Equations']);
  });

  test('generateAssessment targets the head of the derived chain', async () => {
    const store = await seededGraphStore();
    const model = toolTurnModel([
      { calls: [{ name: 'generateAssessment', args: { type: 'practice' } }], text: '' },
      { calls: undefined, text: 'I generated a Practice for you.' },
    ]);

    await createAgentClient({
      model,
      store,
      getLearnerId: () => 'learner-tool',
      getLearnerContext: async () => ({}),
      getConceptGraph: async () => demoGraph(),
    }).send('Generate a practice for me');

    const fr = functionResponseFrom(model);
    expect(fr.response.targetConcept).toBe('Factorisation');
  });
});
