// Quiz generation helpers: fresh question selection, option shuffling,
// lightweight value/word variation, grade-aware difficulty, and language labels.

export const QUIZ_LANGUAGES = [
  { value: 'English', label: 'English (Standard)' },
  { value: 'Afrikaans', label: 'Afrikaans' },
  { value: 'Setswana', label: 'Setswana' },
  { value: 'Zulu', label: 'Zulu' },
  { value: 'Tsonga', label: 'Tsonga' },
  { value: 'Venda', label: 'Venda' },
  { value: 'Pedi', label: 'Pedi' },
  { value: 'Xhosa', label: 'Xhosa' },
];

const WORD_VARIANTS = {
  Factorise: ['Factorise', 'Factorise completely', 'Write in factorised form'],
  Simplify: ['Simplify', 'Simplify fully', 'Reduce the expression'],
  Solve: ['Solve', 'Find the value of x', 'Determine x'],
  Evaluate: ['Evaluate', 'Calculate', 'Find the value of'],
  'What is': ['What is', 'Determine', 'Find'],
};

// Language support is intentionally explicit. English is always available;
// Afrikaans question rendering currently has a local phrase dictionary for
// Mathematics and Physical Sciences only. Other Subjects stay English rather
// than pretending that a partial dictionary is a complete translation.
const QUIZ_LANGUAGE_SUBJECTS = [
  'Mathematics',
  'Physical Sciences',
  'Physical Science',
  'Agricultural Sciences',
  'Life Sciences',
  'English Home Language',
];

export function quizLanguagesForSubject(subject) {
  const name = String(subject || '').trim();
  return QUIZ_LANGUAGE_SUBJECTS.includes(name)
    ? QUIZ_LANGUAGES.slice()
    : QUIZ_LANGUAGES.filter((language) => language.value === 'English');
}

function randomInt(min, max, random) {
  return Math.floor(random() * (max - min + 1)) + min;
}

export function makeRandom(seed = '') {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return function rand() {
    h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5;
    return ((h >>> 0) / 4294967296);
  };
}

export function shuffle(values, random = Math.random) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function replaceFirstStem(prompt, random) {
  let result = String(prompt || '');
  for (const [key, variants] of Object.entries(WORD_VARIANTS)) {
    if (result.startsWith(key)) {
      return variants[Math.floor(random() * variants.length)] + result.slice(key.length);
    }
  }
  return result;
}

function numericVariant(question, random) {
  const q = { ...question, options: question.options ? question.options.slice() : question.options };
  let prompt = String(q.prompt || '');

  // Linear equations: ax + b = c
  let m = prompt.match(/^(.*?)(\d+)x\s*([+-])\s*(\d+)\s*=\s*(\d+)(.*)$/i);
  if (m && /solve|find|determine/i.test(prompt)) {
    const a = randomInt(2, 6, random);
    const x = randomInt(2, 9, random);
    const b = randomInt(2, 10, random);
    const sign = random() < 0.5 ? 1 : -1;
    const c = a * x + sign * b;
    q.prompt = `${replaceFirstStem(prompt, random)}: ${a}x ${sign > 0 ? '+' : '−'} ${b} = ${c}${m[5] || ''}`;
    if (q.type === 'numeric' || q.correctAnswers) q.correctAnswers = [String(x)];
    if (q.options) {
      q.options = [String(x), String(x + 1), String(Math.max(0, x - 1)), String(x * 2)];
      q.correct = 0;
    }
    return q;
  }

  // Ohm's law numeric questions.
  m = prompt.match(/V\s*=\s*(\d+)\s*V\s*and\s*R\s*=\s*(\d+)\s*Ω/i);
  if (m) {
    const r = randomInt(2, 8, random);
    const i = randomInt(2, 7, random);
    const v = r * i;
    q.prompt = `If V = ${v} V and R = ${r} Ω, what is the current I in amperes?`;
    q.correctAnswers = [String(i)];
    return q;
  }
  m = prompt.match(/Two\s+(\d+)\s*Ω\s*resistors/i);
  if (m) {
    const r = randomInt(2, 10, random);
    q.prompt = `Two ${r} Ω resistors in series. What is the total resistance in ohms?`;
    q.correctAnswers = [String(r * 2)];
    return q;
  }

  // Function evaluation f(x)=ax+b at x=n.
  m = prompt.match(/f\(x\)\s*=\s*(\d+)x\s*([+-])\s*(\d+).*f\(([-\d]+)\)/i);
  if (m) {
    const a = randomInt(2, 5, random);
    const b = randomInt(2, 9, random);
    const x = randomInt(2, 7, random);
    const value = a * x + (m[2] === '-' ? -b : b);
    q.prompt = `If f(x) = ${a}x ${m[2] === '-' ? '−' : '+'} ${b}, what is f(${x})?`;
    q.correctAnswers = [String(value)];
    return q;
  }

  // Difference of squares factorisation.
  m = prompt.match(/x²\s*[−-]\s*(\d+)/);
  if (m && /factor/i.test(prompt)) {
    const n = randomInt(3, 12, random);
    const square = n * n;
    q.prompt = `${replaceFirstStem(prompt, random)}: x² − ${square}`;
    q.options = [`(x − ${n})(x + ${n})`, `(x − ${square})(x + 1)`, `(x − ${n})²`, `x(x − ${square})`];
    q.correct = 0;
    return q;
  }

  // For non-numeric Items there is no safe domain-specific generator in the
  // client. A presentation-only stem variation still produces a new form
  // without changing the Item's Concept, options, or correct value.
  if (Array.isArray(q.options) && q.options.length > 1 && q.prompt) {
    const stems = [
      'Choose the correct answer: ',
      'Select the correct option: ',
      'Which option correctly answers this Item? ',
    ];
    const stem = stems[Math.floor(random() * stems.length)];
    q.prompt = stem + String(q.prompt).trim();
  }
  return q;
}

export function varyQuestion(question, { grade = '12', seed = '' } = {}) {
  const random = makeRandom(seed + '|' + (question.id || question.prompt || ''));
  const q = numericVariant(question, random);
  q.prompt = replaceFirstStem(q.prompt, random);

  // Grade 10 emphasises foundational/easy items; Grade 12 keeps the full range.
  const difficulty = q.difficulty || 'medium';
  if (String(grade) === '10' && difficulty === 'hard') return null;
  if (String(grade) === '11' && difficulty === 'hard' && random() < 0.35) return null;

  if (q.options && q.options.length) {
    const originalCorrect = Number(q.correct);
    const pairs = q.options.map((text, index) => ({ text, correct: index === originalCorrect }));
    const shuffled = shuffle(pairs, random);
    q.options = shuffled.map((p) => p.text);
    q.correct = shuffled.findIndex((p) => p.correct);
  }
  return q;
}

/**
 * Force a varied answer-key position across a whole quiz.
 * This is deliberately separate from normal shuffling so a bad/legacy fixture
 * with correct: 0 can never leave every correct answer in option A.
 */
/**
 * Creates a new presentation form without changing the Item's answer value.
 * This is the safe fallback when a Learner has exhausted a pool: the frozen
 * Assessment Item remains untouched, while the displayed stem is rephrased.
 */
export function presentationVariant(question, seed = '') {
  const random = makeRandom(`${seed}|presentation-variant`);
  const q = {
    ...question,
    options: question.options ? question.options.slice() : question.options,
    correctAnswers: question.correctAnswers ? question.correctAnswers.slice() : question.correctAnswers,
  };
  if (q.prompt) {
    const stems = [
      'Choose the correct answer: ',
      'Select the correct option: ',
      'Which option correctly answers this Item? ',
      'Identify the correct answer: ',
      'Select the answer that is correct: ',
      'Which answer is correct for this Item? ',
      'Choose the option that best answers this Item: ',
      'Read the Item and select the correct option: ',
      'Pick the correct answer: ',
      'Which option gives the correct answer? ',
      'Select the correct response: ',
      'For this Item, choose the correct option: ',
    ];
    q.prompt = stems[Math.floor(random() * stems.length)] + replaceFirstStem(q.prompt, random).trim();
  }
  return q;
}

export function balanceCorrectOptionPositions(questions, seed = '') {
  const list = questions.map((question) => ({
    ...question,
    options: question.options ? question.options.slice() : question.options,
  }));
  const mcIndexes = list
    .map((question, index) => (Array.isArray(question.options) && question.options.length > 1 ? index : -1))
    .filter((index) => index >= 0);
  if (!mcIndexes.length) return list;

  const random = makeRandom(`${seed}|answer-balance`);
  const basePositions = shuffle(
    Array.from({ length: Math.max(...mcIndexes.map((i) => list[i].options.length)) }, (_, i) => i),
    random,
  );

  mcIndexes.forEach((questionIndex, order) => {
    const q = list[questionIndex];
    const optionCount = q.options.length;
    if (optionCount < 2) return;

    // For the first four MC questions use each position once when possible.
    // After that, keep using a non-repeating-ish mix rather than always index 0.
    let target = basePositions[order % basePositions.length] % optionCount;
    if (order >= basePositions.length) {
      const recent = mcIndexes
        .slice(Math.max(0, order - 2), order)
        .map((idx) => Number(list[idx].correct));
      const available = Array.from({ length: optionCount }, (_, i) => i)
        .filter((i) => i !== recent[0] && i !== recent[1]);
      if (available.length) target = available[Math.floor(random() * available.length)];
    }
    if (order > 0 && target === 0) {
      const alternatives = Array.from({ length: optionCount }, (_, i) => i).filter((i) => i !== 0);
      target = alternatives[Math.floor(random() * alternatives.length)];
    }

    const correctIndex = Number(q.correct);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= optionCount) return;
    const correctText = q.options[correctIndex];
    const distractors = q.options.filter((_, i) => i !== correctIndex);
    const shuffledDistractors = shuffle(distractors, random);
    const nextOptions = [];
    let distractorIndex = 0;
    for (let i = 0; i < optionCount; i += 1) {
      if (i === target) nextOptions.push(correctText);
      else nextOptions.push(shuffledDistractors[distractorIndex++]);
    }
    q.options = nextOptions;
    q.correct = target;
  });

  return list;
}

export function questionSignature(question) {
  // The signature represents the logical question, not its answer ordering.
  // This means an MC question is still considered the same question after
  // its options are shuffled into a different order.
  const prompt = String(question.prompt || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const options = (question.options || []).map(String).sort((a, b) => a.localeCompare(b));
  const correctIndex = Number(question.correct);
  const correctAnswer = Array.isArray(question.options) && Number.isInteger(correctIndex)
    ? String(question.options[correctIndex])
    : '';
  return JSON.stringify({
    prompt,
    options,
    correctAnswer,
    answers: (question.correctAnswers || []).map(String).sort(),
  });
}

export function readQuizHistory(storage, key) {
  try { return JSON.parse(storage.getItem(key) || '[]'); } catch (_) { return []; }
}

export function writeQuizHistory(storage, key, signatures) {
  try { storage.setItem(key, JSON.stringify(signatures.slice(-150))); } catch (_) {}
}

// Local question-language support. It intentionally translates the linguistic
// parts of questions and keeps mathematical notation/numbers unchanged.
const PHRASES = {
  Afrikaans: {
    'Choose the correct option:': 'Kies die korrekte opsie:', 'Which option correctly answers:': 'Watter opsie beantwoord dit korrek:',
    'Which option correctly completes:': 'Watter opsie voltooi dit korrek:', 'Which option gives the correct answer?': 'Watter opsie gee die korrekte antwoord?',
    'Which option should be chosen for:': 'Watter opsie moet gekies word vir:', 'Which option is correct for the following Item:': 'Watter opsie is korrek vir die volgende Item:',
    'Which choice answers this correctly:': 'Watter keuse beantwoord dit korrek:', 'Which choice gives the correct result for:': 'Watter keuse gee die korrekte resultaat vir:',
    'Which answer should be selected for:': 'Watter antwoord moet gekies word vir:', 'Which answer matches the Item?': 'Watter antwoord pas by die Item?',
    'What is the correct answer to:': 'Wat is die korrekte antwoord op:', 'What is the correct answer?': 'Wat is die korrekte antwoord?',
    'What do we call': 'Wat noem ons', 'What term describes': 'Watter term beskryf', 'What is the term for': 'Wat is die term vir',
    'Name one': 'Noem een', 'Name the': 'Noem die', 'Select the correct': 'Kies die korrekte', 'Select the best': 'Kies die beste',
    'Select the answer': 'Kies die antwoord', 'Pick the correct': 'Kies die korrekte', 'Pick the option': 'Kies die opsie',
    'Identify the correct': 'Identifiseer die korrekte', 'In this Item, which answer is correct?': 'In hierdie Item, watter antwoord is korrek?',
    'For this Item, select the correct answer:': 'Kies die korrekte antwoord vir hierdie Item:', 'Choose the answer that is correct for:': 'Kies die antwoord wat korrek is vir:',
    'Choose the answer that matches this Item:': 'Kies die antwoord wat by hierdie Item pas:', 'Choose the correct response for this Item:': 'Kies die korrekte antwoord vir hierdie Item:',
    'Choose the correct response from the options:': 'Kies die korrekte antwoord uit die opsies:', 'Select the response that is correct:': 'Kies die korrekte antwoord:',
    'Which response is correct here:': 'Watter antwoord is hier korrek:', 'Which answer is supported by the Item?': 'Watter antwoord word deur die Item ondersteun?',
    'Read the Item and choose the correct answer:': 'Lees die Item en kies die korrekte antwoord:', 'Which answer should a Learner choose for:': 'Watter antwoord moet ’n Learner kies vir:',
    'Simplify': 'Vereenvoudig', 'Simplify fully': 'Vereenvoudig volledig', 'Reduce the expression': 'Vereenvoudig die uitdrukking',
    'Solve for x': 'Los x op', 'Find the value of x': 'Vind x', 'Determine x': 'Bepaal x', 'Solve': 'Los op', 'Expand': 'Werk uit',
    'Evaluate': 'Bereken', 'Calculate': 'Bereken', 'Find the value of': 'Vind die waarde van', 'What is': 'Wat is', 'in terms of': 'in terme van', 'All real numbers': 'Alle reële getalle',
    'sustainable': 'volhoubaar', 'methane': 'metaan', 'calf': 'kalf', 'organism': 'organisme', 'kingdom': 'koninkryk',
    'endangered': 'bedreig', 'mitochondria': 'mitochondria', 'photosynthesis': 'fotosintese', 'respiration': 'respirasie',
    'decomposers': 'ontbinders', 'ecosystem': 'ekosisteem', 'genetic diversity': 'genetiese diversiteit', 'insulators': 'isolators',
  },
  Setswana: {
    'Solve for x': 'Rarabolola x',
    'Choose the correct option:': 'Tlhopha karabo e e nepagetseng:', 'Which option correctly answers:': 'Ke karabo efe e e nepagetseng:',
    'What is the correct answer to:': 'Karabo e e nepagetseng ya:', 'What do we call': 'Re bitsa eng', 'What term describes': 'Ke lereo lefe le le tlhalosang',
    'What is the term for': 'Ke lereo lefe la', 'Name one': 'Naya le le lengwe', 'Select the correct': 'Tlhopha e e nepagetseng',
    'Select the best': 'Tlhopha e e botoka', 'Pick the correct': 'Tlhopha e e nepagetseng', 'Solve': 'Rarabolola', 'Simplify': 'Fokotsa',
    'Expand': 'Atolosa', 'Calculate': 'Balela', 'Evaluate': 'Sekaseka', 'Find the value of': 'Batla boleng jwa', 'All real numbers': 'Dinomoro tsotlhe tsa nnete',
  },
  Zulu: {
    'Solve for x': 'Xazulula u-x',
    'Choose the correct option:': 'Khetha impendulo efanele:', 'Which option correctly answers:': 'Iyiphi impendulo ephendula kahle:',
    'What is the correct answer to:': 'Iyini impendulo efanele ku:', 'What do we call': 'Sikubiza ngani', 'What term describes': 'Iliphi igama elichaza',
    'What is the term for': 'Lithini igama le', 'Name one': 'Yisho okukodwa', 'Select the correct': 'Khetha okulungile',
    'Select the best': 'Khetha okuhamba phambili', 'Pick the correct': 'Khetha okulungile', 'Solve': 'Xazulula', 'Simplify': 'Yenza kube lula',
    'Expand': 'Nweba', 'Calculate': 'Bala', 'Evaluate': 'Hlola', 'Find the value of': 'Thola inani le', 'All real numbers': 'Zonke izinombolo zangempela',
  },
  Tsonga: {
    'Solve for x': 'Hlamusela x',
    'Choose the correct option:': 'Hlawula nhlawulo lowu nga kahle:', 'Which option correctly answers:': 'Hi wihi nhlamulo leyi nga kahle:',
    'What is the correct answer to:': 'Hi yihi nhlamulo leyi nga kahle eka:', 'What do we call': 'Hi ku yini leswi hi swi vitanaka', 'What term describes': 'Hi rihi rito leri hlamuselaka',
    'What is the term for': 'Hi rihi rito ra', 'Name one': 'Vula xinwe', 'Select the correct': 'Hlawula leswi nga kahle',
    'Select the best': 'Hlawula leswi antswaka', 'Pick the correct': 'Hlawula leswi nga kahle', 'Solve': 'Hlamusela', 'Simplify': 'Olovisa',
    'Expand': 'Anamisa', 'Calculate': 'Hlayela', 'Evaluate': 'Teka nkoka wa', 'Find the value of': 'Kuma nkoka wa', 'All real numbers': 'Tinomboro hinkwato ta xiviri',
  },
  Venda: {
    'Solve for x': 'Fhedzisani x',
    'Choose the correct option:': 'Nangani khetho yo teaho:', 'Which option correctly answers:': 'Ndi ifhio phindulo yo teaho:',
    'What is the correct answer to:': 'Phindulo yo teaho ya:', 'What do we call': 'Ri pfi mini', 'What term describes': 'Ndi ipfi ḽifhio ḽine ḽa ṱalusa',
    'What is the term for': 'Ipfi ḽa', 'Name one': 'Bulani tshithihi', 'Select the correct': 'Nangani zwo teaho',
    'Select the best': 'Nangani zwo fhiraho', 'Pick the correct': 'Nangani zwo teaho', 'Solve': 'Fhedzisani', 'Simplify': 'Lugisani',
    'Expand': 'Engedzani', 'Calculate': 'Vhalelani', 'Evaluate': 'Tshimbidzani ndeme ya', 'Find the value of': 'Wanani ndeme ya', 'All real numbers': 'Nomboro dza vhukuma dzoṱhe',
  },
  Pedi: {
    'Solve for x': 'Rarolla x',
    'Choose the correct option:': 'Kgetha karabo ye e nepagetšego:', 'Which option correctly answers:': 'Ke karabo efe ye e nepagetšego:',
    'What is the correct answer to:': 'Karabo ye e nepagetšego ya:', 'What do we call': 'Re bitša eng', 'What term describes': 'Ke lereo lefe le le hlalošago',
    'What is the term for': 'Ke lereo lefe la', 'Name one': 'Bolela e tee', 'Select the correct': 'Kgetha ye e nepagetšego',
    'Select the best': 'Kgetha ye kaone', 'Pick the correct': 'Kgetha ye e nepagetšego', 'Solve': 'Rarolla', 'Simplify': 'Nolofatša',
    'Expand': 'Katološa', 'Calculate': 'Bala', 'Evaluate': 'Lekola', 'Find the value of': 'Hwetša boleng bja', 'All real numbers': 'Dinomoro tša nnete ka moka',
  },
  Xhosa: {
    'Solve for x': 'Sombulula u-x',
    'Choose the correct option:': 'Khetha impendulo echanekileyo:', 'Which option correctly answers:': 'Yeyiphi impendulo echanekileyo:',
    'What is the correct answer to:': 'Yeyiphi impendulo echanekileyo ku:', 'What do we call': 'Siyibiza ngokuba yintoni', 'What term describes': 'Leliphi igama elichaza',
    'What is the term for': 'Lithini igama le', 'Name one': 'Chaza enye', 'Select the correct': 'Khetha echanekileyo',
    'Select the best': 'Khetha eyona ilungileyo', 'Pick the correct': 'Khetha echanekileyo', 'Solve': 'Sombulula', 'Simplify': 'Yenza lula',
    'Expand': 'Yandisa', 'Calculate': 'Bala', 'Evaluate': 'Vavanya', 'Find the value of': 'Fumana ixabiso le', 'All real numbers': 'Onke amanani okwenyani',
  },
};


function translateText(text, language) {
  const source = String(text || '');
  if (!language || language === 'English') return source;
  const normalisedLanguage = String(language).trim();
  const map = PHRASES[normalisedLanguage] || PHRASES[normalisedLanguage.toLowerCase()] ||
    PHRASES[normalisedLanguage.charAt(0).toUpperCase() + normalisedLanguage.slice(1)];
  if (!map) return source;

  // One-pass replacement prevents a newly translated word from matching a
  // later source phrase (for example "or" inside "Faktoriseer").
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  const escaped = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(escaped.join('|'), 'g');
  return source.replace(pattern, (match) => map[match] ?? match);
}

export function translateQuestion(question, language) {
  const q = {
    ...question,
    options: question.options ? question.options.map((option) => String(option)) : question.options,
  };
  q.prompt = translateText(q.prompt, language);
  if (q.options) q.options = q.options.map((option) => translateText(option, language));
  return q;
}
