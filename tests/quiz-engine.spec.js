import { test, expect } from '@playwright/test';
import {
  balanceCorrectOptionPositions,
  presentationVariant,
  questionSignature,
  readQuizHistory,
  translateQuestion,
  writeQuizHistory,
} from '../frontend/js/quiz-engine.js';

function item(id, prompt, correct = 0) {
  return {
    id,
    concept: 'Algebra',
    prompt,
    prompt_type: 'multiple_choice',
    options: ['A', 'B', 'C', 'D'],
    correct,
  };
}

test('correct answers are not fixed at option 0 after presentation balancing', () => {
  const questions = Array.from({ length: 12 }, (_, index) => item(`q${index + 1}`, `Item ${index + 1}`));
  const balanced = balanceCorrectOptionPositions(questions, 'fixed-test-seed');
  const positions = balanced.map((question) => question.correct);

  expect(positions.some((position) => position !== 0)).toBe(true);
  expect(positions.every((position) => position >= 0 && position < 4)).toBe(true);
  expect(questions.every((question) => question.correct === 0)).toBe(true);
});

test('quiz history persists normalized Item signatures', () => {
  const storage = new Map();
  const adapter = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, String(value)); },
  };
  const key = 'gapmap.quiz.history.learner-001.mathematics.algebra';
  const signature = questionSignature(item('q1', 'Simplify 2x + 2'));
  writeQuizHistory(adapter, key, [signature]);
  expect(readQuizHistory(adapter, key)).toContain(signature);
});

test('presentation variants change the prompt without changing the Item answer', () => {
  const original = item('q1', 'What is 2 + 2?', 0);
  const variant = presentationVariant(original, 'variant-seed');
  expect(variant.prompt).not.toBe(original.prompt);
  expect(variant.options).toEqual(original.options);
  expect(variant.correct).toBe(original.correct);
  expect(variant.concept).toBe(original.concept);
});

test('language translation preserves the selected option index and options order', () => {
  const original = item('q1', 'Simplify: 3x + 2', 0);
  const translated = translateQuestion(original, 'Afrikaans');
  expect(translated.correct).toBe(0);
  expect(translated.options).toEqual(original.options);
  expect(translated.prompt).not.toBe(original.prompt);
});
