// The Concept Graph generation fixture — the same Grade 12 Mathematics graph
// the demo ships as inspectable YAML (data/subjects/
// graph-g12-mathematics.yaml), as data for the local deterministic generator.
// The demo *serves* the YAML; this JS copy only backs local generation.
// tests/concept-graph-generator.spec.js asserts the two never drift.
const grade12Mathematics = Object.freeze({
  id: 'graph-g12-mathematics',
  type: 'concept-graph',
  subject: 'Grade 12 Mathematics',
  language: 'en',
  generated_at: '2026-09-21T00:00:00Z',
  generated_by: 'authored-demo',
  schema_version: '1.0.0',
  nodes: [
    { concept: 'Linear Equations', grade: '8', description: 'Solving one- and two-step linear equations' },
    { concept: 'Expanding Brackets', grade: '9', description: 'The distributive law and binomial products' },
    { concept: 'Factorisation', grade: '9', description: 'Common factors, difference of squares, and trinomials' },
    { concept: 'Algebra', grade: '10', description: 'Simplifying expressions and solving linear equations' },
    { concept: 'Exponents & Surds', grade: '10', description: 'Laws of exponents and simplifying surds' },
    { concept: 'Functions', grade: '10', description: 'Function notation, evaluation, and inverses' },
    { concept: 'Quadratic Equations', grade: '11', description: 'Solving quadratics by factoring, the formula, and completing the square' },
  ],
  edges: [
    { requires: 'Expanding Brackets', for: 'Factorisation' },
    { requires: 'Linear Equations', for: 'Algebra' },
    { requires: 'Linear Equations', for: 'Functions' },
    { requires: 'Algebra', for: 'Functions' },
    { requires: 'Factorisation', for: 'Quadratic Equations' },
    { requires: 'Algebra', for: 'Quadratic Equations' },
  ],
});

export const conceptGraphFixtures = Object.freeze({
  'Grade 12 Mathematics': grade12Mathematics,
});