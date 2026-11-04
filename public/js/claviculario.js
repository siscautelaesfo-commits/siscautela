// SisCautela · claviculário eletrônico (ESP32 + fechadura 12 V) pelo Realtime Database.
//
// Contrato com o firmware (claviculario/esfo01):
//   comando  { id, uid, cautelaId, tipo: 'retirada' | 'devolucao', criadoEm }  ← o app grava
//   status   { porta: 'aberta' | 'fechada', alerta, ultimoComandoId, ultimoSinal } ← só o ESP32
//   eventos  { tipo, uid, cautelaId, ts }                                        ← só o ESP32, sem apagar
//            tipo 'emergencia': porta aberta pelo botão de emergência (sem uid nem cautela)
// O ESP32 ignora comando repetido (mesmo id) ou com mais de 60 s, destrava a porta por até 2 s
// e aceita a abertura em até 10 s. A lista `membros/{uid}` diz quem pode mandar abrir; ela é
// mantida pelo app quando um administrador do claviculário abre a gestão de usuários.
import {
  getDatabase, ref, set, push, update, get, onValue, query, orderByKey, limitToLast, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';
import { app, auth, ouvir, esc, hora, dataHora, ms, numeroCautela, ICONE } from './nucleo.js';

export const DISPOSITIVO = 'esfo01';
export const rtdb = getDatabase(app);
const BASE = `claviculario/${DISPOSITIVO}`;

const OFFLINE_MS = 3 * 60e3;     // sem sinal de vida há 3 min = offline (o ESP32 manda a cada 1 min)
const RESPOSTA_MS = 15e3;        // tempo para o ESP32 confirmar o comando
const JANELA_ABRIR_MS = 12e3;    // o ESP32 aceita a abertura por 10 s; 2 s de folga para a rede
const REABRIR_MIN = 15;          // até quanto tempo depois da assinatura o militar pode pedir de novo
const TENTATIVAS = 3;

/* ---------- relógio do servidor ---------- */
let desvio = 0;
let conectado = false;
onValue(ref(rtdb, '.info/serverTimeOffset'), (s) => { desvio = s.val() || 0; });
onValue(ref(rtdb, '.info/connected'), (s) => { conectado = s.val() === true; });
const agoraServidor = () => Date.now() + desvio;

/* ---------- situação do claviculário (status + eventos) ---------- */
let status = null;
let lido = false;          // a primeira leitura do status já chegou
let eventos = [];
let erroLeitura = '';
const fnsStatus = new Set();
const fnsEventos = new Set();
let pararStatus = null;
let pararEventos = null;

function ligarStatus() {
  if (pararStatus || !auth.currentUser) return;
  pararStatus = onValue(ref(rtdb, `${BASE}/status`), (s) => {
    status = s.val(); lido = true; erroLeitura = '';
    fnsStatus.forEach((fn) => fn(status));
  }, (err) => {
    console.error(err); lido = true; erroLeitura = 'Sem acesso à situação do claviculário.'; pararStatus = null;
    fnsStatus.forEach((fn) => fn(status));
  });
}

export function ouvirStatus(fn) {
  fnsStatus.add(fn);
  ligarStatus();
  fn(status);
  return () => fnsStatus.delete(fn);
}

// Últimos eventos (painel da frota). A regra libera a leitura para quem está em `membros`.
export function ouvirEventos(fn, n = 8) {
  fnsEventos.add(fn);
  if (!pararEventos && auth.currentUser) {
    pararEventos = onValue(query(ref(rtdb, `${BASE}/eventos`), orderByKey(), limitToLast(n)), (s) => {
      eventos = Object.entries(s.val() || {}).map(([id, e]) => ({ id, ...e })).reverse();
      fnsEventos.forEach((f) => f(eventos));
    }, (err) => { console.warn('eventos do claviculário:', err.code || err); pararEventos = null; });
  }
  fn(eventos);
  return () => fnsEventos.delete(fn);
}

// O claviculário já deu sinal de vida alguma vez? Antes disso (sem o ESP32 instalado) o app não pede abertura.
export const instalado = () => !!status?.ultimoSinal;

export const online = (st = status) => !!st?.ultimoSinal && agoraServidor() - st.ultimoSinal < OFFLINE_MS;

// Ao sair do app, solta tudo (as leituras dependem do login)
export function pararClaviculario() {
  pararStatus?.(); pararStatus = null;
  pararEventos?.(); pararEventos = null;
  fnsStatus.clear(); fnsEventos.clear();
  status = null; lido = false; eventos = []; souAdmin = null; membros = null;
  acompanhamento?.parar();
}

/* ---------- comando de abertura ---------- */
export async function pedirAbertura(cautelaId, tipo) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw Object.assign(new Error('sem login'), { mensagemUsuario: 'Faça login de novo.' });
  // Sem conexão, o pedido ficaria guardado e abriria a porta mais tarde, sem ninguém na frente: não envia.
  if (!conectado) throw Object.assign(new Error('offline'), { mensagemUsuario: 'Sem conexão com o servidor. Confira a internet do celular e tente de novo.' });
  const id = push(ref(rtdb, `${BASE}/eventos`)).key;   // só gera um id único; nada é gravado em eventos
  await set(ref(rtdb, `${BASE}/comando`), { id, uid, cautelaId, tipo, criadoEm: serverTimestamp() });
  return id;
}

/* ---------- acompanhamento da abertura (tela de concluída e janela de reabrir) ---------- */
// Etapas: enviando → aguardando (ESP32 ainda não confirmou) → liberada (destravou) → aberta → concluida
//         e os desvios: sem_resposta, sem_abertura, sem_permissao, falha
let acompanhamento = null;

// `tela`: ao sair dessa tela o acompanhamento para (na janela por cima, quem para é o fechamento dela).
export function acompanharAbertura(caixa, { cautelaId, tipo, prefixo, tela = null }) {
  acompanhamento?.parar();
  const a = { etapa: 'enviando', id: null, tentativa: 0, viuAberta: false, timer: null, erro: '' };
  let pararSt = null;
  const pararTela = ouvir('tela', (t) => { if (tela && t !== tela) a.parar(); });

  a.parar = () => {
    clearTimeout(a.timer); pararSt?.(); pararSt = null; pararTela();
    if (acompanhamento === a) acompanhamento = null;
  };

  const desenhar = () => { if (caixa.isConnected) caixa.innerHTML = htmlAbertura(a, { tipo, prefixo }); };

  let iniciou = false;
  const aoStatus = (st) => {
    if (!iniciou) {
      if (!lido) return;                 // espera a primeira leitura
      iniciou = true;
      if (!instalado()) { caixa.innerHTML = ''; a.parar(); return; }
      a.enviar();
      return;
    }
    if (!a.id) return desenhar();
    const confirmou = st?.ultimoComandoId === a.id;
    if (confirmou && st.porta === 'aberta') a.viuAberta = true;
    if (a.etapa === 'aguardando' && confirmou) {
      a.etapa = st.porta === 'aberta' ? 'aberta' : 'liberada';
      clearTimeout(a.timer);
      if (a.etapa === 'liberada') a.timer = setTimeout(() => { if (a.etapa === 'liberada') { a.etapa = 'sem_abertura'; desenhar(); } }, JANELA_ABRIR_MS);
    } else if (['liberada', 'sem_abertura'].includes(a.etapa) && confirmou && st.porta === 'aberta') {
      a.etapa = 'aberta'; clearTimeout(a.timer);
    } else if (a.etapa === 'aberta' && st?.porta === 'fechada' && a.viuAberta) {
      a.etapa = 'concluida'; clearTimeout(a.timer);
      setTimeout(() => a.parar(), 0);
    }
    desenhar();
  };

  a.enviar = async () => {
    if (a.tentativa >= TENTATIVAS) return;
    a.tentativa++; a.etapa = 'enviando'; a.viuAberta = false; a.erro = '';
    clearTimeout(a.timer); desenhar();
    try {
      a.id = await pedirAbertura(cautelaId, tipo);
      a.etapa = 'aguardando';
      a.timer = setTimeout(() => { if (a.etapa === 'aguardando') { a.etapa = 'sem_resposta'; desenhar(); } }, RESPOSTA_MS);
      aoStatus(status);
    } catch (err) {
      console.error(err);
      a.etapa = String(err?.code || '').includes('PERMISSION_DENIED') || String(err?.message || '').includes('ermission') ? 'sem_permissao' : 'falha';
      a.erro = err?.mensagemUsuario || '';
      desenhar();
    }
  };

  caixa.addEventListener('click', (e) => {
    if (acompanhamento === a && e.target.closest('[data-clav="de-novo"]')) a.enviar();
  });

  acompanhamento = a;
  pararSt = ouvirStatus(aoStatus);
  return a;
}

function htmlAbertura(a, { tipo, prefixo }) {
  const ret = tipo === 'retirada';
  const chave = `a chave da <b>${esc(prefixo)}</b>`;
  const off = status && !online() ? '<div class="alerta-caixa atencao">O claviculário está sem sinal há mais de 3 minutos. Se a porta não abrir, procure o responsável pela frota.</div>' : '';
  const deNovo = a.tentativa < TENTATIVAS ? '<button type="button" class="btn" data-clav="de-novo">Tentar de novo</button>' : '<p class="pequeno">Se for urgente, use o botão de emergência do claviculário e depois registre a abertura no app (aparece no início).</p>';
  const ETAPAS = {
    enviando: ['info', 'Enviando o pedido ao claviculário…', ''],
    aguardando: ['info', 'Aguardando o claviculário…', off],
    liberada: ['ok', 'Porta destravada: puxe a porta agora', `<p>Você tem 10 segundos. ${ret ? `Retire ${chave}` : `Pendure ${chave} no lugar dela`} e feche a porta.</p>`],
    aberta: ['ok', 'Porta aberta', `<p>${ret ? `Retire ${chave}` : `Pendure ${chave}`} e feche a porta. Ela tranca sozinha e o claviculário dá 2 bipes.</p>${status?.alerta ? '<div class="alerta-caixa erro">A porta está aberta há mais de 30 segundos. Feche agora.</div>' : ''}`],
    concluida: ['ok', ret ? 'Chave retirada e porta trancada' : 'Chave devolvida e porta trancada', `<p class="pequeno">Registrado às ${hora(Date.now())}.</p>`],
    sem_resposta: ['erro', 'O claviculário não respondeu', off + deNovo],
    sem_abertura: ['atencao', 'A porta não foi aberta a tempo', '<p class="pequeno">Ela trancou de novo por segurança.</p>' + deNovo],
    sem_permissao: ['erro', 'Seu acesso ao claviculário ainda não foi liberado', '<p class="pequeno">O administrador libera junto com o cadastro. Enquanto isso, procure o responsável pela frota.</p>'],
    falha: ['erro', 'Não foi possível enviar o pedido', `<p class="pequeno">${esc(a.erro || 'Confira a internet do celular.')}</p>${deNovo}`],
  };
  const [cor, titulo, corpo] = ETAPAS[a.etapa];
  const carregando = ['enviando', 'aguardando'].includes(a.etapa);
  return `<div class="caixa clav clav-${cor} pilha" aria-live="polite">
    <div class="linha"><span class="clav-icone ${carregando ? 'girando' : ''}">${a.etapa === 'concluida' ? ICONE.ok : ICONE.chave}</span>
      <div><span class="rotulo">Claviculário${a.tentativa > 1 ? ` · tentativa ${a.tentativa}` : ''}</span><h3 style="margin:0">${titulo}</h3></div></div>
    ${corpo}</div>`;
}

// O militar pode pedir a abertura de novo até 15 min depois de assinar (porta que não abriu, celular que fechou)
export const podeReabrir = (momento) => !!momento && Date.now() - ms(momento) < REABRIR_MIN * 60e3;

/* ---------- lista de quem pode abrir (membros) ---------- */
// Quem está "ativo" no SisCautela fica em membros/{uid} = true; os demais saem.
// Só grava quem está em config/admins (regra do Realtime Database).
let souAdmin = null;
let membros = null;
let fila = Promise.resolve();

export function sincronizarMembros(usuarios) {
  fila = fila.then(() => sincronizar(usuarios)).catch((err) => console.warn('membros do claviculário:', err.code || err));
  return fila;
}

async function sincronizar(usuarios) {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  if (souAdmin === null) {
    souAdmin = (await get(ref(rtdb, `config/admins/${uid}`))).val() === true;
  }
  if (!souAdmin) return;
  if (!membros) membros = (await get(ref(rtdb, 'membros'))).val() || {};
  const mudar = {};
  const ids = new Set(usuarios.map((u) => u.uid));
  usuarios.forEach((u) => {
    const deve = u.situacao === 'ativo';
    if (deve && membros[u.uid] !== true) mudar[u.uid] = true;
    if (!deve && membros[u.uid] != null) mudar[u.uid] = null;
  });
  Object.keys(membros).forEach((id) => { if (!ids.has(id)) mudar[id] = null; });
  if (!Object.keys(mudar).length) return;
  await update(ref(rtdb, 'membros'), mudar);
  Object.entries(mudar).forEach(([id, v]) => { if (v) membros[id] = true; else delete membros[id]; });
}

export const administraClaviculario = () => souAdmin === true;

/* ---------- quadro do painel da frota ---------- */
const NOMES_EVENTO = {
  liberada_retirada: 'Liberada para retirada',
  liberada_devolucao: 'Liberada para devolução',
  porta_aberta: 'Porta aberta',
  porta_fechada: 'Porta fechada',
  porta_aberta_demais: 'Porta aberta demais',
  abertura_nao_autorizada: 'Abertura sem autorização',
  liberada_sem_abertura: 'Liberada e não aberta',
  emergencia: 'Botão de emergência',
};
const EVENTO_GRAVE = ['porta_aberta_demais', 'abertura_nao_autorizada', 'emergencia'];

const cautelaTexto = (id) => (/^c\d+$/.test(id || '') ? numeroCautela(Number(id.slice(1))) : '');

export function htmlQuadroClaviculario(nomeDe = () => '', legenda = () => '') {
  let situacao;
  if (erroLeitura) situacao = `<div class="alerta-caixa atencao">${esc(erroLeitura)}</div>`;
  else if (!status) situacao = '<div class="alerta-caixa atencao">O claviculário ainda não se conectou.</div>';
  else if (!online()) situacao = `<div class="alerta-caixa erro">Sem sinal desde ${dataHora(status.ultimoSinal)}. Confira a energia e o Wi-Fi.</div>`;
  else if (status.alerta) situacao = '<div class="alerta-caixa erro">Alerta: porta aberta demais ou aberta sem autorização.</div>';
  else situacao = `<div class="alerta-caixa ok">Online · porta ${status.porta === 'aberta' ? 'aberta' : 'fechada e trancada'}</div>`;
  const lista = eventos.length ? eventos.map((e) => `<div class="alerta"><span class="ponto ${EVENTO_GRAVE.includes(e.tipo) ? 'erro' : e.tipo.startsWith('liberada') ? 'info' : e.tipo === 'porta_fechada' ? 'ok' : 'atencao'}"></span>
      <div><b>${esc(NOMES_EVENTO[e.tipo] || e.tipo)}</b><div class="pequeno suave">${dataHora(e.ts)}${e.cautelaId ? ' · ' + esc(cautelaTexto(e.cautelaId) || e.cautelaId) : ''}${nomeDe(e.uid) ? ' · ' + esc(nomeDe(e.uid)) : ''}${e.tipo === 'emergencia' && legenda(e.id) ? ' · ' + esc(legenda(e.id)) : ''}</div></div><span></span></div>`).join('')
    : '<p class="pequeno suave">Nenhum evento registrado ainda.</p>';
  return `<div class="caixa pilha"><h3>Claviculário</h3>${situacao}<div>${lista}</div></div>`;
}

// Para os alertas do painel
export function alertasClaviculario() {
  if (!status) return [];
  if (!online()) return [['erro', 'Claviculário sem sinal', `Último sinal ${dataHora(status.ultimoSinal)}`]];
  if (status.alerta) return [['erro', 'Alerta no claviculário', 'Porta aberta demais ou aberta sem autorização']];
  return [];
}

