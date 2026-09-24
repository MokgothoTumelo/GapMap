# Artefact-based assessment: assessment + attempt, Concept-tagged

We store each assessment as two data records — an LLM-generated **assessment** (Items, correct answers, Concept tags, Mistake-Diagnosis seeds), frozen for the attempt, and an app-written **attempt** (Responses, per-Concept Mastery rollup, generated feedback) — validated against JSON Schemas at the LLM boundary, with every Item required to carry a Concept so the rollup produces the Gap Map. Demo YAML is kept separately from the schemas so sample data cannot be mistaken for application state.

## Considered options

- **Single file, answers written back into the quiz.** Rejected: regenerating the quiz clobbers in-progress answers and destroys attempt history; the quiz template and the learner's sitting are different lifecycles.
- **DB-only, no inspectable artefact.** Rejected for the prototype: you lose the "show the judge the quiz object" UX and the ability to diff attempts as text. The file is kept as a serialisation of a DB row, not a replacement for one — PostgreSQL remains the record of truth for multi-user history.
- **YAML end-to-end, no JSON Schema.** Rejected: free-form YAML from the LLM is unvalidated; JSON Schema + structured output gives a generation contract. YAML stays on disk for human readability; conversion happens at the boundary.
- **JSON end-to-end.** Rejected: less pleasant to read and hand-edit in the side panel, which is the whole point of the artefact UX.

## Consequences

- The Concept tag is load-bearing: without it an Item is just a question; with it, a Diagnostic rolls up into a Gap Map. Any Item without a Concept is a schema violation.
- Attempt history is append-only by `assessment_id` + `learner_id`; the assessment is referenced, never mutated.
- Moving to Postgres later is a serialisation change, not a model change — the assessment/attempt/Concept shape survives.
