import { createMockLearnerStore, getCurrentLearner, getCurrentLearnerId } from './learner-store.js';
import { createAssessmentForLearner } from './assessment-service.js';
import { createModelAssessmentGenerator } from './assessment-generator.js';
import { buildLearningPath, mistakeKindsByConcept } from '../../core/learning-path.js';

export const COMPANION_SYSTEM_PROMPT = [
  'You are GapMap’s Learning Companion, a site agent for the signed-in Learner.',
  'Help the Learner navigate GapMap, understand Concepts in the active Subject,',
  'use the Gap Map and Learning Path to choose a next step, and explain why a wrong Response was wrong.',
  'For Subject questions, ground the explanation in the active Subject and Concepts returned by the tools; do not fill missing curriculum facts from guesswork.',
  'When the Learner asks how to reach a GapMap surface, use getPlatformHelp when you need state-aware guidance,',
  'then use navigateTo when the Learner clearly asks you to open or take them to a surface.',
  'Use getConcept before explaining a Concept that is not already present in the bounded context.',
  'Use getMistakeDiagnosis for a wrong Response instead of inventing a diagnosis. If no stored Mistake Diagnosis exists, say that it is unavailable.',
  'When the Learner’s name is in context, use it naturally.',
  'Respect the Learner’s Language and Explanation Level.',
  'Never invent Diagnostic results, Scores, Mastery, Concepts, navigation targets, or Mistake Diagnoses.',
  'If a tool fails, surface the failure plainly and do not replace it with a guessed answer.',
  'You are not an Assessment engine unless the request explicitly asks for a Diagnostic or Practice.',
].join(' ');

function contextWithoutTranscript(context = {}, learnerId) {
  const safe = { ...context, learnerId };
  delete safe.transcript;
  return safe;
}

// A Learning Path entry is either a Concept name (the flat, graph-less
// derivation) or a derived object (ADR-0006) — accept both everywhere.
export function pathEntryConcept(entry) {
  return typeof entry === 'string' ? entry : entry?.concept;
}

function pathHeadConcept(learningPath = []) {
  return pathEntryConcept(learningPath[0]) || null;
}

export function buildCompanionContext({
  learnerId,
  learnerContext = {},
} = {}) {
  const snapshot = buildLearnerSnapshot(
    contextWithoutTranscript(learnerContext, learnerId),
  );
  return {
    learnerId,
    learner: snapshot.learner || null,
    grade: snapshot.learner?.grade || snapshot.grade || null,
    activeSubject: snapshot.subject || snapshot.activeSubject || null,
    language: snapshot.language || snapshot.learner?.language || null,
    explanationLevel: snapshot.explanationLevel || snapshot.learner?.explanationLevel || null,
    currentSurface: snapshot.currentSurface || null,
    gapMap: snapshot.gapMap || [],
    learningPathHead: snapshot.learningPath || [],
  };
}

export function buildCompanionPrompt({
  message,
  learnerId,
  learnerContext = {},
  transcript = [],
  systemPrompt = COMPANION_SYSTEM_PROMPT,
} = {}) {
  const history = transcript
    .map((turn) => `${turn.role === 'assistant' ? 'Companion' : 'Learner'}: ${turn.content}`)
    .join('\n');

  return [
    systemPrompt,
    '',
    '<companion_context>',
    JSON.stringify(buildCompanionContext({ learnerId, learnerContext }), null, 2),
    '</companion_context>',
    '',
    '<conversation_transcript>',
    history || '(no previous turns)',
    '</conversation_transcript>',
    '',
    '<learner_message>',
    message,
    '</learner_message>',
  ].join('\n');
}

// The bounded snapshot injected into every prompt. Unbounded collections
// (assessments, attempts, the full transcript) are discoverable via tools, not
// injected; the Learning Path is capped at its head so the prompt stays small
// regardless of how many lessons the Learner has completed.
export const LEARNING_PATH_HEAD_SIZE = 5;
export const TRANSCRIPT_TAIL_SIZE = 12;

export function buildLearnerSnapshot(context = {}, {
  learningPathHeadSize = LEARNING_PATH_HEAD_SIZE,
} = {}) {
  const snapshot = { ...context };
  delete snapshot.assessments;
  delete snapshot.attempts;
  delete snapshot.transcript;
  if (
    Array.isArray(snapshot.learningPath) &&
    snapshot.learningPath.length > learningPathHeadSize
  ) {
    snapshot.learningPath = snapshot.learningPath.slice(0, learningPathHeadSize);
  }
  return snapshot;
}

function chunkText(chunk) {
  if (typeof chunk === 'string') return chunk;
  if (typeof chunk?.text === 'function') {
    try {
      return chunk.text();
    } catch (_error) {
      return '';
    }
  }
  if (typeof chunk?.text === 'string') return chunk.text;
  return '';
}

function responseText(result) {
  const response = result?.response || result;
  if (typeof response?.text === 'function') return response.text();
  if (typeof response?.text === 'string') return response.text;
  if (typeof result?.text === 'function') return result.text();
  if (typeof result?.text === 'string') return result.text;
  return '';
}

// Companion tools: the model discovers Learner context on demand instead of
// having it all injected into every prompt. `generateAssessment` is documented
// in docs/adr/0005-companion-tool-calling.md and will land separately.
export const COMPANION_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'getGapMap',
        description:
          "Returns the Learner's current Gap Map (per-Concept mastery rollup: each Concept with its Score and status) and the Learning Path. When the Subject has a Concept Graph, learningPath is the derived chain — roots first, each entry carrying its origin grade, what it blocks and what blocks it — and rootCauses names what is holding the Learner back. Call this whenever the Learner asks about their progress, what to study next, or before generating an Assessment, so your answer is grounded in real data instead of guessed.",
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'getLearningPath',
        description:
          "Returns the Learner's full ordered Learning Path. When the Subject has a Concept Graph the path is the derived chain: roots first (rootCauses names them), each entry with its origin grade, what it blocks and what blocks it; without a graph it is the Concepts not yet mastered in severity order. The prompt snapshot only includes the head of the path; call this when you need the whole path or the root cause.",
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'getConcept',
        description:
          "Returns the Items covering a given Concept (the Concept's learning content), plus its prerequisites and dependents in the Subject's Concept Graph when one exists. Call this when the Learner asks to study or understand a specific Concept.",
        parameters: {
          type: 'object',
          properties: {
            concept: {
              type: 'string',
              description: 'The Concept name, e.g. Factorisation.',
            },
          },
          required: ['concept'],
        },
      },
      {
        name: 'getItem',
        description:
          'Returns a specific Item by its id, together with the Assessment it belongs to. Call this when the Learner references a particular Item.',
        parameters: {
          type: 'object',
          properties: {
            itemId: {
              type: 'string',
              description: 'The Item id.',
            },
          },
          required: ['itemId'],
        },
      },
      {
        name: 'getAttemptHistory',
        description:
          "Returns the Learner's past Attempts for a given Concept (each with its Score and Mastery). Call this when the Learner asks about their history on a Concept or how their Mastery changed.",
        parameters: {
          type: 'object',
          properties: {
            concept: {
              type: 'string',
              description: 'The Concept name, e.g. Factorisation.',
            },
          },
          required: ['concept'],
        },
      },
      {
        name: 'getPlatformHelp',
        description:
          "Returns a map of GapMap's own surfaces and how to reach them, grounded in this Learner's state (their grade and Subject, whether a Gap Map exists, whether an unattempted Practice is waiting). Call this when the Learner asks how the site works, where to find a feature, or what to do next in the app.",
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'getSubjectConcepts',
        description:
          "Returns the Concepts available in the Learner's active Subject, including descriptions and origin grades when the Subject has a Concept Graph. Use this before explaining a Concept that is not already in context, so explanations stay grounded in the active Subject.",
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'getMistakeDiagnosis',
        description:
          "Returns stored Mistake Diagnoses for wrong Responses in the Learner's active Subject. Optionally narrow by attemptId and itemId. If no attemptId is supplied, the latest completed Attempt for the active Subject is used. Never invent a diagnosis when the tool returns none.",
        parameters: {
          type: 'object',
          properties: {
            attemptId: {
              type: 'string',
              description: 'Optional Attempt id. If omitted, use the latest completed Attempt for the active Subject.',
            },
            itemId: {
              type: 'string',
              description: 'Optional Item id. If omitted, return all wrong Responses with stored Mistake Diagnoses in the selected Attempt.',
            },
          },
        },
      },
      {
        name: 'navigateTo',
        description:
          "Opens a GapMap surface for the Learner. Use only when the Learner clearly asks to open, go to, or take them to a surface. Supported surfaces are Dashboard, Diagnostic, Library, Concept, and Profile. For Concept, concept is required.",
        parameters: {
          type: 'object',
          properties: {
            surface: {
              type: 'string',
              enum: ['dashboard', 'diagnostic', 'library', 'concept', 'profile'],
              description: 'The GapMap surface to open.',
            },
            concept: {
              type: 'string',
              description: 'Required only for the concept surface.',
            },
          },
          required: ['surface'],
        },
      },
      {
        name: 'generateAssessment',
        description:
          "Generates and persists a new Assessment (Diagnostic or Practice) for the Learner, grounded in their Gap Map and Learning Path. Call this when the Learner asks for a new Assessment, or when Practice is the right next step. For Practice, target a Concept from the Learning Path (use getLearningPath or getGapMap first if you are unsure). Returns a summary (id, type, item count); point the Learner to the concept page for that Concept, where the Practice is served.",
        parameters: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['diagnostic', 'practice'],
              description: 'The kind of Assessment to generate.',
            },
            targetConcept: {
              type: 'string',
              description: 'The Concept to target (Practice only). Defaults to the head of the Learning Path.',
            },
            itemCount: {
              type: 'integer',
              description: 'The number of Items to generate.',
            },
          },
          required: ['type'],
        },
      },
    ],
  },
];

const MAX_TOOL_ITERATIONS = 5;

// The Learner Profile (auth-guard's `gapmap_user` in the browser) grounds the
// platform-help tool in the Learner's grade and Subject; the panel pages
// always have it in localStorage.
function defaultProfileProvider() {
  try {
    return getCurrentLearner()?.user || null;
  } catch (_error) {
    return null;
  }
}

function createToolExecutor({
  store,
  getLearnerId,
  modelAssessmentGenerator,
  getLearnerProfile = () => null,
  getConceptGraph = null,
  getSubjectConcepts = null,
  navigate = null,
}) {
  // ADR-0006: when the Subject has a Concept Graph, the Learning Path tools
  // return the derived chain (roots first, with blocks/blockedBy/origin and
  // Mistake-Diagnosis evidence) instead of the flat severity list. Without a
  // graph the tools keep their original shape — the degradation is honest.
  async function derivePath(context) {
    const gapMap = context.gapMap || [];
    const flat = context.learningPath || [];
    if (!getConceptGraph) return { path: flat, rootCauses: undefined };
    const graph = await getConceptGraph();
    if (!graph) return { path: flat, rootCauses: undefined };
    const derived = buildLearningPath({
      gapMap,
      graph,
      mistakeKinds: mistakeKindsByConcept(context.assessments, context.attempts),
    });
    return derived;
  }

  function normaliseSubject(value) {
    return String(value || '')
      .replace(/^Grade\\s*\\d+\\s*/i, '')
      .trim()
      .toLowerCase();
  }

  function assessmentBelongsToProfile(assessment, profile) {
    if (!assessment) return false;
    const assessmentSubject = normaliseSubject(assessment.subject);
    const activeSubject = normaliseSubject(profile?.subject);
    return !activeSubject || !assessmentSubject || assessmentSubject === activeSubject;
  }

  async function activeProfile() {
    return (typeof getLearnerProfile === 'function' && getLearnerProfile()) || {};
  }

  return async function executeTool(name, args) {
    const id = await getLearnerId();
    if (!store) throw new Error('Companion tools require a Learner store');

    if (name === 'getGapMap') {
      const context = await store.getContext(id);
      const derived = await derivePath(context);
      const result = {
        gapMap: context.gapMap || [],
        learningPath: derived.path || [],
      };
      if (derived.rootCauses) result.rootCauses = derived.rootCauses;
      return result;
    }

    if (name === 'getLearningPath') {
      const context = await store.getContext(id);
      const derived = await derivePath(context);
      const result = { learningPath: derived.path || [] };
      if (derived.rootCauses) result.rootCauses = derived.rootCauses;
      return result;
    }

    if (name === 'getSubjectConcepts') {
      if (typeof getSubjectConcepts !== 'function') {
        throw new Error('Subject Concept discovery is unavailable');
      }
      return getSubjectConcepts();
    }

    if (name === 'getMistakeDiagnosis') {
      const profile = await activeProfile();
      const assessments = (await store.listAssessments(id))
        .filter((assessment) => assessmentBelongsToProfile(assessment, profile));
      const assessmentsById = new Map(assessments.map((assessment) => [assessment.id, assessment]));
      const attempts = (await store.listAttempts(id))
        .filter((attempt) => assessmentsById.has(attempt.assessment_id));
      let attempt = args?.attemptId
        ? attempts.find((candidate) => candidate.id === args.attemptId)
        : attempts.find((candidate) => candidate.completed_at) || attempts[0];

      if (!attempt) {
        return {
          found: false,
          attemptId: null,
          diagnoses: [],
          reason: 'No Attempt is available for the active Subject.',
        };
      }

      const assessment = assessmentsById.get(attempt.assessment_id);
      if (!assessment) {
        throw new Error('The Attempt references an unavailable Assessment');
      }

      const itemById = new Map((assessment.items || []).map((item) => [item.id, item]));
      const responses = (attempt.responses || [])
        .filter((response) => response && response.correct === false)
        .filter((response) => !args?.itemId || response.item_id === args.itemId)
        .map((response) => {
          const item = itemById.get(response.item_id);
          if (!item) return null;
          const seed = (item.wrong_explanations || []).find(
            (candidate) => Object.is(candidate.answer, response.answer),
          );
          if (!seed) return null;
          return {
            attemptId: attempt.id,
            assessmentId: assessment.id,
            itemId: item.id,
            concept: item.concept,
            response: response.answer,
            diagnosis: {
              explanation: seed.explanation,
              kind: seed.kind || null,
              prerequisite: seed.prerequisite || null,
            },
          };
        })
        .filter(Boolean);

      return {
        found: responses.length > 0,
        attemptId: attempt.id,
        assessmentId: assessment.id,
        itemId: args?.itemId || null,
        diagnoses: responses,
        reason: responses.length ? null : 'No stored Mistake Diagnosis exists for the requested Response.',
      };
    }

    if (name === 'navigateTo') {
      const surface = String(args?.surface || '').toLowerCase();
      const concept = typeof args?.concept === 'string' ? args.concept.trim() : '';
      const urls = {
        dashboard: 'dashboard.html',
        diagnostic: 'diagnostic.html',
        library: 'library.html',
        profile: 'profile.html',
      };
      let url = urls[surface];
      if (surface === 'concept') {
        if (!concept) throw new Error('navigateTo concept requires a concept name');
        url = `concept.html?concept=${encodeURIComponent(concept)}`;
      }
      if (!url) throw new Error(`Unsupported navigation surface: ${surface || 'missing'}`);
      if (typeof navigate !== 'function') {
        throw new Error('GapMap navigation is unavailable');
      }
      await navigate({ surface, concept: concept || null, url });
      return { navigated: true, surface, concept: concept || null, url };
    }

    if (name === 'getConcept') {
      const concept = args?.concept;
      if (!concept) throw new Error('getConcept requires a concept name');
      const profile = await activeProfile();
      const assessments = (await store.listAssessments(id))
        .filter((assessment) => assessmentBelongsToProfile(assessment, profile));
      const items = assessments
        .flatMap((assessment) => assessment.items || [])
        .filter((item) => item.concept === concept);
      const result = { concept, items };
      if (getConceptGraph) {
        // Ground the Concept in the Subject's prerequisite chain (ADR-0006):
        // what it depends on, and what depends on it.
        const graph = await getConceptGraph();
        if (graph) {
          const node = (graph.nodes || []).find((candidate) => candidate.concept === concept);
          if (!node && items.length === 0) {
            return {
              concept,
              items: [],
              available: false,
              reason: 'The Concept is not present in the active Subject.',
            };
          }
          if (node) {
            result.description = node.description || null;
            result.originGrade = node.grade || null;
          }
          const prerequisites = (graph.edges || [])
            .filter((edge) => edge.for === concept)
            .map((edge) => edge.requires);
          const dependents = (graph.edges || [])
            .filter((edge) => edge.requires === concept)
            .map((edge) => edge.for);
          if (prerequisites.length) result.prerequisites = prerequisites;
          if (dependents.length) result.dependents = dependents;
        }
      }
      return result;
    }

    if (name === 'getItem') {
      const itemId = args?.itemId;
      if (!itemId) throw new Error('getItem requires an itemId');
      const assessments = await store.listAssessments(id);
      for (const assessment of assessments) {
        const item = (assessment.items || []).find((candidate) => candidate.id === itemId);
        if (item) return { item, assessmentId: assessment.id };
      }
      return { item: null, assessmentId: null };
    }

    if (name === 'getAttemptHistory') {
      const concept = args?.concept;
      if (!concept) throw new Error('getAttemptHistory requires a concept name');
      const attempts = await store.listAttempts(id);
      const history = attempts
        .map((attempt) => ({
          id: attempt.id,
          assessment_id: attempt.assessment_id,
          completed_at: attempt.completed_at,
          overall_pct: attempt.overall_pct,
          conceptScore: (attempt.scores || []).find((score) => score.concept === concept) || null,
        }))
        .filter((entry) => entry.conceptScore);
      return { concept, history };
    }

    if (name === 'getPlatformHelp') {
      const context = await store.getContext(id);
      const gapMap = context.gapMap || [];
      const learningPath = context.learningPath || [];
      const assessments = await store.listAssessments(id);
      const attemptedIds = new Set(
        (await store.listAttempts(id)).map((attempt) => attempt.assessment_id),
      );
      const openPractice = assessments.find(
        (assessment) =>
          assessment.type === 'practice' && !attemptedIds.has(assessment.id),
      );
      const profile =
        (typeof getLearnerProfile === 'function' && getLearnerProfile()) || {};

      return {
        grade: profile.grade || null,
        subject: profile.subject || null,
        hasGapMap: gapMap.length > 0,
        nextConcepts: learningPath.slice(0, 3).map(pathEntryConcept),
        hasUnattemptedPractice: Boolean(openPractice),
        unattemptedPractice: openPractice
          ? { id: openPractice.id, concept: openPractice.concepts?.[0]?.name || null }
          : null,
        surfaces: [
          { name: 'Dashboard (dashboard.html)', does: 'Your Gap Map and Learning Path for the active Subject, plus Retake Diagnostic to re-measure.' },
          { name: 'Diagnostic (diagnostic.html)', does: 'Measures your Concepts for your grade + Subject; the results build your Gap Map.' },
          { name: 'Concept page (concept.html?concept=…)', does: 'Learn and Practise one Concept; the Practice is composed from your generated assessments.' },
          { name: 'Library (library.html)', does: 'Past papers and videos filtered to your grade and active Subject; papers download through GapMap.' },
          { name: 'Profile & preferences (profile.html, behind the avatar)', does: 'Your Account (name, password) and Preferences (Subject, Language, Explanation Level).' },
          { name: 'This panel', does: 'Your Learning Companion session; a page can opt the session out with ?agent=off.' },
        ],
      };
    }

    if (name === 'generateAssessment') {
      const type = args?.type;
      if (!['diagnostic', 'practice'].includes(type)) {
        throw new Error('generateAssessment requires type: diagnostic or practice');
      }
      const context = await store.getContext(id);
      const gapMap = context.gapMap || [];
      const derived = await derivePath(context);
      const learningPath = derived.path || [];
      const isTargeted = type === 'practice';
      const targetConcept = args?.targetConcept || (isTargeted ? pathHeadConcept(learningPath) : undefined);
      const request = {
        type,
        targetConcept,
        itemCount: args?.itemCount,
        // Give the generator the Learner's known Concepts so every Item can be
        // tagged with a real one (the concept-tag bridge is load-bearing).
        concepts: gapMap.map((entry) => ({ name: entry.concept })),
        gapMap,
        learningPath,
      };
      const assessment = await createAssessmentForLearner({
        learnerId: id,
        request,
        store,
        generator: modelAssessmentGenerator || undefined,
      });
      return {
        id: assessment.id,
        type: assessment.type,
        itemCount: (assessment.items || []).length,
        targetConcept: targetConcept || null,
      };
    }

    throw new Error(`Unknown Companion tool: ${name}`);
  };
}

function functionCallPartsFrom(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return [];
  return parts.filter((part) => part && part.functionCall);
}

async function generateWithTools(model, contents, tools, onToken) {
  if (typeof model.generateContentStream === 'function') {
    const result = await model.generateContentStream({ contents, tools });
    const stream = result?.stream || result;
    const responsePromise = result?.response || null;

    let text = '';
    if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
      for await (const chunk of stream) {
        const next = chunkText(chunk);
        if (next) {
          text += next;
          onToken(next);
        }
      }
    }

    const response = responsePromise ? await responsePromise : null;
    const functionCallParts = functionCallPartsFrom(response);

    if (!text && response) {
      const fullText = responseText(response);
      if (fullText) {
        text = fullText;
        onToken(fullText);
      }
    }

    return { text, functionCallParts };
  }

  if (typeof model.generateContent === 'function') {
    const result = await model.generateContent({ contents, tools });
    const response = result?.response || result;
    const functionCallParts = functionCallPartsFrom(response);
    const text = responseText(result);
    if (text) onToken(text);
    return { text, functionCallParts };
  }

  throw new Error('Agent model must support generateContentStream or generateContent');
}

async function streamModelWithTools(model, prompt, tools, executeTool, onToken, onToolCall) {
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const { text, functionCallParts } = await generateWithTools(model, contents, tools, onToken);

    if (functionCallParts.length) {
      for (const part of functionCallParts) {
        if (onToolCall) onToolCall(part.functionCall.name, part.functionCall.args);
      }
      // Echo the model's functionCall parts back verbatim — the Gemini API
      // requires the thoughtSignature sibling to be preserved across turns.
      contents.push({ role: 'model', parts: functionCallParts });
      const userParts = [];
      for (const part of functionCallParts) {
        const call = part.functionCall;
        const toolResult = await executeTool(call.name, call.args);
        userParts.push({
          functionResponse: {
            name: call.name,
            id: call.id,
            response: toolResult,
          },
        });
      }
      contents.push({ role: 'user', parts: userParts });
      continue;
    }

    if (!text) throw new Error('Agent returned an empty reply');
    return text;
  }

  throw new Error('Agent called too many tools');
}

async function streamModel(model, prompt, onToken, {
  tools = null,
  executeTool = null,
  onToolCall = null,
} = {}) {
  if (tools && executeTool) {
    return streamModelWithTools(model, prompt, tools, executeTool, onToken, onToolCall);
  }

  if (typeof model.generateContentStream === 'function') {
    const result = await model.generateContentStream(prompt);
    const stream = result?.stream || result;
    let text = '';

    if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
      for await (const chunk of stream) {
        const next = chunkText(chunk);
        if (next) {
          text += next;
          onToken(next);
        }
      }
    }

    if (!text && result?.response) {
      text = responseText(result);
      if (text) onToken(text);
    }
    return text;
  }

  if (typeof model.generateContent === 'function') {
    const result = await model.generateContent(prompt);
    const text = responseText(result);
    if (text) onToken(text);
    return text;
  }

  throw new Error('Agent model must support generateContentStream or generateContent');
}

const TRANSIENT_MODEL_ERROR = /(?:\b429\b|\b5\d\d\b|high demand|temporar|unavailable|quota|rate limit|fetch-error)/i;

function modelEntries(model, models) {
  const candidates = Array.isArray(models) && models.length
    ? models
    : model
      ? [model]
      : [];

  return candidates
    .map((entry) => entry?.model ? entry : { model: entry, name: 'firebase-ai-logic' })
    .filter((entry) => entry.model);
}

function isTransientModelError(error) {
  return TRANSIENT_MODEL_ERROR.test(`${error?.code || ''} ${error?.message || error || ''}`);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function streamModelPool(
  entries,
  prompt,
  {
    onToken,
    onReset,
    retryAttempts,
    retryDelayMs,
    tools,
    executeTool,
    onToolCall,
  },
) {
  let lastError = null;

  for (let modelIndex = 0; modelIndex < entries.length; modelIndex += 1) {
    const entry = entries[modelIndex];

    for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
      let streamed = false;
      try {
        const text = await streamModel(entry.model, prompt, (token) => {
          streamed = true;
          onToken(token);
        }, { tools, executeTool, onToolCall });
        if (!text) throw new Error('Agent returned an empty reply');
        return { text, modelName: entry.name };
      } catch (error) {
        lastError = error;
        if (streamed) onReset();

        if (!isTransientModelError(error)) throw error;
        if (attempt < retryAttempts) {
          await wait(retryDelayMs * (2 ** attempt));
          continue;
        }

        // A capacity/quota failure is eligible for the next model in the
        // pool. Authentication, App Check, malformed prompts, and other
        // non-transient errors were already thrown above.
        break;
      }
    }
  }

  throw lastError || new Error('No Firebase AI Logic model is configured');
}

function defaultContextProvider({ learnerId, store }) {
  if (store && typeof store.getContext === 'function') {
    return store.getContext(learnerId);
  }
  return { learnerId };
}

export function createAgentClient({
  model = null,
  models = null,
  retryAttempts = 1,
  retryDelayMs = 300,
  store = createMockLearnerStore(),
  getLearnerId = () => getCurrentLearnerId(),
  getLearnerProfile = defaultProfileProvider,
  getLearnerContext = defaultContextProvider,
  getConceptGraph = null,
  getSubjectConcepts = null,
  navigate = null,
  systemPrompt = COMPANION_SYSTEM_PROMPT,
  tools = COMPANION_TOOLS,
  executeTool = null,
} = {}) {
  const availableModels = modelEntries(model, models);

  async function learnerId() {
    return Promise.resolve(getLearnerId());
  }

  // The generateAssessment tool uses the model-backed generator when a live
  // model is available (so it can author arbitrary Assessments), and falls
  // back to the local deterministic generator for the key-free demo/tests.
  const modelAssessmentGenerator = availableModels.length &&
    typeof availableModels[0].model.generateContent === 'function'
    ? createModelAssessmentGenerator({ model: availableModels[0].model })
    : null;

  const toolExecutor = executeTool || createToolExecutor({
    store,
    getLearnerId: () => learnerId(),
    modelAssessmentGenerator,
    getLearnerProfile,
    getConceptGraph,
    getSubjectConcepts,
    navigate,
  });

  async function transcriptFor(id) {
    if (store && typeof store.getTranscript === 'function') {
      return store.getTranscript(id);
    }
    return [];
  }

  return {
    async getLearnerId() {
      return learnerId();
    },

    async getTranscript() {
      return transcriptFor(await learnerId());
    },

    async send(message, { onToken = () => {}, onReset = () => {}, onToolCall = () => {} } = {}) {
      const text = String(message || '').trim();
      if (!text) throw new Error('A Companion message is required');

      const id = await learnerId();
      const previousTranscript = await transcriptFor(id);
      const context = await getLearnerContext({ learnerId: id, store });
      const userTurn = { role: 'user', content: text };

      // Inject only a bounded snapshot; the rest is discoverable via tools.
      const snapshot = buildLearnerSnapshot(context || {});
      const transcript = [...previousTranscript, userTurn].slice(-TRANSCRIPT_TAIL_SIZE);

      const prompt = buildCompanionPrompt({
        message: text,
        learnerId: id,
        learnerContext: snapshot,
        transcript,
        systemPrompt,
      });

      if (!availableModels.length) {
        throw new Error(
          'Firebase AI Logic is not configured; the live agent is disabled for this session',
        );
      }

      const liveReply = await streamModelPool(availableModels, prompt, {
        onToken,
        onReset,
        retryAttempts,
        retryDelayMs,
        tools,
        executeTool: toolExecutor,
        onToolCall,
      });

      if (store && typeof store.appendTranscript === 'function') {
        await store.appendTranscript(id, userTurn);
        await store.appendTranscript(id, {
          role: 'assistant',
          content: liveReply.text,
        });
      }
      // Keep a cloud copy as well as the local transcript so future Firebase
      // backed sessions can retain the Companion history. The live response is
      // never blocked by a transient Firestore write failure.
      import('./firebase-data-store.js').then(({ saveCompanionMessage }) =>
        Promise.all([
          saveCompanionMessage(id, userTurn),
          saveCompanionMessage(id, { role: 'assistant', content: liveReply.text }),
        ]),
      ).catch((error) => console.warn('[Firebase] Companion transcript sync skipped.', error));

      return {
        text: liveReply.text,
        source: 'firebase-ai-logic',
        learnerId: id,
        prompt,
        modelName: liveReply.modelName,
      };
    },

    async reset() {
      const id = await learnerId();
      if (store && typeof store.clearTranscript === 'function') {
        await store.clearTranscript(id);
      }
    },
  };
}

export function createDefaultAgentClient(options = {}) {
  return createAgentClient(options);
}
