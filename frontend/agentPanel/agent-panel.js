(function () {
  const icons = {
    spark:
      '<svg viewBox="0 0 24 24" fill="none"><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Zm7 14 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" fill="currentColor"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    activity:
      '<svg viewBox="0 0 24 24" fill="none"><path d="M4 12h3l2-6 4 12 2-6h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function createElement(tagName, className, html) {
    const element = document.createElement(tagName);
    element.className = className || '';
    if (html !== undefined) element.innerHTML = html;
    return element;
  }

  function scrollToLatestMessage(thread) {
    if (thread.parentElement) {
      thread.parentElement.scrollTop = thread.parentElement.scrollHeight;
    }
  }

  const launcher = createElement(
    'button',
    'gm-agent-launcher',
    icons.spark + '<span>Ask GapMap</span>',
  );
  launcher.setAttribute('aria-label', 'Open GapMap companion');

  const scrim = createElement('div', 'gm-agent-scrim');
  const panel = createElement(
    'aside',
    'gm-agent-panel',
    `
      <header class="gm-agent-header">
        <div class="gm-agent-brand">
          <div class="gm-agent-brand-mark">${icons.spark}</div>
          <div class="gm-agent-brand-copy">
            <div class="gm-agent-title">GapMap companion</div>
            <div class="gm-agent-subtitle">
              <span class="gm-agent-status-dot"></span>
              <span class="gm-agent-status-text">Starting live agent…</span>
            </div>
          </div>
        </div>

        <div class="gm-agent-header-actions">
          <button class="gm-agent-button gm-agent-new" aria-label="Start a new conversation">
            ${icons.plus}
          </button>
          <button class="gm-agent-button gm-agent-close" aria-label="Close GapMap companion">
            ${icons.close}
          </button>
        </div>
      </header>

      <div class="gm-agent-body">
        <div class="gm-agent-thread">
          <section class="gm-agent-intro">
            <div class="gm-agent-intro-kicker">
              ${icons.spark} Personalised support
            </div>
            <h2>What are you working on?</h2>
            <p>
              Ask about a Concept, share an Item, or get help choosing your
              next step on the Learning Path.
            </p>

            <div class="gm-agent-suggestions">
              <button class="gm-agent-suggestion" data-prompt="Help me understand factorisation">
                <span>⌁</span>
                Understand a Concept
              </button>
              <button class="gm-agent-suggestion" data-prompt="Help me with a difficult Item">
                <span>◇</span>
                Work through an Item
              </button>
            </div>
          </section>

          <div class="gm-agent-messages"></div>
        </div>
      </div>

      <section class="gm-agent-activity">
        <button class="gm-agent-activity-toggle" aria-expanded="false">
          <span class="gm-agent-activity-label">
            ${icons.activity} Activity
            <span class="gm-agent-activity-count">0</span>
          </span>
          <span class="gm-agent-activity-action">View events</span>
        </button>
        <div class="gm-agent-activity-log"></div>
      </section>

      <div class="gm-agent-composer-wrap">
        <form class="gm-agent-composer">
          <textarea
            class="gm-agent-input"
            rows="1"
            placeholder="Message GapMap…"
            aria-label="Message GapMap"
          ></textarea>
          <button class="gm-agent-send" aria-label="Send message">
            ${icons.send}
          </button>
        </form>
        <p class="gm-agent-disclaimer">GapMap can make mistakes. Check important work.</p>
      </div>
    `,
  );

  document.body.append(launcher, scrim, panel);

  const thread = panel.querySelector('.gm-agent-thread');
  const messages = panel.querySelector('.gm-agent-messages');
  const intro = panel.querySelector('.gm-agent-intro');
  const input = panel.querySelector('.gm-agent-input');
  const sendButton = panel.querySelector('.gm-agent-send');
  const statusText = panel.querySelector('.gm-agent-status-text');
  const statusDot = panel.querySelector('.gm-agent-status-dot');
  const activity = panel.querySelector('.gm-agent-activity');
  const activityLog = panel.querySelector('.gm-agent-activity-log');
  const activityCount = panel.querySelector('.gm-agent-activity-count');
  const activityAction = panel.querySelector('.gm-agent-activity-action');

  let eventCount = 0;
  let activeAssistantBubble = null;
  let agentClient = null;

  /**
   * Docked mode (desktop): the open panel becomes a right-hand rail below the
   * sticky nav, and the page's container moves only as far as the rail
   * actually requires — no shift on wide screens where the centred column
   * never reaches it, an animated one when it would otherwise be covered.
   * Narrow screens keep the overlay drawer instead.
   */
  const DOCK_MEDIA = window.matchMedia('(min-width: 1100px)');
  const DOCK_GAP = 24;

  function applyDockInset() {
    if (!DOCK_MEDIA.matches) return;
    const container = document.querySelector('.container');
    if (!container) return;
    const railLeft = panel.getBoundingClientRect().left;
    const covered = container.getBoundingClientRect().right + DOCK_GAP - railLeft;
    container.style.marginRight = covered > 0 ? `${Math.round(covered)}px` : '';
  }

  function releaseDockInset() {
    const container = document.querySelector('.container');
    if (container) container.style.marginRight = '';
  }

  function openPanel() {
    panel.classList.add('is-visible');
    scrim.classList.add('is-visible');
    // Anchor the rail below the sticky nav, then make room beside it only if
    // the content would otherwise be covered.
    const nav = document.querySelector('.nav');
    const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
    document.documentElement.style.setProperty(
      '--gm-panel-top',
      `${Math.round(navBottom)}px`,
    );
    document.body.classList.add('gm-panel-open');
    applyDockInset();
    input.focus();
  }

  function closePanel() {
    panel.classList.remove('is-visible');
    scrim.classList.remove('is-visible');
    document.body.classList.remove('gm-panel-open');
    releaseDockInset();
  }

  window.addEventListener('resize', () => {
    if (panel.classList.contains('is-visible')) {
      const nav = document.querySelector('.nav');
      document.documentElement.style.setProperty(
        '--gm-panel-top',
        `${Math.round(nav ? nav.getBoundingClientRect().bottom : 0)}px`,
      );
      applyDockInset();
    }
  });

  function setBusy(isBusy) {
    sendButton.disabled = isBusy;
    statusText.textContent = isBusy ? 'Thinking…' : statusText.dataset.readyText || 'Ready to help';
    statusDot.classList.toggle('is-busy', isBusy);
  }

  function addMessage(role, text, isPending = false) {
    const message = createElement(
      'article',
      'gm-agent-message ' + (role === 'user' ? 'is-user' : 'is-assistant'),
    );
    const avatar = role === 'user' ? 'TM' : icons.spark;

    message.innerHTML = `
      <div class="gm-agent-avatar">${avatar}</div>
      <div class="gm-agent-bubble"><span class="gm-agent-bubble-text"></span></div>
    `;

    const bubble = message.querySelector('.gm-agent-bubble');
    const bubbleText = message.querySelector('.gm-agent-bubble-text');
    if (isPending) {
      message.classList.add('is-pending');
      bubble.insertAdjacentHTML(
        'afterbegin',
        '<span class="gm-agent-dots"><i></i><i></i><i></i></span>',
      );
    } else {
      bubbleText.textContent = text || '';
    }

    messages.append(message);
    scrollToLatestMessage(thread);
    return bubble;
  }

  function assistantBubbleText(bubble) {
    return bubble.querySelector('.gm-agent-bubble-text');
  }

  function clearPendingDots(bubble) {
    const dots = bubble.querySelector('.gm-agent-dots');
    if (dots) dots.remove();
    bubble.parentElement.classList.remove('is-pending');
  }

  function resetBubbleContent(bubble) {
    clearPendingDots(bubble);
    assistantBubbleText(bubble).textContent = '';
    bubble.querySelectorAll('.gm-agent-tool-chip').forEach((chip) => chip.remove());
  }

  function addEvent(name, detail = '') {
    eventCount += 1;
    activityCount.textContent = eventCount;

    const eventRow = createElement('div', 'gm-agent-event');
    const eventName = document.createElement('strong');
    const eventDetail = document.createElement('span');
    eventName.textContent = name.replaceAll('_', ' ');
    eventDetail.textContent = detail;
    eventRow.append(eventName, eventDetail);
    activityLog.append(eventRow);
  }

  function resetView() {
    messages.innerHTML = '';
    intro.hidden = false;
    activityLog.innerHTML = '';
    eventCount = 0;
    activityCount.textContent = '0';
    activeAssistantBubble = null;
    setBusy(false);
  }

  function appendAssistantToken(token) {
    if (!activeAssistantBubble) {
      activeAssistantBubble = addMessage('assistant', '', true);
    }
    clearPendingDots(activeAssistantBubble);
    assistantBubbleText(activeAssistantBubble).textContent += token;
    scrollToLatestMessage(thread);
  }

  function appendToolCall(name) {
    if (!activeAssistantBubble) {
      activeAssistantBubble = addMessage('assistant', '', true);
    }
    clearPendingDots(activeAssistantBubble);
    const chip = createElement('span', 'gm-agent-tool-chip');
    chip.textContent = `Called ${name}`;
    activeAssistantBubble.insertBefore(chip, assistantBubbleText(activeAssistantBubble));
    addEvent('tool_call', name);
    scrollToLatestMessage(thread);
  }

  function renderTranscript(transcript) {
    if (!transcript.length) return;
    intro.hidden = true;
    transcript.forEach((turn) => addMessage(turn.role, turn.content));
  }

  function demoStorage() {
    try {
      return globalThis.localStorage;
    } catch (_error) {
      return undefined;
    }
  }

  function configuredModel() {
    return globalThis.gapmapAgentModel || globalThis.gapmapAgent?.model || null;
  }

  function configuredModels() {
    if (Array.isArray(globalThis.gapmapAgentModels) && globalThis.gapmapAgentModels.length) {
      return globalThis.gapmapAgentModels;
    }
    const model = configuredModel();
    return model ? [model] : [];
  }

  async function sendPrompt(value) {
    const message = value.trim();
    if (!message || sendButton.disabled) return;

    intro.hidden = true;
    addMessage('user', message);
    input.value = '';
    input.style.height = 'auto';
    activeAssistantBubble = addMessage('assistant', '', true);
    setBusy(true);
    openPanel();

    try {
      const result = await agentReady;
      const response = await result.send(message, {
        onToken: appendAssistantToken,
        onToolCall: appendToolCall,
        onReset: () => {
          if (activeAssistantBubble) {
            resetBubbleContent(activeAssistantBubble);
          }
        },
      });

      if (!activeAssistantBubble) {
        activeAssistantBubble = addMessage('assistant', response.text);
      }
      clearPendingDots(activeAssistantBubble);
      const bubbleText = assistantBubbleText(activeAssistantBubble);
      if (!bubbleText.textContent) {
        bubbleText.textContent = response.text;
      }
      addEvent('model_reply', response.modelName || response.source);
      activeAssistantBubble = null;
      setBusy(false);
    } catch (error) {
      const text = error?.message || 'I could not send that message.';
      if (!activeAssistantBubble) activeAssistantBubble = addMessage('assistant', text);
      resetBubbleContent(activeAssistantBubble);
      assistantBubbleText(activeAssistantBubble).textContent = text;
      activeAssistantBubble = null;
      addEvent('agent_error', text);
      setBusy(false);
    }
  }

  launcher.addEventListener('click', openPanel);
  scrim.addEventListener('click', closePanel);
  panel.querySelector('.gm-agent-close').addEventListener('click', closePanel);

  panel.querySelector('.gm-agent-new').addEventListener('click', async () => {
    try {
      const client = await agentReady;
      await client.reset();
    } finally {
      resetView();
      input.focus();
    }
  });

  panel.querySelectorAll('.gm-agent-suggestion').forEach((button) => {
    button.addEventListener('click', () => sendPrompt(button.dataset.prompt));
  });

  panel
    .querySelector('.gm-agent-activity-toggle')
    .addEventListener('click', (event) => {
      const isExpanded = activity.classList.toggle('is-expanded');
      event.currentTarget.setAttribute('aria-expanded', isExpanded);
      activityAction.textContent = isExpanded ? 'Hide events' : 'View events';
    });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 108) + 'px';
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendPrompt(input.value);
    }
  });

  panel.querySelector('.gm-agent-composer').addEventListener('submit', (event) => {
    event.preventDefault();
    sendPrompt(input.value);
  });

  function currentSurface() {
    const path = (globalThis.location?.pathname || '').split('/').pop() || 'index.html';
    return path.replace(/\\.html$/i, '') || 'index';
  }

  // The live agent is on by default: every page loads the Firebase AI Logic
  // bootstrap unless the session opted out. `?agent=off` (or
  // GAPMAP_DISABLE_LIVE_AGENT) opts out for the session — sticky in
  // sessionStorage so the key-free demo flow stays key-free across
  // navigation; `?agent=live` re-enables it explicitly.
  // The Subject store parses the active Subject's YAML graph through the
  // vendored browser copy of js-yaml. Some pages (for example Library,
  // Profile and the auth pages) do not otherwise need the YAML parser, but
  // the Companion can load subject-store.js on every page. Ensure the vendor
  // is available before importing that module so the tool never fails with
  // "js-yaml is not loaded" merely because of page-specific script tags.
  function ensureJsYamlLoaded() {
    if (typeof globalThis.jsyaml !== 'undefined') return Promise.resolve();

    const existing = document.querySelector('script[data-gapmap-js-yaml]');
    if (existing) {
      return new Promise((resolve, reject) => {
        if (typeof globalThis.jsyaml !== 'undefined') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => {
          if (typeof globalThis.jsyaml === 'undefined') {
            reject(new Error('js-yaml loaded but did not expose the browser parser'));
            return;
          }
          resolve();
        }, { once: true });
        existing.addEventListener('error', () => {
          reject(new Error('Could not load the vendored js-yaml parser'));
        }, { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/frontend/vendor/js-yaml.min.js';
      script.async = false;
      script.dataset.gapmapJsYaml = 'true';
      script.addEventListener('load', () => {
        if (typeof globalThis.jsyaml === 'undefined') {
          reject(new Error('js-yaml loaded but did not expose the browser parser'));
          return;
        }
        resolve();
      }, { once: true });
      script.addEventListener('error', () => {
        reject(new Error('Could not load the vendored js-yaml parser'));
      }, { once: true });
      document.head.appendChild(script);
    });
  }

  const liveAgentSetup = (() => {
    const params = new URLSearchParams(globalThis.location?.search || '');
    const explicitlyOff =
      params.get('agent') === 'off' || globalThis.GAPMAP_DISABLE_LIVE_AGENT === true;
    const explicitlyOn = params.get('agent') === 'live';

    if (explicitlyOff) {
      try {
        globalThis.sessionStorage?.setItem('gapmap.agent.live', 'off');
      } catch (_error) {
        // sessionStorage may be unavailable (private mode); the flag is
        // still honoured for this page.
      }
    } else if (explicitlyOn) {
      try {
        globalThis.sessionStorage?.removeItem('gapmap.agent.live');
      } catch (_error) {
        // ignore
      }
    }

    let persistedOff = false;
    try {
      persistedOff = globalThis.sessionStorage?.getItem('gapmap.agent.live') === 'off';
    } catch (_error) {
      persistedOff = false;
    }

    const liveRequested = explicitlyOn || (!explicitlyOff && !persistedOff);
    return liveRequested ? import('../../agent-config.js') : Promise.resolve(null);
  })();

  const agentReady = Promise.all([
    liveAgentSetup,
    ensureJsYamlLoaded(),
  ]).then(() => Promise.all([
    import('../js/agent-client.js'),
    import('../js/learner-store.js'),
    import('../js/subject-store.js'),
  ])).then(async ([agentModule, storeModule, subjectStoreModule]) => {
    const localStore = storeModule.createMockLearnerStore({ storage: demoStorage() });
    // A live session reads and writes per-Learner records through Firestore
    // (`frontend/js/firebase-learner-store.js`) with the mock store as the
    // offline fallback; the opted-out key-free demo (`?agent=off`) and every
    // test stay entirely local — no database, no CDN fetch.
    let store = localStore;
    if ((await liveAgentSetup) !== null) {
      try {
        const { createFirebaseLearnerStore } = await import('../js/firebase-learner-store.js');
        store = await createFirebaseLearnerStore({
          fallbackStore: localStore,
          storage: demoStorage(),
        });
      } catch (error) {
        console.warn('[Agent panel] Firestore-backed Learner store unavailable; using the local store.', error);
      }
    }
    const subjectStore = subjectStoreModule.createSubjectStore();
    const identityOptions = {
      auth: globalThis.auth,
      getCurrentUser: globalThis.getCurrentUser,
      storage: demoStorage(),
    };

    agentClient = agentModule.createAgentClient({
      model: configuredModel(),
      models: configuredModels(),
      store,
      getLearnerId: () => storeModule.getCurrentLearnerId(identityOptions),
      getLearnerContext: async ({ learnerId }) => {
        const storedContext = await store.getContext(learnerId);
        const identity = storeModule.getCurrentLearner(identityOptions);
        const profile = identity.user || {};
        const localProfile = Object.fromEntries(
          Object.entries({
            firstName: profile.firstName,
            grade: profile.grade,
            language: profile.language,
            explanationLevel: profile.explanationLevel,
            subject: profile.subject,
          }).filter(([, value]) => value !== undefined && value !== null),
        );

        const appContext = typeof globalThis.gapmapLearnerContext === 'function'
          ? await globalThis.gapmapLearnerContext({ learnerId, user: identity.user })
          : globalThis.gapmapLearnerContext || {};
        const safeContext = Object.fromEntries(
          ['gapMap', 'learningPath', 'subject', 'language', 'explanationLevel']
            .filter((key) => appContext?.[key] !== undefined)
            .map((key) => [key, appContext[key]]),
        );
        const appLearner = appContext?.learner || {};
        const safeAppLearner = Object.fromEntries(
          ['language', 'explanationLevel', 'subject']
            .filter((key) => appLearner[key] !== undefined)
            .map((key) => [key, appLearner[key]]),
        );

        return {
          ...storedContext,
          ...safeContext,
          subject: GapMapAuth.getActiveSubject?.() || safeContext.subject || profile.subject || null,
          currentSurface: currentSurface(),
          learner: {
            ...localProfile,
            ...safeAppLearner,
          },
        };
      },
      // ADR-0006: the Companion's Learning Path tools read the Subject's
      // Concept Graph from the subject store — subject-level data shared by
      // all Learners. A Subject without a graph returns null (flat path); a
      // malformed graph surfaces as a tool failure rather than masking it.
      getConceptGraph: async () => {
        const identity = storeModule.getCurrentLearner(identityOptions);
        const profile = identity.user || {};
        return subjectStore.getConceptGraph({
          grade: profile.grade,
          subject: profile.subject,
        });
      },
      getSubjectConcepts: async () => {
        const identity = storeModule.getCurrentLearner(identityOptions);
        const profile = identity.user || {};
        const graph = await subjectStore.getConceptGraph({
          grade: profile.grade,
          subject: profile.subject,
        });
        if (graph) {
          return {
            grade: profile.grade || null,
            subject: profile.subject || null,
            concepts: (graph.nodes || []).map((node) => ({
              concept: node.concept,
              description: node.description || null,
              originGrade: node.grade || null,
            })),
          };
        }

        const assessments = await store.listAssessments(identity.learnerId);
        const subject = String(profile.subject || '').trim().toLowerCase();
        const concepts = new Map();
        assessments
          .filter((assessment) => {
            const value = String(assessment.subject || '').replace(/^Grade\\s*\\d+\\s*/i, '').trim().toLowerCase();
            return !subject || !value || value === subject;
          })
          .forEach((assessment) => {
            (assessment.concepts || []).forEach((entry) => {
              if (entry?.name && !concepts.has(entry.name)) {
                concepts.set(entry.name, {
                  concept: entry.name,
                  description: entry.description || null,
                  originGrade: profile.grade || null,
                });
              }
            });
          });
        return {
          grade: profile.grade || null,
          subject: profile.subject || null,
          concepts: Array.from(concepts.values()),
        };
      },
      navigate: async ({ url }) => {
        if (!url) throw new Error('Navigation target is missing');
        globalThis.location.assign(url);
      },
    });

    const modelAvailable = configuredModels().length > 0;
    statusText.dataset.readyText = modelAvailable ? 'Ready to help' : 'Live agent unavailable';
    statusText.textContent = statusText.dataset.readyText;

    try {
      renderTranscript(await agentClient.getTranscript());
    } catch (_error) {
      // A corrupt local transcript must not prevent the Companion panel from
      // opening. The store starts clean on the next successful write.
    }

    return agentClient;
  }).catch((error) => {
    statusText.dataset.readyText = 'Live agent unavailable';
    statusText.textContent = 'Live agent unavailable';
    addEvent('client_error', error.message);
    throw error;
  });

  // Keep this reference available for diagnostic tooling without making the
  // panel's runtime contract depend on a global singleton.
  globalThis.gapmapAgentPanel = {
    getClient: () => agentClient,
    sendPrompt,
  };
})();
