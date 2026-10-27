// SisCautela EsFO — versão 0.1: login, primeiro acesso e ativação.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'pt-BR';
const db = getFirestore(app);

// ---------- utilidades de tela ----------
const $ = (sel) => document.querySelector(sel);

function mostrar(idTela) {
  document.querySelectorAll('.tela').forEach((t) => t.classList.toggle('ativa', t.id === idTela));
  window.scrollTo(0, 0);
}

let timerMsg;
function mensagem(texto, erro = false) {
  const el = $('#mensagem');
  el.textContent = texto;
  el.classList.toggle('erro', erro);
  el.hidden = false;
  clearTimeout(timerMsg);
  timerMsg = setTimeout(() => { el.hidden = true; }, 6000);
}

function travar(form, travado) {
  form.querySelectorAll('button, input').forEach((el) => { el.disabled = travado; });
}

const normalizarEmail = (e) => String(e || '').trim().toLowerCase();
const somenteDigitos = (n) => String(n || '').replace(/\D/g, '');

function traduzirErro(err) {
  const c = err?.code || '';
  const mapa = {
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/email-already-in-use': 'Já existe acesso com esse e-mail. Use "Entrar" ou "Esqueci a senha".',
    'auth/weak-password': 'Senha fraca. Use pelo menos 8 caracteres.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    'auth/network-request-failed': 'Sem conexão com a internet.',
    'permission-denied': 'Acesso negado pelo sistema.',
    'unavailable': 'Sem conexão com o servidor. Tente novamente.'
  };
  return mapa[c] || 'Não foi possível concluir. Tente novamente.';
}

// ---------- navegação por botões ----------
document.addEventListener('click', (e) => {
  const ir = e.target.closest('[data-ir]');
  if (ir) mostrar(ir.dataset.ir);
  const acao = e.target.closest('[data-acao="sair"]');
  if (acao) signOut(auth);
});

// ---------- roteamento conforme a situação do usuário ----------
let preCadastroAtual = null;

async function rotear(user) {
  preCadastroAtual = null;
  if (!user) return mostrar('tela-login');

  if (!user.emailVerified) {
    $('#email-verificar').textContent = user.email;
    return mostrar('tela-verificar');
  }

  try {
    const usuario = await getDoc(doc(db, 'usuarios', user.uid));
    if (usuario.exists()) {
      const u = usuario.data();
      if (u.situacao !== 'ativo') {
        $('#msg-sem-acesso').textContent = 'Seu acesso está desativado. Procure o gestor da frota.';
        return mostrar('tela-sem-acesso');
      }
      $('#saudacao').textContent = `Olá, ${u.nomeGuerra}`;
      $('#info-usuario').textContent = `${u.curso} · ${u.turma} · nº ${u.numero} · perfil: ${u.perfil}`;
      return mostrar('tela-inicio');
    }

    const pre = await getDoc(doc(db, 'precadastro', normalizarEmail(user.email)));
    if (!pre.exists() || pre.data().situacao !== 'pendente') {
      $('#msg-sem-acesso').textContent =
        'Este e-mail não consta do pré-cadastro, ou o acesso já foi ativado em outra conta. ' +
        'Procure o gestor da frota e confira o e-mail informado.';
      return mostrar('tela-sem-acesso');
    }
    preCadastroAtual = pre.data();
    return mostrar('tela-ativar');
  } catch (err) {
    console.error(err);
    mensagem(traduzirErro(err), true);
    $('#msg-sem-acesso').textContent = 'Não foi possível verificar seu acesso agora.';
    return mostrar('tela-sem-acesso');
  }
}

onAuthStateChanged(auth, rotear);

// ---------- login ----------
$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const email = normalizarEmail(f.email.value);
  const senha = f.senha.value;
  if (!email || !senha) return mensagem('Preencha e-mail e senha.', true);
  travar(f, true);
  try {
    await signInWithEmailAndPassword(auth, email, senha);
    f.reset();
  } catch (err) {
    mensagem(traduzirErro(err), true);
  } finally {
    travar(f, false);
  }
});

// ---------- primeiro acesso ----------
$('#form-primeiro-acesso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const email = normalizarEmail(f.email.value);
  if (!email) return mensagem('Informe o e-mail.', true);
  if (f.senha.value.length < 8) return mensagem('A senha precisa ter pelo menos 8 caracteres.', true);
  if (f.senha.value !== f.senha2.value) return mensagem('As senhas não conferem.', true);
  travar(f, true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, f.senha.value);
    await sendEmailVerification(cred.user);
    f.reset();
    mensagem('Link de confirmação enviado para o seu e-mail.');
  } catch (err) {
    mensagem(traduzirErro(err), true);
  } finally {
    travar(f, false);
  }
});

// ---------- esqueci a senha ----------
$('#form-esqueci').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const email = normalizarEmail(f.email.value);
  if (!email) return mensagem('Informe o e-mail.', true);
  travar(f, true);
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    if (err?.code === 'auth/invalid-email') { travar(f, false); return mensagem(traduzirErro(err), true); }
    // Para não revelar quais e-mails têm acesso, a resposta é sempre a mesma.
  }
  travar(f, false);
  f.reset();
  mensagem('Se houver acesso com esse e-mail, o link foi enviado.');
  mostrar('tela-login');
});

// ---------- verificação de e-mail ----------
$('#btn-ja-confirmei').addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return mostrar('tela-login');
  await user.reload();
  if (!user.emailVerified) return mensagem('O e-mail ainda não foi confirmado. Abra o link recebido.', true);
  await user.getIdToken(true); // atualiza o token para o banco reconhecer o e-mail confirmado
  rotear(user);
});

$('#btn-reenviar').addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return mostrar('tela-login');
  try {
    await sendEmailVerification(user);
    mensagem('E-mail reenviado.');
  } catch (err) {
    mensagem(traduzirErro(err), true);
  }
});

// ---------- ativação ----------
$('#form-ativar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const user = auth.currentUser;
  const pre = preCadastroAtual;
  if (!user || !pre) return rotear(user);

  if (somenteDigitos(f.numero.value) !== somenteDigitos(pre.numero)) {
    return mensagem('Número funcional não confere com o pré-cadastro.', true);
  }

  travar(f, true);
  try {
    const email = normalizarEmail(user.email);
    const lote = writeBatch(db);
    lote.set(doc(db, 'usuarios', user.uid), {
      numero: pre.numero,
      nomeGuerra: pre.nomeGuerra,
      curso: pre.curso,
      turma: pre.turma,
      perfil: pre.perfil,
      email,
      situacao: 'ativo',
      ativadoEm: serverTimestamp()
    });
    lote.update(doc(db, 'precadastro', email), {
      situacao: 'ativado',
      uid: user.uid,
      ativadoEm: serverTimestamp()
    });
    await lote.commit();
    f.reset();
    mensagem('Acesso ativado.');
    await rotear(user);
  } catch (err) {
    console.error(err);
    mensagem(traduzirErro(err), true);
  } finally {
    travar(f, false);
  }
});

// ---------- PWA ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
