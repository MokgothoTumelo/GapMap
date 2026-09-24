# Companion tool calling for discoverable Learner context

Status: **in progress — not finalized.** The tool-calling interface and
bounded snapshot are implemented in `frontend/js/agent-client.js`, with all
six tools wired end-to-end against the mock `learnerStore`: `getGapMap`,
`getLearningPath`, `getConcept`, `getItem`, `getAttemptHistory`, and
`generateAssessment`. The model-backed `generateAssessment` path has an open
reliability item (structured output) — see below. This ADR is a living
record: it is not a closed decision until the tool set and the bounded-context
snapshot are agreed and landed.

## Problem

The Learning Companion's intelligence comes from the model plus the Learner's
context (Gap Map, Learning Path). Injecting all of that context into every
prompt does not scale: after hundreds of lessons the context would be
unbounded, and the model would be asked to reason over data it does not need
for the current turn. The context should be **discoverable** — the agent
decides, from a small always-in-context snapshot and its own judgement, what it
needs to look at, guided by tool descriptions and system-prompt guidelines.

The Assessment generator is the same intelligence: it cannot generate
Diagnostic / Practice artefacts without the Learner's context. The
end state is that the Companion produces arbitrary data for the Learner
(grounded in the discovered Gap Map and Learning Path) and the app renders it —
the renderer already accepts any assessment artefact.

## Decision (direction)

- The Companion uses Firebase AI Logic function calling. The Web SDK
  (`@firebase/ai`, pinned `12.17.1`) supports `FunctionDeclaration` /
  `FunctionDeclarationsTool` / `FunctionCall` / `FunctionResponse` and the
  tool-execution loop; no new backend is needed.
- A **bounded snapshot** stays in context: Learner identity, Language,
  Explanation Level, Subject, the Gap Map rollup (per-Concept — bounded by the
  Concept vocabulary, not by lesson count), the Learning Path head (next N
  steps, not the whole path), and the recent transcript.
- The rest is **discoverable via tools**. The agent calls tools on demand.
- Tools read from the mock `learnerStore` until a real DB exists; the DB shape
  is documented (with commented examples) so the swap is a serialisation
  change, not a model change.
- The no-fabrication rule stands: if a tool fails or data is missing, the panel
  surfaces it rather than inventing a reply.

## Implemented (in progress)

- **Bounded snapshot injected into every prompt** (`buildLearnerSnapshot` in
  `frontend/js/agent-client.js`): the unbounded collections (assessments,
  attempts, full transcript) are dropped from the injected context, the
  Learning Path is capped at its head (`LEARNING_PATH_HEAD_SIZE = 5`), and the
  conversation transcript is capped at a tail (`TRANSCRIPT_TAIL_SIZE = 12`).
  The Gap Map rollup, Learner profile (Language, Explanation Level, Subject),
  and identity stay in the snapshot — bounded by the Concept vocabulary, not
  by lesson count.
- Tool-calling interface + execution loop in `frontend/js/agent-client.js`
  (`generateWithTools` / `streamModelWithTools`), threaded through
  `streamModelPool` and `createAgentClient`. The loop is bounded
  (`MAX_TOOL_ITERATIONS = 5`) to guard against runaway tool calls.
- `getGapMap()` tool: returns the Learner's Gap Map rollup and Learning Path
  from the mock `learnerStore`, declared via `COMPANION_TOOLS`.
- `getLearningPath()` — the full ordered path (the snapshot holds only the
  head).
- `getConcept(concept)` — the Items covering a Concept (the Concept's
  learning content). "Lesson" is not a domain term — see CONTEXT.md; the
  canonical unit is the **Concept**.
- `getItem(itemId)` — a specific Item (or `null` when missing, so the model
  reports it rather than inventing one).
- `getAttemptHistory(concept)` — past Attempts for a Concept, each with its
  Score and Mastery.
- `getPlatformHelp()` — a map of GapMap's own surfaces (dashboard, concept
  page, Library, profile & preferences, Diagnostic, this panel) with how to
  reach them, grounded in the Learner's grade and Subject and their store state
  (whether a Gap Map exists, whether an unattempted Practice is waiting) —
  answers "how does the site work" without injecting the map into every prompt.
- `generateAssessment({ type, targetConcept, itemCount })` — generates and
  persists a Diagnostic / Practice via `createAssessmentForLearner`
  (model-backed when a live model is available, local deterministic
  otherwise), grounded in the Learner's Gap Map + Learning Path + known
  Concepts, and returns a summary (id, type, item count). See the design and
  the open reliability item in the Planned section.
- **UI feedback:** `send()` accepts an `onToolCall(name, args)` callback;
  the panel renders a small `called <tool>` chip in the assistant bubble and
  logs a `tool_call` event in the Activity log, so tool use is visible while
  the reply streams.
- **Implementation note (Gemini 3 thought signatures):** the Gemini API
  returns each `functionCall` part with a sibling `thoughtSignature` field and
  requires it to be echoed back verbatim on the next turn. The SDK's
  `response.functionCalls()` drops that sibling, so the loop reads the raw
  candidate parts (`candidates[0].content.parts`) and echoes them back
  unchanged. Omitting the signature yields a 400
  (`Function call is missing a thought_signature`).
- **`generateAssessment` design (settled 2026-08-20):**
  - **Division of labour.** The Companion decides the intent — whether to
    generate, the Assessment type, the target Concept, and the item count —
    from the conversation and what it discovered via tools. It does not
    hand-write the artefact; the executor calls the existing generator
    (`createAssessmentForLearner` in `assessment-service.js`; model-backed
    when a live model is available, local deterministic otherwise), which
    authors, validates, and persists. The model receives a summary (id, type,
    item count) to relay to the Learner.
  - **Grounding.** The generated Assessment is grounded in the Learner's
    Learning Path (itself derived from the Gap Map's weak points). The
    executor injects the Gap Map + Learning Path + the Learner's known
    Concepts into the generator's prompt; Practice targets the Concept
    at the head of the Learning Path (or the requested Concept); a Diagnostic
    covers the Subject's Concepts to produce/refresh the Gap Map.
  - **No fabrication.** If generation or validation fails, the tool surfaces
    the error; it never invents an artefact.

## Open

- **Render seam (design team).** The artefact is persisted to the store; the
  app can list Assessments by type and render any artefact. Product
  direction: a browse-by-type view with selection, and Practice opting for
  the newest entry based on the Learner's weak points — the UI/UX is
  deliberately left open for the design team.
- **Model-backed reliability.** The model-backed generator uses structured
  output (`responseMimeType: 'application/json'` + `responseSchema` in the
  SDK's `SchemaRequest` format) to constrain the model to valid structure,
  assigns the app-owned id and metadata itself (the model authors the
  content), and retries with the validation error as a corrective hint. Live
  e2e confirms the model now produces schema-valid, persisted Assessments
  (a Diagnostic when the Learner has no data, a Practice grounded in the
  weakest Concept otherwise). The concept-tag bridge stays a semantic check.

## Consequences

- Context stays bounded regardless of lesson count; the "500 lessons" concern
  is addressed by keeping the snapshot small and making lessons/items
  discoverable. The bounded snapshot and the discovery tools are implemented;
  the model sees the Gap Map rollup in the snapshot and can fetch the full
  path, Concept content, Items, and attempt history on demand.
- Assessment generation becomes personalised: the agent grounds it in the real
  Gap Map / Learning Path it discovers, instead of the current generic request
  params (which carry no Learner context).
- Adds a tool-execution loop and its failure modes: tool errors, the
  too-many-tools guard, and the thought-signature requirement above.
- The e2e vision: the Companion produces arbitrary data for the Learner and the
  app renders it; the demo path (Diagnostic → Gap Map → Learning Path →
  Practice, re-measured by retaking the Diagnostic) remains independent of live
  AI and can opt out with `?agent=off`.
