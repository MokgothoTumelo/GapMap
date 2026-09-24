import { test, expect } from '@playwright/test';
import { mapExternalQuestions, tagExternalQuestion, normaliseExternalQuestion } from '../frontend/js/external-question-pool.js';

test.describe('external question pool adapter', () => {
  test('only admits confidently Concept-tagged Items', () => {
    const concepts = [
      { name: 'Factorisation', description: 'Factorising expressions and difference of squares' },
      { name: 'Algebra', description: 'Simplifying expressions and solving equations' },
    ];
    const raw = [
      { question: 'Factorise x² − 25.', correct_answer: '(x − 5)(x + 5)', distractors: ['x − 25', '(x − 5)²', 'x(x − 25)'] },
      { question: 'Simplify the algebraic expression 3x + 2x.', correct_answer: '5x', distractors: ['6x', '5', 'x²'] },
      { question: 'Explain this completely.', correct_answer: 'It depends', distractors: ['Maybe', 'No', 'Yes'] },
    ];
    const mapped = mapExternalQuestions(raw, concepts, { limit: 10 });
    expect(mapped.length).toBe(2);
    expect(new Set(mapped.map((item) => item.concept)).size).toBe(2);
    expect(mapped.every((item) => item.concept && item.options?.length >= 3)).toBe(true);
  });

  test('rejects an ambiguous mapping rather than guessing', () => {
    const question = normaliseExternalQuestion({
      question: 'This algebra expression must be factorised before solving.',
      correct_answer: 'x = 2',
      distractors: ['x = 3', 'x = 4', 'x = 5'],
    });
    const concepts = [
      { name: 'Factorisation', description: 'Factorising expressions' },
      { name: 'Algebra', description: 'Solving algebraic expressions' },
    ];
    expect(tagExternalQuestion(question, concepts)).toBeNull();
  });
});
