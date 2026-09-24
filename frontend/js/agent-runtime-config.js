export const FIREBASE_SDK_VERSION = '12.17.1';

export const agentFirebaseConfig = Object.freeze({
  apiKey: 'AIzaSyBEtanaqIJb_5UQNcwaXBrRQmRltZETEq4',
  authDomain: 'gapmap-63650.firebaseapp.com',
  projectId: 'gapmap-63650',
  storageBucket: 'gapmap-63650.firebasestorage.app',
  messagingSenderId: '838924418460',
  appId: '1:838924418460:web:209aa61f53c93294461c59',
  measurementId: 'G-0Q4NB2QB71',
});

export const AGENT_MODEL_NAMES = Object.freeze([
  'gemini-3.5-flash-lite'
]);

export const agentProjectNumber = agentFirebaseConfig.appId.split(':')[1];
