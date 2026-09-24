# Quantum in GapMap — explained for the team

This page explains the two quantum features in GapMap in plain language, shows
where the code lives, and gives honest answers to the questions judges are
likely to ask. Read sections 1–2 if you only have five minutes.

---

## 1. The 30-second version

GapMap runs **two quantum algorithms on a quantum simulator that we built**
(`core/quantum-sim.js`). The simulator runs in the browser, so nothing leaves
the learner's device.

| # | Feature | Where the learner sees it | Quantum technique |
|---|---------|---------------------------|-------------------|
| 2 | **Quantum Adaptive Practice** — decides which Concept to practise next | Purple card at the end of the Diagnostic, and the "targeted Practice" card in `concept.html` | Amplitude encoding + amplitude amplification + measurement |
| 1 | **Quantum Study Plan** — picks the best K Concepts to study this week | "Quantum Study Plan" card on the Gap Map (`dashboard.html`) | QAOA (Quantum Approximate Optimisation Algorithm) |

Both use real quantum gates and real quantum rules (superposition,
interference, measurement). Both are **simulated on a normal computer** — we
do not claim to run on a quantum processor.

---

## 2. What is real, and what is not (say this out loud)

**Real:**
- Qubits are stored as complex amplitudes, exactly as quantum mechanics describes them.
- The gates (H, Rx, Ry, Rz, Rzz, phase gates) are the standard quantum gates.
- Outcomes are read by *measuring* — random samples following the Born rule, as on a real device.
- Interference is real: amplitudes add and cancel. That is why the answer is not just "re-weighting a list".

**Not real:**
- There is no quantum hardware involved. A classical computer calculates what a quantum computer would do.
- No speed-up. With 4–10 Concepts a normal computer is just as fast. The point is that the *formulation* (encoding, oracle, cost function, circuit) is the real thing and carries over to hardware, where whole-curriculum graphs would be too big to enumerate.
- The starting scores (how weak is each Concept?) come from an ordinary scoring formula. Quantum computing acts on that result; it doesn't replace it.

> Previous version (v1) only *borrowed quantum vocabulary*: it took a square
> root and then squared it again (which does nothing) and called "pick the
> biggest" a "collapse". v2 replaces that with real circuits.

---

## 3. Six ideas you need (that's all)

1. **Qubit.** A bit that can be 0 and 1 at the same time, with an *amplitude* (a number) attached to each.
2. **Superposition.** n qubits hold **2ⁿ** amplitudes at once — 2 qubits hold 4 numbers, 6 qubits hold 64.
3. **Probability = amplitude².** If a state has amplitude 0.7 it will be seen about 0.49 = 49% of the time.
4. **Gates.** Steps that rotate amplitudes. They never lose information; you can always run them backwards.
5. **Interference.** Amplitudes can be positive or negative (or have a phase). Matching ones add up (more likely); opposite ones cancel (less likely). Quantum algorithms are the art of arranging interference so the *right* answer gets bigger.
6. **Measurement.** You can't read the amplitudes. You measure, and get **one** answer at random, weighted by probability. Repeat many times ("shots") and you see the pattern.

The simulator (`core/quantum-sim.js`, about 430 lines including comments) implements exactly these
six things: `StateVector`, gates like `.h() .ry() .rx() .rz() .rzz()
.phaseShift()`, and `.sample(shots)`.

---

## 4. Feature 2 — Quantum Adaptive Practice

**Question it answers:** *"Given everything the Diagnostic showed, which Concept should this learner practise next?"*

File: `core/quantum-adaptive.js` → `buildQuantumLearningState()`

### Step by step

**Step 0 — Classical scoring (ordinary maths).**
Each weak Concept gets a weight from its score, how many mistakes were made,
and how sure we can be (few questions = more uncertainty). Normalised, this
gives a starting probability for each Concept.

**Step 1 — Amplitude encoding (quantum).**
We load those probabilities into qubits. 4 Concepts need only **2 qubits**;
16 Concepts need only 4. A short tree of `Ry` rotations does it, and the
tests check the loaded probabilities match to 10 decimal places.

**Step 2 — The oracle marks the root causes (quantum).**
A **root cause** is a Concept that other weak Concepts depend on — from the
Concept Graph — or that a Mistake Diagnosis points back to ("you got this wrong
because you're shaky on *Factorisation*"). The oracle tags those states with a
phase.

**Step 3 — Amplitude amplification (quantum interference).**
We reflect the state about its starting point. Tagged states interfere
constructively, so root causes gain probability and the rest lose it. This is
the Grover idea, with one improvement of ours: standard Grover always rotates
by a fixed angle, which can overshoot or even do nothing (at exactly 50% marked,
it gains nothing). We tune the phase so the root causes end up holding about
**75%** of the probability. The formula is in the code and pinned by a test.

**Step 4 — Measure.**
We measure the register 1,024 times. The Concept seen most often is the one the
state "collapsed" onto, and its frequency is the confidence bar. The random
generator is seeded from the Diagnostic, so the same Diagnostic always gives
the same plan (needed for testing and for saving the plan).

### Worked example (from the test data)

Learner is weak at Factorisation (40%), Quadratic Equations (30%), and
middling at Algebra (60%) and Functions (70%). The graph says Factorisation
and Algebra are both needed for Quadratic Equations.

| Concept | Root cause? | Before | After the circuit | Measured (1,024 shots) |
|---|---|---|---|---|
| Factorisation | yes | 27.9% | 46.9% | 44.8% |
| Algebra | yes | 16.7% | 28.1% | 29.2% |
| Quadratic Equations | no | **41.2%** | 18.6% | 19.9% |
| Functions | no | 14.2% | 6.4% | 6.1% |

Before the circuit, Quadratic Equations (the lowest score) looks like the
biggest problem. After it, **Factorisation wins**, because fixing the root
cause repairs the dependent Concept too. Root causes went from 44.6% to 75.0%
of the probability. This is the same "roots first" idea as the Learning Path,
now produced by interference.

### What the learner sees
The purple card after the Diagnostic: "*A simulated 2-qubit circuit encoded
your Diagnostic evidence, amplified the root-cause Concepts, and 1024
measurements collapsed it onto Factorisation.*" Then `concept.html` serves a
repair → transfer → check set of questions for that Concept.

---

## 5. Feature 1 — Quantum Study Plan (QAOA)

**Question it answers:** *"I can only study K Concepts this week. Which K give the most progress, without studying something before its prerequisite?"*

File: `core/quantum-qaoa.js` → `optimiseStudyPlan()`

### Why this fits quantum

It is a yes/no choice for every Concept ("study" / "skip") with rules between
them. That is a **combinatorial optimisation** problem: 6 Concepts have
2⁶ = 64 possible plans, 30 have over a billion. QAOA is a quantum algorithm
designed for exactly this shape of problem.

### Step by step

**Step 1 — One qubit per Concept.**
|1⟩ = "study this week", |0⟩ = "skip". Putting all qubits in superposition
represents **all plans at once**.

**Step 2 — Write the rules as a cost (a QUBO).**
Lower cost = better plan.
- *Reward:* a Concept is worth more the bigger its gap **and** the weaker the Concepts that depend on it: `benefit = gap × (1 + Σ gap of dependents)`.
- *Penalty:* choosing a different number of Concepts than K.
- *Penalty:* choosing a Concept without its prerequisite.

**Step 3 — Convert to the form a quantum circuit uses (Ising).**
Substitute x = (1 − z)/2. Every linear term becomes an `Rz` gate and every
"these two interact" term becomes an `Rzz` gate. A test checks the Ising cost
equals the original cost for **every** possible plan.

**Step 4 — Build the QAOA circuit.**
Start with Hadamard on every qubit (all plans equally likely). Then repeat
twice: a **cost layer** (Rz/Rzz gates that stamp each plan's cost into its
phase) and a **mixer layer** (Rx gates that let amplitude flow between plans).
The angles γ and β decide how the interference plays out.

**Step 5 — Tune the angles (the "hybrid" loop).**
A classical optimiser tries different angles, runs the circuit, and keeps the
angles whose *best 10%* of outcomes have the lowest cost (this is called CVaR).
This classical-tunes-quantum loop is how QAOA is run on real machines too.

**Step 6 — Measure and check.**
Measure 2,048 times, throw away invalid plans, keep the cheapest valid one.
Then compare with exhaustive classical search. The UI shows the comparison:
"✓ Checked against classical search: same plan".

**Step 7 — Order it.**
The chosen Concepts are sorted prerequisites-first with the existing
`buildLearningPath()`.

### Worked example (Grade 12 Maths demo)

Budget: 2 Concepts. Result: **Expanding Brackets → Factorisation** (which
unlocks Quadratic Equations). 6 qubits, 60 gates. The optimal plan appeared in
about **10%** of measurements, compared with **1.6%** for blind guessing. The
choice matches the classical answer.

### How well does it work? (we measured it)

- 60 random problems with 3–10 Concepts: the quantum run found the true optimum **every time**.
- The cheapest plan in the cost function was always a valid plan (penalties are strong enough).
- Speed: about 0.23 s on average, under 1 s worst case at 10 Concepts (more than 10 Concepts: we keep the 10 with the most to gain and say so).

---

## 6. Where everything is

**New files**

| File | What it is |
|---|---|
| `core/quantum-sim.js` | The quantum simulator: qubits, gates, measurement, amplitude encoding |
| `core/quantum-qaoa.js` | QUBO → Ising → QAOA circuit → tuning → measurement → verification |
| `tests/quantum-sim.spec.js` | Pins the simulator to known physics (Bell pair, Grover formula, unitarity) |
| `tests/quantum-qaoa.spec.js` | Ising = QUBO, valid plans only, optimum found, roots-first, edge cases |
| `docs/QUANTUM-EXPLAINED.md` | This page |

**Changed files**

| File | Change |
|---|---|
| `core/quantum-adaptive.js` | `buildQuantumLearningState()` rewritten to run the real circuit; `prepareQuantumPractice()` passes the graph through and explains the circuit; fixed an operator-precedence bug in `candidateFocusKinds()` (unknown mistake kinds reset their count instead of adding to it) |
| `dashboard.html` | New "Quantum Study Plan" card (styles, markup, `wireQuantumStudyPlan()`), inserted between the Learning Path and the buttons |
| `diagnostic.html` | Loads the Concept Graph and passes it to the quantum step; labels changed from "Quantum-Inspired" to "Quantum Adaptive Practice · simulated qubits" |
| `concept.html` | Label only |
| `tests/quantum-adaptive.spec.js` | 9 new tests for the real-circuit behaviour |
| `core/README.md`, `README.md` | Quantum section and Technologies list updated |

---

## 7. How to demo it (2 minutes)

1. Sign up → Setup (Grade 12, Mathematics) → take the **Diagnostic**.
2. On the results screen, point at the **purple card**: "this ran a 2-qubit circuit and measured it 1,024 times."
3. Open **View my GapMap**. Scroll to **Quantum Study Plan**. Change "I can study" from 3 to 2 and watch it re-run.
4. Click **How this works** and show the circuit listing at the bottom.
5. Say: "It's simulated, and we verify it against classical search — that check is the ✓ line."

---

## 8. Questions judges may ask

**"Is this really quantum?"**
It runs real quantum algorithms — amplitude amplification and QAOA — on a
simulator we wrote. It is not on quantum hardware, and we say so in the UI.

**"Do you get a quantum speed-up?"**
No, not at this size, and we don't claim one. Amplitude amplification is only
quadratically faster for unstructured search, and QAOA has no proven advantage.
What we built is the correct formulation, ready for larger problems and real
hardware.

**"Why not just sort by score?"**
Sorting picks the lowest score (Quadratic Equations). The circuit picks the
*root cause* (Factorisation) because dependency structure is part of the
problem — a test in the repo shows the two disagree. For the study plan, the
budget and prerequisite rules turn it into a real optimisation problem.

**"Why simulate instead of using a real quantum computer?"**
Access, queue times and noise. Six qubits are simulated *exactly*, which lets
us verify every answer against classical search. The circuit is built from
standard gates, so it can be exported.

**"What would change on real hardware?"**
We'd read only sampled measurements (we already do), add noise handling, and
compile the multi-qubit steps into the device's native gates. The classical
check would stay.

**"Where does the data go?"**
Nowhere. Everything runs in the learner's browser.

---

## 9. Limits and next steps (be upfront)

- The QAOA circuit is tuned with 2 layers; more layers improve quality but cost time.
- With very tight rules (few valid plans) the optimum shows up in a small share of shots — the classical check catches any miss.
- The initial scoring formula is a heuristic, not a learned model.
- Next step: export the circuits to Qiskit and run them on a free cloud quantum device for a live demo. The gate list is already available in the UI ("How this works") and in `plan.quantum.circuit.gates`.

---

## 10. Glossary

- **Amplitude** — the number attached to each state; probability = amplitude².
- **Amplitude amplification** — Grover's idea: use interference to make marked states more likely.
- **Born rule** — the rule that measurement gives outcome *i* with probability |amplitude|².
- **CVaR** — average cost of the best few percent of outcomes; a robust way to tune QAOA.
- **Ising / QUBO** — two equivalent ways to write "minimise a cost over yes/no choices".
- **Oracle** — a step that tags the states we care about (here: root causes, or invalid plans via penalties).
- **QAOA** — a hybrid quantum/classical algorithm for optimisation.
- **Shot** — one run of the circuit followed by one measurement.
- **State vector simulator** — a program that tracks all 2ⁿ amplitudes so a classical computer can mimic a small quantum computer.
