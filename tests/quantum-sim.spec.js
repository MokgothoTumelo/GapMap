import { test, expect } from '@playwright/test';
import {
  StateVector,
  amplitudeEncodingGates,
  invertCircuit,
  createRng,
} from '../core/quantum-sim.js';

// The simulator is the foundation both quantum features stand on, so these
// tests pin it to known physics rather than to our own expectations.
test.describe('Quantum state-vector simulator', () => {
  test('a Hadamard + CNOT makes a Bell pair: only 00 and 11, 50/50', () => {
    const sv = new StateVector(2).h(0).cnot(0, 1);
    const p = Array.from(sv.probabilities());
    expect(p[0]).toBeCloseTo(0.5, 10);
    expect(p[3]).toBeCloseTo(0.5, 10);
    expect(p[1]).toBeCloseTo(0, 10);
    expect(p[2]).toBeCloseTo(0, 10);
  });

  test('gates are unitary: total probability stays 1', () => {
    const sv = new StateVector(4)
      .h(0).ry(1, 0.7).rx(2, 1.3).rz(3, 0.4).cnot(0, 3).rzz(1, 2, 0.9);
    expect(sv.norm()).toBeCloseTo(1, 10);
  });

  test('Rzz only adds phase, so probabilities are unchanged until amplitudes interfere', () => {
    const sv = new StateVector(2).h(0).h(1);
    const before = Array.from(sv.probabilities());
    sv.rzz(0, 1, 1.1);
    Array.from(sv.probabilities()).forEach((p, i) => expect(p).toBeCloseTo(before[i], 10));
  });

  test('amplitude encoding loads exactly the requested probabilities', () => {
    const target = [0.4, 0.25, 0.2, 0.1, 0.05, 0, 0, 0];
    const sv = new StateVector(3).applyAll(amplitudeEncodingGates(target, 3));
    Array.from(sv.probabilities()).forEach((p, i) => expect(p).toBeCloseTo(target[i], 10));
  });

  test('amplitude encoding normalises input and rejects an empty distribution', () => {
    const sv = new StateVector(2).applyAll(amplitudeEncodingGates([2, 1, 1, 0], 2));
    expect(sv.probabilities()[0]).toBeCloseTo(0.5, 10);
    expect(() => amplitudeEncodingGates([0, 0, 0, 0], 2)).toThrow();
  });

  test('an inverted circuit undoes the circuit', () => {
    const gates = amplitudeEncodingGates([0.5, 0.2, 0.15, 0.1, 0.05, 0, 0, 0], 3);
    const sv = new StateVector(3).applyAll(gates).applyAll(invertCircuit(gates));
    expect(sv.probabilities()[0]).toBeCloseTo(1, 10);
  });

  test('one Grover round matches the textbook amplification sin²(3θ)', () => {
    const prior = [0.5, 0.2, 0.15, 0.1, 0.05, 0, 0, 0];
    const prep = amplitudeEncodingGates(prior, 3);
    const sv = new StateVector(3).applyAll(prep);
    const marked = 2; // starts at probability 0.15
    sv.phaseFlip([marked]).applyAll(invertCircuit(prep)).phaseFlip([0]).applyAll(prep);
    const theta = Math.asin(Math.sqrt(0.15));
    expect(sv.probabilities()[marked]).toBeCloseTo(Math.sin(3 * theta) ** 2, 8);
    expect(sv.norm()).toBeCloseTo(1, 10);
  });

  test('measurement follows the Born rule and is reproducible with a seed', () => {
    const build = () => new StateVector(3)
      .applyAll(amplitudeEncodingGates([0.5, 0.25, 0.25, 0, 0, 0, 0, 0], 3));
    const a = build().sample(4000, createRng(11));
    const b = build().sample(4000, createRng(11));
    expect(a).toEqual(b);
    expect(a[0] / 4000).toBeGreaterThan(0.46);
    expect(a[0] / 4000).toBeLessThan(0.54);
    expect(a.slice(3).every((count) => count === 0)).toBe(true);
  });

  test('rejects an unsupported qubit count', () => {
    expect(() => new StateVector(0)).toThrow(RangeError);
    expect(() => new StateVector(40)).toThrow(RangeError);
  });

  test('a phase shift changes no probability by itself, and is undone by its inverse', () => {
    const sv = new StateVector(3).applyAll(amplitudeEncodingGates([0.3, 0.3, 0.2, 0.1, 0.1, 0, 0, 0], 3));
    const before = Array.from(sv.probabilities());
    const gate = { g: 'phase', indices: [0, 2], phi: 0.8 };
    sv.apply(gate);
    Array.from(sv.probabilities()).forEach((p, i) => expect(p).toBeCloseTo(before[i], 10));
    sv.applyAll(invertCircuit([gate]));
    expect(sv.im.every((v) => Math.abs(v) < 1e-12)).toBe(true);
  });

  test('phase-tuned amplification matches its closed form P = a·|1 − 2u + u²a|²', () => {
    const prior = [0.25, 0.25, 0.2, 0.15, 0.1, 0.05, 0, 0];
    const prep = amplitudeEncodingGates(prior, 3);
    const marked = [0, 1]; // a = 0.5
    const a = 0.5;
    for (const phi of [0.4, 1.1, 2.0, Math.PI]) {
      const sv = new StateVector(3).applyAll(prep);
      sv.phaseShift(marked, phi).applyAll(invertCircuit(prep)).phaseShift([0], phi).applyAll(prep);
      const simulated = marked.reduce((sum, i) => sum + sv.probabilities()[i], 0);
      const ur = 1 - Math.cos(phi);
      const ui = -Math.sin(phi);
      const re = 1 - 2 * ur + (ur * ur - ui * ui) * a;
      const im = -2 * ui + 2 * ur * ui * a;
      expect(simulated).toBeCloseTo(a * (re * re + im * im), 8);
    }
  });
});
