// GapMap session, Learner Profile, and the guest lock.
//
// Firebase Authentication is now the account source of truth. The local
// `gapmap_user` value is only a lightweight app-session snapshot used by the
// existing page guards and renderers; it contains no password. Firestore is
// the durable store for the Learner Profile and learning artefacts. The
// preference setters below keep the local snapshot responsive and also sync
// the Profile to Firestore.
//
// This version is resilient to sandboxed documents that lack
// allow-same-origin (localStorage / sessionStorage throw SecurityError).
//
(function () {
  var STORAGE_KEY = 'gapmap_user';
  var REDIRECT_MESSAGE_KEY = 'gapmap_auth_message';
  var DEFAULT_MESSAGE = 'Please log in to continue.';
  var DEFAULT_LANGUAGE = 'English';
  var DEFAULT_EXPLANATION_LEVEL = 'Standard';

  // ------------------------------------------------------------------
  // Billing / subscription gate — REMOVED
  //
  // subscription.html has been removed. Access is no longer gated on a
  // trial or paid subscription. Onboarding is now:
  //   Signup → Email OTP verify → Setup → Diagnostic → Dashboard
  // The helpers below remain as no-ops / always-open so any leftover
  // callers do not break.
  // ------------------------------------------------------------------
  var TRIAL_LENGTH_DAYS = 30;

  function getBillingStatus(/* userArg */) {
    return {
      billingComplete: true,
      subscriptionActive: true,
      planKey: null,
      trialStart: null,
      trialLengthDays: TRIAL_LENGTH_DAYS,
      trialActive: true,
      trialExpired: false,
      daysRemaining: TRIAL_LENGTH_DAYS,
      hasAccess: true,
      record: {},
    };
  }

  function startTrial(/* userArg, extra */) {
    return getBillingStatus();
  }

  function activateSubscription(/* userArg, sub */) {
    return getBillingStatus();
  }

  function cancelSubscription(/* userArg */) {
    return getBillingStatus();
  }

  // ------------------------------------------------------------------
  // Safe storage layer – falls back to in-memory when localStorage is
  // blocked (sandboxed iframe without allow-same-origin, some private
  // modes, etc.)
  // ------------------------------------------------------------------
  var memoryStore = {};

  function canUseStorage(storage) {
    try {
      var testKey = '__gm_test__';
      storage.setItem(testKey, '1');
      storage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }

  var useLocal = canUseStorage(window.localStorage);
  var useSession = canUseStorage(window.sessionStorage);

  function safeGet(key) {
    try {
      if (useLocal) return localStorage.getItem(key);
      return memoryStore[key] || null;
    } catch (e) {
      return memoryStore[key] || null;
    }
  }

  function safeSet(key, value) {
    try {
      if (useLocal) {
        localStorage.setItem(key, value);
        return;
      }
    } catch (e) { /* fall through */ }
    memoryStore[key] = value;
  }

  function safeRemove(key) {
    try {
      if (useLocal) localStorage.removeItem(key);
    } catch (e) {}
    delete memoryStore[key];
  }

  function safeSessionGet(key) {
    try {
      if (useSession) return sessionStorage.getItem(key);
      return memoryStore['session:' + key] || null;
    } catch (e) {
      return memoryStore['session:' + key] || null;
    }
  }

  function safeSessionSet(key, value) {
    try {
      if (useSession) {
        sessionStorage.setItem(key, value);
        return;
      }
    } catch (e) {}
    memoryStore['session:' + key] = value;
  }

  function safeSessionRemove(key) {
    try {
      if (useSession) sessionStorage.removeItem(key);
    } catch (e) {}
    delete memoryStore['session:' + key];
  }

  // ------------------------------------------------------------------
  // Shared dropdown switcher (Subject, Language). Injects its styles
  // once and renders a <select> into the container on mount.
  // ------------------------------------------------------------------
  var SWITCHER_STYLE =
    '.gm-switcher{position:relative;display:inline-flex;align-items:center;}' +
    '.gm-switcher select{' +
    'appearance:none;-webkit-appearance:none;background:#EEF2FF;color:#3B5BDB;' +
    'font-size:0.85rem;font-weight:600;padding:6px 32px 6px 14px;border-radius:20px;' +
    'border:1.5px solid transparent;cursor:pointer;font-family:inherit;outline:none;max-width:220px;}' +
    '.gm-switcher select:hover,.gm-switcher select:focus{border-color:#3B5BDB;background:#E0E7FF;}' +
    '.gm-switcher::after{content:"";position:absolute;right:12px;top:50%;transform:translateY(-50%);' +
    'width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid #3B5BDB;pointer-events:none;}' +
    '@media (max-width:700px){.gm-switcher select{max-width:160px;font-size:0.8rem;padding:5px 28px 5px 10px;}}';

  function ensureSwitcherStyle() {
    if (document.getElementById('gm-switcher-style')) return;
    var style = document.createElement('style');
    style.id = 'gm-switcher-style';
    style.textContent = SWITCHER_STYLE;
    document.head.appendChild(style);
  }

  /**
   * Mount a dropdown switcher into a container element.
   * options: {
   *   container: HTMLElement or selector,
   *   values: [string],
   *   active: string — preselected value at mount time,
   *   isActive: function(value) — guard against no-op changes (fresh read),
   *   onSelect: function(value) — called when the Learner picks a new value,
   *   ariaLabel: string
   * }
   * Returns true if mounted.
   */
  function mountPicker(options) {
    options = options || {};
    var container = options.container;
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container) return false;

    ensureSwitcherStyle();

    container.innerHTML = '';
    container.className = (container.className || '') + ' gm-switcher';
    var select = document.createElement('select');
    select.setAttribute('aria-label', options.ariaLabel || 'Switch');
    (options.values || []).forEach(function (value) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      if (value === options.active) opt.selected = true;
      select.appendChild(opt);
    });
    container.appendChild(select);

    select.addEventListener('change', function () {
      var next = select.value;
      if (!next) return;
      if (typeof options.isActive === 'function' && options.isActive(next)) return;
      if (typeof options.onSelect === 'function') options.onSelect(next);
    });

    return true;
  }

  // ------------------------------------------------------------------
  // The avatar menu: identity glance + the Profile page + Log out.
  // Log out lives here (and on profile.html), not in the navs.
  // ------------------------------------------------------------------
  var PROFILE_MENU_STYLE =
    '.gm-profile-wrap{position:relative;display:inline-flex;align-items:center;}' +
    '.gm-profile-wrap .avatar{cursor:pointer;}' +
    '.gm-profile-menu{position:absolute;top:calc(100% + 10px);right:0;z-index:60;' +
    'background:#fff;border:1.5px solid #E5E7EB;border-radius:14px;' +
    'box-shadow:0 12px 32px -12px rgba(0,0,0,.18);min-width:230px;padding:8px;display:none;}' +
    '.gm-profile-menu.open{display:block;}' +
    '.gm-profile-menu-head{padding:10px 12px;border-bottom:1.5px solid #F1F5F9;margin-bottom:6px;}' +
    '.gm-profile-name{font-weight:700;font-size:.92rem;color:#1A1A2E;}' +
    '.gm-profile-email{font-size:.8rem;color:#5A5A72;margin-top:2px;word-break:break-all;}' +
    '.gm-profile-menu a,.gm-profile-menu button{display:flex;align-items:center;width:100%;text-align:left;' +
    'padding:9px 12px;border-radius:10px;background:none;border:none;font-family:inherit;font-size:.88rem;' +
    'font-weight:600;color:#1A1A2E;cursor:pointer;text-decoration:none;}' +
    '.gm-profile-menu a:hover,.gm-profile-menu button:hover{background:#F1F5F9;}';

  function ensureProfileMenuStyle() {
    if (document.getElementById('gm-profile-menu-style')) return;
    var style = document.createElement('style');
    style.id = 'gm-profile-menu-style';
    style.textContent = PROFILE_MENU_STYLE;
    document.head.appendChild(style);
  }

  /**
   * Turn the page's avatar element into the Profile menu: initials, identity
   * glance (name + email), a link to profile.html, and Log out. Idempotent —
   * safe to re-mount after a Profile change to refresh the glance.
   * options: { avatar: HTMLElement or selector }
   * Returns true if mounted.
   */
  function mountProfileMenu(options) {
    options = options || {};
    var avatar = options.avatar;
    if (typeof avatar === 'string') avatar = document.querySelector(avatar);
    if (!avatar) return false;
    var user = getUser();
    if (!user) return false;

    ensureProfileMenuStyle();

    var first = (user.firstName || user.name || 'U').toString().trim();
    var last = (user.lastName || '').toString().trim();
    var initials = first.charAt(0).toUpperCase() +
      (last ? last.charAt(0).toUpperCase() : '');
    avatar.textContent = initials || 'U';
    avatar.setAttribute('role', 'button');
    avatar.setAttribute('aria-label', 'Open profile menu');
    avatar.setAttribute('aria-haspopup', 'menu');
    avatar.tabIndex = 0;

    var wrap = avatar.closest('.gm-profile-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'gm-profile-wrap';
      avatar.parentNode.insertBefore(wrap, avatar);
      wrap.appendChild(avatar);
    }

    var existing = wrap.querySelector('.gm-profile-menu');
    if (existing) existing.remove();
    var menu = document.createElement('div');
    menu.className = 'gm-profile-menu';
    menu.setAttribute('role', 'menu');

    var head = document.createElement('div');
    head.className = 'gm-profile-menu-head';
    var nameEl = document.createElement('div');
    nameEl.className = 'gm-profile-name';
    nameEl.textContent = (first + ' ' + last).trim() || user.email;
    var emailEl = document.createElement('div');
    emailEl.className = 'gm-profile-email';
    emailEl.textContent = user.email || '';
    head.appendChild(nameEl);
    head.appendChild(emailEl);

    var profileLink = document.createElement('a');
    profileLink.href = 'profile.html';
    profileLink.textContent = 'Profile & preferences';

    var logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.textContent = 'Log out';
    logoutBtn.addEventListener('click', function () {
      logout('index.html');
    });

    menu.appendChild(head);
    menu.appendChild(profileLink);
    menu.appendChild(logoutBtn);
    wrap.appendChild(menu);

    function closeMenu() {
      menu.classList.remove('open');
      document.removeEventListener('click', onDocumentClick, true);
    }
    function onDocumentClick(event) {
      if (!wrap.contains(event.target)) closeMenu();
    }
    avatar.addEventListener('click', function (event) {
      event.stopPropagation();
      if (menu.classList.contains('open')) {
        closeMenu();
      } else {
        menu.classList.add('open');
        document.addEventListener('click', onDocumentClick, true);
      }
    });
    avatar.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenu();
    });

    return true;
  }

  function syncFirebaseProfile(user, extra) {
    if (!user || !user.uid) return Promise.resolve(false);
    return import('./firebase-data-store.js')
      .then(({ saveLearnerProfile }) => saveLearnerProfile({ ...user, ...(extra || {}) }))
      .then(() => true)
      .catch((error) => {
        console.warn('[Firebase] Profile sync skipped.', error);
        return false;
      });
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------
  function getUser() {
    try {
      // Authentication state is session-scoped. Do not resurrect a previous
      // browser-run from persistent localStorage.
      var raw = safeSessionGet(STORAGE_KEY);
      if (!raw) return null;
      var user = JSON.parse(raw);
      return user && typeof user === 'object' ? user : null;
    } catch (e) {
      return null;
    }
  }

  function isAuthenticated() {
    return !!getUser();
  }

  // Hides the page immediately. Only call this on protected pages, and
  // only as the very first thing in <head>.
  function lockPage() {
    document.documentElement.classList.add('gm-auth-checking');

    var hideStyle = document.createElement('style');
    hideStyle.id = 'gm-auth-hide-style';
    hideStyle.textContent =
      'html.gm-auth-checking body { visibility: hidden !important; }';

    document.head.appendChild(hideStyle);

    // Failsafe: never leave the Learner on a permanent blank page
    // (e.g. module load error on file:// or a JS exception before reveal)
    setTimeout(function () {
      if (document.documentElement.classList.contains('gm-auth-checking')) {
        console.warn('[GapMapAuth] Auth lock timeout — revealing page. Check the console for script errors.');
        reveal();
      }
    }, 3000);
  }

  function reveal() {
    document.documentElement.classList.remove('gm-auth-checking');
  }

  function goToLogin(message) {
    try {
      safeSessionSet(REDIRECT_MESSAGE_KEY, message || DEFAULT_MESSAGE);
    } catch (e) {}
    // Always reveal before navigating — otherwise a failed redirect leaves a blank page
    try { reveal(); } catch (e) {}
    window.location.replace('login.html');
  }

  function requireAuth(options) {
    options = options || {};

    var requireSetupComplete = options.requireSetupComplete !== false;
    var user = getUser();

    // No logged-in user.
    if (!user) {
      goToLogin(DEFAULT_MESSAGE);
      return null;
    }

    // Protected pages require setup to be completed.
    if (requireSetupComplete && !user.setupComplete) {
      try { reveal(); } catch (e) {}
      window.location.replace('setup.html');
      return null;
    }

    // Optional redirect for pages such as setup.html.
    if (options.redirectIfSetupComplete && user.setupComplete) {
      window.location.replace(options.redirectIfSetupComplete);
      return null;
    }

    // Access is allowed.
    reveal();
    return user;
  }

  /**
   * Single source of truth for "where should this Learner go next":
   *   not logged in       -> login.html
   *   setup not complete  -> setup.html
   *   otherwise           -> dashboard.html
   *
   * (Billing / subscription.html gate has been removed.)
   */
  function nextOnboardingStep(userArg) {
    var user = userArg || getUser();
    if (!user) return 'login.html';
    if (!user.setupComplete) return 'setup.html';
    return 'dashboard.html';
  }

  function logout(redirectTo) {
    // Remove both the current session snapshot and any legacy persistent
    // snapshot left by older GapMap builds.
    safeSessionRemove(STORAGE_KEY);
    safeRemove(STORAGE_KEY);
    import('./firebase-auth.js').then(({ signOutFirebase }) => signOutFirebase()).catch(() => {});
    window.location.href = redirectTo || 'index.html';
  }

  function clearLegacyPersistentSession() {
    // One-time migration helper used by the landing page. Older builds stored
    // the account snapshot in localStorage, which could make a fresh launch
    // appear to have a Learner already signed in.
    safeRemove(STORAGE_KEY);
    safeSessionRemove(STORAGE_KEY);
    return true;
  }

  function consumeRedirectMessage() {
    try {
      var msg = safeSessionGet(REDIRECT_MESSAGE_KEY);
      if (msg) safeSessionRemove(REDIRECT_MESSAGE_KEY);
      return msg;
    } catch (e) {
      return null;
    }
  }

  function updateNav(options) {
    var user = getUser();
    if (!user) return;

    options = options || {};

    var loginLink = document.querySelector('[data-nav="login"]');
    var signupLink = document.querySelector('[data-nav="signup"]');
    var dashboardLink = document.querySelector('[data-nav="dashboard"]');
    var learnLink = document.querySelector('[data-nav="learn"]');

    if (loginLink) loginLink.style.display = 'none';
    if (signupLink) signupLink.style.display = 'none';

    if (dashboardLink) {
      dashboardLink.href = user.setupComplete ? 'dashboard.html' : 'setup.html';
      dashboardLink.style.display = '';
    }

    if (learnLink) {
      learnLink.style.display = user.setupComplete ? '' : 'none';
    }

    // Log out lives behind the avatar (mountProfileMenu) and on profile.html,
    // not in the navs.

    if (!options.keepMarketingLinks) {
      var marketingLinks = document.querySelectorAll('[data-nav-marketing]');
      marketingLinks.forEach(function (el) {
        el.style.display = 'none';
      });
    }
  }

  // Expose safe helpers so login/signup pages can use the same storage layer
  window.GapMapAuth = {
    getUser: getUser,
    isAuthenticated: isAuthenticated,
    lockPage: lockPage,
    requireAuth: requireAuth,
    reveal: reveal,
    logout: logout,
    clearLegacyPersistentSession: clearLegacyPersistentSession,
    consumeRedirectMessage: consumeRedirectMessage,
    updateNav: updateNav,
    // Billing helpers kept as no-ops (subscription gate removed)
    TRIAL_LENGTH_DAYS: TRIAL_LENGTH_DAYS,
    getBillingStatus: getBillingStatus,
    startTrial: startTrial,
    activateSubscription: activateSubscription,
    cancelSubscription: cancelSubscription,
    nextOnboardingStep: nextOnboardingStep,
    // Learner preferences: the switchers (nav) read + mutate these
    LANGUAGES: ['English', 'Afrikaans'],
    EXPLANATION_LEVELS: ['Simple', 'Standard', 'Detailed'],
    mountProfileMenu: mountProfileMenu,
    // storage helpers for login / signup pages
    safeGet: safeGet,
    safeSet: safeSet,
    safeRemove: safeRemove,
    safeSessionGet: safeSessionGet,
    safeSessionSet: safeSessionSet,
    safeSessionRemove: safeSessionRemove,
    /**
     * Mint a new learner id for a Learner Profile. Called once, at signup: the
     * id is stored on the Profile (`uid`) and is the key the Learner store
     * joins the Learner's data by (frontend/js/learner-store.js). Profiles
     * created before minting carry no uid and fall back to the email hash.
     */
    mintLearnerId: function () {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return 'learner-' + window.crypto.randomUUID();
      }
      return 'learner-' + Date.now().toString(36) + '-' +
        Math.random().toString(36).slice(2, 8);
    },

    // ------------------------------------------------------------------
    // Multi-Subject helpers
    // Each Subject has its own isolated dashboard data (Gap Map, etc.).
    // user.subject is the currently active Subject.
    // ------------------------------------------------------------------
    SUBJECTS_BY_GRADE: {
      "10": ["Mathematics", "Physical Sciences", "English Home Language", "Life Sciences", "Agricultural Sciences"],
      "11": ["Mathematics", "Physical Sciences", "English Home Language", "Life Sciences", "Agricultural Sciences"],
      "12": ["Mathematics", "Physical Sciences", "English Home Language", "Life Sciences", "Agricultural Sciences"]
    },

    normalizeSubject: function (subject) {
      if (!subject) return "";
      var s = String(subject).trim();
      // Strip leading "Grade XX " if present (legacy)
      s = s.replace(/^Grade\s*\d+\s*/i, "").trim();
      return s;
    },

    /**
     * The Learner-scoped namespace for presentation-level data (per-Subject
     * Gap Maps, practice results, history): the minted uid when present, else
     * the stable email hash (mirroring learner-store's demo fallback, so
     * pre-mint profiles land on the same scope). Every such key must go
     * through this — data is never shared across Learners on one browser.
     */
    learnerScope: function () {
      var user = getUser();
      if (!user) return null;
      if (user.uid || user.id) return user.uid || user.id;
      if (user.email) {
        var hash = 2166136261;
        var value = String(user.email).toLowerCase();
        for (var index = 0; index < value.length; index += 1) {
          hash ^= value.charCodeAt(index);
          hash = Math.imul(hash, 16777619);
        }
        return "demo-" + (hash >>> 0).toString(36);
      }
      return null;
    },

    diagnosticKey: function (subject) {
      var norm = this.normalizeSubject(subject);
      var scope = this.learnerScope() || "guest";
      if (!norm) return "gapmap_diagnostic:" + scope;
      // Stable key: Learner scope + lowercase, spaces → hyphens
      var keyPart = norm.toLowerCase().replace(/\s+/g, "-");
      return "gapmap_diagnostic:" + scope + ":" + keyPart;
    },

    getActiveSubject: function () {
      var user = getUser();
      return user && user.subject ? this.normalizeSubject(user.subject) : null;
    },

    /**
     * Switch the active Subject and persist it.
     * Does not navigate away — caller should re-render.
     */
    setActiveSubject: function (subject) {
      var user = getUser();
      if (!user) return null;
      var norm = this.normalizeSubject(subject);
      if (!norm) return user;

      user.subject = norm;

      // Keep a list of subjects the Learner has used
      if (!Array.isArray(user.subjects)) user.subjects = [];
      if (user.subjects.indexOf(norm) === -1) {
        user.subjects.push(norm);
      }

      safeSessionSet(STORAGE_KEY, JSON.stringify(user));

      syncFirebaseProfile(user);

      return user;
    },

    /**
     * The Learner's active Explanation Level (defaults to Standard) — read by
     * the Companion when it builds its context. Values match the artefact
     * schema's explanation_level enum and Setup's labels.
     */
    getActiveExplanationLevel: function () {
      var user = getUser();
      return (user && user.explanationLevel) || DEFAULT_EXPLANATION_LEVEL;
    },

    /**
     * Switch the active Explanation Level and persist it in the session and sync it to Firestore.
     * Does not navigate away — caller should re-render or reload.
     */
    setActiveExplanationLevel: function (level) {
      var user = getUser();
      if (!user) return null;
      var next = level ? String(level).trim() : '';
      if (!next) return user;

      user.explanationLevel = next;

      safeSessionSet(STORAGE_KEY, JSON.stringify(user));

      syncFirebaseProfile(user);

      return user;
    },

    /**
     * The Learner's active Language (defaults to English until Setup or a
     * switch sets it) — read by the Companion when it builds its context.
     */
    getActiveLanguage: function () {
      var user = getUser();
      return (user && user.language) || DEFAULT_LANGUAGE;
    },

    /**
     * Switch the active Language and persist it in the session and sync it to Firestore.
     * Does not navigate away — caller should re-render or reload.
     */
    setActiveLanguage: function (language) {
      var user = getUser();
      if (!user) return null;
      var next = language ? String(language).trim() : '';
      if (!next) return user;

      user.language = next;

      safeSessionSet(STORAGE_KEY, JSON.stringify(user));

      syncFirebaseProfile(user);

      return user;
    },

    /**
     * Load diagnostic results for a specific Subject.
     * Falls back to the legacy global key for backward compatibility.
     */
    loadDiagnosticResults: function (subject) {
      // Read only this Learner's scoped key. Legacy unscoped keys from before
      // Learner scoping are deliberately NOT adopted: on a shared browser they
      // belong to whoever signed in last, which is exactly the leak this
      // scoping closes.
      var key = this.diagnosticKey(subject);
      var raw = safeGet(key);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    },

    /**
     * Save diagnostic results for a specific Subject — under this Learner's
     * scope only.
     */
    saveDiagnosticResults: function (subject, results) {
      var key = this.diagnosticKey(subject);
      var payload = results || {};
      // Always stamp the subject on the payload for clarity
      payload.subject = this.normalizeSubject(subject);
      safeSet(key, JSON.stringify(payload));
    },

    /**
     * Mount a Subject switcher dropdown into a container element.
     * options: {
     *   container: HTMLElement or selector,
     *   onChange: function(newSubject) — called after subject is set (page should re-render or reload)
     * }
     * Returns true if mounted.
     */
    mountSubjectSwitcher: function (options) {
      options = options || {};
      var user = getUser();
      if (!user) return false;

      var self = this;
      var active = this.getActiveSubject() || this.normalizeSubject(user.subject) || '';
      var grade = user.grade || '12';
      var list = (this.SUBJECTS_BY_GRADE[String(grade)] || []).slice();
      if (active && list.indexOf(active) === -1) list.unshift(active);

      return mountPicker({
        container: options.container,
        values: list,
        active: active,
        ariaLabel: 'Switch subject',
        isActive: function (value) { return value === self.getActiveSubject(); },
        onSelect: function (next) {
          self.setActiveSubject(next);
          if (typeof options.onChange === 'function') {
            options.onChange(next);
          } else {
            // Default: soft reload so every page picks up the new subject
            window.location.reload();
          }
        },
      });
    },

    /**
     * Mount a Language switcher dropdown into a container element.
     * options: {
     *   container: HTMLElement or selector,
     *   onChange: function(nextLanguage) — called after the Language is set
     * }
     * Returns true if mounted.
     */
    mountLanguageSwitcher: function (options) {
      options = options || {};
      var user = getUser();
      if (!user) return false;

      var self = this;
      return mountPicker({
        container: options.container,
        values: this.LANGUAGES.slice(),
        active: this.getActiveLanguage(),
        ariaLabel: 'Switch language',
        isActive: function (value) { return value === self.getActiveLanguage(); },
        onSelect: function (next) {
          self.setActiveLanguage(next);
          if (typeof options.onChange === 'function') {
            options.onChange(next);
          } else {
            // Default: soft reload so every page — and the Companion's next
            // turn — picks up the new Language
            window.location.reload();
          }
        },
      });
    },

    /**
     * Mount an Explanation Level switcher dropdown into a container element.
     * options: {
     *   container: HTMLElement or selector,
     *   onChange: function(nextLevel) — called after the level is set
     * }
     * Returns true if mounted.
     */
    mountExplanationLevelSwitcher: function (options) {
      options = options || {};
      var user = getUser();
      if (!user) return false;

      var self = this;
      return mountPicker({
        container: options.container,
        values: this.EXPLANATION_LEVELS.slice(),
        active: this.getActiveExplanationLevel(),
        ariaLabel: 'Switch explanation level',
        isActive: function (value) { return value === self.getActiveExplanationLevel(); },
        onSelect: function (next) {
          self.setActiveExplanationLevel(next);
          if (typeof options.onChange === 'function') {
            options.onChange(next);
          } else {
            // Default: soft reload so every page — and the Companion's next
            // turn — picks up the new Explanation Level
            window.location.reload();
          }
        },
      });
    },

    /**
     * Simple keyword map: Concept name (or fragment) → recommended YouTube video ids.
     * Used by concept pages and Gap Map cards.
     */
    getVideosForConcept: function (conceptName, subject) {
      var name = (conceptName || '').toLowerCase();
      var subj = this.normalizeSubject(subject || this.getActiveSubject() || '');
      var all = [
        // Mathematics (Kevin)
        { concepts: ['limit', 'limits'], youtubeId: '4VUWIiudCk0', title: 'Limits – Calculus Grade 12', channel: 'Kevinmathscience', subject: 'Mathematics' },
        { concepts: ['first principle', 'first principles', 'derivative from first'], youtubeId: 'alUkVWVEP10', title: 'First Principles – Calculus', channel: 'Kevinmathscience', subject: 'Mathematics' },
        { concepts: ['tangent'], youtubeId: '45abKQwiCt8', title: 'Equation of the Tangent', channel: 'Kevinmathscience', subject: 'Mathematics' },
        { concepts: ['reduction', 'reduction formula'], youtubeId: 'XXwMYNorbaI', title: 'Reduction Formulae – Trig', channel: 'Kevinmathscience', subject: 'Mathematics' },
        { concepts: ['general solution'], youtubeId: 'UAaf14YizQw', title: 'General Solution – Trig', channel: 'Kevinmathscience', subject: 'Mathematics' },
        { concepts: ['trig graph', 'trig function', 'trigonometry'], youtubeId: 'h5gaH8pcMTU', title: 'Trig Functions – Equation', channel: 'Kevinmathscience', subject: 'Mathematics' },
        { concepts: ['calculus', 'differentiate', 'differentiation'], youtubeId: '3t3fL1DQgg4', title: 'Calculus Exam Question', channel: 'Kevinmathscience', subject: 'Mathematics' },
        { concepts: ['factoris', 'factorization', 'factorisation'], youtubeId: 'alUkVWVEP10', title: 'Algebra foundations (related)', channel: 'Kevinmathscience', subject: 'Mathematics' },
        // Physical Sciences (Mlungisi)
        { concepts: ['work', 'energy', 'power'], youtubeId: 'BjhxVy1iCjQ', title: 'Work, Energy & Power – Part 1', channel: 'Mlungisi Nkosi', subject: 'Physical Sciences' },
        { concepts: ['conservation of energy', 'mechanical energy'], youtubeId: 'UHRuQ0U3kJI', title: 'Conservation of Mechanical Energy', channel: 'Mlungisi Nkosi', subject: 'Physical Sciences' },
        { concepts: ['momentum', 'impulse'], youtubeId: 'QAURZq43508', title: 'Momentum – Conservation', channel: 'Mlungisi Nkosi', subject: 'Physical Sciences' },
        { concepts: ['projectile', 'vertical projectile'], youtubeId: 'H-LunHFDJPs', title: 'Vertical Projectile Motion', channel: 'Mlungisi Nkosi', subject: 'Physical Sciences' },
        { concepts: ['newton', "newton's law", 'newtons law'], youtubeId: '1dhibgYUE00', title: "Newton's Laws – Exam Q", channel: 'Mlungisi Nkosi', subject: 'Physical Sciences' },
        { concepts: ['organic', 'organic chemistry'], youtubeId: 'qKkf6HLjpMw', title: 'Organic Chemistry Exam Q', channel: 'Mlungisi Nkosi', subject: 'Physical Sciences' },
        { concepts: ['equilibrium', 'kc', 'chemical equilibrium'], youtubeId: 'yGyGi5xTyvY', title: 'Chemical Equilibrium – Kc', channel: 'Mlungisi Nkosi', subject: 'Physical Sciences' }
      ];

      var matches = all.filter(function (v) {
        if (subj && v.subject !== subj) return false;
        return v.concepts.some(function (kw) { return name.indexOf(kw) !== -1; });
      });
      return matches.slice(0, 3); // max 3 recommendations
    }
  };
})();