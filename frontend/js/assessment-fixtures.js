const factorisationConcept = {
  name: 'Factorisation',
  description: 'Rewriting expressions as products of simpler factors',
};

const factorisationItems = [
  {
    id: 'q1',
    concept: 'Factorisation',
    difficulty: 'easy',
    prompt: 'Factorise completely: x² − 16',
    prompt_type: 'multiple_choice',
    options: ['(x − 4)(x + 4)', '(x − 8)(x + 2)', '(x − 4)²', 'x(x − 16)'],
    correct: 0,
    correct_explanation:
      'x² − 16 = x² − 4² = (x − 4)(x + 4). This is the difference of squares pattern.',
    wrong_explanations: [
      {
        answer: 1,
        explanation: 'These factors multiply to x² − 6x − 16, so they do not reproduce the original expression.', kind: 'procedure',
      },
      {
        answer: 2,
        explanation: 'Squaring (x − 4) gives x² − 8x + 16, not x² − 16.', kind: 'procedure',
      },
      {
        answer: 3,
        explanation: 'Taking x outside leaves x − 16, but x² − 16 has no common factor of x.', kind: 'concept',
      },
    ],
  },
  {
    id: 'q2',
    concept: 'Factorisation',
    difficulty: 'easy',
    prompt: 'Factorise: x² + 7x + 12',
    prompt_type: 'multiple_choice',
    options: ['(x + 3)(x + 4)', '(x + 2)(x + 6)', '(x + 1)(x + 12)', '(x − 3)(x − 4)'],
    correct: 0,
    correct_explanation:
      '3 × 4 = 12 and 3 + 4 = 7, so x² + 7x + 12 = (x + 3)(x + 4).',
    wrong_explanations: [
      {
        answer: 1,
        explanation: '2 × 6 = 12, but 2 + 6 = 8 rather than the required middle coefficient 7.', kind: 'procedure',
      },
      {
        answer: 2,
        explanation: '1 × 12 = 12, but 1 + 12 = 13 rather than 7.', kind: 'procedure',
      },
      {
        answer: 3,
        explanation: 'These factors produce a negative middle term rather than +7x.', kind: 'procedure',
      },
    ],
  },
  {
    id: 'q3',
    concept: 'Factorisation',
    difficulty: 'medium',
    prompt: 'Factorise: 2x² + 5x + 2',
    prompt_type: 'multiple_choice',
    options: ['(2x + 1)(x + 2)', '(2x + 2)(x + 1)', '(x + 1)(x + 2)', '(2x − 1)(x − 2)'],
    correct: 0,
    correct_explanation:
      '(2x + 1)(x + 2) expands to 2x² + 4x + x + 2 = 2x² + 5x + 2.',
    wrong_explanations: [
      {
        answer: 1,
        explanation: 'These factors expand to 2x² + 4x + 2, so the middle coefficient is too small.', kind: 'procedure',
      },
      {
        answer: 2,
        explanation: 'These factors have leading coefficient 1, but the original expression has leading coefficient 2.', kind: 'concept',
      },
      {
        answer: 3,
        explanation: 'Both factors use subtraction, producing a negative middle term rather than +5x.', kind: 'procedure',
      },
    ],
  },
];

const diagnosticItems = [
  {
    id: 'q1',
    concept: 'Algebraic Expressions',
    difficulty: 'easy',
    prompt: 'Which expression is equivalent to 3x + 2x?',
    prompt_type: 'multiple_choice',
    options: ['5x', '6x', '5x²', 'x + 5'],
    correct: 0,
    correct_explanation: 'Like terms add their coefficients: 3x + 2x = 5x.',
    wrong_explanations: [
      { answer: 1, explanation: 'Adding the coefficients gives 5, not 6.', kind: 'procedure' },
      { answer: 2, explanation: 'Adding like terms does not change the exponent.', kind: 'concept' },
      { answer: 3, explanation: 'The x remains a factor of the combined term.', kind: 'procedure' },
    ],
  },
  {
    id: 'q2',
    concept: 'Factorisation',
    difficulty: 'easy',
    prompt: 'Which is the factorised form of x² − 9?',
    prompt_type: 'multiple_choice',
    options: ['(x − 3)(x + 3)', '(x − 9)(x + 1)', '(x − 3)²', 'x(x − 9)'],
    correct: 0,
    correct_explanation: 'x² − 9 is a difference of squares: x² − 3² = (x − 3)(x + 3).',
    wrong_explanations: [
      { answer: 1, explanation: 'These factors do not expand to x² − 9.', kind: 'procedure' },
      { answer: 2, explanation: 'Squaring x − 3 creates a middle term −6x.', kind: 'concept' },
      { answer: 3, explanation: 'x is not a common factor of x² − 9.', kind: 'procedure' },
    ],
  },
];

function assessmentMetadata(id, type, concepts, items) {
  return {
    id,
    type,
    subject: 'Grade 12 Mathematics',
    language: 'en',
    explanation_level: 'Standard',
    concepts,
    items,
    generated_at: '2026-01-01T00:00:00.000Z',
    generated_by: 'gapmap-local-demo',
    schema_version: '1.0.0',
  };
}

export const assessmentFixtures = Object.freeze({
  diagnostic: assessmentMetadata(
    'diagnostic-g12-maths-local',
    'diagnostic',
    [
      { name: 'Algebraic Expressions', description: 'Working with terms and coefficients' },
      factorisationConcept,
    ],
    diagnosticItems,
  ),
  practice: assessmentMetadata(
    'practice-factorisation-local',
    'practice',
    [factorisationConcept],
    factorisationItems,
  ),
});
