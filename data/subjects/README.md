# GapMap subject data

Subject-level data: knowledge the **Subject** holds for *all* Learners — never
per-Learner state, never demo sample data. One YAML file per Subject (grade +
subject name), loaded through the subject store (`frontend/js/subject-store.js`),
which fetches, semantically validates, and caches per Subject. When the
database lands, these files become rows behind the same seam — a
serialisation change, not a model change.

```text
data/subjects/
  graph-g12-mathematics.yaml   # the Grade 12 Mathematics Concept Graph
```

## Concept Graphs

`graph-g12-mathematics.yaml` is the Grade 12 Mathematics Subject's **Concept
Graph** (ADR-0006) — the prerequisite edges between Concepts, spanning grades
where a Concept builds on earlier years' work. With the Gap Map it drives the
Learning Path (`core/learning-path.js`): roots first, severity as tie-break.
It is also where the demo narrative lives as data: Factorisation (Grade 9
origin) is weak *and* blocks Quadratic Equations, so the path starts below the
Learner's grade — a Foundational Gap.

Every Subject's graph follows the slug policy shared with the demo assessment
files: `graph-g<grade>-<subject>.yaml` (`Grade 12 Mathematics` →
`graph-g12-mathematics.yaml`).