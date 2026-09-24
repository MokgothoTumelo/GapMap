// EmailJS-backed one-time codes for GapMap account verification.
//
// EmailJS is only used as the delivery channel. The OTP itself is never
// rendered on screen, logged to the console, or stored in Firestore. The
// browser keeps only a SHA-256 digest plus expiry/attempt metadata locally.
// localStorage is used so a refresh or switching tabs does not discard a
// still-valid 10-minute verification challenge.

export const EMAILJS_SERVICE_ID = 'lanabettino_10';
export const EMAILJS_TEMPLATE_ID = 'Otp_code';
export const EMAILJS_PUBLIC_KEY = 'Ho3XNGvDrUyYdjwn4';
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000;

const EMAILJS_SCRIPT_URL =
  'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
const CHALLENGE_PREFIX = 'gapmap.emailjs.otp.challenge.v4:';
const RESEND_PREFIX = 'gapmap.emailjs.otp.lastSentAt.v4:';
const ACTIVE_CHALLENGE_KEY = 'gapmap.emailjs.otp.active.v4';
const ACTIVE_RESEND_KEY = 'gapmap.emailjs.otp.activeResend.v4';

let emailJsLoadPromise = null;
let emailJsInitialised = false;

function storageGet(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch (_error) {
    return null;
  }
}

function storageSet(storage, key, value) {
  try {
    storage?.setItem(key, value);
    return true;
  } catch (_error) {
    return false;
  }
}

function storageRemove(storage, key) {
  try {
    storage?.removeItem(key);
  } catch (_error) {}
}

function safeGet(key) {
  const local = storageGet(globalThis.localStorage, key);
  if (local !== null) return local;
  return storageGet(globalThis.sessionStorage, key);
}

function safeSet(key, value) {
  if (storageSet(globalThis.localStorage, key, value)) return 'local';
  storageSet(globalThis.sessionStorage, key, value);
  return 'session';
}

function safeRemove(key) {
  storageRemove(globalThis.localStorage, key);
  storageRemove(globalThis.sessionStorage, key);
}

function getEmailJs() {
  if (!globalThis.emailjs) {
    throw new Error('Email delivery is not ready. Please refresh and try again.');
  }
  return globalThis.emailjs;
}

export function loadEmailJs() {
  if (globalThis.emailjs) return Promise.resolve(globalThis.emailjs);
  if (emailJsLoadPromise) return emailJsLoadPromise;

  emailJsLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-gapmap-emailjs]');
    if (existing) {
      existing.addEventListener('load', () => resolve(getEmailJs()), { once: true });
      existing.addEventListener('error', () => reject(new Error('EmailJS could not be loaded.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = EMAILJS_SCRIPT_URL;
    script.async = true;
    script.dataset.gapmapEmailjs = 'true';
    script.onload = () => {
      try {
        resolve(getEmailJs());
      } catch (error) {
        reject(error);
      }
    };
    script.onerror = () => reject(new Error('EmailJS could not be loaded.'));
    document.head.appendChild(script);
  });

  return emailJsLoadPromise;
}

export async function initEmailJs() {
  const emailjs = await loadEmailJs();
  if (!emailJsInitialised) {
    emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    emailJsInitialised = true;
  }
  return emailjs;
}

function generateOtp() {
  const values = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return String(100000 + (values[0] % 900000));
  }
  return String(100000 + Math.floor(Math.random() * 900000));
}

async function digestCode(code) {
  const value = new TextEncoder().encode(String(code));
  if (globalThis.crypto?.subtle?.digest) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', value);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  // Deterministic fallback for older browsers. It is still never the raw OTP.
  let hash = 2166136261;
  for (const byte of value) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16)}`;
}

function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalisePurpose(purpose) {
  return String(purpose || 'account verification').trim();
}

function scopedKey(prefix, email, purpose) {
  return `${prefix}${encodeURIComponent(`${normaliseEmail(email)}|${normalisePurpose(purpose)}`)}`;
}

function challengeMatches(challenge, email, purpose) {
  if (!challenge) return false;
  return challenge.email === normaliseEmail(email) && challenge.purpose === normalisePurpose(purpose);
}

function readChallenge(options = {}) {
  try {
    const key = options.email && options.purpose
      ? scopedKey(CHALLENGE_PREFIX, options.email, options.purpose)
      : safeGet(ACTIVE_CHALLENGE_KEY);
    if (!key) return null;
    const raw = options.email && options.purpose ? safeGet(key) : safeGet(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function writeChallenge(challenge) {
  const key = scopedKey(CHALLENGE_PREFIX, challenge.email, challenge.purpose);
  safeSet(key, JSON.stringify(challenge));
  safeSet(ACTIVE_CHALLENGE_KEY, key);
}

export function getOtpState(options = {}) {
  const challenge = readChallenge(options);
  if (!challenge) return null;
  if (options.email && !challengeMatches(challenge, options.email, options.purpose)) return null;

  const issuedAt = Number(challenge.issuedAt);
  const expiresAt = Number(challenge.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    clearOtpState({ email: challenge.email, purpose: challenge.purpose });
    return null;
  }
  if (Date.now() >= expiresAt) {
    clearOtpState({ email: challenge.email, purpose: challenge.purpose });
    return null;
  }
  return challenge;
}

export function getOtpRemainingMs(options = {}) {
  const challenge = getOtpState(options);
  return challenge ? Math.max(0, Number(challenge.expiresAt) - Date.now()) : 0;
}

export function clearOtpState(options = {}) {
  const challenge = readChallenge(options);
  if (!challenge) return;
  if (options.email && !challengeMatches(challenge, options.email, options.purpose)) return;
  const key = scopedKey(CHALLENGE_PREFIX, challenge.email, challenge.purpose);
  safeRemove(key);
  if (safeGet(ACTIVE_CHALLENGE_KEY) === key) safeRemove(ACTIVE_CHALLENGE_KEY);
}

export function getResendRemainingMs(options = {}) {
  const key = options.email && options.purpose
    ? scopedKey(RESEND_PREFIX, options.email, options.purpose)
    : safeGet(ACTIVE_RESEND_KEY);
  const lastSentAt = Number(key ? safeGet(key) : 0);
  if (!Number.isFinite(lastSentAt) || lastSentAt <= 0) return 0;
  return Math.max(0, OTP_RESEND_COOLDOWN_MS - (Date.now() - lastSentAt));
}

async function createAndSend({ email, name = '', purpose = 'account verification' } = {}) {
  const normalizedEmail = normaliseEmail(email);
  const normalizedPurpose = normalisePurpose(purpose);
  if (!normalizedEmail) throw new Error('A valid email address is required.');
  const cooldown = getResendRemainingMs({ email: normalizedEmail, purpose: normalizedPurpose });
  if (cooldown > 0) {
    throw new Error(`Please wait ${Math.ceil(cooldown / 1000)} seconds before requesting another code.`);
  }

  const code = generateOtp();
  const emailjs = await initEmailJs();

  const params = {
    // Most EmailJS templates use to_email; aliases below make the same template
    // usable if it references one of the common names instead.
    to_email: normalizedEmail,
    email: normalizedEmail,
    recipient_email: normalizedEmail,
    to_name: String(name || 'GapMap Learner').trim() || 'GapMap Learner',
    name: String(name || 'GapMap Learner').trim() || 'GapMap Learner',
    otp_code: code,
    code,
    otp: code,
    purpose: normalizedPurpose,
  };

  // Start the 10-minute lifetime only after EmailJS confirms the send request.
  await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, params);

  const now = Date.now();
  const expiresAt = now + OTP_TTL_MS;
  writeChallenge({
    email: normalizedEmail,
    purpose: normalizedPurpose,
    codeHash: await digestCode(code),
    issuedAt: now,
    expiresAt,
    attempts: 0,
  });
  const resendKey = scopedKey(RESEND_PREFIX, normalizedEmail, normalizedPurpose);
  safeSet(resendKey, String(now));
  safeSet(ACTIVE_RESEND_KEY, resendKey);
  return { issuedAt: now, expiresAt }; 
}

export async function sendOtpEmail(options = {}) {
  return createAndSend(options);
}

export async function verifyOtp({ email, purpose, code } = {}) {
  const normalizedEmail = normaliseEmail(email);
  const challenge = getOtpState({ email: normalizedEmail, purpose });
  if (!challenge) {
    return {
      ok: false,
      reason: 'expired',
      message: 'This code is no longer valid. Please request a new code. Codes remain valid for 10 minutes after the email is sent.',
    };
  }

  if (!challengeMatches(challenge, normalizedEmail, purpose)) {
    return { ok: false, reason: 'mismatch', message: 'This code does not belong to the current verification request.' };
  }

  const entered = String(code || '').replace(/\D/g, '');
  if (entered.length !== 6) {
    return { ok: false, reason: 'format', message: 'Please enter the full 6-digit code.' };
  }

  if (Number(challenge.attempts || 0) >= OTP_MAX_ATTEMPTS) {
    clearOtpState({ email: normalizedEmail, purpose });
    return { ok: false, reason: 'locked', message: 'Too many incorrect attempts. Please request a new code.' };
  }

  const enteredHash = await digestCode(entered);
  if (enteredHash !== challenge.codeHash) {
    challenge.attempts = Number(challenge.attempts || 0) + 1;
    writeChallenge(challenge);
    const remaining = Math.max(0, OTP_MAX_ATTEMPTS - challenge.attempts);
    return {
      ok: false,
      reason: 'incorrect',
      remaining,
      message: remaining
        ? `Incorrect code. You have ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        : 'Too many incorrect attempts. Please request a new code.',
    };
  }

  clearOtpState({ email: normalizedEmail, purpose });
  return { ok: true };
}
