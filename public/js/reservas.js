// SisCautela · reserva de viatura para cautelas futuras.
//
// Regra combinada com a Missão Viaturas:
//  - qualquer militar ativo reserva uma viatura para um período (blocos de 30 min, até 24 h, até 14 dias antes);
//  - até 1 h antes do início, a viatura segue disponível para todos, mas quem cautelar tem que devolver
//    até 30 min antes do início da reserva (folga para conferir a viatura e passar a chave);
//  - a partir de 1 h antes, só quem reservou consegue cautelar;
//  - se não retirar até 30 min depois do início, a reserva cai e o não comparecimento fica registrado.
import {
  doc, collection, query, where, onSnapshot, writeBatch, updateDoc, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import {
  db, estado, avisar, $, mostrar, mensagem, traduzirErro, abrirModal, fecharModal, ehGestao,
  esc, ms, hora, dataCurta, nomeMilitar, porPrioridade, chaveiro
} from './nucleo.js';
import * as ponte from './ponte.js';

export const telasReserva = ['tela-reserva'];

export const BLOCO_MS = 30 * 60e3;
export const BLOQUEIO_MS = 60 * 60e3;      // só quem reservou cautela a partir de 1 h antes
export const FOLGA_MS = 30 * 60e3;         // quem cautelar antes devolve até 30 min antes do início
export const TOLERANCIA_MS = 30 * 60e3;    // depois do início, a reserva espera 30 min
export const ANTECEDENCIA_DIAS = 14;
export const MAX_RESERVAS = 2;             // reservas futuras por militar
export const MAX_DURACAO_MS = 24 * 3600e3;

let reservas = [];
let parar = null;

/* ---------- dados ---------- */
export function iniciarReservas() {
  if (parar) return;
  const desde = Timestamp.fromMillis(Date.now() - 7 * 86400e3);   // uma semana para trás: não comparecimentos recentes
  parar = onSnapshot(query(collection(db, 'reservas'), where('fim', '>=', desde)), (s) => {
    reservas = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(a.inicio) - ms(b.inicio));
    avisar('reservas', reservas);
  }, (err) => console.error('reservas:', err));
}

export function pararReservas() {
  parar?.(); parar = null; reservas = [];
}

export const todasReservas = () => reservas;

// Ainda vale: ativa, não retirada, não passou da tolerância e não terminou
export const vigente = (r, agora = Date.now()) =>
  r.situacao === 'ativa' && !r.cautelaId && agora <= ms(r.inicio) + TOLERANCIA_MS && agora < ms(r.fim);

export const naoCompareceu = (r, agora = Date.now()) =>
  r.situacao === 'expirada' || (r.situacao === 'ativa' && !r.cautelaId && agora > ms(r.inicio) + TOLERANCIA_MS);

const uid = () => estado.eu?.uid;

export const reservasDaViatura = (vtrId, agora = Date.now()) => reservas.filter((r) => r.vtrId === vtrId && vigente(r, agora));

// Próxima reserva de outra pessoa nesta viatura
export function proximaDeOutro(vtrId, agora = Date.now()) {
  return reservasDaViatura(vtrId, agora).find((r) => r.userId !== uid()) || null;
}

// Na janela de 1 h antes até a tolerância: só quem reservou pode cautelar
export function bloqueadaParaMim(vtrId, agora = Date.now()) {
  const r = proximaDeOutro(vtrId, agora);
  return r && agora >= ms(r.inicio) - BLOQUEIO_MS ? r : null;
}

// Até quando pode ficar com a viatura (devolver 30 min antes da próxima reserva de outra pessoa)
export function limiteDevolucao(vtrId, agora = Date.now()) {
  const r = proximaDeOutro(vtrId, agora);
  return r ? { ate: ms(r.inicio) - FOLGA_MS, reserva: r } : null;
}

export const minhasReservas = (agora = Date.now()) => reservas.filter((r) => r.userId === uid() && vigente(r, agora));

// Minha reserva que já pode ser retirada (de 1 h antes até 30 min depois do início)
export const minhaReservaAgora = (agora = Date.now()) =>
  minhasReservas(agora).find((r) => agora >= ms(r.inicio) - BLOQUEIO_MS) || null;

const sobrepoe = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

/* ---------- textos ---------- */
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export function quando(t) {
  const d = new Date(ms(t)), hoje = new Date(), amanha = new Date();
  amanha.setDate(hoje.getDate() + 1);
  const mesmo = (a, b) => a.toDateString() === b.toDateString();
  const dia = mesmo(d, hoje) ? 'hoje' : mesmo(d, amanha) ? 'amanhã' : `${DIAS[d.getDay()]} ${dataCurta(t)}`;
  return `${dia} às ${hora(t)}`;
}
export const periodo = (r) => {
  const mesmoDia = new Date(ms(r.inicio)).toDateString() === new Date(ms(r.fim)).toDateString();
  return `${quando(r.inicio)} até ${mesmoDia ? hora(r.fim) : quando(r.fim)}`;
};

/* ---------- criar e cancelar ---------- */
export async function criarReserva({ vtrId, inicio, fim, missao }) {
  const v = estado.viaturas.find((x) => x.id === vtrId);
  const erro = validarReserva({ v, inicio, fim, missao });
  if (erro) throw Object.assign(new Error(erro), { mensagemUsuario: erro });
  const lote = writeBatch(db);
  const ref = doc(collection(db, 'reservas'));
  lote.set(ref, {
    vtrId: v.id, vtrPrefixo: v.prefixo, userId: uid(), userNome: nomeMilitar(estado.eu), missao: missao.trim(),
    inicio: Timestamp.fromMillis(inicio), fim: Timestamp.fromMillis(fim), situacao: 'ativa', criadaEm: serverTimestamp(),
  });
  const liberaEm = Timestamp.fromMillis(inicio + TOLERANCIA_MS);
  for (let t = inicio; t < fim; t += BLOCO_MS) {
    lote.set(doc(db, 'reservaBlocos', `${v.id}_${t}`), { vtrId: v.id, t: Timestamp.fromMillis(t), reservaId: ref.id, userId: uid(), liberaEm });
  }
  try {
    await lote.commit();
  } catch (err) {
    // Bloco já preso por outra reserva gravada no mesmo instante
    if (err?.code === 'permission-denied') {
      throw Object.assign(err, { mensagemUsuario: 'Esse horário acabou de ser reservado por outra pessoa. Escolha outro horário ou outra viatura.' });
    }
    throw err;
  }
  return ref.id;
}

export function validarReserva({ v, inicio, fim, missao }, agora = Date.now()) {
  if (!v || v.situacao !== 'ativa') return 'Escolha uma viatura em uso na frota.';
  if (!missao || missao.trim().length < 3) return 'Informe a missão ou o destino.';
  if (!inicio || !fim || inicio % BLOCO_MS || fim % BLOCO_MS) return 'Escolha os horários de início e de fim.';
  if (inicio < Math.ceil(agora / BLOCO_MS) * BLOCO_MS) return 'O início precisa ser depois de agora.';
  if (inicio > agora + ANTECEDENCIA_DIAS * 86400e3) return `A reserva pode ser feita com até ${ANTECEDENCIA_DIAS} dias de antecedência.`;
  if (fim <= inicio) return 'O fim precisa ser depois do início.';
  if (fim - inicio > MAX_DURACAO_MS) return 'A reserva pode ser de até 24 horas.';
  if (minhasReservas(agora).length >= MAX_RESERVAS) return `Você já tem ${MAX_RESERVAS} reservas. Cancele uma ou espere ela passar para reservar outra.`;
  const choque = reservasDaViatura(v.id, agora).find((r) => sobrepoe(inicio, fim, ms(r.inicio), ms(r.fim)));
  if (choque) return `A VTR ${v.prefixo} já está reservada ${periodo(choque)}${choque.userId === uid() ? ' por você' : ''}.`;
  return '';
}

export async function cancelarMinha(r) {
  const lote = writeBatch(db);
  lote.update(doc(db, 'reservas', r.id), { situacao: 'cancelada', canceladaPor: uid(), canceladaEm: serverTimestamp() });
  for (let t = ms(r.inicio); t < ms(r.fim); t += BLOCO_MS) {
    lote.update(doc(db, 'reservaBlocos', `${r.vtrId}_${t}`), { liberaEm: serverTimestamp() });
  }
  await lote.commit();
}

// Gestão: cancela com justificativa; a ponte solta os horários e avisa quem reservou por e-mail
export async function cancelarPelaGestao(r, motivo) {
  await updateDoc(doc(db, 'reservas', r.id), {
    situacao: 'cancelada', canceladaPor: uid(), canceladaEm: serverTimestamp(), motivoCancelamento: motivo.trim(),
  });
  if (ponte.ponteLigada()) ponte.chamar('liberarReserva', { id: r.id }).catch((e) => console.warn('liberarReserva:', e));
}

// Ao retirar a viatura pela reserva
export function marcarCumprida(reservaId, cautelaId) {
  return updateDoc(doc(db, 'reservas', reservaId), { situacao: 'cumprida', cautelaId })
    .catch((e) => console.warn('reserva cumprida:', e));
}

/* ---------- tela de reserva ---------- */
let form = null;   // { vtrId, dia: 'aaaa-mm-dd', ini: 'hh:mm', fim: 'hh:mm', missao, erro, gravando }

const p2 = (n) => String(n).padStart(2, '0');
const isoDiaLocal = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const HORARIOS = Array.from({ length: 48 }, (_, i) => `${p2(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`);

// Converte o formulário em início e fim (se o fim for antes do início, é no dia seguinte)
function periodoDoForm(f) {
  if (!f.dia || !f.ini || !f.fim) return {};
  const inicio = new Date(`${f.dia}T${f.ini}`).getTime();
  let fim = new Date(`${f.dia}T${f.fim}`).getTime();
  if (fim <= inicio) fim += 86400e3;
  return { inicio, fim };
}

export function abrirReserva(vtrId) {
  const agora = new Date(Date.now() + BLOQUEIO_MS);
  agora.setMinutes(agora.getMinutes() < 30 ? 30 : 60, 0, 0);
  const fim = new Date(agora.getTime() + 2 * 3600e3);
  const ativas = porPrioridade().filter((v) => v.situacao === 'ativa');
  form = {
    vtrId: vtrId || ativas[0]?.id || '', dia: isoDiaLocal(agora), ini: `${p2(agora.getHours())}:${p2(agora.getMinutes())}`,
    fim: `${p2(fim.getHours())}:${p2(fim.getMinutes())}`, missao: '', erro: '', gravando: false,
  };
  renderReserva();
  mostrar('tela-reserva');
}

export function renderReserva() {
  const caixa = $('#reserva-conteudo');
  if (!caixa || !form) return;
  const f = form;
  const ativas = porPrioridade().filter((v) => v.situacao === 'ativa');
  const v = ativas.find((x) => x.id === f.vtrId);
  const { inicio, fim } = periodoDoForm(f);
  const hojeIso = isoDiaLocal(new Date()), maxIso = isoDiaLocal(new Date(Date.now() + ANTECEDENCIA_DIAS * 86400e3));
  const agenda = v ? reservasDaViatura(v.id) : [];
  const dur = inicio && fim ? (fim - inicio) / 3600e3 : 0;
  caixa.innerHTML = `
    <div class="linha separa"><div><span class="rotulo">Nova reserva</span><h1 style="margin:0">Reservar viatura</h1></div>
      <button type="button" class="btn leve" data-r="voltar">Cancelar</button></div>
    <div class="caixa pilha">
      <label>Viatura<select data-rf="vtrId">${ativas.map((x) => `<option value="${x.id}" ${x.id === f.vtrId ? 'selected' : ''}>${esc(x.prefixo)} · ${esc(x.modelo || '')}${x.cautelaAtual ? ' (cautelada agora)' : ''}</option>`).join('')}</select></label>
      <label>Missão ou destino<input data-rf="missao" maxlength="150" value="${esc(f.missao)}" placeholder="Ex.: condução da turma ao estande de tiro"></label>
      <label>Dia<input type="date" data-rf="dia" value="${esc(f.dia)}" min="${hojeIso}" max="${maxIso}"></label>
      <div class="duas-colunas">
        <label>Início<select data-rf="ini">${HORARIOS.map((h) => `<option ${h === f.ini ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
        <label>Fim<select data-rf="fim">${HORARIOS.map((h) => `<option ${h === f.fim ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
      </div>
      <span class="dica">${inicio ? `${esc(periodo({ inicio, fim }))}${dur ? ` · ${dur.toLocaleString('pt-BR')} h` : ''}. ` : ''}Se o fim for antes do início, a reserva vai até o dia seguinte.</span>
      ${v?.cautelaAtual ? '<div class="alerta-caixa atencao">Esta viatura está cautelada agora. Quem está com ela será lembrado de devolver até 30 min antes da sua reserva.</div>' : ''}
      <div class="alerta-caixa info">Até 1 h antes do início, a viatura continua disponível para todos, com a volta limitada a 30 min antes da sua reserva. A partir de 1 h antes, só você consegue cautelar. Se não retirar até 30 min depois do início, a reserva cai.</div>
    </div>
    ${v ? `<div class="caixa pilha"><h3 style="margin:0">Reservas da VTR ${esc(v.prefixo)}</h3>
      ${agenda.length ? agenda.map((r) => `<div class="alerta"><span class="ponto info"></span><div><b>${esc(periodo(r))}</b><div class="pequeno suave">${esc(r.userNome)} · ${esc(r.missao)}</div></div><span></span></div>`).join('')
        : '<p class="pequeno suave">Nenhuma reserva nos próximos dias.</p>'}</div>` : ''}
    ${f.erro ? `<div class="alerta-caixa erro" role="alert">${esc(f.erro)}</div>` : ''}
    <div class="linha separa"><span></span><button type="button" class="btn prim" data-r="confirmar" ${f.gravando ? 'disabled' : ''}>${f.gravando ? 'Reservando…' : 'Confirmar reserva'}</button></div>`;
}

async function confirmar() {
  const f = form;
  const { inicio, fim } = periodoDoForm(f);
  f.erro = validarReserva({ v: estado.viaturas.find((x) => x.id === f.vtrId), inicio, fim, missao: f.missao });
  if (f.erro) { renderReserva(); return window.scrollTo(0, document.body.scrollHeight); }
  f.gravando = true; renderReserva();
  try {
    await criarReserva({ vtrId: f.vtrId, inicio, fim, missao: f.missao });
    const v = estado.viaturas.find((x) => x.id === f.vtrId);
    form = null;
    mostrar('tela-inicio');
    avisar('reservas', reservas);
    mensagem(`Reserva confirmada: VTR ${v?.prefixo}, ${periodo({ inicio, fim })}.`);
  } catch (err) {
    console.error(err);
    f.gravando = false; f.erro = traduzirErro(err);
    renderReserva();
  }
}

document.addEventListener('input', (e) => {
  const k = e.target.dataset?.rf;
  if (!k || !form) return;
  form[k] = e.target.value;
  form.erro = '';
  if (k !== 'missao') renderReserva();
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-r]');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.r === 'voltar') { form = null; mostrar('tela-inicio'); }
  if (d.r === 'confirmar') confirmar();
  if (d.r === 'nova') abrirReserva(d.vtr);
  if (d.r === 'cancelar-minha') pedirCancelamento(reservas.find((x) => x.id === d.id));
  if (d.r === 'cancelar-gestao') pedirCancelamentoGestao(reservas.find((x) => x.id === d.id));
});
// O cartão do início abre a tela de reserva
document.getElementById('cartao-reservar')?.addEventListener('click', () => abrirReserva());

function pedirCancelamento(r) {
  if (!r) return;
  const m = abrirModal(`<h2>Cancelar reserva</h2>
    <p>VTR ${chaveiro({ prefixo: r.vtrPrefixo })}, ${esc(periodo(r))}.</p>
    <p class="pequeno">O horário fica livre para outra pessoa.</p>
    <div class="linha separa"><button type="button" class="btn" data-fechar-modal>Manter</button><button type="button" class="btn perigo" id="res-cancelar">Cancelar reserva</button></div>`);
  m.querySelector('#res-cancelar').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await cancelarMinha(r); fecharModal(); mensagem('Reserva cancelada.'); } catch (err) { console.error(err); fecharModal(); mensagem(traduzirErro(err), true); }
  });
}

function pedirCancelamentoGestao(r) {
  if (!r || !ehGestao()) return;
  const m = abrirModal(`<h2>Cancelar reserva de ${esc(r.userNome)}</h2>
    <p>VTR ${chaveiro({ prefixo: r.vtrPrefixo })}, ${esc(periodo(r))} · ${esc(r.missao)}</p>
    <label>Motivo (vai por e-mail para quem reservou)<textarea id="res-motivo" maxlength="200" placeholder="Ex.: viatura requisitada para missão do comando"></textarea></label>
    <p id="res-erro" class="alerta-caixa erro" hidden></p>
    <div class="linha separa"><button type="button" class="btn" data-fechar-modal>Voltar</button><button type="button" class="btn perigo" id="res-cancelar">Cancelar reserva</button></div>`);
  m.querySelector('#res-cancelar').addEventListener('click', async (e) => {
    const motivo = m.querySelector('#res-motivo').value;
    if (motivo.trim().length < 5) { const p = m.querySelector('#res-erro'); p.textContent = 'Escreva o motivo do cancelamento.'; p.hidden = false; return; }
    e.target.disabled = true;
    try { await cancelarPelaGestao(r, motivo); fecharModal(); mensagem('Reserva cancelada. Quem reservou será avisado.'); } catch (err) { console.error(err); fecharModal(); mensagem(traduzirErro(err), true); }
  });
}

/* ---------- pedaços de tela usados no início e no painel ---------- */
export function htmlMinhasReservas() {
  const lista = minhasReservas();
  if (!lista.length) return '';
  return `<section class="pilha"><h3 style="margin:0">Suas reservas</h3>${lista.map((r) => `<div class="caixa linha separa">
      <div class="pilha" style="gap:4px"><div class="linha" style="gap:8px">${chaveiro({ prefixo: r.vtrPrefixo })}<b>${esc(periodo(r))}</b></div><div class="pequeno suave">${esc(r.missao)}</div></div>
      <button type="button" class="btn leve peq" data-r="cancelar-minha" data-id="${r.id}">Cancelar</button></div>`).join('')}</section>`;
}

// Agenda da frota (painel): próximos 7 dias e não comparecimentos de hoje
export function htmlAgenda() {
  const agora = Date.now(), ate = agora + 7 * 86400e3;
  const prox = reservas.filter((r) => vigente(r, agora) && ms(r.inicio) < ate);
  const faltas = reservas.filter((r) => naoCompareceu(r, agora) && agora - ms(r.inicio) < 86400e3);
  const linha = (r, falta) => `<div class="alerta"><span class="ponto ${falta ? 'erro' : agora >= ms(r.inicio) - BLOQUEIO_MS ? 'atencao' : 'info'}"></span>
      <div><b>${chaveiro({ prefixo: r.vtrPrefixo })} ${esc(periodo(r))}</b><div class="pequeno suave">${esc(r.userNome)} · ${esc(r.missao)}${falta ? ' · <b>não compareceu</b>' : ''}</div></div>
      ${!falta && ehGestao() ? `<button type="button" class="btn peq" data-r="cancelar-gestao" data-id="${r.id}">Cancelar</button>` : '<span></span>'}</div>`;
  return `<div class="caixa pilha"><h3 style="margin:0">Reservas · próximos 7 dias</h3>
    ${prox.length ? prox.map((r) => linha(r, false)).join('') : '<p class="pequeno suave">Nenhuma reserva.</p>'}
    ${faltas.length ? `<div class="rotulo" style="margin-top:6px">Não compareceram (últimas 24 h)</div>${faltas.map((r) => linha(r, true)).join('')}` : ''}</div>`;
}

