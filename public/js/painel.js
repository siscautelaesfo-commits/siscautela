// SisCautela · painel da frota (conferente, gestor e administrador): situação ao vivo, cautelas,
// avarias e relatórios. A gestão também trata avarias e, em último caso, encerra uma cautela.
import {
  collection, doc, query, where, orderBy, limit, startAfter, getDoc, getDocs, onSnapshot, writeBatch, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import {
  db, estado, ouvir, ehGestao, $, mostrar, telaAtual, mensagem, traduzirErro, abrirModal, fecharModal,
  esc, ms, km, hora, dataHora, duracao, COMB, ATRASO_MIN, estaAtrasada, devolveuAtrasado, porPrioridade,
  statusViatura, chaveiro, placa, figura, selo, combMini, ICONE, SITUACOES, situacaoCautela
} from './nucleo.js';
import { abrirDetalheCautela, renderRelatorios, relatorioDeHoje, invalidarRelatorios } from './relatorios.js';
import { assinar } from './assinatura.js';
import { gravarDevolucao } from './cautela.js';
import { ouvirStatus, ouvirEventos, htmlQuadroClaviculario, alertasClaviculario } from './claviculario.js';
import { htmlAgenda } from './reservas.js';
import { alertasEmergencia, legendaEvento, encerrarPelaGestao as encerrarEmergencia } from './emergencia.js';

export const telasPainel = ['tela-painel'];

let abertas = [];
let avarias = [];
let pendentes = 0;
let guia = 'painel';
let filtroVtr = '';
let recentes = null;        // cautelas da aba Cautelas, das mais novas para as mais antigas (carregadas aos poucos)
let ultimoDoc = null;       // onde a próxima página começa
let fimLista = false;
let carregandoLista = false;
let resolvidas = null;      // avarias resolvidas nos últimos 90 dias (só ao abrir a aba Avarias)
let carregandoResolvidas = false;
const PAGINA = 50;
const parar = [];
let ligado = false;

export function iniciarPainel() {
  if (ligado) return;
  ligado = true;
  parar.push(onSnapshot(query(collection(db, 'cautelas'), where('situacao', '==', 'aberta')), (s) => {
    abertas = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    // A lista da aba Cautelas é atualizada só no que mudou (sem reler tudo a cada foto enviada)
    s.docChanges().forEach((ch) => {
      if (ch.type !== 'removed') return substituirRecente({ id: ch.doc.id, ...ch.doc.data() });
      getDoc(doc(db, 'cautelas', ch.doc.id)).then((d) => { if (d.exists()) { substituirRecente({ id: d.id, ...d.data() }); atualizar(); } }).catch(() => {});
    });
    invalidarRelatorios();
    atualizar();
  }, (e) => console.error(e)));
  // Só as avarias em aberto ficam ao vivo; as resolvidas são lidas ao abrir a aba Avarias
  parar.push(onSnapshot(query(collection(db, 'avarias'), where('situacao', 'in', ['aberta', 'apuracao'])), (s) => {
    avarias = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.em) - ms(a.em));
    atualizar();
  }, (e) => console.error(e)));
  parar.push(onSnapshot(query(collection(db, 'usuarios'), where('situacao', '==', 'pendente')), (s) => {
    pendentes = s.size; atualizar();
  }, (e) => console.error(e)));
  parar.push(ouvir('viaturas', atualizar));
  parar.push(ouvir('reservas', atualizar));
  parar.push(ouvir('emergencias', atualizar));
  parar.push(ouvirStatus(() => atualizar()), ouvirEventos(() => atualizar()));
  parar.push(ouvir('encerrar-cautela', encerrarPelaGestao));
  const t = setInterval(() => { if (telaAtual() === 'tela-painel' && guia !== 'relatorios' && !$('#modal').firstChild) render(); }, 30000);
  parar.push(() => clearInterval(t));
}

export function pararPainel() {
  parar.splice(0).forEach((fn) => fn());
  ligado = false; abertas = []; avarias = []; recentes = null; ultimoDoc = null; fimLista = false; resolvidas = null;
}

document.getElementById('cartao-painel')?.addEventListener('click', () => { guia = 'painel'; render(); mostrar('tela-painel'); });

const cautelaDa = (vtrId) => abertas.find((c) => c.vtrId === vtrId);
const nomeDe = (uid) => (abertas.find((c) => c.userId === uid) || recentes?.find((c) => c.userId === uid))?.userNome || '';

function atualizar() {
  const atrasos = abertas.filter((c) => estaAtrasada(c)).length;
  const el = $('#resumo-painel');
  if (el) el.textContent = abertas.length
    ? `${abertas.length} viatura${abertas.length > 1 ? 's' : ''} fora${atrasos ? ` · ${atrasos} em atraso` : ''}`
    : 'Todas as chaves no claviculário';
  if (telaAtual() === 'tela-painel' && guia !== 'relatorios') render();
}

function render() {
  const avAbertas = avarias.filter((a) => a.situacao !== 'resolvida').length;
  const guias = [['painel', 'Painel', abertas.filter((c) => estaAtrasada(c)).length], ['cautelas', 'Cautelas', 0], ['avarias', 'Avarias', avAbertas], ['relatorios', 'Relatórios', 0]];
  $('#guias-painel').innerHTML = guias.map(([k, t, n]) => `<button type="button" role="tab" aria-selected="${guia === k}" data-guia="${k}">${t}${n ? `<span class="contador">${n}</span>` : ''}</button>`).join('');
  const caixa = $('#painel-conteudo');
  if (guia === 'painel') caixa.innerHTML = htmlPainel();
  if (guia === 'cautelas') renderCautelas(caixa);
  if (guia === 'avarias') { caixa.innerHTML = htmlAvarias(); if (resolvidas === null) carregarResolvidas(); }
  if (guia === 'relatorios') renderRelatorios(caixa);
}

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-guia]');
  if (g) { guia = g.dataset.guia; render(); return; }
  const b = e.target.closest('[data-p]');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.p === 'cautela') { const c = abertas.find((x) => x.id === d.id) || recentes?.find((x) => x.id === d.id); if (c) abrirDetalheCautela(c); }
  if (d.p === 'hoje-pdf') relatorioDeHoje('pdf');
  if (d.p === 'hoje-compartilhar') relatorioDeHoje('compartilhar');
  if (d.p === 'guia') { guia = d.g; render(); }
  if (d.p === 'avaria') tratarAvaria(d.id, d.s);
  if (d.p === 'mais-cautelas') carregarCautelas(true).then(() => { if (guia === 'cautelas') renderCautelas($('#painel-conteudo')); });
  if (d.p === 'usuarios') document.getElementById('cartao-gestao')?.click();
  if (d.p === 'emergencia') encerrarEmergencia(d.id);
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'filtro-vtr') { filtroVtr = e.target.value; renderCautelas($('#painel-conteudo')); }
});

/* ---------- painel ---------- */
function htmlPainel() {
  const vtrs = porPrioridade();
  const st = vtrs.map((v) => statusViatura(v, cautelaDa(v.id)));
  const n = (s) => st.filter((x) => x === s).length;
  const alertas = [...alertasEmergencia()];
  abertas.filter((c) => estaAtrasada(c)).forEach((c) => alertas.push(['erro', `Cautela em atraso: VTR ${c.vtrPrefixo}`, `${c.userNome} · previsão ${dataHora(c.previsao)} (${duracao(Date.now() - ms(c.previsao))} atrás)`, `data-p="cautela" data-id="${c.id}"`, 'Ver']));
  abertas.filter((c) => c.etapa === 'chave' && Date.now() > ms(c.saida) + 30 * 60e3).forEach((c) => alertas.push(['erro', `Chave da VTR ${c.vtrPrefixo} sem vistoria`, `${c.userNome} · chave retirada ${dataHora(c.saida)} (${duracao(Date.now() - ms(c.saida))} atrás)`, `data-p="cautela" data-id="${c.id}"`, 'Ver']));
  abertas.filter((c) => c.divergenciaKm != null).forEach((c) => alertas.push(['atencao', `KM divergente na VTR ${c.vtrPrefixo}`, `Saída com ${km(c.kmSaida)} km; último registro com ${km(c.divergenciaKm)} km`, `data-p="cautela" data-id="${c.id}"`, 'Ver']));
  avarias.filter((a) => a.situacao === 'aberta').forEach((a) => alertas.push([a.gravidade === 'grave' ? 'erro' : 'atencao', `Avaria ${a.gravidade} na VTR ${a.vtrPrefixo}`, a.descricao, 'data-p="guia" data-g="avarias"', 'Tratar']));
  alertasClaviculario().forEach(([g, t, s]) => alertas.push([g, t, s, '', '']));
  if (pendentes && ehGestao()) alertas.push(['info', `${pendentes} cadastro${pendentes > 1 ? 's' : ''} aguardando aprovação`, 'Autocadastro feito pelo próprio militar', 'data-p="usuarios"', 'Ver']);
  return `<div class="quadros">
      <div class="quadro q-ok"><b>${n('disponivel')}</b><span>Disponíveis</span></div>
      <div class="quadro q-cau"><b>${n('cautelada')}</b><span>Cauteladas</span></div>
      <div class="quadro q-erro"><b>${n('atrasada')}</b><span>Em atraso</span></div>
      <div class="quadro q-atencao"><b>${n('bloqueada')}</b><span>Indisponíveis</span></div></div>
    <div class="duas">
      <section class="pilha"><h3>Viaturas</h3><div class="vlista">${vtrs.map((v) => {
        const c = cautelaDa(v.id), s = statusViatura(v, c);
        let sub = `${esc(v.modelo)} · ${km(v.kmAtual)} km`;
        if (c) sub = c.etapa === 'chave' ? `Chave com ${esc(c.userNome)} desde ${hora(c.saida)} · aguardando vistoria` : `Com ${esc(c.userNome)} desde ${hora(c.saida)} · volta prevista ${hora(c.previsao)}`;
        if (s === 'bloqueada') sub = `${SITUACOES[v.situacao]}${v.motivoSituacao ? ': ' + esc(v.motivoSituacao) : ''}`;
        const dentro = `${figura(v)}<div><div class="meta">${chaveiro(v)}${placa(v.placa)}<span class="prio">${v.prioridade}º</span></div><div class="sub">${sub}</div></div><div>${selo(s)}</div>`;
        return c ? `<button type="button" class="vitem" data-p="cautela" data-id="${c.id}">${dentro}</button>` : `<div class="vitem">${dentro}</div>`;
      }).join('')}</div></section>
      <section class="pilha">
        <div class="caixa"><h3 style="margin-bottom:6px">Alertas</h3>${alertas.length ? alertas.map(([g, t, s, a, b]) => `<div class="alerta"><span class="ponto ${g}"></span><div><b>${esc(t)}</b><div class="pequeno suave">${esc(s)}</div></div>${b ? `<button type="button" class="btn peq" ${a}>${b}</button>` : '<span></span>'}</div>`).join('') : '<p>Nenhum alerta agora.</p>'}</div>
        ${htmlAgenda()}
        ${htmlQuadroClaviculario(nomeDe, legendaEvento)}
        <div class="caixa pilha"><h3>Relatório do dia</h3><p class="pequeno">Cautelas de hoje, viaturas fora e ocorrências, para a passagem de serviço.</p>
          <div class="linha"><button type="button" class="btn prim" data-p="hoje-pdf">${ICONE.pdf}Baixar PDF de hoje</button><button type="button" class="btn" data-p="hoje-compartilhar">${ICONE.compartilhar}Compartilhar</button></div></div>
      </section>
    </div>`;
}

/* ---------- cautelas recentes ---------- */
// Lidas de 50 em 50, das mais novas para as mais antigas ("Carregar mais"), para não gastar a cota diária de leituras.
async function carregarCautelas(mais = false) {
  if (carregandoLista || (mais && fimLista)) return;
  carregandoLista = true;
  try {
    const partes = [collection(db, 'cautelas'), orderBy('saida', 'desc')];
    if (mais && ultimoDoc) partes.push(startAfter(ultimoDoc));
    partes.push(limit(PAGINA));
    const s = await getDocs(query(...partes));
    const novos = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    recentes = mais ? [...(recentes || []), ...novos.filter((c) => !(recentes || []).some((x) => x.id === c.id))] : novos;
    recentes.sort((a, b) => b.seq - a.seq);
    if (s.docs.length) ultimoDoc = s.docs[s.docs.length - 1];
    fimLista = s.docs.length < PAGINA;
  } finally {
    carregandoLista = false;
  }
}

function substituirRecente(c) {
  if (!recentes) return;
  const i = recentes.findIndex((x) => x.id === c.id);
  if (i >= 0) recentes[i] = c; else recentes.unshift(c);
  recentes.sort((a, b) => b.seq - a.seq);
}

async function renderCautelas(caixa) {
  if (!recentes) {
    caixa.innerHTML = '<p class="vazio">Carregando…</p>';
    try {
      await carregarCautelas();
    } catch (err) {
      caixa.innerHTML = `<p class="vazio">${esc(traduzirErro(err))}</p>`; return;
    }
  }
  if (guia !== 'cautelas' || !recentes) return;
  const lista = recentes.filter((c) => !filtroVtr || c.vtrId === filtroVtr);
  const mais = fimLista ? '' : `<div class="linha" style="justify-content:center;margin-top:10px"><button type="button" class="btn" data-p="mais-cautelas">Carregar mais ${PAGINA}</button></div>`;
  caixa.innerHTML = `<div class="linha separa" style="margin-bottom:10px"><h3>Cautelas mais recentes (${lista.length}${filtroVtr ? ' desta viatura entre as carregadas' : ''})</h3>
    <label style="min-width:200px">Viatura<select id="filtro-vtr"><option value="">Todas</option>${porPrioridade().map((v) => `<option value="${v.id}" ${filtroVtr === v.id ? 'selected' : ''}>${esc(v.prefixo)} · ${esc(v.modelo)}</option>`).join('')}</select></label></div>
    <div class="tabela"><table><thead><tr><th>Nº</th><th>VTR</th><th>Militar</th><th>Saída</th><th>Missão</th><th class="d">KM</th><th>Situação</th></tr></thead><tbody>
    ${lista.map((c) => {
      const [st, stTxt] = situacaoCautela(c);
      return `<tr class="clica" data-p="cautela" data-id="${c.id}" tabindex="0"><td>${esc(c.numero)}</td><td>${chaveiro(c.vtrPrefixo)}</td><td>${esc(c.userNome)}</td><td>${dataHora(c.saida)}</td><td>${esc(c.missao)}${c.justificativa ? `<div class="pequeno" style="color:var(--atencao)">Fora da ordem: ${esc(c.justificativa)}</div>` : ''}</td><td class="d">${c.kmRetorno != null ? km(c.kmRetorno - c.kmSaida) : '—'}</td><td>${selo(st, stTxt)}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="vazio">Nenhuma cautela encontrada.</td></tr>'}</tbody></table></div>${mais}`;
}

/* ---------- avarias ---------- */
async function carregarResolvidas() {
  if (carregandoResolvidas) return;
  carregandoResolvidas = true;
  try {
    const desde = Timestamp.fromMillis(Date.now() - 90 * 86400e3);
    const s = await getDocs(query(collection(db, 'avarias'), where('em', '>=', desde)));
    resolvidas = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => a.situacao === 'resolvida');
  } catch (err) {
    console.error(err); resolvidas = [];
  } finally {
    carregandoResolvidas = false;
  }
  if (telaAtual() === 'tela-painel' && guia === 'avarias') render();
}

function htmlAvarias() {
  const nomes = { aberta: 'Aberta', apuracao: 'Em apuração', resolvida: 'Resolvida' };
  const extras = (resolvidas || []).filter((r) => !avarias.some((a) => a.id === r.id));
  const lista = [...avarias, ...extras].sort((a, b) => (a.situacao === 'resolvida') - (b.situacao === 'resolvida') || ms(b.em) - ms(a.em));
  const nota = resolvidas === null ? '<p class="pequeno suave">Carregando as resolvidas…</p>' : '<p class="pequeno suave">Aparecem as avarias em aberto e as resolvidas dos últimos 90 dias.</p>';
  if (!lista.length) return resolvidas === null ? nota : '<p class="vazio">Nenhuma avaria em aberto nem resolvida nos últimos 90 dias.</p>';
  return `${nota}<div class="lista">${lista.map((a) => {
    const v = estado.viaturas.find((x) => x.id === a.vtrId) || {};
    const bloqueia = v.situacao === 'manutencao' && v.avariaBloqueio === a.id;
    const origem = /^c\d+$/.test(a.origemProvavel || '') ? 'C-' + a.origemProvavel.slice(1).padStart(4, '0') : '—';
    return `<article class="caixa pilha">
      <div class="linha separa"><div class="linha">${chaveiro(a.vtrPrefixo)}${selo(a.gravidade === 'grave' ? 'atrasada' : 'bloqueada', a.gravidade === 'grave' ? 'Grave' : 'Leve')}</div>${selo(a.situacao === 'resolvida' ? 'neutra' : 'cautelada', nomes[a.situacao])}</div>
      <p style="margin:0;color:var(--texto)"><b>${esc(a.descricao)}</b></p>
      <dl class="kv pequeno"><dt>Registrada por</dt><dd>${esc(a.registradaNome || '—')}, ${dataHora(a.em)}</dd>
      <dt>Origem provável</dt><dd>${origem === '—' ? 'Sem cautela anterior registrada' : `cautela ${origem}`}</dd>
      ${bloqueia ? '<dt>Viatura</dt><dd>fora de uso por esta avaria</dd>' : ''}</dl>
      ${ehGestao() && a.situacao !== 'resolvida' ? `<div class="linha">
        ${a.situacao === 'aberta' ? `<button type="button" class="btn peq" data-p="avaria" data-id="${a.id}" data-s="apuracao">Pôr em apuração</button>` : ''}
        <button type="button" class="btn peq prim" data-p="avaria" data-id="${a.id}" data-s="resolvida">${bloqueia ? 'Resolver e liberar a viatura' : 'Marcar como resolvida'}</button></div>` : ''}
    </article>`;
  }).join('')}</div>`;
}

async function tratarAvaria(id, situacao) {
  const a = avarias.find((x) => x.id === id);
  const v = estado.viaturas.find((x) => x.id === a.vtrId);
  try {
    const lote = writeBatch(db);
    lote.update(doc(db, 'avarias', id), { situacao, tratadaPor: estado.eu.uid, tratadaEm: serverTimestamp() });
    if (situacao === 'resolvida' && v?.situacao === 'manutencao' && v.avariaBloqueio === id) {
      lote.update(doc(db, 'viaturas', v.id), { situacao: 'ativa', motivoSituacao: null, avariaBloqueio: null, atualizadoPor: estado.eu.uid, atualizadoEm: serverTimestamp() });
    }
    await lote.commit();
    if (situacao === 'resolvida') resolvidas = null;   // relê as resolvidas para a avaria continuar na lista
    mensagem(situacao === 'resolvida' ? 'Avaria resolvida.' : 'Avaria em apuração.');
  } catch (err) {
    console.error(err);
    mensagem(traduzirErro(err), true);
  }
}

/* ---------- encerrar cautela pela gestão (celular perdido, militar ausente) ---------- */
// Chave retirada sem vistoria: a gestão cancela a cautela (não há KM de saída para encerrar)
function cancelarChavePelaGestao(c) {
  const m = abrirModal(`<h2>Cancelar cautela ${esc(c.numero)}</h2>
    <p class="pequeno">A chave foi retirada por ${esc(c.userNome)} ${dataHora(c.saida)}, mas a vistoria não foi feita. Cancele quando a chave já estiver de volta no claviculário.</p>
    <label>Motivo<textarea id="canc-obs" maxlength="180" placeholder="Ex.: chave devolvida ao claviculário sem uso da viatura"></textarea></label>
    <p class="pequeno" id="canc-erro" style="color:var(--erro)" hidden></p>
    <div class="linha separa"><button type="button" class="btn" data-fechar-modal>Voltar</button><button type="button" class="btn perigo" id="canc-ok">Cancelar cautela</button></div>`);
  m.querySelector('#canc-ok').addEventListener('click', async (e) => {
    const obs = m.querySelector('#canc-obs').value.trim();
    if (obs.length < 10) { const p = m.querySelector('#canc-erro'); p.textContent = 'Descreva o motivo.'; p.hidden = false; return; }
    e.target.disabled = true;
    try {
      const lote = writeBatch(db);
      lote.update(doc(db, 'cautelas', c.id), { situacao: 'cancelada', canceladaEm: serverTimestamp(), motivoCancelamento: ('Cancelada pela gestão: ' + obs).slice(0, 200), encerradaPor: estado.eu.uid });
      lote.update(doc(db, 'viaturas', c.vtrId), { cautelaAtual: null, atualizadoEm: serverTimestamp() });
      lote.update(doc(db, 'usuarios', c.userId), { cautelaAtual: null });
      await lote.commit();
      fecharModal();
      mensagem(`Cautela ${c.numero} cancelada.`);
    } catch (err) {
      console.error(err);
      e.target.disabled = false;
      mensagem(traduzirErro(err), true);
    }
  });
}

function encerrarPelaGestao(c) {
  if (!ehGestao()) return;
  if (c.etapa === 'chave') return cancelarChavePelaGestao(c);
  let comb = null;
  const m = abrirModal(`<h2>Encerrar cautela ${esc(c.numero)}</h2>
    <p class="pequeno">Use só quando o militar não puder registrar a devolução. Fica registrado que a gestão encerrou, e o motivo vai para o histórico.</p>
    <label>KM no painel<input type="number" inputmode="numeric" id="enc-km" placeholder="${c.kmSaida}"></label>
    <div><span class="rotulo">Combustível</span><div class="comb" id="enc-comb">${COMB.map((t, i) => `<button type="button" data-n="${i}"><i></i>${t}</button>`).join('')}</div></div>
    <label>Motivo<textarea id="enc-obs" maxlength="500" placeholder="Ex.: militar baixado ao hospital; viatura conferida pelo oficial de dia"></textarea></label>
    <p class="pequeno" id="enc-erro" style="color:var(--erro)" hidden></p>
    <div class="linha separa"><button type="button" class="btn" data-fechar-modal>Cancelar</button><button type="button" class="btn perigo" id="enc-ok">Assinar e encerrar</button></div>`);
  m.querySelector('#enc-comb').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    comb = Number(b.dataset.n);
    m.querySelectorAll('#enc-comb button').forEach((x, i) => { x.classList.toggle('marcado', i === comb); x.classList.toggle('aceso', i <= comb); x.classList.toggle('baixo', comb === 0); });
  });
  m.querySelector('#enc-ok').addEventListener('click', async () => {
    const kmR = Number(m.querySelector('#enc-km').value), obs = m.querySelector('#enc-obs').value.trim();
    const erro = m.querySelector('#enc-erro');
    const falha = (t) => { erro.textContent = t; erro.hidden = false; };
    if (!Number.isInteger(kmR) || kmR < c.kmSaida) return falha(`Informe o KM (no mínimo ${km(c.kmSaida)}).`);
    if (comb == null) return falha('Marque o combustível.');
    if (obs.length < 10) return falha('Descreva o motivo do encerramento.');
    const assinatura = await assinar('Assinar encerramento', `Cautela ${c.numero} · VTR ${c.vtrPrefixo}`);
    if (!assinatura) return;
    try {
      await gravarDevolucao(c, { km: kmR, comb, obs: 'Encerrada pela gestão: ' + obs, justComb: null }, assinatura);
      mensagem(`Cautela ${c.numero} encerrada.`);
    } catch (err) {
      console.error(err);
      mensagem(traduzirErro(err), true);
    }
  });
}
