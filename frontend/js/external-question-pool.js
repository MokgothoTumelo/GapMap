// External Question Pool — Oak National Academy MCQ dataset
//
// This module is a source adapter, not a replacement for GapMap's Item model.
// External questions are admitted only when they can be mapped confidently to
// exactly one existing Concept. The Concept tag is assigned before an Item can
// enter Diagnostic or Practice, so an unclassified external question is dropped
// rather than being allowed to contaminate the Concept pipeline.
//
// Source: Oak National Academy's archived MCQ dataset. The dataset is released
// under the Open Government Licence v3.0 and may be reused commercially with
// the required attribution. See the project/source page for provenance.

export const OAK_MCQ_URL =
  'https://raw.githubusercontent.com/oaknational/oak-dspy-mcq-eval/main/data/mcq_mindiff_dataset.json';

export const OAK_MCQ_ATTRIBUTION =
  'Contains data from Oak National Academy, derived from Clark, H.-B. et al. (2024), “Auto-Evaluation: A Critical Measure in Driving Improvements in Quality and Safety of AI-Generated Lesson Resources”, AI + Open Education Initiative. Data licensed under the Open Government Licence v3.0.';

let sourcePromise = null;

const STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'into', 'what', 'which', 'does', 'this',
  'that', 'how', 'why', 'when', 'where', 'are', 'is', 'of', 'to', 'in', 'a',
  'an', 'on', 'or', 'by', 'as', 'be', 'can', 'their', 'your', 'one', 'using',
  'used', 'use', 'work', 'working', 'understanding', 'solving', 'solve',
]);

const CONCEPT_KEYWORDS = {
  'Linear Equations': ['linear equation', 'linear equations', 'solve for x', 'equation in x', 'unknown value', 'equation', 'equations'],
  'Expanding Brackets': ['expand', 'expanding brackets', 'distributive law', 'brackets'],
  Factorisation: ['factorise', 'factorize', 'factorisation', 'factorization', 'common factor', 'difference of squares', 'factorised form'],
  Exponents: ['exponent', 'exponents', 'index law', 'indices', 'power of', 'powers'],
  'Exponents & Surds': ['exponent', 'indices', 'surds', 'radical', 'square root', 'laws of exponents'],
  Algebra: ['algebraic expression', 'simplify the expression', 'like terms', 'coefficient', 'variable', 'algebra'],
  Numbers: ['fraction', 'fractions', 'percentage', 'ratio', 'integer', 'negative number', 'place value', 'dividing', 'divide', 'multiplying', 'multiply', 'addition', 'subtraction'],
  Functions: ['f(x)', 'function', 'functions', 'inverse function', 'composite function', 'domain of', 'range of'],
  Geometry: ['angle', 'triangle', 'quadrilateral', 'polygon', 'geometry'],
  Measurement: ['area', 'perimeter', 'volume', 'surface area', 'length', 'measurement'],
  'Euclidean Geometry': ['euclidean', 'cyclic quadrilateral', 'circle theorem', 'parallel lines', 'congruent'],
  'Quadratic Equations': ['quadratic', 'quadratics', 'discriminant', 'roots of', 'solve x²', 'parabola'],
  'Soil Science': ['soil', 'erosion', 'fertility', 'humus', 'soil profile', 'soil texture'],
  'Plant Production': ['crop', 'plant production', 'germination', 'photosynthesis', 'cultivation', 'planting'],
  'Animal Production': ['livestock', 'animal production', 'cattle', 'poultry', 'animal nutrition', 'ruminant'],
  'Agricultural Ecology': ['sustainable agriculture', 'biodiversity', 'agroforestry', 'overgrazing', 'climate change', 'carbon sequestration', 'ecosystem'],
  'Farm Management': ['farm management', 'profit', 'farm budget', 'enterprise', 'production cost', 'farm planning'],
  'Cell Biology': ['cell', 'organelle', 'mitochondria', 'cell membrane', 'microscope'],
  Genetics: ['gene', 'genetics', 'allele', 'inheritance', 'chromosome', 'dna'],
  'Human Physiology': ['human body', 'heart', 'blood', 'respiration', 'digestion', 'nervous system', 'hormone'],
  Ecology: ['ecosystem', 'food chain', 'population', 'community', 'habitat', 'ecology'],
  Biodiversity: ['biodiversity', 'species diversity', 'endangered species', 'conservation'],
  Matter: ['matter', 'particle', 'solid', 'liquid', 'gas', 'state of matter'],
  'Matter & Materials': ['material', 'mixture', 'compound', 'element', 'properties of matter', 'soluble'],
  'Forces & Motion': ['force', 'motion', 'newton', 'acceleration', 'velocity'],
  Mechanics: ['mechanics', 'speed', 'momentum', 'motion', 'force'],
  Energy: ['energy', 'work done', 'power', 'kinetic', 'potential energy'],
  'Waves & Sound': ['wave', 'wavelength', 'frequency', 'sound', 'amplitude'],
  Waves: ['wave', 'wavelength', 'frequency', 'amplitude'],
  Electricity: ['electricity', 'circuit', 'current', 'voltage', 'resistance', 'ohm'],
  'Chemical Change': ['chemical reaction', 'reaction', 'acid', 'base', 'oxidation', 'combustion'],
  Grammar: ['grammar', 'sentence', 'verb', 'adjective', 'tense', 'punctuation'],
  Vocabulary: ['vocabulary', 'meaning of the word', 'synonym', 'antonym', 'definition'],
  Comprehension: ['passage', 'reading', 'comprehension', 'according to the text', 'what does the writer'],
  Writing: ['paragraph', 'letter', 'essay', 'writing', 'closing paragraph', 'opening paragraph'],
  Literature: ['poem', 'poetry', 'novel', 'character', 'theme', 'literature', 'metaphor'],
};

function normalise(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9²+\-./ ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalise(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}

function hash(value) {
  let h = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffle(values, random = Math.random) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function normaliseExternalQuestion(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const prompt = String(raw.question || '').trim();
  const correct = String(raw.correct_answer || '').trim();
  const distractors = Array.isArray(raw.distractors)
    ? raw.distractors.map((entry) => String(entry ?? '').trim()).filter(Boolean)
    : [];
  const options = [];
  for (const answer of [correct, ...distractors]) {
    const key = normalise(answer);
    if (!key || options.some((entry) => normalise(entry) === key)) continue;
    options.push(answer);
    if (options.length >= 4) break;
  }
  if (!prompt || !correct || options.length < 3) return null;

  let seed = hash(`${prompt}|${correct}|${index}`);
  const random = () => {
    seed = Math.imul(seed ^ (seed >>> 16), 2246822507);
    seed = Math.imul(seed ^ (seed >>> 13), 3266489909);
    seed ^= seed >>> 16;
    return (seed >>> 0) / 4294967296;
  };
  const answers = shuffle(options, random);
  const correctIndex = answers.indexOf(correct);
  if (correctIndex < 0) return null;

  return {
    sourceId: `oak-${hash(`${prompt}|${correct}|${index}`)}`,
    prompt,
    options: answers,
    correct: correctIndex,
    prompt_type: 'multiple_choice',
    difficulty: Number(raw.human_score) >= 3 ? 'hard' : Number(raw.human_score) === 2 ? 'medium' : 'easy',
    correct_explanation: `The source identifies “${correct}” as the correct answer. This Item is used as an additional Practice variation; the external dataset does not provide a worked explanation for this Item.`,
  };
}

function conceptScore(question, concept) {
  const text = normalise(`${question.prompt} ${(question.options || []).join(' ')}`);
  const conceptName = normalise(concept?.name);
  const description = normalise(concept?.description);
  let score = 0;

  if (conceptName && text.includes(conceptName)) score += 8;

  const explicit = CONCEPT_KEYWORDS[concept?.name] || [];
  for (const keyword of explicit) {
    if (text.includes(normalise(keyword))) score += keyword.includes(' ') ? 4 : 3;
  }

  const nameTokens = tokenize(concept?.name).filter((token) => token.length >= 5);
  for (const token of nameTokens) if (text.includes(token)) score += 2;

  const descriptionTokens = tokenize(description).filter((token) => token.length >= 6);
  for (const token of descriptionTokens) if (text.includes(token)) score += 1;

  return score;
}

export function tagExternalQuestion(question, concepts = []) {
  if (!question || !Array.isArray(concepts) || !concepts.length) return null;
  const ranked = concepts
    .map((concept) => ({ concept, score: conceptScore(question, concept) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < 3) return null;
  // Be conservative when two Concepts have substantive evidence. An external
  // Item must not silently enter the wrong Concept just because one keyword
  // happened to score slightly higher.
  if (second && second.score >= 3) return null;
  if (second && best.score === second.score) return null;
  if (second && best.score - second.score < 2) return null;
  return best.concept.name;
}

export function toGapMapItem(question, concept, index = 0) {
  if (!question || !concept) return null;
  const idNumber = 700000 + (hash(`${question.sourceId}|${concept}|${index}`) % 299999);
  return {
    id: `q${idNumber}`,
    concept,
    difficulty: question.difficulty || 'medium',
    prompt: question.prompt,
    prompt_type: 'multiple_choice',
    options: question.options.slice(),
    correct: question.correct,
    correct_explanation: question.correct_explanation,
  };
}

export function mapExternalQuestions(rawItems, concepts, { limit = 250 } = {}) {
  const mapped = [];
  const seenPrompts = new Set();
  for (let index = 0; index < Math.min(rawItems.length, limit); index += 1) {
    const question = normaliseExternalQuestion(rawItems[index], index);
    if (!question) continue;
    const key = normalise(question.prompt);
    if (seenPrompts.has(key)) continue;
    const concept = tagExternalQuestion(question, concepts);
    if (!concept) continue;
    seenPrompts.add(key);
    mapped.push(toGapMapItem(question, concept, index));
  }
  return mapped.filter(Boolean);
}

export async function loadOakQuestionPool({
  fetchImpl = globalThis.fetch,
  timeoutMs = 2500,
  forceRefresh = false,
} = {}) {
  if (!forceRefresh && sourcePromise) return sourcePromise;
  if (typeof fetchImpl !== 'function') {
    return { items: [], cached: false, source: OAK_MCQ_URL };
  }

  const run = (async () => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(
        OAK_MCQ_URL,
        controller ? { signal: controller.signal } : undefined,
      );
      if (!response?.ok) {
        throw new Error(`Oak Question Pool request failed: ${response?.status || 'unknown'}`);
      }
      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error('Oak Question Pool returned an unexpected shape.');
      }
      return { items: payload, cached: false, source: OAK_MCQ_URL };
    } catch (error) {
      console.warn('[Question Pool] Oak source unavailable; using authored pool only.', error);
      return { items: [], cached: false, source: OAK_MCQ_URL, error };
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  sourcePromise = run;
  const result = await run;
  if (!result.items?.length) sourcePromise = null;
  return result;
}

export async function loadConceptQuestionPool({
  concepts = [],
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  timeoutMs = 2500,
  limit = 250,
} = {}) {
  const result = await loadOakQuestionPool({ fetchImpl, storage, timeoutMs });
  return {
    ...result,
    items: mapExternalQuestions(result.items, concepts, { limit }),
  };
}
