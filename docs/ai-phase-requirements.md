# AI Phase – Features & Requirements

> Folded in from the team's share
> (`share-1789485032866-AI_Phase_Features_Requirements.pdf`, received 2026-09-16
> alongside the `Done.zip` snapshot) so the phase's acceptance criteria live
> with the code. Verbatim below, with the glossary's canonical terms applied
> ("students" → Learners; "quiz" → Practice — see `CONTEXT.md`).

The AI phase will focus on making the learning platform more intelligent, accessible, personalized, and useful to Learners.

## 1. Multilingual AI Communication

The AI should be able to communicate with users in different languages. Learners should be able to interact with the AI using their preferred language.

**Indicator:** The website should include a clear indicator showing the language currently being used by the AI, so users know that multilingual communication is supported.

## 2. Subject & Website Assistance

The AI should be able to answer questions related to the subjects supported by the platform, as well as questions about how the website works.

For example, Learners should be able to ask for explanations, clarification of concepts, study guidance, or help navigating and using the platform.

## 3. Personalized AI Experience

The AI should provide a more personalized experience for each Learner. Where appropriate, it should be able to recall the Learner's name and use it naturally when communicating with them.

## 4. AI-Powered Question Randomization

Use AI to help randomize questions. The AI should be able to generate or reorganize suitable questions based on the selected subject and learning requirements, helping Learners receive varied practice instead of repeatedly seeing the same questions.

## Overall Goal

The AI phase should make the platform feel like a personalized multilingual learning assistant: able to communicate in different languages, support Learners with subject-related questions, explain how the website works, remember useful Learner details such as names, and improve Practice through AI-assisted question randomization.

---

## Status and what we delivered (2026-09-17)

### 1 — Multilingual AI Communication

**Status: delivered.** Language is a switchable Learner Profile preference,
carried into the Companion's `<learner_context>` with the prompt instruction to
guide in that Language. The *indicator* the requirement asks for is **dropped
by decision** — the Language switcher itself is the visible indicator; a second
one would be redundant.

**Delivered:**
- Language as a Profile preference: `GapMapAuth.LANGUAGES`,
  `getActiveLanguage` / `setActiveLanguage`, persisted to the session and the
  Firebase-backed Learner Profile (`frontend/js/auth-guard.js` + Firestore); switchers in the nav
  (`mountLanguageSwitcher`) and on `profile.html`; Setup prefills it.
- Companion wiring: `agent-panel.js` puts `learner.language` into
  `<learner_context>`; the system prompt instructs guidance in that Language.
- The panel dock (`agent-panel.css` + the panel script): the open panel is a
  rail below the sticky nav on desktop — nav visible, content shifted only as
  far as the rail actually requires; narrow screens keep the overlay drawer.
- Tests: `tests/preferences.spec.js` (switchers persist), 
  `tests/agent-panel-dock.spec.js` (dock, release, overlay thresholds).

### 2. Subject & website assistance — concluded

**Delivered:**
- Subject grounding: the discovery tools `getGapMap`, `getLearningPath`,
  `getConcept`, `getItem`, `getAttemptHistory` wired end-to-end against the
  Learner's store (`frontend/js/agent-client.js`, ADR-0005) — the Companion
  answers from the Learner's real Gap Map, Learning Path, Items, and Attempt
  history, not guesses.
- Platform grounding: the `getPlatformHelp` discovery tool — GapMap's surfaces
  and how to reach them, grounded in the Learner's grade + Subject, their Gap
  Map state, and whether an unattempted Practice is waiting — via the
  `getLearnerProfile` seam; prompt nudge to call it for site questions.
- Tests: `tests/agent-client.spec.js` (declaration, grounded execution,
  prompt nudge).

### 3. Personalised AI experience — concluded

**Delivered:**
- The Learner Profile itself: Firebase Authentication supplies the stable learner uid at signup
  (`GapMapAuth.mintLearnerId()`), Account and Preferences inspectable and
  modifiable on `profile.html` behind the avatar menu
  (`GapMapAuth.mountProfileMenu`).
- The name in the Companion's context: `agent-panel.js` puts
  `learner.firstName` into `<learner_context>`; the system prompt instructs
  using it naturally in conversation.
- Tests: `tests/agent-client.spec.js` (name through the prompt),
  `tests/auth-routing.spec.js` (avatar menu glance), `tests/preferences.spec.js`
  (Profile inspect/modify).

### 4. AI-powered question randomization — resolved by design

**Delivered:**
- The AI generates the pool: `generateAssessment` (Diagnostic/Practice; local
  deterministic + model-backed adapters) persists schema-valid Assessment
  artefacts into the Learner's store via `createAssessmentForLearner`.
- The platform randomizes: `frontend/js/assessment-composer.js` —
  `composePractice` cherry-picks Items for a Concept across that pool
  (dedup by prompt, unseen-first from Attempt history, deterministic seeded
  shuffle), clamps to the Practice schema's 3–5 Items, and freezes the result
  as a new Practice artefact; `ensureComposedPracticeForLearner` reuses an
  unattempted Practice instead of stacking duplicates.
- Served in the flow: `concept.html` practices pool-first with the in-page
  Concept bank as fallback; pool-only Concepts render straight into Practice;
  completing a composed Practice writes an Attempt back, which drives the next
  composition's unseen-first selection.
- Tests: `tests/assessment-composer.spec.js` (composition, dedup, unseen-first,
  determinism, thin-pool refusal, reuse lifecycle), `tests/demo.spec.js`
  (pool-first Practice; pool-only Concept viewable and attemptable).
