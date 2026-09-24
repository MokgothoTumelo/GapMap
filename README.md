# GapMap - Hackathon Challenge Submission

> **New to the repo?** See [START-HERE.md](START-HERE.md) for setup (cross-platform, no bash needed) and a map of what's solid vs. open.

## Project Information

| Field | Entry |
|-------|-------|
| Team Name | CodeMinds |
| Project Name | GapMap |
| Select Challenge | Localised Self-Learning Experiences |
| Sector of Innovation | Education |
| Select Location | [Your actual city/province] |

---

## Why These Choices?

**GapMap** is the product name, while **CodeMinds** is the team name.

The project isn't simply "an AI tutor." Its main purpose is:

> **Identify exactly what a learner doesn't understand and create a personalised path to help them improve.**

---

## Background

Many learners struggle not because they lack access to educational content, but because they do not know which concepts they are struggling with. Traditional learning platforms often provide the same material to everyone, regardless of their individual knowledge gaps.

This inspired us to create **GapMap**, a personalised learning platform that identifies specific weaknesses and guides learners towards targeted resources and practice. We want to make learning more personalised, accessible and relevant to South African learners.

---

## Project Overview

GapMap is a localised personalised learning platform that identifies what learners don't understand and guides them through targeted learning until they improve. By combining diagnostic assessment with intelligent gap analysis, we help learners focus their study time on the concepts that matter most.

---

## Technologies

### Frontend
- HTML
- CSS
- JavaScript
- React

### Backend
- Node.js
- Express.js
- Python (for AI/LLM integration)
- REST API

### Database
- PostgreSQL

### Other
- Git/GitHub
- AI/LLM API

### Quantum (hackathon bonus criterion)
- **Quantum state-vector simulator** written in JavaScript (`core/quantum-sim.js`) — real gates, superposition, interference and measurement, run in the browser
- **Quantum Adaptive Practice** — amplitude encoding + phase-tuned amplitude amplification + Born-rule measurement choose the next Concept to practise
- **Quantum Study Plan** — a QAOA circuit picks the best set of Concepts to study within a time budget, respecting prerequisites, and is verified against classical search
- Simulated on a classical computer (no quantum hardware is claimed). See [docs/QUANTUM-EXPLAINED.md](docs/QUANTUM-EXPLAINED.md)

---

## Recommended Architecture

GAPMAP
├── React Frontend
├── AI / LLM API
│
└── Node.js API
├── PostgreSQL Database
└── Recommendation Engine
└── Learner Profile

---

## User Journey

### 1. Create Account
Learner signs up with basic information.

### 2. Choose Subject
Example: **Grade 12 Mathematics**

### 3. Take Diagnostic Assessment
- 10-20 questions
- Covers key concepts in the subject

### 4. GapMap Analyses Results

| Concept | Score | Status |
|---------|-------|--------|
| Algebra | 87% | Strong |
| Functions | 64% | Improve |
| Factorisation | 38% | Weak |
| Quadratic equations | 42% | Weak |

### 5. Personalised Learning Path Created
**Priority #1:** Factorisation

### 6. Learn
- Simple explanation
- Worked examples

### 7. Practice
- Targeted questions specifically about factorisation
- Immediate feedback

### 8. Retake the Diagnostic & Progress
- Factorisation: **38% → 76%**
- GapMap recommends the next concept

> **Build status:** steps 1–8 are wired: re-measurement is retaking the Diagnostic from the dashboard, and the fresh Gap Map shows the movement. (The separate Retest artefact kind has been removed from the format.)

---

## Standout Features

### Feature 1: "Why Did I Get This Wrong?"

Instead of simply saying **"X Incorrect"**, GapMap explains the type of mistake:

> **Your answer:** 12  
> **Correct answer:** 18  
> 
> *"You correctly multiplied the first values, but you forgot to distribute the negative sign to the second term."*

Then: **Try another question**

This makes the system about understanding mistakes, not just marking answers.

---

### Feature 2: Localised Learning

Learners can choose:

**Language:**
- English
- isiZulu
- Sepedi
- Setswana
- isiXhosa
- (and more)

**Explanation Level:**
- Very Simple
- Standard
- Detailed

**Example:**
If a learner doesn't understand: *"The derivative represents the instantaneous rate of change..."*

They can request: **Explain simply** and receive an easier explanation.

> **Note:** For the hackathon demo, we'll implement English + one additional South African language first.

---

## MVP Features

### Must-Have (Core MVP)
1. User registration/login
2. Subject selection
3. Diagnostic test
4. Automatic scoring
5. Knowledge-gap dashboard
6. Personalised learning path
7. Learning explanations
8. Practice questions
9. Progress tracking

### Nice-to-Have
10. Language selection
11. AI explanations
12. AI-generated questions
13. Teacher dashboard

### Won't Build (For Now)
- ❌ Complicated social networking
- ❌ Messaging system
- ❌ Payment system
- ❌ Dozens of subjects
- ❌ 10 different languages
- ❌ Complicated AI model training

---

## The Demo Strategy

When presenting, **don't** start by saying: *"We built an AI-powered educational platform."*

Instead, **show the problem:**

### Demo Scenario

1. **Learner takes the diagnostic test**
2. **They get:** Overall: 61%
3. **GapMap reveals:**

| Concept | Score |
|---------|-------|
| Algebra | 87% |
| Functions | 65% |
| Factorisation | 38% |
| Quadratic equations | 42% |

4. **Key message:**
> *"A 61% mark doesn't tell the learner what they don't understand. GapMap does."*

5. **Click Factorisation**
6. System teaches the concept
7. Learner answers questions
8. **Progress:** Factorisation **38% → 76%**

**That's the moment we want the judges to remember.**

---

## Core Problem Statement

### The Problem
> Learners often receive a general score without knowing which specific concepts they have not mastered, making it difficult to know what they should study next.

### Our Solution
> GapMap identifies individual knowledge gaps and creates a personalised learning path that helps learners focus on the concepts they need most.

---

## Project in One Sentence

> **GapMap is a localised personalised learning platform that identifies what learners don't understand and guides them through targeted learning until they improve.**

---

## Next Steps

1. Build the actual GapMap prototype
2. Decide exactly what screens/pages the judges will see
3. Focus on making the diagnostic test and learning path features work smoothly
4. Prepare the demo scenario

---

*This is the direction we'll use for the application.*


## SEQUENCE TO FOLLOW
            ↓
            ↓
index.html
    ↓
signup.html  →  (OTP)  →  setup.html   (grade + subject)
    ↓                         ↓
login.html  ────────────────→  setup.html  (or directly to diagnostic)
                                  ↓
                            diagnostic.html
                                  ↓
                            dashboard.html  (Gap Map + Learning Path)
                                  ↓
                            concept.html?concept=…  (Learn → Practice → Results)
                                  ↓
                            library.html  (past papers + videos)

Protected pages route guests to `login.html` (`frontend/js/auth-guard.js`). Re-measurement is retaking the Diagnostic from the dashboard.

## Fresh Question Pool

Diagnostic and Concept Practice can supplement the authored YAML pools with a
reusable Oak National Academy MCQ source. External Items are admitted only when
they can be mapped confidently to exactly one existing Concept; otherwise they
are dropped. The source is optional, has a short timeout, and failure falls
back to the authored/offline pool. Diagnostic and Practice history prevents the
exact same Item form from being selected again until the available pool is
exhausted; only then is a presentation variant used.

## Firebase Authentication, EmailJS OTP and Cloud Persistence

The app now uses Firebase Authentication for real email/password credentials and Cloud Firestore for Learner data. The browser no longer stores account passwords in `localStorage` or Firestore.

EmailJS service `lanabettino_10` and template `Otp_code` deliver a six-digit OTP after sign-up and before sign-in is completed. The same OTP step is used before Firebase sends a secure password-reset email. OTP codes are not shown on screen and are not logged or written to Firestore.

The Firestore model is documented in [`FIREBASE-SETUP.md`](./FIREBASE-SETUP.md), and the locked-down browser rules are in [`firestore.rules`](./firestore.rules).

The database stores the Learner Profile, frozen Assessments, append-only Attempts, derived latest Diagnostic summaries, and Learning Companion transcript turns. Firebase Authentication remains the source of truth for credentials.
