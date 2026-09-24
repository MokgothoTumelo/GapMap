# GapMap Demo Data

These YAML files are inspectable fixtures for the prototype UI and documentation.
They are not production data or the application's source of truth.

```text
demo-data/
  assessments/   assessment definitions used by the demo pages
  attempts/      completed learner attempts used by examples
```

The data conforms to the schemas in [`../schema/`](../schema/).

> Subject-level data — the Concept Graphs — is **application state**, not
> sample data, and lives beside this folder in [`../../data/subjects/`](../../data/subjects/),
> served to every Learner through the subject store
> (`frontend/js/subject-store.js`). See
> [`docs/adr/0006-concept-graph-learning-path.md`](../docs/adr/0006-concept-graph-learning-path.md).