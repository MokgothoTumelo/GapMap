// A small, dependency-free quantum state-vector simulator.
//
// This is REAL quantum mechanics, simulated on a classical computer: n qubits
// are stored as 2^n complex amplitudes, gates are unitary operations on those
// amplitudes, and measurement follows the Born rule (probability = |amplitude|²).
// It is NOT a quantum computer, and nothing here claims to be one. Every gate
// used below is a standard gate that a real quantum processor also runs, so the
// circuits built on top of this file can be exported to Qiskit / Braket as-is.
//
// Conventions
//  - Qubit q corresponds to bit q of the basis-state index (qubit 0 = least
//    significant bit). Basis state |0…0⟩ is index 0.
//  - Rotations follow the usual definitions:
//      Ry(θ) = [[cos θ/2, −sin θ/2], [sin θ/2, cos θ/2]]
//      Rx(θ) = [[cos θ/2, −i sin θ/2], [−i sin θ/2, cos θ/2]]
//      Rz(θ) = diag(e^(−iθ/2), e^(+iθ/2))
//      Rzz(θ) = exp(−i θ/2 · Z⊗Z)
//
// Pure and runtime-agnostic: no DOM, no fetch, no Node APIs.

export const MAX_QUBITS = 16;

/** Small, fast, seedable PRNG (mulberry32) so measurement runs are reproducible. */
export function createRng(seed = 1) {
  let a = (Number(seed) >>> 0) || 1;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 32-bit hash of a string (FNV-1a) — used to derive seeds. */
export function hashSeed(text) {
  let h = 0x811C9DC5;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const round = (value) => Math.round(value * 10000) / 10000;

export class StateVector {
  /**
   * @param {number} numQubits
   * @param {{ record?: boolean }} [options] record=false skips the gate log
   *        (used inside optimisation loops that run thousands of circuits).
   */
  constructor(numQubits, { record = true } = {}) {
    const n = Math.trunc(numQubits);
    if (!Number.isInteger(n) || n < 1 || n > MAX_QUBITS) {
      throw new RangeError(`StateVector supports 1–${MAX_QUBITS} qubits (got ${numQubits})`);
    }
    this.n = n;
    this.dim = 1 << n;
    this.re = new Float64Array(this.dim);
    this.im = new Float64Array(this.dim);
    this.re[0] = 1; // start in |0…0⟩
    this.record = record;
    this.log = [];
  }

  clone({ record = this.record } = {}) {
    const copy = new StateVector(this.n, { record });
    copy.re.set(this.re);
    copy.im.set(this.im);
    if (record) copy.log = this.log.map((gate) => ({ ...gate }));
    return copy;
  }

  _log(gate) {
    if (this.record) this.log.push(gate);
  }

  // ---- single-qubit gates -------------------------------------------------

  /** Apply an arbitrary 2×2 complex matrix [[a, b], [c, d]] given as 8 numbers. */
  _apply1(q, ar, ai, br, bi, cr, ci, dr, di) {
    const mask = 1 << q;
    for (let i = 0; i < this.dim; i += 1) {
      if (i & mask) continue;
      const j = i | mask;
      const x0r = this.re[i];
      const x0i = this.im[i];
      const x1r = this.re[j];
      const x1i = this.im[j];
      this.re[i] = ar * x0r - ai * x0i + br * x1r - bi * x1i;
      this.im[i] = ar * x0i + ai * x0r + br * x1i + bi * x1r;
      this.re[j] = cr * x0r - ci * x0i + dr * x1r - di * x1i;
      this.im[j] = cr * x0i + ci * x0r + dr * x1i + di * x1r;
    }
  }

  /** Hadamard: |0⟩ → (|0⟩+|1⟩)/√2. Creates an equal superposition. */
  h(q) {
    const s = Math.SQRT1_2;
    this._apply1(q, s, 0, s, 0, s, 0, -s, 0);
    this._log({ g: 'h', q });
    return this;
  }

  /** Pauli-X (bit flip). */
  x(q) {
    this._apply1(q, 0, 0, 1, 0, 1, 0, 0, 0);
    this._log({ g: 'x', q });
    return this;
  }

  /** Rotation about Y — the workhorse for loading real-valued probabilities. */
  ry(q, theta) {
    const c = Math.cos(theta / 2);
    const s = Math.sin(theta / 2);
    this._apply1(q, c, 0, -s, 0, s, 0, c, 0);
    this._log({ g: 'ry', q, theta });
    return this;
  }

  /** Rotation about X — used as the QAOA "mixer". */
  rx(q, theta) {
    const c = Math.cos(theta / 2);
    const s = Math.sin(theta / 2);
    this._apply1(q, c, 0, 0, -s, 0, -s, c, 0);
    this._log({ g: 'rx', q, theta });
    return this;
  }

  /** Rotation about Z — a phase that depends on the qubit's value. */
  rz(q, theta) {
    const c = Math.cos(theta / 2);
    const s = Math.sin(theta / 2);
    this._apply1(q, c, -s, 0, 0, 0, 0, c, s);
    this._log({ g: 'rz', q, theta });
    return this;
  }

  // ---- two-qubit gates ----------------------------------------------------

  /** Controlled-NOT: flips `target` when `control` is 1. Creates entanglement. */
  cnot(control, target) {
    const cMask = 1 << control;
    const tMask = 1 << target;
    for (let i = 0; i < this.dim; i += 1) {
      if ((i & cMask) && !(i & tMask)) {
        const j = i | tMask;
        const r = this.re[i]; this.re[i] = this.re[j]; this.re[j] = r;
        const m = this.im[i]; this.im[i] = this.im[j]; this.im[j] = m;
      }
    }
    this._log({ g: 'cnot', c: control, t: target });
    return this;
  }

  /**
   * Rzz(θ) = exp(−i θ/2 · Z⊗Z): a phase e^(−iθ/2) when the two qubits agree and
   * e^(+iθ/2) when they differ. This is how a "two things interact" term of a
   * cost function is written into a circuit (it is two CNOTs + one Rz on hardware).
   */
  rzz(a, b, theta) {
    const c = Math.cos(theta / 2);
    const s = Math.sin(theta / 2);
    const aMask = 1 << a;
    const bMask = 1 << b;
    for (let i = 0; i < this.dim; i += 1) {
      const parity = ((i & aMask) ? 1 : 0) ^ ((i & bMask) ? 1 : 0);
      const pr = c;
      const pi = parity ? s : -s;
      const xr = this.re[i];
      const xi = this.im[i];
      this.re[i] = pr * xr - pi * xi;
      this.im[i] = pr * xi + pi * xr;
    }
    this._log({ g: 'rzz', a, b, theta });
    return this;
  }

  // ---- multi-qubit building blocks ----------------------------------------

  /**
   * Multiplexed (uniformly-controlled) Ry: rotate `target` by angles[v], where
   * v is the value held by the `controls` qubits (controls[0] is the least
   * significant bit of v). This is the standard building block for loading an
   * arbitrary real probability distribution into qubits ("amplitude encoding");
   * on hardware it compiles to a ladder of CNOTs and single-qubit Ry gates.
   */
  multiplexedRy(controls, target, angles) {
    const tMask = 1 << target;
    for (let i = 0; i < this.dim; i += 1) {
      if (i & tMask) continue;
      let v = 0;
      for (let k = 0; k < controls.length; k += 1) {
        if (i & (1 << controls[k])) v |= 1 << k;
      }
      const theta = angles[v] || 0;
      if (theta === 0) continue;
      const c = Math.cos(theta / 2);
      const s = Math.sin(theta / 2);
      const j = i | tMask;
      const x0r = this.re[i]; const x0i = this.im[i];
      const x1r = this.re[j]; const x1i = this.im[j];
      this.re[i] = c * x0r - s * x1r;
      this.im[i] = c * x0i - s * x1i;
      this.re[j] = s * x0r + c * x1r;
      this.im[j] = s * x0i + c * x1i;
    }
    this._log({ g: 'mry', controls: [...controls], target, angles: [...angles] });
    return this;
  }

  /**
   * Phase flip: multiply the amplitude of each listed basis state by −1.
   * Nothing changes in the probabilities yet — the sign only matters once the
   * amplitudes are made to interfere. This is the "oracle" in Grover-style search.
   */
  phaseFlip(indices) {
    for (const index of indices) {
      if (index >= 0 && index < this.dim) {
        this.re[index] = -this.re[index];
        this.im[index] = -this.im[index];
      }
    }
    this._log({ g: 'flip', indices: [...indices] });
    return this;
  }

  /**
   * Phase shift: multiply the listed basis states by e^(iφ). φ = π is the plain
   * phase flip above. Other angles let amplitude amplification be *dialled*
   * (a partial boost) instead of always rotating by a fixed, sometimes
   * overshooting, angle.
   */
  phaseShift(indices, phi) {
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    for (const index of indices) {
      if (index >= 0 && index < this.dim) {
        const xr = this.re[index];
        const xi = this.im[index];
        this.re[index] = c * xr - s * xi;
        this.im[index] = c * xi + s * xr;
      }
    }
    this._log({ g: 'phase', indices: [...indices], phi });
    return this;
  }

  /** Apply a recorded gate descriptor (used to replay / invert circuits). */
  apply(gate) {
    switch (gate.g) {
      case 'h': return this.h(gate.q);
      case 'x': return this.x(gate.q);
      case 'ry': return this.ry(gate.q, gate.theta);
      case 'rx': return this.rx(gate.q, gate.theta);
      case 'rz': return this.rz(gate.q, gate.theta);
      case 'cnot': return this.cnot(gate.c, gate.t);
      case 'rzz': return this.rzz(gate.a, gate.b, gate.theta);
      case 'mry': return this.multiplexedRy(gate.controls, gate.target, gate.angles);
      case 'flip': return this.phaseFlip(gate.indices);
      case 'phase': return this.phaseShift(gate.indices, gate.phi);
      default: throw new Error(`Unknown gate "${gate.g}"`);
    }
  }

  applyAll(gates) {
    for (const gate of gates) this.apply(gate);
    return this;
  }

  // ---- measurement & readout ----------------------------------------------

  /** Exact outcome probabilities |amplitude|² — only possible in simulation. */
  probabilities() {
    const p = new Float64Array(this.dim);
    for (let i = 0; i < this.dim; i += 1) {
      p[i] = this.re[i] * this.re[i] + this.im[i] * this.im[i];
    }
    return p;
  }

  /** Total probability; must stay ≈ 1 because gates are unitary. */
  norm() {
    let sum = 0;
    for (let i = 0; i < this.dim; i += 1) {
      sum += this.re[i] * this.re[i] + this.im[i] * this.im[i];
    }
    return sum;
  }

  /**
   * Measure the whole register `shots` times (Born rule). Each shot collapses
   * the state to one basis state; the returned array counts how often each
   * basis state was observed. A real device only ever gives you these counts.
   */
  sample(shots, rng = Math.random) {
    const probs = this.probabilities();
    const cumulative = new Float64Array(this.dim);
    let running = 0;
    for (let i = 0; i < this.dim; i += 1) {
      running += probs[i];
      cumulative[i] = running;
    }
    const counts = new Array(this.dim).fill(0);
    for (let s = 0; s < shots; s += 1) {
      const r = rng() * running;
      let lo = 0;
      let hi = this.dim - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] < r) lo = mid + 1; else hi = mid;
      }
      counts[lo] += 1;
    }
    return counts;
  }

  /** ⟨Z_q⟩ — expected value of the qubit's ±1 observable (+1 for |0⟩, −1 for |1⟩). */
  expectZ(q) {
    const mask = 1 << q;
    let total = 0;
    for (let i = 0; i < this.dim; i += 1) {
      const p = this.re[i] * this.re[i] + this.im[i] * this.im[i];
      total += (i & mask) ? -p : p;
    }
    return total;
  }

  /** ⟨Z_a Z_b⟩ — expected value of the two-qubit parity observable. */
  expectZZ(a, b) {
    const aMask = 1 << a;
    const bMask = 1 << b;
    let total = 0;
    for (let i = 0; i < this.dim; i += 1) {
      const p = this.re[i] * this.re[i] + this.im[i] * this.im[i];
      total += (((i & aMask) ? 1 : 0) ^ ((i & bMask) ? 1 : 0)) ? -p : p;
    }
    return total;
  }

  /** Human-readable circuit listing (for the UI, docs and Qiskit porting). */
  describe() {
    return describeCircuit(this.log);
  }
}

// ---- circuit helpers ------------------------------------------------------

/** The inverse of a recorded circuit: reverse the order, negate every angle. */
export function invertCircuit(gates) {
  return [...gates].reverse().map((gate) => {
    switch (gate.g) {
      case 'ry':
      case 'rx':
      case 'rz':
      case 'rzz':
        return { ...gate, theta: -gate.theta };
      case 'mry':
        return { ...gate, angles: gate.angles.map((angle) => -angle) };
      case 'phase':
        return { ...gate, phi: -gate.phi };
      default: // h, x, cnot and phase flips are their own inverse
        return { ...gate };
    }
  });
}

/** One short line per gate, e.g. "Ry(1.2310) q2". */
export function describeCircuit(gates) {
  return gates.map((gate) => {
    switch (gate.g) {
      case 'h': return `H q${gate.q}`;
      case 'x': return `X q${gate.q}`;
      case 'ry': return `Ry(${round(gate.theta)}) q${gate.q}`;
      case 'rx': return `Rx(${round(gate.theta)}) q${gate.q}`;
      case 'rz': return `Rz(${round(gate.theta)}) q${gate.q}`;
      case 'cnot': return `CNOT q${gate.c}→q${gate.t}`;
      case 'rzz': return `Rzz(${round(gate.theta)}) q${gate.a},q${gate.b}`;
      case 'mry': return `Ry[controlled by ${gate.controls.length ? gate.controls.map((c) => 'q' + c).join(',') : 'none'}] q${gate.target}`;
      case 'flip': return `PhaseFlip |${gate.indices.join(',')}⟩`;
      case 'phase': return `Phase(${round(gate.phi)}) |${gate.indices.join(',')}⟩`;
      default: return gate.g;
    }
  });
}

/**
 * Amplitude encoding: the gate list that turns |0…0⟩ into
 *   Σ_i √p_i |i⟩
 * for a probability vector p (length ≤ 2^n; the rest is padded with zeros).
 * Built as a binary tree of (multiplexed) Ry rotations — each qubit, from the
 * most significant down, splits the remaining probability between its 0 and 1
 * halves. n qubits hold 2^n probabilities, which is why this encoding is so
 * compact.
 */
export function amplitudeEncodingGates(probabilities, numQubits) {
  const dim = 1 << numQubits;
  const p = new Array(dim).fill(0);
  let total = 0;
  for (let i = 0; i < dim; i += 1) {
    p[i] = Math.max(0, Number(probabilities[i]) || 0);
    total += p[i];
  }
  if (total <= 0) throw new RangeError('amplitudeEncodingGates needs a positive probability mass');
  for (let i = 0; i < dim; i += 1) p[i] /= total;

  const gates = [];
  for (let level = numQubits - 1; level >= 0; level -= 1) {
    const groups = 1 << (numQubits - 1 - level);
    const half = 1 << level;
    const angles = [];
    for (let g = 0; g < groups; g += 1) {
      const start = g << (level + 1);
      let zero = 0;
      let one = 0;
      for (let k = 0; k < half; k += 1) {
        zero += p[start + k];
        one += p[start + half + k];
      }
      angles.push(zero + one > 0 ? 2 * Math.atan2(Math.sqrt(one), Math.sqrt(zero)) : 0);
    }
    const controls = [];
    for (let c = level + 1; c < numQubits; c += 1) controls.push(c);
    gates.push({ g: 'mry', controls, target: level, angles });
  }
  return gates;
}
