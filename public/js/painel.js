// SisCautela · painel da frota (conferente, gestor e administrador): situação ao vivo, cautelas,
// avarias e relatórios. A gestão também trata avarias e, em último caso, encerra uma cautela.
import {
  collection, doc, query, where, getDocs, onSnapshot, writeBatch, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import {
  db, estado, ouvir, ehGestao, $, mostrar, telaAtual, mensagem, traduzirErro, abrirModal, fecharModal,
  esc, ms, km, hora, dataHora, duracao, COMB, ATRASO_MIN, estaAtrasada, devolveuAtrasado, porPrioridade,
  statusViatura, chaveiro, placa, figura, selo, combMini, ICONE, SITUACOES
} from './nucleo.js';
import { abrirDetalheCautela, renderRelatorios, relatorioDeHoje, invalidarRelatorios } from './relatorios.js';
import { assinar } from './assinatura.js';
import { gravarDevolucao } from './cautela.js';

export const telasPainel = ['tela-painel'];

let abertas = [];
let avarias = [];
let pendentes = 0;
let guia = 'painel';
let filtroVtr = '';
let recentes = null;
const parar = [];
let ligado = false;

export function iniciarPainel() {
  if (ligado) return;
  ligado = true;
  parar.push(onSnapshot(query(collection(db, 'cautelas'), where('situacao', '==', 'aberta')), (s) => {
    abertas = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    recentes = null; invalidarRelatorios();
    atualizar();
  }, (e) => console.error(e)));
  parar.push(onSnapshot(collection(db, 'avarias'), (s) => {
    avarias = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b.em) - ms(a.em));
    atualizar();
  }, (e) => console.error(e)));
  parar.push(onSnapshot(query(collection(db, 'usuarios'), where('situacao', '==', 'pendente')), (s) => {
    pendentes = s.size; atualizar();
  }, (e) => console.error(e)));
  parar.push(ouvir('viaturas', atualizar));
  parar.push(ouvir('encerrar-cautela', encerrarPelaGestao));
  const t = setInterval(() => { if (telaAtual() === 'tela-painel' && guia !== 'relatorios' && !$('#modal').firstChild) render(); }, 30000);
  parar.push(() => clearInterval(t));
}

export function pararPainel() {
  parar.splice(0).forEach((fn) => fn());
  ligado = false; abertas = []; avarias = []; recentes = null;
}

document.getElementById('cartao-painel')?.addEventListener('click', () => { guia = 'painel'; render(); mostrar('tela-painel'); });

const cautelaDa = (vtrId) => abertas.find((c) => c.vtrId === vtrId);

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
  if (guia === 'avarias') caixa.innerHTML = htmlAvarias();
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
  if (d.p === 'usuarios') document.getElementById('cartao-gestao')?.click();
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'filtro-vtr') { filtroVtr = e.target.value; renderCautelas($('#painel-conteudo')); }
});

/* ---------- painel ---------- */
function htmlPainel() {
  const vtrs = porPrioridade();
  const st = vtrs.map((v) => statusViatura(v, cautelaDa(v.id)));
  const n = (s) => st.filter((x) => x === s).length;
  const alertas = [];
  abertas.filter((c) => estaAtrasada(c)).forEach((c) => alertas.push(['erro', `Cautela em atraso: VTR ${c.vtrPrefixo}`, `${c.userNome} · previsão ${dataHora(c.previsao)} (${duracao(Date.now() - ms(c.previsao))} atrás)`, `data-p="cautela" data-id="${c.id}"`, 'Ver']));
  abertas.filter((c) => c.divergenciaKm != null).forEach((c) => alertas.push(['atencao', `KM divergente na VTR ${c.vtrPrefixo}`, `Saída com ${km(c.kmSaida)} km; último registro com ${km(c.divergenciaKm)} km`, `data-p="cautela" data-id="${c.id}"`, 'Ver']));
  avarias.filter((a) => a.situacao === 'aberta').forEach((a) => alertas.push([a.gravidade === 'grave' ? 'erro' : 'atencao', `Avaria ${a.gravidade} na VTR ${a.vtrPrefixo}`, a.descricao, 'data-p="guia" data-g="avarias"', 'Tratar']));
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
        if (c) sub = `Com ${esc(c.userNome)} desde ${hora(c.saida)} · volta prevista ${hora(c.previsao)}`;
        if (s === 'bloqueada') sub = `${SITUACOES[v.situacao]}${v.motivoSituacao ? ': ' + esc(v.motivoSituacao) : ''}`;
        const dentro = `${figura(v)}<div><div class="meta">${chaveiro(v)}${placa(v.placa)}<span class="prio">${v.prioridade}º</span></div><div class="sub">${sub}</div></div><div>${selo(s)}</div>`;
        return c ? `<button type="button" class="vitem" data-p="cautela" data-id="${c.id}">${dentro}</button>` : `<div class="vitem">${dentro}</div>`;
      }).join('')}</div></section>
      <section class="pilha">
        <div class="caixa"><h3 style="margin-bottom:6px">Alertas</h3>${alertas.length ? alertas.map(([g, t, s, a, b]) => `<div class="alerta"><span class="ponto ${g}"></span><div><b>${esc(t)}</b><div class="pequeno suave">${esc(s)}</div></div><button type="button" class="btn peq" ${a}>${b}</button></div>`).join('') : '<p>Nenhum alerta agora.</p>'}</div>
        <div class="caixa pilha"><h3>Relatório do dia</h3><p class="pequeno">Cautelas de hoje, viaturas fora e ocorrências, para a passagem de serviço.</p>
          <div class="linha"><button type="button" class="btn prim" data-p="hoje-pdf">${ICONE.pdf}Baixar PDF de hoje</button><button type="button" class="btn" data-p="hoje-compartilhar">${ICONE.compartilhar}Compartilhar</button></div></div>
      </section>
    </div>`;
}

/* ---------- cautelas recentes ---------- */
async function renderCautelas(caixa) {
  if (!recentes) {
    caixa.innerHTML = '<p class="vazio">Carregando…</p>';
    try {
      const desde = Timestamp.fromMillis(Date.now() - 90 * 86400e3);
      const s = await getDocs(query(collection(db, 'cautelas'), where('saida', '>=', desde)));
      recentes = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.seq - a.seq);
    } catch (err) {
      caixa.innerHTML = `<p class="vazio">${esc(traduzirErro(err))}</p>`; return;
    }
  }
  if (guia !== 'cautelas') return;
  const lista = recentes.filter((c) => !filtroVtr || c.vtrId === filtroVtr);
  caixa.innerHTML = `<div class="linha separa" style="margin-bottom:10px"><h3>Cautelas dos últimos 90 dias (${lista.length})</h3>
    <label style="min-width:200px">Viatura<select id="filtro-vtr"><option value="">Todas</option>${porPrioridade().map((v) => `<option value="${v.id}" ${filtroVtr === v.id ? 'selected' : ''}>${esc(v.prefixo)} · ${esc(v.modelo)}</option>`).join('')}</select></label></div>
    <div class="tabela"><table><thead><tr><th>Nº</th><th>VTR</th><th>Militar</th><th>Saída</th><th>Missão</th><th class="d">KM</th><th>Situação</th></tr></thead><tbody>
    ${lista.map((c) => {
      const st = c.situacao === 'aberta' ? (estaAtrasada(c) ? 'atrasada' : 'cautelada') : 'neutra';
      return `<tr class="clica" data-p="cautela" data-id="${c.id}" tabindex="0"><td>${esc(c.numero)}</td><td>${chaveiro(c.vtrPrefixo)}</td><td>${esc(c.userNome)}</td><td>${dataHora(c.saida)}</td><td>${esc(c.missao)}${c.justificativa ? `<div class="pequeno" style="color:var(--atencao)">Fora da ordem: ${esc(c.justificativa)}</div>` : ''}</td><td class="d">${c.kmRetorno != null ? km(c.kmRetorno - c.kmSaida) : '—'}</td><td>${devolveuAtrasado(c) ? selo('atrasada', 'Devolveu atrasado') : selo(st, st === 'neutra' ? 'Encerrada' : st === 'cautelada' ? 'Aberta' : null)}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="vazio">Nenhuma cautela no período.</td></tr>'}</tbody></table></div>`;
}

/* ---------- avarias ---------- */
function htmlAvarias() {
  const nomes = { aberta: 'Aberta', apuracao: 'Em apuração', resolvida: 'Resolvida' };
  const lista = [...avarias].sort((a, b) => (a.situacao === 'resolvida') - (b.situacao === 'resolvida') || ms(b.em) - ms(a.em));
  if (!lista.length) return '<p class="vazio">Nenhuma avaria registrada.</p>';
  return `<div class="lista">${lista.map((a) => {
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
    mensagem(situacao === 'resolvida' ? 'Avaria resolvida.' : 'Avaria em apuração.');
  } catch (err) {
    console.error(err);
    mensagem(traduzirErro(err), true);
  }
}

/* ---------- encerrar cautela pela gestão (celular perdido, militar ausente) ---------- */
function encerrarPelaGestao(c) {
  if (!ehGestao()) return;
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
