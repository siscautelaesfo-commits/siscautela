// SisCautela EsFO — peças comuns: Firebase, estado, telas, mensagens e formatação.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = 'pt-BR';
export const db = getFirestore(app);

// ---------- estado compartilhado ----------
export const estado = {
  eu: null,          // meu cadastro (usuarios/{uid}) + uid
  viaturas: [],      // todas as viaturas
};
const ouvintes = {};
export function ouvir(evento, fn) {
  (ouvintes[evento] ||= new Set()).add(fn);
  return () => ouvintes[evento].delete(fn);
}
export function avisar(evento, dado) {
  (ouvintes[evento] || []).forEach((fn) => { try { fn(dado); } catch (e) { console.error(e); } });
}

export const ehGestao = () => !!estado.eu && estado.eu.situacao === 'ativo' && ['gestor', 'admin'].includes(estado.eu.perfil);
export const acompanha = () => !!estado.eu && estado.eu.situacao === 'ativo' && ['conferente', 'gestor', 'admin'].includes(estado.eu.perfil);

// ---------- telas e mensagens ----------
export const $ = (sel) => document.querySelector(sel);

export function mostrar(idTela) {
  document.querySelectorAll('.tela').forEach((t) => t.classList.toggle('ativa', t.id === idTela));
  window.scrollTo(0, 0);
  avisar('tela', idTela);
}
export const telaAtual = () => document.querySelector('.tela.ativa')?.id;

let timerMsg;
export function mensagem(texto, erro = false) {
  const el = $('#mensagem');
  el.textContent = texto;
  el.classList.toggle('erro', erro);
  el.hidden = false;
  clearTimeout(timerMsg);
  timerMsg = setTimeout(() => { el.hidden = true; }, 6000);
}

export function traduzirErro(err) {
  const c = err?.code || err?.codigo || '';
  const mapa = {
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/email-already-in-use': 'Já existe acesso com esse e-mail. Use "Entrar" ou "Esqueci a senha".',
    'auth/weak-password': 'Senha fraca. Use pelo menos 8 caracteres.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    'auth/network-request-failed': 'Sem conexão com a internet.',
    'permission-denied': 'Ação não permitida.',
    'unavailable': 'Sem conexão com o servidor. Tente novamente.',
    'failed-precondition': 'A situação mudou enquanto você preenchia. Confira e tente de novo.',
    'aborted': 'Outra pessoa gravou ao mesmo tempo. Tente de novo.',
  };
  return err?.mensagemUsuario || mapa[c] || 'Não foi possível concluir. Tente novamente.';
}

// Janela por cima da tela (assinatura, detalhes, compartilhar)
let fecharAtual = null;
export function abrirModal(html, aoFechar) {
  const caixa = $('#modal');
  caixa.innerHTML = `<div class="fundo-modal" data-fundo-modal><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  fecharAtual = aoFechar || null;
  return caixa.querySelector('.modal');
}
export function fecharModal() {
  $('#modal').innerHTML = '';
  const fn = fecharAtual; fecharAtual = null;
  fn?.();
}
export const modalAberto = () => !!$('#modal').firstChild;
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-fundo-modal]')) fecharModal();
  if (e.target.closest('[data-fechar-modal]')) fecharModal();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalAberto()) fecharModal(); });

// ---------- formatação ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ms = (v) => (v == null ? null : typeof v === 'number' ? v : v.toMillis ? v.toMillis() : v.seconds ? v.seconds * 1000 : new Date(v).getTime());
export const km = (n) => (n == null || n === '' || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('pt-BR'));
export const reais = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const hora = (t) => (t ? new Date(ms(t)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');
export const dataBR = (t) => (t ? new Date(ms(t)).toLocaleDateString('pt-BR') : '—');
export const dataCurta = (t) => (t ? new Date(ms(t)).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—');
export function dataHora(t) {
  if (!t) return '—';
  const d = new Date(ms(t)), hoje = new Date(), ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  const mesmo = (a, b) => a.toDateString() === b.toDateString();
  return (mesmo(d, hoje) ? 'hoje' : mesmo(d, ontem) ? 'ontem' : dataCurta(t)) + ', ' + hora(t);
}
export const dataHoraFixa = (t) => (t ? dataCurta(t) + ' ' + hora(t) : '—');
export function duracao(msTotal) {
  const m = Math.round(Math.abs(msTotal) / 60000);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return h + ' h' + (r ? ' ' + String(r).padStart(2, '0') : '');
}
export const horas = (msTotal) => (msTotal / 3600e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' h';
export const isoDia = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
export const inicioDia = (iso) => new Date(iso + 'T00:00').getTime();

// "Cad. Romeiro" / "Al Of Silva"
export const posto = (u) => (u?.curso === 'CHOE' ? 'Al Of' : 'Cad.');
export const nomeMilitar = (u) => (u ? `${posto(u)} ${u.nomeGuerra || ''}`.trim() : '—');

// ---------- regras de negócio ----------
export const COMB = ['Reserva', '1/4', '1/2', '3/4', 'Cheio'];
export const FOTOS = [['frente', 'Frente'], ['traseira', 'Traseira'], ['latEsq', 'Lateral esquerda'], ['latDir', 'Lateral direita'], ['painel', 'Painel com KM e combustível']];
export const MOTIVOS = ['Missão exige viatura caracterizada', 'Mais lugares para passageiros', 'Missão exige picape ou furgão', 'Viatura prioritária com problema', 'Outro motivo'];
export const ATRASO_MIN = 30;
export const KM_ALERTA = 400;
export const SITUACOES = { ativa: 'Disponível', manutencao: 'Em manutenção', baixada: 'Baixada', usoExclusivo: 'Uso exclusivo' };
export const numeroCautela = (seq) => 'C-' + String(seq).padStart(4, '0');

export const estaAtrasada = (c, agora = Date.now()) => c?.situacao === 'aberta' && agora > ms(c.previsao) + ATRASO_MIN * 60000;
export const devolveuAtrasado = (c) => !!c?.devolucao && ms(c.devolucao) > ms(c.previsao) + ATRASO_MIN * 60000;

// Situação para exibir: disponível, cautelada, em atraso, bloqueada
export function statusViatura(v, cautelaAberta) {
  if (v.situacao !== 'ativa') return 'bloqueada';
  if (!v.cautelaAtual) return 'disponivel';
  return cautelaAberta && estaAtrasada(cautelaAberta) ? 'atrasada' : 'cautelada';
}
export const ST_TEXTO = { disponivel: 'Disponível', cautelada: 'Cautelada', atrasada: 'Em atraso', bloqueada: 'Indisponível' };
export const disponiveis = () => porPrioridade().filter((v) => v.situacao === 'ativa' && !v.cautelaAtual);
export const porPrioridade = () => [...estado.viaturas].sort((a, b) =>
  (a.prioridade - b.prioridade) || String(a.prefixo).localeCompare(String(b.prefixo), 'pt-BR'));

// Figura da viatura pelo modelo (mesmas imagens do app da missão viatura)
export function tipoViatura(modelo = '') {
  const m = modelo.toLowerCase();
  if (m.includes('master') || m.includes('furg') || m.includes('van')) return 'furgao';
  if (m.includes('ranger') || m.includes('hilux') || m.includes('s10') || m.includes('l200')) return 'picape';
  if (m.includes('trailblazer') || m.includes('sw4')) return 'suvGrande';
  if (m.includes('duster') || m.includes('renegade') || m.includes('creta')) return 'suv';
  return 'sedan';
}

// ---------- pedaços de HTML ----------
export const chaveiro = (v, cls = '') => `<span class="chaveiro ${cls}">${esc(v?.prefixo ?? v)}</span>`;
export const placa = (p) => (p ? `<span class="placa" aria-label="Placa ${esc(p)}"><span>BRASIL</span><span>${esc(p)}</span></span>` : '');
export const figura = (v) => `<img class="vimg" src="img/viaturas/${tipoViatura(v.modelo)}.webp" alt="">`;
export const selo = (st, txt) => `<span class="selo s-${st}">${esc(txt || ST_TEXTO[st])}</span>`;
export const combMini = (n) => (n == null ? '—' : `<span class="combmini ${n === 0 ? 'baixo' : ''}" title="${COMB[n]}">${[0, 1, 2, 3, 4].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span> <span class="pequeno">${COMB[n]}</span>`);

export const ICONE = {
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  digital: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 11v3a8 8 0 0 0 1.5 4.6"/><path d="M8.6 9.6A3.5 3.5 0 0 1 15.5 11v1.5a12 12 0 0 0 .8 4.2"/><path d="M6 13a6 6 0 0 1 .4-3.6"/><path d="M5.2 6.5A8 8 0 0 1 19.6 9"/><path d="M19.8 13a17 17 0 0 1-.3 3"/><path d="M9 19.5c-1.3-1.9-2-3.9-2-6.5"/><path d="M11.4 6.1A6 6 0 0 1 17.9 11v1"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><path d="M12 11v6"/><path d="m9 14 3 3 3-3"/></svg>',
  compartilhar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/></svg>',
};
