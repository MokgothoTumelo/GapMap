# Flow: See why you're stuck — the Learner learns what to study first and why

Trigger:  The Learner opens `dashboard.html` after completing a Diagnostic for
          the active Subject (or re-opens it later).
Goal:     The Learner can name the Concept that is holding them back and the
          order to work in — not just which Concepts are weak.
Pre:      The Learner is signed in (`gapmap_user`), Setup is complete, and a
          Diagnostic for the active Subject has been taken (the presentation
          store `gapmap_diagnostic:<learner>:<subject>` exists). The Subject
          store serves the Subject's Concept Graph.

## Steps
| # | Learner action | Expected observable behavior | Time class |
|---|----------------|------------------------------|------------|
| 1 | Open the dashboard | The Gap Map renders for the active Subject: overall Score, per-Concept breakdown with Mastery badges, and the Learning Path section. | instant |
| 2 | Read the root cause | A root-cause banner sits above the score card: it names the **root** — the Concept on the path that other path Concepts depend on — with its Score, an origin-grade chip when it's below the Learner's grade, and a one-line evidence sentence when the Learner's wrong Responses carry Mistake Diagnoses ("N of your M wrong X responses were prerequisite failures pointing back here."). | instant |
| 3 | Read the Learning Path as a chain | The path renders as a **dependency chain**: root first, then each Concept with an arrow connector to it that names the dependency it satisfies ("unblocks Factorisation", "next"). Entries below the grade show an origin chip ("Grade 9"). Every node shows its Score. | instant |
| 4 | Start the root Concept | The primary CTA reads "Start with <root>" and links to that Concept's page; each chain node links to its Concept page. | instant |
| 5 | Inspect the path as data | "View as data" reveals the **derived path object** — the same entries, roots, and Mistake-Diagnosis evidence the Learning Companion's tools return — with its provenance (the Subject's Concept Graph id it was derived from). Hiding it never re-derives; the path is computed on read either way. | instant |

## Failure paths
| From step | Failure | Expected feedback / recovery |
|-----------|---------|------------------------------|
| 1 | No Diagnostic yet for this Subject | An empty state explains it and offers "Start Diagnostic". No half-rendered Gap Map. |
| 2 | The Subject has no Concept Graph | The path renders in severity order with the original labels ("Highest priority / Next / Then improve") and no root-cause banner — the page says only what the data supports, never a fabricated root cause. |
| 2 | The Concept Graph file is malformed | The page logs a console warning and renders with the severity order (same recovery as above); the page itself never breaks. |
| 2 | Wrong Responses carry no Mistake Diagnoses | The banner still names the root and what it blocks; the evidence sentence is simply absent. |

## Known gaps (annotations, not expectations)
- Step 2: only the G12 Mathematics flow has full Mistake-Diagnosis evidence
  in its served artefacts; the other Subjects' html assessments carry no
  `wrong_explanations` yet (authored data work, schema-optional) — evidence:
  this session's porting notes (2026-09-21); graphs themselves cover all
  Subjects (validated by tests/validate.spec.js, "every demo Subject has a
  schema-valid Concept Graph").
- Step 3: the chain is rendered top-down; a Learner with more than ~5 path
  Concepts gets a long page — evidence: no tracker issue yet.

---

*Evidence verified 2026-09-21 against this session's build
(tests/root-cause.spec.js steps 1–5 against the demo artefacts; failure paths
against the severity-fallback code path). Flow shape Learner-calibrated
2026-09-21.*