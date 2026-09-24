// Firestore persistence for GapMap application data.
// Passwords are deliberately excluded: Firebase Authentication owns account
// credentials. Raw OTP codes and verification digests are also never stored in
// Firestore.

import { getFirebaseServices } from './firebase-app.js';

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function sanitise(value, key = '') {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((entry) => sanitise(entry)).filter((entry) => entry !== undefined);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (/^(password|currentPassword|newPassword|confirmPassword|otp|otpCode|otp_code|codeHash|privateKey|accessToken|apiKey)$/i.test(entryKey)) continue;
      const clean = sanitise(entryValue, entryKey);
      if (clean !== undefined) out[entryKey] = clean;
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 20000) return value.slice(0, 20000);
  return value;
}

function requireUid(uid) {
  const value = String(uid || '').trim();
  if (!value) throw new Error('A Firebase Learner uid is required for Firestore persistence.');
  return value;
}

function subjectKey(subject) {
  return String(subject || 'general')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general';
}

async function services() {
  return getFirebaseServices();
}

export async function getLearnerProfile(uid) {
  const learnerId = requireUid(uid);
  const { db, firebase } = await services();
  const ref = firebase.doc(db, 'learners', learnerId);
  const snapshot = await firebase.getDoc(ref);
  return snapshot.exists() ? snapshot.data() : null;
}

export async function saveLearnerProfile(profile) {
  const uid = requireUid(profile?.uid || profile?.learnerId);
  const { db, firebase } = await services();
  const ref = firebase.doc(db, 'learners', uid);
  const payload = {
    ...sanitise(clone(profile)),
    uid,
    updatedAt: firebase.serverTimestamp(),
  };
  if (profile?.email) payload.email = String(profile.email).trim().toLowerCase();
  if (profile?.createdAt) payload.createdAt = profile.createdAt;
  delete payload.learnerId;
  await firebase.setDoc(ref, payload, { merge: true });
  return payload;
}


export async function ensureLearnerProfile(firebaseUser, patch = {}) {
  if (!firebaseUser?.uid) throw new Error('A Firebase account is required to create a Learner Profile.');
  const existing = (await getLearnerProfile(firebaseUser.uid)) || {};
  const displayName = String(firebaseUser.displayName || '').trim();
  const nameParts = displayName ? displayName.split(/\s+/) : [];
  const firstName = patch.firstName ?? existing.firstName ?? nameParts.shift() ?? '';
  const lastName = patch.lastName ?? existing.lastName ?? nameParts.join(' ');
  const profile = {
    ...existing,
    ...patch,
    uid: firebaseUser.uid,
    email: String(firebaseUser.email || existing.email || '').trim().toLowerCase(),
    firstName,
    lastName,
  };
  await saveLearnerProfile(profile);
  return profile;
}

export async function markLogin(uid) {
  const learnerId = requireUid(uid);
  const { db, firebase } = await services();
  await firebase.setDoc(firebase.doc(db, 'learners', learnerId), {
    lastLoginAt: new Date().toISOString(),
    updatedAt: firebase.serverTimestamp(),
  }, { merge: true });
}

export async function markEmailOtpVerified(uid) {
  const learnerId = requireUid(uid);
  const { db, firebase } = await services();
  await firebase.setDoc(firebase.doc(db, 'learners', learnerId), {
    emailOtpVerified: true,
    emailOtpVerifiedAt: new Date().toISOString(),
    updatedAt: firebase.serverTimestamp(),
  }, { merge: true });
}

export async function saveAssessment(uid, assessment) {
  const learnerId = requireUid(uid);
  if (!assessment?.id) throw new Error('Assessment id is required for Firestore persistence.');
  const { db, firebase } = await services();
  const ref = firebase.doc(db, 'learners', learnerId, 'assessments', String(assessment.id));
  const existing = await firebase.getDoc(ref);
  if (existing.exists()) return existing.data();

  const payload = {
    ...sanitise(clone(assessment)),
    learner_id: learnerId,
    storedAt: firebase.serverTimestamp(),
  };
  await firebase.setDoc(ref, payload);
  return payload;
}

export async function saveAttempt(uid, attempt) {
  const learnerId = requireUid(uid);
  if (!attempt?.id) throw new Error('Attempt id is required for Firestore persistence.');
  const { db, firebase } = await services();
  const ref = firebase.doc(db, 'learners', learnerId, 'attempts', String(attempt.id));
  const existing = await firebase.getDoc(ref);
  if (existing.exists()) return existing.data();

  const payload = {
    ...sanitise(clone(attempt)),
    learner_id: learnerId,
    storedAt: firebase.serverTimestamp(),
  };
  await firebase.setDoc(ref, payload);
  return payload;
}

export async function saveDiagnosticSummary(uid, results) {
  const learnerId = requireUid(uid);
  const subject = String(results?.subject || 'General').trim();
  const { db, firebase } = await services();
  const ref = firebase.doc(db, 'learners', learnerId, 'subjects', subjectKey(subject));
  const payload = {
    subject,
    grade: results?.grade || null,
    latestScore: Number(results?.overall || 0),
    latestTakenAt: results?.takenAt || new Date().toISOString(),
    concepts: sanitise(clone(results?.concepts || {})),
    scores: sanitise(clone(results?.scores || [])),
    totalCorrect: Number(results?.totalCorrect || 0),
    totalQuestions: Number(results?.totalQuestions || 0),
    mistakes: sanitise(clone(results?.mistakes || [])),
    updatedAt: firebase.serverTimestamp(),
  };
  await firebase.setDoc(ref, payload, { merge: true });
  return payload;
}

export async function getLatestDiagnosticSummary(uid, subject) {
  const learnerId = requireUid(uid);
  const { db, firebase } = await services();
  const ref = firebase.doc(db, 'learners', learnerId, 'subjects', subjectKey(subject));
  const snapshot = await firebase.getDoc(ref);
  return snapshot.exists() ? snapshot.data() : null;
}

export async function saveCompanionMessage(uid, message) {
  const learnerId = requireUid(uid);
  const { db, firebase } = await services();
  const ref = firebase.collection(db, 'learners', learnerId, 'companionMessages');
  const payload = {
    ...sanitise(clone(message)),
    learner_id: learnerId,
    createdAt: firebase.serverTimestamp(),
  };
  const created = await firebase.addDoc(ref, payload);
  return created.id;
}

export async function savePracticeHistory(uid, { subject, concept, signatures = [] } = {}) {
  const learnerId = requireUid(uid);
  const cleanSignatures = [...new Set((Array.isArray(signatures) ? signatures : []).filter(Boolean).map(String))].slice(-1000);
  const { db, firebase } = await services();
  const subjectId = subjectKey(subject);
  const conceptId = subjectKey(concept);
  const ref = firebase.doc(db, 'learners', learnerId, 'practiceHistory', `${subjectId}__${conceptId}`);
  const existing = await firebase.getDoc(ref);
  const old = existing.exists() && Array.isArray(existing.data()?.signatures) ? existing.data().signatures : [];
  const merged = [...new Set([...old, ...cleanSignatures])].slice(-1000);
  const payload = {
    learner_id: learnerId,
    subject: String(subject || 'General').trim(),
    concept: String(concept || 'General').trim(),
    signatures: merged,
    updatedAt: firebase.serverTimestamp(),
  };
  await firebase.setDoc(ref, payload, { merge: true });
  return payload;
}

export async function getPracticeHistory(uid, { subject, concept } = {}) {
  const learnerId = requireUid(uid);
  const { db, firebase } = await services();
  const ref = firebase.doc(db, 'learners', learnerId, 'practiceHistory', `${subjectKey(subject)}__${subjectKey(concept)}`);
  const snapshot = await firebase.getDoc(ref);
  return snapshot.exists() && Array.isArray(snapshot.data()?.signatures) ? snapshot.data().signatures : [];
}

