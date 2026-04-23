// ==============================
// MONVY — FIREBASE INTEGRATION
// v12.12.1 | tag <script> mode
// ==============================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc,
  collection, addDoc, getDocs, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD_xar1S5zCb5WEg814btkj4vwwcGGmQt4",
  authDomain: "monvy-5969f.firebaseapp.com",
  projectId: "monvy-5969f",
  storageBucket: "monvy-5969f.firebasestorage.app",
  messagingSenderId: "373157570069",
  appId: "1:373157570069:web:debf59f8352d181ffc901c"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// ── Auth ──────────────────────────────────────────────────────

export async function loginComGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  await _garantirPerfil(result.user);
  return result.user;
}

export async function loginComEmail(email, senha) {
  const result = await signInWithEmailAndPassword(auth, email, senha);
  return result.user;
}

export async function cadastrarComEmail(nome, email, senha) {
  const result = await createUserWithEmailAndPassword(auth, email, senha);
  await updateProfile(result.user, { displayName: nome });
  await _garantirPerfil(result.user, nome);
  return result.user;
}

export async function enviarResetSenha(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function fazerLogout() {
  await signOut(auth);
}

export function onAuth(cb) { return onAuthStateChanged(auth, cb); }
export function usuarioAtual() { return auth.currentUser; }

async function _garantirPerfil(user, nomeOverride) {
  const ref  = doc(db, 'usuarios', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      nome: nomeOverride || user.displayName || 'Usuário',
      email: user.email,
      foto: user.photoURL || null,
      criadoEm: serverTimestamp(),
      onboardingDone: false,
      perfilVida: {}
    });
  }
}

// ── Perfil ────────────────────────────────────────────────────

export async function getPerfil(uid) {
  const snap = await getDoc(doc(db, 'usuarios', uid));
  return snap.exists() ? snap.data() : {};
}

export async function salvarPerfil(uid, dados) {
  await updateDoc(doc(db, 'usuarios', uid), dados);
}

export async function salvarPerfilVida(uid, perfil) {
  await updateDoc(doc(db, 'usuarios', uid), { perfilVida: perfil });
}

export async function marcarOnboardingFeito(uid) {
  await updateDoc(doc(db, 'usuarios', uid), { onboardingDone: true });
}

// ── Movimentações ─────────────────────────────────────────────

export async function getMovimentacoes(uid) {
  const q    = query(collection(db, 'usuarios', uid, 'movimentacoes'), orderBy('criadoEm', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function adicionarMovimentacao(uid, mov) {
  const ref = await addDoc(collection(db, 'usuarios', uid, 'movimentacoes'), {
    ...mov, criadoEm: serverTimestamp()
  });
  return ref.id;
}

export async function deletarMovimentacao(uid, id) {
  await deleteDoc(doc(db, 'usuarios', uid, 'movimentacoes', id));
}

export function ouvirMovimentacoes(uid, callback) {
  const q = query(collection(db, 'usuarios', uid, 'movimentacoes'), orderBy('criadoEm', 'desc'));
  return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// ── Metas ─────────────────────────────────────────────────────

export async function getMetas(uid) {
  const snap = await getDocs(collection(db, 'usuarios', uid, 'metas'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function adicionarMeta(uid, meta) {
  const ref = await addDoc(collection(db, 'usuarios', uid, 'metas'), {
    ...meta, criadoEm: serverTimestamp()
  });
  return ref.id;
}

export async function atualizarMeta(uid, id, dados) {
  await updateDoc(doc(db, 'usuarios', uid, 'metas', id), dados);
}

export async function deletarMeta(uid, id) {
  await deleteDoc(doc(db, 'usuarios', uid, 'metas', id));
}

// ── Dívidas ───────────────────────────────────────────────────

export async function getDividas(uid) {
  const snap = await getDocs(collection(db, 'usuarios', uid, 'dividas'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function adicionarDivida(uid, divida) {
  const ref = await addDoc(collection(db, 'usuarios', uid, 'dividas'), {
    ...divida, criadoEm: serverTimestamp()
  });
  return ref.id;
}

export async function atualizarDivida(uid, id, dados) {
  await updateDoc(doc(db, 'usuarios', uid, 'dividas', id), dados);
}

export async function deletarDivida(uid, id) {
  await deleteDoc(doc(db, 'usuarios', uid, 'dividas', id));
}

export { auth, db };
