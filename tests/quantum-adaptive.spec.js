import { test, expect } from '@playwright/test';
import {
  buildQuantumLearningState,
  prepareQuantumPractice,
  selectQuantumPracticeItems,
  explainAnswer,
} from '../core/quantum-adaptive.js';

test.describe('Quantum-inspired adaptive practice', () => {
  test('collapses the learning state onto the most supported Knowledge Gap', () => {
    const state = buildQuantumLearningState({
      gapMap: [
        { concept: 'Algebra', pct: 40, total: 5, status: 'weak' },
        { concept: 'Functions', pct: 80, total: 5, status: 'strong' },
      ],
      mistakes: [
        { concept: 'Algebra', kind: 'procedure', answer: 1 },
        { concept: 'Algebra', kind: 'procedure', answer: 2 },
      ],
    });

    expect(state.collapsedConcept).toBe('Algebra');
    const probabilityTotal = state.state.reduce((sum, entry) => sum + entry.probability, 0);
    expect(probabilityTotal).toBeGreaterThan(0.99);
    expect(probabilityTotal).toBeLessThan(1.01);
  });

  test('prioritises Items whose Mistake-Diagnosis kind matches the Diagnostic evidence', () => {
    const result = selectQuantumPracticeItems({
      concept: 'Algebra',
      mistakes: [{ concept: 'Algebra', kind: 'procedure', answer: 1 }],
      itemCount: 3,
      bankItems: [
        {
          id: 'q1',
          concept: 'Algebra',
          prompt_type: 'multiple_choice',
          prompt: 'Solve x + 1 = 3',
          options: ['2', '3', '1', '4'],
          correct: 0,
          wrong_explanations: [{ answer: 1, explanation: 'You stopped too early.', kind: 'procedure' }],
        },
        {
          id: 'q2',
          concept: 'Algebra',
          prompt_type: 'multiple_choice',
          prompt: 'Simplify 2x + 3x',
          options: ['5x', '6x', 'x', '5'],
          correct: 0,
        },
        {
          id: 'q3',
          concept: 'Algebra',
          prompt_type: 'numeric',
          prompt: 'Solve: 2x = 6',
          correct: 3,
          correct_explanation: 'Divide both sides by 2.',
        },
      ],
    });

    expect(result.items).toHaveLength(3);
    expect(result.items[0].id).toBe('q1');
    expect(result.items[0].quantum_stage).toBe('repair');
  });

  test('prepares a repair → transfer → check Practice set', () => {
    const plan = prepareQuantumPractice({
      gapMap: [{ concept: 'Algebra', pct: 45, total: 5, status: 'weak' }],
      mistakes: [{ concept: 'Algebra', kind: 'concept', answer: 1 }],
      bankItems: [
        {
          id: 'q1',
          concept: 'Algebra',
          prompt_type: 'multiple_choice',
          prompt: 'Simplify 2x + 3x',
          options: ['5x', '6x', 'x', '5'],
          correct: 0,
          wrong_explanations: [{ answer: 1, explanation: 'You multiplied coefficients.', kind: 'concept' }],
        },
        { id: 'q2', concept: 'Algebra', prompt_type: 'short_answer', prompt: 'Simplify 4x + x', correct: '5x' },
        { id: 'q3', concept: 'Algebra', prompt_type: 'numeric', prompt: 'Solve 2x = 8', correct: 4 },
        { id: 'q4', concept: 'Algebra', prompt_type: 'short_answer', prompt: 'Expand 2(x + 3)', correct: '2x+6' },
        { id: 'q5', concept: 'Algebra', prompt_type: 'numeric', prompt: 'Evaluate 2 + 3', correct: 5 },
      ],
      itemCount: 5,
    });

    expect(plan.targetConcept).toBe('Algebra');
    expect(plan.itemIds).toHaveLength(5);
    expect(plan.stages).toEqual(['repair', 'repair', 'transfer', 'transfer', 'check']);
  });

  test('explains both the mistake and the worked answer', () => {
    const item = {
      concept: 'Quadratic Equations',
      prompt_type: 'multiple_choice',
      prompt: 'Solve x^2 = 16.',
      options: ['x = 4 or x = -4', 'x = 4', 'x = 8'],
      correct: 0,
      correct_explanation: 'Take the square root and remember both positive and negative roots.',
      wrong_explanations: [
        { answer: 1, explanation: 'You took the square root but forgot the negative root.', kind: 'procedure' },
      ],
    };

    const explanation = explainAnswer(item, 1);
    expect(explanation.mistakeKind).toBe('procedure');
    expect(explanation.mistakeExplanation).toContain('forgot the negative root');
    expect(explanation.how).toContain('both positive and negative roots');
  });

  // ── v2: real circuit behaviour (amplitude encoding, amplification, measurement) ──
  const rootGraph = {
    edges: [
      { requires: 'Factorisation', for: 'Quadratic Equations' },
      { requires: 'Algebra', for: 'Quadratic Equations' },
    ],
  };
  const rootGapMap = [
    { concept: 'Factorisation', pct: 40, total: 5, status: 'weak' },
    { concept: 'Quadratic Equations', pct: 30, total: 5, status: 'weak' },
    { concept: 'Algebra', pct: 60, total: 5, status: 'improve' },
    { concept: 'Functions', pct: 70, total: 5, status: 'improve' },
  ];

  test('records the circuit it ran and says plainly that it is simulated', () => {
    const state = buildQuantumLearningState({ gapMap: rootGapMap, graph: rootGraph });
    expect(state.circuit.simulated).toBe(true);
    expect(state.circuit.qubits).toBe(2); // 4 Concepts → 2 qubits
    expect(state.circuit.gates.length).toBe(state.circuit.gateCount);
    expect(state.method).toMatch(/simulation/i);
  });

  test('amplitude amplification raises the root-cause probability above its prior', () => {
    const state = buildQuantumLearningState({ gapMap: rootGapMap, graph: rootGraph });
    const roots = state.state.filter((entry) => entry.isRootCause);
    expect(roots.map((entry) => entry.concept).sort()).toEqual(['Algebra', 'Factorisation']);
    const before = roots.reduce((sum, entry) => sum + entry.priorProbability, 0);
    const after = roots.reduce((sum, entry) => sum + entry.probability, 0);
    expect(after).toBeGreaterThan(before);
    expect(state.circuit.amplification.applied).toBe(true);
    // The phase is tuned to stop near the 75% target rather than overshoot.
    expect(after).toBeGreaterThan(0.72);
    expect(after).toBeLessThan(0.78);
  });

  test('amplification is skipped when root causes already dominate', () => {
    const state = buildQuantumLearningState({
      gapMap: [
        { concept: 'Factorisation', pct: 5, total: 100, status: 'weak' },
        { concept: 'Quadratic Equations', pct: 79, total: 100, status: 'improve' },
      ],
      graph: { edges: [{ requires: 'Factorisation', for: 'Quadratic Equations' }] },
    });
    expect(state.circuit.amplification.applied).toBe(false);
    expect(state.collapsedConcept).toBe('Factorisation');
  });

  test('the Concept Graph changes the outcome: the lowest score is not automatically the target', () => {
    const noGraph = buildQuantumLearningState({ gapMap: rootGapMap });
    const withGraph = buildQuantumLearningState({ gapMap: rootGapMap, graph: rootGraph });
    expect(noGraph.collapsedConcept).toBe('Quadratic Equations'); // largest gap wins with no structure
    expect(withGraph.collapsedConcept).toBe('Factorisation'); // root cause wins once interference applies
    expect(noGraph.circuit.amplification.applied).toBe(false);
  });

  test('a Mistake Diagnosis that names a prerequisite also marks it as a root cause', () => {
    const state = buildQuantumLearningState({
      gapMap: rootGapMap,
      mistakes: [{ concept: 'Quadratic Equations', kind: 'prerequisite', prerequisite: 'Factorisation', answer: 1 }],
    });
    expect(state.state.find((entry) => entry.concept === 'Factorisation').isRootCause).toBe(true);
    expect(state.collapsedConcept).toBe('Factorisation');
  });

  test('exact and measured probabilities agree, and probabilities sum to 1', () => {
    const state = buildQuantumLearningState({ gapMap: rootGapMap, graph: rootGraph, shots: 4096 });
    expect(state.state.reduce((sum, entry) => sum + entry.probability, 0)).toBeCloseTo(1, 8);
    expect(state.state.reduce((sum, entry) => sum + entry.measuredFrequency, 0)).toBeCloseTo(1, 8);
    state.state.forEach((entry) => {
      expect(Math.abs(entry.measuredFrequency - entry.probability)).toBeLessThan(0.04);
    });
  });

  test('is reproducible: the same Diagnostic gives the same measured plan', () => {
    const a = buildQuantumLearningState({ gapMap: rootGapMap, graph: rootGraph });
    const b = buildQuantumLearningState({ gapMap: rootGapMap, graph: rootGraph });
    expect(a.state.map((entry) => entry.measuredFrequency))
      .toEqual(b.state.map((entry) => entry.measuredFrequency));
  });

  test('never uses more than 4 qubits: extra Concepts are dropped by weight', () => {
    const many = Array.from({ length: 20 }, (_v, i) => ({ concept: `C${i}`, pct: 5 + i * 3, total: 5, status: 'weak' }));
    const state = buildQuantumLearningState({ gapMap: many });
    expect(state.circuit.qubits).toBe(4);
    expect(state.state).toHaveLength(16);
  });

  test('prepareQuantumPractice carries the graph through and explains the circuit', () => {
    const plan = prepareQuantumPractice({ gapMap: rootGapMap, graph: rootGraph, bankItems: [] });
    expect(plan.targetConcept).toBe('Factorisation');
    expect(plan.explanation).toMatch(/2-qubit/);
    expect(plan.explanation).toMatch(/amplified/);
  });
});
