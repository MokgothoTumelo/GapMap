import {
  AGENT_MODEL_NAMES,
  agentFirebaseConfig,
  agentProjectNumber,
} from '../frontend/js/agent-runtime-config.js';

const debugToken = process.env.FIREBASE_APPCHECK_DEBUG_TOKEN;
const prompt = process.env.AGENT_SMOKE_PROMPT ||
  'Reply with exactly: GapMap Firebase AI Logic smoke test passed.';
const models = (process.env.AGENT_SMOKE_MODELS || AGENT_MODEL_NAMES.join(','))
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);

function errorMessage(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed.error?.message || parsed.message || JSON.stringify(parsed);
  } catch (_error) {
    return body.trim() || 'empty response';
  }
}

function isTransient(status, message) {
  return status === 429 || status >= 500 || /high demand|temporar|unavailable|quota|rate limit/i.test(message);
}

async function exchangeDebugToken() {
  if (!debugToken) return null;

  const url = `https://content-firebaseappcheck.googleapis.com/v1/projects/${agentFirebaseConfig.projectId}/apps/${agentFirebaseConfig.appId}:exchangeDebugToken?key=${agentFirebaseConfig.apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ debug_token: debugToken }),
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`App Check debug-token exchange failed: [${response.status}] ${errorMessage(body)}`);
  }

  const payload = JSON.parse(body);
  if (!payload.token) throw new Error('App Check exchange returned no token');
  return payload.token;
}

function generatedText(body) {
  const chunks = [];
  const trimmed = body.trim();

  if (trimmed.startsWith('{')) {
    const response = JSON.parse(trimmed);
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.text) chunks.push(part.text);
    }
    return chunks.join('');
  }

  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('');
    if (!data || data === '[DONE]') continue;

    const response = JSON.parse(data);
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.text) chunks.push(part.text);
    }
  }

  return chunks.join('');
}

async function callModel(model, appCheckToken) {
  const url = `https://firebasevertexai.googleapis.com/v1beta/projects/${agentFirebaseConfig.projectId}/models/${model}:streamGenerateContent?alt=sse`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': agentFirebaseConfig.apiKey,
      ...(appCheckToken ? { 'x-firebase-appcheck': appCheckToken } : {}),
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }],
      }],
    }),
  });
  const body = await response.text();

  if (!response.ok) {
    const message = errorMessage(body);
    const error = new Error(`${model}: [${response.status}] ${message}`);
    error.status = response.status;
    error.transient = isTransient(response.status, message);
    throw error;
  }

  const text = generatedText(body);
  if (!text) throw new Error(`${model}: successful response contained no text`);
  return text;
}

async function main() {
  console.log(`Firebase AI Logic smoke: project ${agentFirebaseConfig.projectId} (${agentProjectNumber})`);
  const appCheckToken = await exchangeDebugToken();
  const failures = [];
  console.log(`App Check header: ${appCheckToken ? 'debug token supplied' : 'disabled'}`);

  for (const model of models) {
    try {
      const text = await callModel(model, appCheckToken);
      console.log(JSON.stringify({ ok: true, model, text }, null, 2));
      return;
    } catch (error) {
      failures.push(error.message);
      if (!error.transient) throw error;
      console.warn(`Transient failure from ${model}; trying the next model.`);
    }
  }

  throw new Error(`All live models failed:\n${failures.join('\n')}`);
}

main().catch((error) => {
  console.error(`Agent smoke failed: ${error.message}`);
  process.exitCode = 1;
});
