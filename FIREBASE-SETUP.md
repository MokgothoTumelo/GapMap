# GapMap Firebase + EmailJS setup

## Firebase project

The web app is configured for Firebase project `gapmap-6cb1d` using the Firebase web configuration supplied for this project.

Before using account creation, sign-in, or Firestore persistence, enable **Authentication → Sign-in method → Email/Password** in the Firebase Console and create a **Cloud Firestore database** for the project.

The browser uses the Firebase modular Web SDK from the official Google CDN. The project keeps `firebase` pinned at `12.17.1`, matching the browser module version in `frontend/js/firebase-app.js`.

## EmailJS

EmailJS is configured as:

- Service ID: `lanabettino_10`
- Template ID: `Otp_code`
- Public key: `Ho3XNGvDrUyYdjwn4`

The browser generates a six-digit OTP and sends it through EmailJS. The OTP is **not displayed on screen**, not logged to the console, and not stored in Firestore.

The EmailJS template should use the `{{otp_code}}` variable for the code and route delivery to the `{{to_email}}` recipient (or the corresponding recipient variable configured by the template/service).

OTP codes expire after 10 minutes, allow five verification attempts, and have a 30-second resend cooldown.

## Authentication flow

### Sign-up

1. Firebase Authentication creates the account.
2. GapMap saves the Learner Profile in `/learners/{uid}`.
3. EmailJS sends the OTP.
4. The Learner enters the OTP.
5. GapMap marks the Profile as `emailOtpVerified` and proceeds to Setup.

### Sign-in

1. Firebase Authentication checks the email/password.
2. GapMap sends a new OTP through EmailJS.
3. The Learner must verify the OTP before the app session is written and navigation continues.

### Forgot password

1. The Learner enters the account email.
2. GapMap sends a custom EmailJS OTP.
3. After the OTP is verified, GapMap asks Firebase Authentication to send its secure password-reset email.
4. The password itself is then changed through Firebase's password-reset flow. GapMap never stores passwords in Firestore or localStorage.

## Firestore data model

`learners/{uid}`

Stores the Learner Profile and account metadata such as UID, email, name, grade, active Subject, Subjects used, Language, Explanation Level, Setup state, email OTP verification state, and last-login timestamp.

`learners/{uid}/assessments/{assessmentId}`

Stores frozen Assessment artefacts so a completed Attempt can always be tied back to the exact Items presented.

`learners/{uid}/attempts/{attemptId}`

Stores append-only Diagnostic/Practice Attempts: Responses, per-Concept Scores, overall Score, timestamps, subject, grade, and Mistake Diagnosis evidence when present.

`learners/{uid}/subjects/{subjectId}`

Stores the latest derived Diagnostic summary for quick Gap Map/dashboard rendering.

`learners/{uid}/companionMessages/{messageId}`

Stores Learning Companion messages when the application explicitly persists them.

`learners/{uid}/practiceHistory/{subjectId}__{conceptId}`

Stores the set of Practice Item signatures already presented for a Subject + Concept so repeat protection can survive a browser change or cleared local session.

### Security note

Firebase Authentication owns passwords. Do **not** add a password field to Firestore. The Firestore rules in `firestore.rules` restrict records to the signed-in Firebase UID and make Assessments/Attempts append-only from the browser.

## Deploying the rules

This project includes `firebase.json` and `.firebaserc` already pointed at `gapmap-6cb1d`. From the project root, after installing the Firebase CLI and signing in, deploy the Firestore rules with:

```bash
firebase deploy --only firestore:rules
```

In the Firebase Console, also confirm that **Authentication → Sign-in method → Email/Password** is enabled and that **Cloud Firestore** has been created for the project. Do not deploy broad `allow read, write: if true` rules.
