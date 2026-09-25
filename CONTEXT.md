# GapMap

A localised personalised learning platform that identifies which Concepts a Learner has not mastered and guides them through targeted study until their Mastery improves.

## Language

### People and structure

**Learner**:
A person whose Knowledge Gaps we identify and guide through study.
_Avoid_: student, user, pupil

**Learner Profile**:
The Learner's saved setup and preferences — their stable Firebase Authentication uid, name and email, grade, active Subject, the Subjects they have used, active Language, Explanation Level, and Setup status. uid IS learnerId: the same stable value under two names — `uid` in Authentication and the Profile doc, `learnerId` in the store interface, `{uid}` in the `learners/{uid}` path, `learner_id` in Assessment/Attempt/subject-summary docs. The name is semantic and must never block reads or writes. One concept, one owner: Firebase Authentication owns the account identity and the durable Learner Profile lives at `learners/{uid}` in Firestore; `gapmap_user` is only a lightweight local session snapshot for page rendering.
_Avoid_: user profile, account settings, preferences blob

**Subject**:
A body of curriculum a Learner can be assessed against, e.g. Grade 12 Mathematics. Grade 12 denotes the school year (the final year of K-12). The app stores a Subject as grade + subject name (`grade: "12"`, `subject: "Mathematics"`); *Grade 12 Mathematics* is the display form.
_Avoid_: course, module, topic

**Concept**:
A unit of knowledge within a Subject, e.g. Factorisation. The smallest thing a Knowledge Gap can be about.
_Avoid_: topic, skill, lesson

### Assessment

**Assessment**:
A set of Items presented to a Learner. Diagnostic and Practice are kinds of Assessment.
_Avoid_: quiz, test, exam

**Diagnostic**:
An Assessment that measures a Learner across the Concepts of a Subject to produce a Gap Map.
_Avoid_: diagnostic test, diagnostic assessment, placement test

**Practice**:
An Assessment that targets a single Concept on the Learning Path.
_Avoid_: exercise set, worksheet

**Item**:
A single question within an Assessment, covering exactly one Concept.
_Avoid_: question, prompt, problem

**Response**:
A Learner's answer to one Item.
_Avoid_: answer (the answer is the value; the Response is the act plus the value), submission

### Study material

**Library**:
A Learner's collection of study material for a Subject — official past papers and video links (`library.html`). A Library holds Resources; it is not an Assessment and its Resources carry no Concept tags.
_Avoid_: resources page, downloads, vault

**Resource**:
One entry in a Subject's Library: a question paper (PDF) or a video, labelled with grade, subject, and year or channel; a paper may expose a download id (`/api/download?id=…`).
_Avoid_: file, material, content item

### Mastery and Knowledge Gaps

**Score**:
The percentage of a Learner's Responses that are correct — overall, or within a single Concept.
_Avoid_: mark, grade, result

**Mastery**:
A Concept's classification from its Score: strong, improve, or weak.
_Avoid_: level (collides with Explanation Level), rating, proficiency

**Knowledge Gap** (KG):
A Concept whose Mastery is weak or improve — something the Learner has not mastered. "Gap" survives in the compound **Gap Map** and the product name **GapMap**.
_Avoid_: gap (as a standalone term), weakness, area for improvement

**Gap Map**:
The per-Concept Mastery breakdown across a Subject, produced from a Diagnostic.
_Avoid_: results table, scorecard, diagnostic report

**Learning Path**:
The ordered sequence of Concepts to study, prioritised by Knowledge Gap severity and prerequisites. Derived from the Gap Map and the Subject's Concept Graph — roots (blocking Concepts) first, severity as tie-break. Computed on read; not stored as a per-Learner artefact.
_Avoid_: personalised learning path, study plan, roadmap

**Prerequisite**:
A Concept that another Concept builds on — one the Learner should master before the later one is learnable. Prerequisites are edges in the Subject's Concept Graph, not per-Learner state.
_Avoid_: dependency, foundation, pre-requisite

**Concept Graph**:
The Subject-level map of Concepts and their Prerequisite edges, spanning grades where a Concept builds on earlier years' work. One frozen artefact per Subject; together with the Gap Map it drives the Learning Path.
_Avoid_: knowledge graph, curriculum map, skill tree

**Foundational Gap**:
A Knowledge Gap on a Prerequisite Concept — typically below the active Subject's grade — that one or more weak or improve Concepts depend on. The Gap Map's root-cause read.
_Avoid_: underlying gap, root weakness, missing basics

### Feedback and localisation

**Mistake Diagnosis**:
An explanation of *why* a wrong Response is wrong — the type of mistake, not just "incorrect". The "Why did I get this wrong?" feature. Each diagnosis carries a kind — `misread`, `procedure`, `concept`, or `prerequisite` — with a `prerequisite` kind naming the blocking Concept, so the kinds roll up into the Gap Map's root-cause readout.
_Avoid_: feedback, error explanation, hint

**Language**:
The language of instruction and explanation offered to a Learner, e.g. English, isiZulu. The app stores the Learner's active Language (`language: "isiZulu"`) and it is switchable in the nav like the active Subject; it feeds the Companion's context from its next turn.
_Avoid_: locale, translation

**Explanation Level**:
The simplicity tier of an explanation: Simple, Standard, or Detailed. A separate axis from how hard an Item is. The values are uniform everywhere — the Learner Profile, the artefact schema's `explanation_level` enum, and Setup's labels. The Learner's active Explanation Level is switchable in the nav like the active Subject and Language; it feeds the Companion's context from its next turn.
_Avoid_: difficulty (that is per-Item), depth, detail level

### Guidance

**Learning Companion**:
The product's conversational voice that guides a Learner through their Knowledge Gaps — explaining Concepts, working through practice Items, and producing Mistake Diagnoses in the Learner's Language and Explanation Level.
_Avoid_: chatbot, assistant, tutor

## Relationships

- A **Learner** studies one or more **Subjects**.
- A **Learner** has one **Learner Profile**; its grade and active Subject scope their Assessments and data, and its Language and Explanation Level shape the guidance they receive.
- A **Subject** is composed of **Concepts**.
- An **Assessment** contains **Items**, each covering exactly one **Concept**.
- A **Diagnostic** measures a Learner across a Subject's Concepts.
- A Learner's **Responses** to a Diagnostic's Items produce a **Gap Map**.
- A **Knowledge Gap** is a **Concept** whose **Mastery** is weak or improve.
- A **Subject**'s **Concept Graph** records the **Prerequisite** edges between its Concepts, spanning grades where they exist.
- A **Foundational Gap** is a **Knowledge Gap** on a **Prerequisite** that weak or improve Concepts depend on.
- A **Learning Path** orders Concepts by Knowledge Gap severity (and prerequisites), derived from the **Gap Map** and the Subject's **Concept Graph** — roots first, severity as tie-break.
- A Learner re-measures progress by **retaking the Diagnostic**: fresh Responses produce a fresh Gap Map for the active Subject, and the Attempt history stays append-only.
- A **Subject** has a **Library** of **Resources** (past papers, videos) — study material, separate from Assessments.
- A **Mistake Diagnosis** is produced for an incorrect **Response**.
- A **Learning Companion** guides a Learner through their Knowledge Gaps, drawing on the Gap Map and Learning Path.

## Example dialogue

> **Dev:** "If a Learner scores 61% on a Diagnostic, what do we tell them?"
> **Domain expert:** "Not 61%. The Diagnostic's Responses roll up into a Gap Map — Algebra strong, Functions improve, Factorisation weak. The 61% hides the Knowledge Gaps; the Gap Map shows them."
> **Dev:** "So a low Score and a Knowledge Gap are different things?"
> **Domain expert:** "Yes. A Score is a percentage; a Knowledge Gap is a Concept the Learner hasn't mastered. A Learner can have a middling Score with one severe Knowledge Gap — that Knowledge Gap is the start of the Learning Path."
> **Dev:** "And after Practice — how does the Learner see progress?"
> **Domain expert:** "By retaking the Diagnostic. The fresh Gap Map shows whether Mastery moved — Factorisation from weak to strong. Practice is the input; the retaken Diagnostic is the check."

## Flagged ambiguities

- "quiz" was used to mean every Assessment interchangeably (Diagnostic, Practice, and at one point a separate "Retest") — resolved: "quiz" is avoided as a canonical term; the kinds are **Diagnostic** and **Practice**.
- a separate **Retest** kind — a single-Concept re-measurement after Practice, with its own schema — was modelled in the format — resolved: the flow re-measures by **retaking the Diagnostic**, and the extra kind reinforced a misunderstanding of that flow. The Retest schema kind has since been removed from `core/schema/`, the generator, and the Companion tools.
- "gap" (the plan's shorthand) vs "knowledge gap" vs "weakness" — resolved: canonical is **Knowledge Gap (KG)**; "gap" as a standalone term, "weakness", and "area for improvement" are avoided. "Gap" survives in the compound **Gap Map** and the product name **GapMap**.
- "diagnostic assessment" / "diagnostic test" (both in the plan) — resolved: canonical is **Diagnostic**.
- "level" was overloaded between Mastery level and Explanation Level — resolved: **Mastery** takes the strong/improve/weak classification; **Explanation Level** is the simplicity tier; "level" alone is avoided.
- "feedback" is a generic term for any system response; the domain concept we mean is **Mistake Diagnosis** — resolved: use Mistake Diagnosis for the "why was this wrong" explanation; reserve "feedback" for generic UI responses.
- "user" survives in the demo's client-side storage key (`gapmap_user`) — resolved: that name is implementation, not domain language; Firebase Authentication is the account source of truth, the Firestore record is the durable **Learner Profile**, and the local key is only a page-session snapshot.
- the Profile's fields (grade, Subject, Language, Explanation Level) lived as an unnamed bag on the session — resolved: canonical is **Learner Profile**; "user profile" and "account settings" are avoided, and switchable preferences are owned by the one helper (`frontend/js/auth-guard.js`), not scattered across pages.
- `uid` vs `learnerId` — resolved: same stable value, different label per layer (`uid` in Authentication/Profile, `learnerId`/`learner_id` in the store); the difference is semantic and must not block data reads or writes.