import assert from 'node:assert/strict';
import { OTP_TTL_MS, sendOtpEmail, verifyOtp, getOtpRemainingMs, getOtpState, clearOtpState } from '../frontend/js/emailjs-otp.js';

class MemoryStorage {
  #data = new Map();
  getItem(key) { return this.#data.has(key) ? this.#data.get(key) : null; }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
  removeItem(key) { this.#data.delete(String(key)); }
  clear() { this.#data.clear(); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.emailjs = { init() {}, async send(_s, _t, params) { this.lastCode = params.code; return { status: 200 }; } };
globalThis.document = { querySelector: () => null, createElement: () => ({}) };

const realNow = Date.now;
const baseNow = 1_900_000_000_000;
Date.now = () => baseNow;

try {
  localStorage.clear();
  sessionStorage.clear();

  await sendOtpEmail({ email: 'learner@example.com', purpose: 'signup verification' });
  const firstCode = globalThis.emailjs.lastCode;
  assert.equal(getOtpRemainingMs({ email: 'learner@example.com', purpose: 'signup verification' }), OTP_TTL_MS);

  Date.now = () => baseNow + 9 * 60 * 1000 + 59 * 1000;
  assert.ok(getOtpRemainingMs({ email: 'learner@example.com', purpose: 'signup verification' }) > 0);
  assert.ok(getOtpState({ email: 'learner@example.com', purpose: 'signup verification' }));
  assert.deepEqual(await verifyOtp({ email: 'learner@example.com', purpose: 'signup verification', code: firstCode }), { ok: true });

  Date.now = () => baseNow + 10 * 60 * 1000;
  await sendOtpEmail({ email: 'learner@example.com', purpose: 'sign-in verification' });
  const signInCode = globalThis.emailjs.lastCode;
  Date.now = () => baseNow + 10 * 60 * 1000 + OTP_TTL_MS;
  assert.equal(getOtpRemainingMs({ email: 'learner@example.com', purpose: 'sign-in verification' }), 0);
  const expired = await verifyOtp({ email: 'learner@example.com', purpose: 'sign-in verification', code: signInCode });
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'expired');

  Date.now = () => baseNow + 25 * 60 * 1000;
  await sendOtpEmail({ email: 'learner@example.com', purpose: 'sign-in verification' });
  await sendOtpEmail({ email: 'learner@example.com', purpose: 'password reset verification' });
  assert.ok(getOtpState({ email: 'learner@example.com', purpose: 'sign-in verification' }));
  assert.ok(getOtpState({ email: 'learner@example.com', purpose: 'password reset verification' }));

  clearOtpState({ email: 'learner@example.com', purpose: 'sign-in verification' });
  assert.equal(getOtpState({ email: 'learner@example.com', purpose: 'sign-in verification' }), null);
  assert.ok(getOtpState({ email: 'learner@example.com', purpose: 'password reset verification' }));

  console.log('emailjs-otp-10min.spec.js passed');
} finally {
  Date.now = realNow;
}
