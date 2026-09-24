// Shared Firebase Web SDK bootstrap for Authentication + Cloud Firestore.
// The project uses plain HTML/JS rather than a bundler, so the official CDN
// ESM modules are loaded directly in the browser.

export const FIREBASE_SDK_VERSION = '12.17.1';

export const firebaseConfig = Object.freeze({
  apiKey: 'AIzaSyCjVyUKI-t-SyCBcY4_wWGApoWdq1mScIs',
  authDomain: 'gapmap-6cb1d.firebaseapp.com',
  projectId: 'gapmap-6cb1d',
  storageBucket: 'gapmap-6cb1d.firebasestorage.app',
  messagingSenderId: '397957406254',
  appId: '1:397957406254:web:5d0defd78543ecd6d289bf',
});

let servicesPromise = null;

export function getFirebaseServices() {
  if (servicesPromise) return servicesPromise;

  servicesPromise = Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`),
  ]).then(async ([appSdk, authSdk, firestoreSdk]) => {
    const existingApp = globalThis.__gapmapFirebaseApp;
    const app = existingApp || appSdk.initializeApp(firebaseConfig, 'gapmap-data');
    const auth = globalThis.__gapmapFirebaseAuth || authSdk.getAuth(app);
    const db = globalThis.__gapmapFirebaseDb || firestoreSdk.getFirestore(app);

    // Authentication is intentionally session-scoped: closing the app/tab
    // requires the Learner to sign in again rather than inheriting an older
    // persisted Firebase account.
    if (typeof authSdk.setPersistence === 'function' && authSdk.browserSessionPersistence) {
      try {
        await authSdk.setPersistence(auth, authSdk.browserSessionPersistence);
      } catch (error) {
        console.warn('[Firebase Auth] Could not apply session persistence.', error);
      }
    }

    const services = {
      app,
      auth,
      db,
      firebase: {
        ...appSdk,
        ...authSdk,
        ...firestoreSdk,
      },
    };

    globalThis.__gapmapFirebaseApp = app;
    globalThis.__gapmapFirebaseAuth = auth;
    globalThis.__gapmapFirebaseDb = db;
    globalThis.gapmapFirebase = services;
    globalThis.auth = auth;
    globalThis.getCurrentUser = () => auth.currentUser;

    return services;
  });

  return servicesPromise;
}

export async function getFirebaseAuth() {
  return (await getFirebaseServices()).auth;
}

export async function getFirestoreDb() {
  return (await getFirebaseServices()).db;
}
