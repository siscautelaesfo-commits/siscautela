// Claviculário virtual: faz o papel do ESP32 para testar o app antes do hardware.
// Segue o mesmo contrato e os mesmos tempos do firmware (documento "Claviculário Eletrônico – Projeto Opção B").
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {
  getAuth, setPersistence, browserSessionPersistence, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {
  getDatabase, ref, onValue, update, push, set, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const DISPOSITIVO = 'esfo01';
const BASE = `claviculario/${DISPOSITIVO}`;
const VALIDADE_CMD_MS = 60000;
const JANELA_ABRIR_MS = 10000;
const LIMITE_ABERTA_MS = 30000;
const HEARTBEAT_MS = 60000;
const SEGURAR_EMERGENCIA_MS = 1000;   // o botão de emergência precisa ficar apertado 1 s (evita esbarrão)

// App separado ("claviculario"): o login fica guardado à parte do login do SisCautela
const app = initializeApp(firebaseConfig, 'claviculario');
const auth = getAuth(app);
const db = getDatabase(app);
await setPersistence(auth, browserSessionPersistence);

const $ = (s) => document.querySelector(s);
let desvio = 0;
let conectado = false;
const agora = () => Date.now() + desvio;

// Estado igual ao do firmware
let portaAberta = false, alertaAtivo = false, aberturaAutorizada = false, sessaoAutorizada = false;
let liberadaEm = 0, abertaDesde = 0, uidAtual = '', cautelaAtual = '', tipoAtual = '';
let timers = [];
let pararComando = null;
onValue(ref(db, '.info/serverTimeOffset'), (s) => { desvio = s.val() || 0; });
onValue(ref(db, '.info/connected'), (s) => { conectado = s.val() === true; desenhar(); });

const hhmmss = () => new Date().toLocaleTimeString('pt-BR');
function log(txt) {
  const el = document.createElement('div');
  el.textContent = `${hhmmss()}  ${txt}`;
  $('#cv-log').prepend(el);
}

/* ---------- som (buzzer ativo) ---------- */
let ac = null;
function bipes(n, longo = false) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < n; i++) {
      const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime + i * 0.2;
      o.type = 'square'; o.frequency.value = 2700; g.gain.value = 0.04;
      o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + (longo ? 0.35 : 0.09));
    }
  } catch { /* sem áudio */ }
}
let alarme = null;
function alarmeTocar(ligar) {
  clearInterval(alarme); alarme = null;
  if (ligar) alarme = setInterval(() => bipes(1, true), 1000);
}

/* ---------- Firebase (mesmas gravações do ESP32) ---------- */
function registrarEvento(tipo) {
  push(ref(db, `${BASE}/eventos`), { tipo, uid: uidAtual, cautelaId: cautelaAtual, ts: serverTimestamp() })
    .catch((e) => log('Erro ao gravar evento: ' + (e.code || e.message)));
  log('evento: ' + tipo);
}
function atualizarStatus(extra = {}) {
  return update(ref(db, `${BASE}/status`), { porta: portaAberta ? 'aberta' : 'fechada', alerta: alertaAtivo, ultimoSinal: serverTimestamp(), ...extra })
    .catch((e) => log('Erro ao gravar status: ' + (e.code || e.message)));
}

function processarComando(c) {
  if (!c?.id) return;
  const ultimo = localStorage.getItem('clav-virtual-ultimoId');
  if (c.id === ultimo) return;                       // já executado
  localStorage.setItem('clav-virtual-ultimoId', c.id);
  const idade = agora() - Number(c.criadoEm || 0);
  if (idade > VALIDADE_CMD_MS) { log(`comando antigo ignorado (${Math.round(idade / 1000)} s)`); return; }
  if (portaAberta) { log('comando recebido com a porta aberta: ignorado'); return; }
  uidAtual = c.uid || ''; cautelaAtual = c.cautelaId || ''; tipoAtual = c.tipo || 'retirada';
  aberturaAutorizada = true; liberadaEm = Date.now();
  bipes(1);
  registrarEvento(tipoAtual === 'devolucao' ? 'liberada_devolucao' : 'liberada_retirada');
  set(ref(db, `${BASE}/status/ultimoComandoId`), c.id).catch((e) => log('Erro: ' + (e.code || e.message)));
  log(`porta destravada para ${tipoAtual} da cautela ${cautelaAtual} (10 s para abrir)`);
  limpar();
  timers.push(setTimeout(() => {
    if (aberturaAutorizada && !portaAberta) {
      aberturaAutorizada = false;
      registrarEvento('liberada_sem_abertura');
      desenhar();
    }
  }, JANELA_ABRIR_MS));
  desenhar();
}

// Botão de emergência: destrava sem pedido do app (3 bipes) e registra o evento, sem uid nem cautela.
// A abertura que vem em seguida conta como autorizada (sem alarme), mas o alarme de porta aberta demais vale.
function emergencia() {
  if (portaAberta) { log('botão de emergência com a porta aberta: ignorado'); return; }
  limpar();
  uidAtual = ''; cautelaAtual = ''; tipoAtual = 'emergencia';
  aberturaAutorizada = true; liberadaEm = Date.now();
  bipes(3);
  registrarEvento('emergencia');
  log('BOTÃO DE EMERGÊNCIA: porta destravada (10 s para abrir)');
  timers.push(setTimeout(() => {
    if (aberturaAutorizada && !portaAberta) { aberturaAutorizada = false; registrarEvento('liberada_sem_abertura'); desenhar(); }
  }, JANELA_ABRIR_MS));
  desenhar();
}

function abrir() {
  if (portaAberta) return;
  const autorizada = aberturaAutorizada && Date.now() - liberadaEm < JANELA_ABRIR_MS;
  limpar();
  portaAberta = true; abertaDesde = Date.now(); sessaoAutorizada = autorizada;
  if (!autorizada) { uidAtual = ''; cautelaAtual = ''; alertaAtivo = true; alarmeTocar(true); }
  registrarEvento(autorizada ? 'porta_aberta' : 'abertura_nao_autorizada');
  atualizarStatus();
  timers.push(setTimeout(() => {
    if (portaAberta && !alertaAtivo) {
      alertaAtivo = true; alarmeTocar(true);
      registrarEvento('porta_aberta_demais');
      atualizarStatus(); desenhar();
    }
  }, LIMITE_ABERTA_MS));
  desenhar();
}

function fechar() {
  if (!portaAberta) return;
  limpar();
  portaAberta = false; alertaAtivo = false; aberturaAutorizada = false; alarmeTocar(false);
  registrarEvento('porta_fechada');
  if (sessaoAutorizada) bipes(2);
  sessaoAutorizada = false;
  atualizarStatus();
  desenhar();
}
const limpar = () => { timers.forEach(clearTimeout); timers = []; };

/* ---------- tela ---------- */
function desenhar() {
  const destravada = aberturaAutorizada && !portaAberta;
  $('#cv-armario').classList.toggle('cv-aberta', portaAberta);
  $('#cv-armario').classList.toggle('cv-destravada', destravada || portaAberta);
  $('#cv-luz').className = 'cv-luz ' + (alertaAtivo ? 'alerta' : conectado ? 'on' : '');
  $('#cv-conexao').textContent = conectado ? 'Online' : 'Sem conexão com o Firebase';
  $('#cv-titulo').textContent = portaAberta ? (alertaAtivo ? 'Porta aberta · ALARME' : 'Porta aberta')
    : destravada ? 'Destravada: abra em até 10 s' : 'Porta fechada e trancada';
  $('#cv-msg').textContent = portaAberta
    ? (sessaoAutorizada ? (tipoAtual === 'emergencia' ? 'Aberta pelo botão de emergência. Pegue a chave e feche a porta; registre a cautela no app.' : `${tipoAtual === 'devolucao' ? 'Pendure a chave' : 'Retire a chave'} e feche a porta.`) : 'Abertura sem pedido do app: o alarme fica ligado até fechar.')
    : destravada ? (tipoAtual === 'emergencia' ? 'Botão de emergência acionado. Clique em "Abrir a porta".' : `Pedido de ${tipoAtual} recebido. Clique em "Abrir a porta".`) : 'Aguardando um pedido do app.';
  $('#cv-fechar').disabled = !portaAberta;
  $('#cv-abrir').disabled = portaAberta;
  $('#cv-emergencia').disabled = portaAberta || destravada;
}

$('#cv-abrir').addEventListener('click', abrir);
// Segurar o botão de emergência por 1 s (mouse ou toque)
let segurando = null;
const soltar = () => { clearTimeout(segurando); segurando = null; };
$('#cv-emergencia').addEventListener('pointerdown', (e) => {
  e.preventDefault(); soltar();
  segurando = setTimeout(() => { segurando = null; emergencia(); }, SEGURAR_EMERGENCIA_MS);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('#cv-emergencia').addEventListener(ev, soltar));
$('#cv-fechar').addEventListener('click', fechar);
$('#cv-sair').addEventListener('click', () => signOut(auth));

$('#cv-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget, erro = $('#cv-erro');
  erro.hidden = true;
  f.querySelector('button').disabled = true;
  try {
    await signInWithEmailAndPassword(auth, f.email.value.trim(), f.senha.value);
    f.senha.value = '';
  } catch (err) {
    erro.textContent = err.code === 'auth/invalid-credential' ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar: ' + (err.code || err.message);
    erro.hidden = false;
  } finally {
    f.querySelector('button').disabled = false;
  }
});

let heartbeat = null;
onAuthStateChanged(auth, (user) => {
  pararComando?.(); pararComando = null;
  clearInterval(heartbeat); limpar(); alarmeTocar(false);
  $('#cv-login').hidden = !!user;
  $('#cv-painel').hidden = !user;
  if (!user) return;
  log('ligado como ' + user.email);
  portaAberta = false; alertaAtivo = false; aberturaAutorizada = false;
  atualizarStatus();
  heartbeat = setInterval(() => atualizarStatus(), HEARTBEAT_MS);
  pararComando = onValue(ref(db, `${BASE}/comando`), (s) => processarComando(s.val()), (err) => {
    log('Sem permissão para ler o comando: confira se esta conta está em config/dispositivos/' + DISPOSITIVO + ' (' + (err.code || err.message) + ')');
  });
  desenhar();
});
