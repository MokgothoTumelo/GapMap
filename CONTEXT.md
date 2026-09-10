# GapMap

A localised personalised learning platform that identifies which Concepts a Learner has not mastered and guides them through targeted study until their Mastery improves.

## Language

### People and structure

**Learner**:
A person whose Knowledge Gaps we identify and guide through study.
_Avoid_: student, user, pupil

**Subject**:
A body of curriculum a Learner can be assessed against, e.g. Grade 12 Mathematics. Grade 12 denotes the school year (the final year of K-12).
_Avoid_: course, module, topic

**Concept**:
A unit of knowledge within a Subject, e.g. Factorisation. The smallest thing a Knowledge Gap can be about.
_Avoid_: topic, skill, lesson

### Assessment

**Assessment**:
A set of Items presented to a Learner. Diagnostic, Practice, and Retest are kinds of Assessment.
_Avoid_: quiz, test, exam

**Diagnostic**:
An Assessment that measures a Learner across the Concepts of a Subject to produce a Gap Map.
_Avoid_: diagnostic test, diagnostic assessment, placement test

**Practice**:
An Assessment that targets a single Concept on the Learning Path.
_Avoid_: exercise set, worksheet

**Retest**:
An Assessment that re-measures a single Concept after Practice.
_Avoid_: follow-up test, re-quiz

**Item**:
A single question within an Assessment, covering exactly one Concept.
_Avoid_: question, prompt, problem

**Response**:
A Learner's answer to one Item.
_Avoid_: answer (the answer is the value; the Response is the act plus the value), submission

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
The ordered sequence of Concepts to study, prioritised by Knowledge Gap severity and prerequisites.
_Avoid_: personalised learning path, study plan, roadmap

### Feedback and localisation

**Mistake Diagnosis**:
An explanation of *why* a wrong Response is wrong — the type of mistake, not just "incorrect". The "Why did I get this wrong?" feature.
_Avoid_: feedback, error explanation, hint

**Language**:
The language of instruction and explanation offered to a Learner, e.g. English, isiZulu.
_Avoid_: locale, translation

**Explanation Level**:
The simplicity tier of an explanation: very simple, standard, or detailed. A separate axis from how hard an Item is.
_Avoid_: difficulty (that is per-Item), depth, detail level

### Guidance

**Learning Companion**:
The product's conversational voice that guides a Learner through their Knowledge Gaps — explaining Concepts, working through practice Items, and producing Mistake Diagnoses in the Learner's Language and Explanation Level.
_Avoid_: chatbot, assistant, tutor

## Relationships

- A **Learner** studies one or more **Subjects**.
- A **Subject** is composed of **Concepts**.
- An **Assessment** contains **Items**, each covering exactly one **Concept**.
- A **Diagnostic** measures a Learner across a Subject's Concepts.
- A Learner's **Responses** to a Diagnostic's Items produce a **Gap Map**.
- A **Knowledge Gap** is a **Concept** whose **Mastery** is weak or improve.
- A **Learning Path** orders Concepts by Knowledge Gap severity (and prerequisites).
- **Practice** targets one Concept on the Learning Path; a **Retest** re-measures it after.
- A **Mistake Diagnosis** is produced for an incorrect **Response**.
- A **Learning Companion** guides a Learner through their Knowledge Gaps, drawing on the Gap Map and Learning Path.

## Example dialogue

> **Dev:** "If a Learner scores 61% on a Diagnostic, what do we tell them?"
> **Domain expert:** "Not 61%. The Diagnostic's Responses roll up into a Gap Map — Algebra strong, Functions improve, Factorisation weak. The 61% hides the Knowledge Gaps; the Gap Map shows them."
> **Dev:** "So a low Score and a Knowledge Gap are different things?"
> **Domain expert:** "Yes. A Score is a percentage; a Knowledge Gap is a Concept the Learner hasn't mastered. A Learner can have a middling Score with one severe Knowledge Gap — that Knowledge Gap is the start of the Learning Path."
> **Dev:** "And Practice vs Retest?"
> **Domain expert:** "Practice teaches one Concept and drills it. Retest re-measures that same Concept to see if Mastery moved from weak to strong. Practice is the input; Retest is the check."

## Flagged ambiguities

- "quiz" was used to mean Diagnostic, Practice, and Retest interchangeably — resolved: these are distinct kinds of **Assessment**; "quiz" is avoided as a canonical term.
- "gap" (the plan's shorthand) vs "knowledge gap" vs "weakness" — resolved: canonical is **Knowledge Gap (KG)**; "gap" as a standalone term, "weakness", and "area for improvement" are avoided. "Gap" survives in the compound **Gap Map** and the product name **GapMap**.
- "diagnostic assessment" / "diagnostic test" (both in the plan) — resolved: canonical is **Diagnostic**.
- "level" was overloaded between Mastery level and Explanation Level — resolved: **Mastery** takes the strong/improve/weak classification; **Explanation Level** is the simplicity tier; "level" alone is avoided.
- "feedback" is a generic term for any system response; the domain concept we mean is **Mistake Diagnosis** — resolved: use Mistake Diagnosis for the "why was this wrong" explanation; reserve "feedback" for generic UI responses.