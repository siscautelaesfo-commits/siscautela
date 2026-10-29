// SisCautela · página do militar: início, cautela (retirada), devolução, abastecimento e minhas cautelas.
import {
  doc, collection, query, where, getDocs, onSnapshot, runTransaction, writeBatch, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import {
  db, estado, ouvir, $, mostrar, telaAtual, mensagem, traduzirErro, abrirModal, fecharModal,
  esc, ms, km, hora, dataHora, duracao, nomeMilitar, COMB, FOTOS, MOTIVOS, ATRASO_MIN, KM_ALERTA,
  numeroCautela, estaAtrasada, disponiveis, porPrioridade, statusViatura, chaveiro, placa, figura, selo, combMini, ICONE, SITUACOES
} from './nucleo.js';
import { assinar } from './assinatura.js';
import * as ponte from './ponte.js';
import { abrirDetalheCautela } from './relatorios.js';

export const telasCautela = ['tela-retirada', 'tela-devolucao', 'tela-concluida', 'tela-minhas'];

let minha = null;            // minha cautela aberta (documento ao vivo)
let pararMinha = null;
let idMinha = null;
let rascunho = null;         // cautela ou devolução sendo preenchida
let ultima = null;           // última cautela/devolução registrada (tela de concluída)
let iniciado = false;
const pararOutros = [];

/* ---------- ciclo de vida ---------- */
export function iniciarCautelas() {
  ponte.configurar();
  acompanharMinha();
  if (iniciado) return renderInicio();
  iniciado = true;
  pararOutros.push(ouvir('viaturas', () => {
    renderInicio();
    if (telaAtual() === 'tela-retirada' && rascunho?.passo === 1) renderRetirada();
  }));
  pararOutros.push(ouvir('eu', acompanharMinha));
  pararOutros.push(ponte.ouvirFila(mostrarFila));
  pararOutros.push(ponte.ouvirEnvios(aoEnviarFoto));
  setInterval(() => { if (telaAtual() === 'tela-inicio' && !rascunho) renderInicio(); }, 30000);
  renderInicio();
}

export function pararCautelas() {
  pararMinha?.(); pararMinha = null; idMinha = null; minha = null; rascunho = null;
}

function acompanharMinha() {
  const id = estado.eu?.cautelaAtual || null;
  if (id === idMinha) return;
  pararMinha?.(); pararMinha = null; minha = null; idMinha = id;
  if (id) {
    pararMinha = onSnapshot(doc(db, 'cautelas', id), (s) => {
      minha = s.exists() ? { id: s.id, ...s.data() } : null;
      renderInicio();
    }, (err) => console.error(err));
  }
  renderInicio();
}

function mostrarFila(estadoFila) {
  const el = $('#fila-fotos');
  if (!el) return;
  const n = estadoFila.pendentes, f = estadoFila.falhas.length;
  el.hidden = !n && !f;
  el.classList.toggle('pendente', n > 0);
  el.textContent = f ? `${f} foto(s) recusada(s) pelo servidor` :
    !ponte.ponteLigada() ? `${n} foto(s) guardada(s) no celular` :
    estadoFila.offline ? `${n} foto(s) aguardando internet` : `Enviando ${n} foto(s)…`;
}

// Quando as fotos da devolução terminam de subir, pede o termo em PDF ao Drive
const termosPedidos = new Set();
async function aoEnviarFoto(item) {
  if (item.momento !== 'devolucao' || termosPedidos.has(item.ref)) return;
  const fila = await new Promise((r) => { const parar = ponte.ouvirFila((e) => { parar(); r(e); }); });
  if (fila.pendentes) return;
  termosPedidos.add(item.ref);
  ponte.pedirTermo(item.ref).catch(() => termosPedidos.delete(item.ref));
}

/* ---------- início ---------- */
function renderInicio() {
  const caixa = $('#inicio-cautela');
  if (!caixa || !estado.eu) return;
  let h = '';
  if (estado.eu.cautelaAtual) {
    if (!minha) { caixa.innerHTML = '<div class="caixa">Carregando a sua cautela…</div>'; return; }
    const v = estado.viaturas.find((x) => x.id === minha.vtrId) || { prefixo: minha.vtrPrefixo, modelo: '' };
    const atraso = estaAtrasada(minha), falta = ms(minha.previsao) - Date.now();
    h += `<section class="caixa ${atraso ? 'critica' : 'destaque'} pilha">
      <div class="linha separa"><span class="rotulo">Sua cautela aberta · ${esc(minha.numero)}</span>${atraso ? selo('atrasada') : selo('cautelada', 'Em andamento')}</div>
      <div class="linha">${chaveiro(v)}${placa(v.placa)}<span class="suave">${esc(v.modelo)}</span></div>
      <div class="cartoes" style="margin:0">
        <div><div class="rotulo">${falta >= 0 ? 'Volta prevista em' : 'Passou da previsão há'}</div><div class="grande">${duracao(falta)}</div><div class="pequeno suave">prevista para ${dataHora(minha.previsao)}</div></div>
        <dl class="kv"><dt>Missão</dt><dd>${esc(minha.missao)}</dd><dt>Saída</dt><dd>${dataHora(minha.saida)}</dd><dt>KM de saída</dt><dd>${km(minha.kmSaida)}</dd></dl>
      </div>
      ${atraso ? '<div class="alerta-caixa erro">A cautela está em atraso e o gestor é avisado. Devolva a viatura ou fale com o gestor.</div>' : ''}
      <button type="button" class="primario" data-c="devolver">Devolver viatura</button>
      <div class="linha"><button type="button" class="btn" data-c="abastecer">Registrar abastecimento</button>
      <button type="button" class="btn leve" data-c="ver-minha">Ver cautela</button></div>
    </section>`;
  } else {
    const disp = disponiveis();
    h += `<section class="pilha"><div><h2>Disponíveis para cautela (${disp.length})</h2>
      <p class="pequeno">Na ordem de prioridade: as mais antigas primeiro. Toque na viatura para cautelar; outra que não a primeira pede o motivo.</p></div>
      ${disp.length ? `<div class="vlista">${disp.map((v, i) => itemViatura(v, {
        prio: i + 1, acao: `data-c="cautelar" data-id="${v.id}"`,
        direita: `<span class="btn peq ${i === 0 ? 'prim' : ''}">Cautelar</span>`,
      })).join('')}</div>` : '<div class="alerta-caixa atencao">Nenhuma viatura disponível no momento.</div>'}</section>`;
  }
  const fora = porPrioridade().filter((v) => !(v.situacao === 'ativa' && !v.cautelaAtual) && v.id !== minha?.vtrId);
  if (fora.length) {
    h += `<section class="secao"><h3>Indisponíveis agora (${fora.length})</h3>
      <div class="vlista">${fora.map((v) => itemViatura(v)).join('')}</div></section>`;
  }
  caixa.innerHTML = h;
}

function itemViatura(v, o = {}) {
  const st = statusViatura(v);
  let sub = `${esc(v.modelo)} · ${km(v.kmAtual)} km`;
  if (st === 'bloqueada') sub = `${SITUACOES[v.situacao] || v.situacao}${v.motivoSituacao ? ': ' + esc(v.motivoSituacao) : ''}`;
  if (st === 'cautelada') sub = `${esc(v.modelo)} · cautelada`;
  const dentro = `${figura(v)}<div><div class="meta">${chaveiro(v)}${placa(v.placa)}${o.prio ? `<span class="prio ${o.prio === 1 ? 'primeira' : ''}">${o.prio === 1 ? 'PRIORIDADE' : o.prio + 'ª NA FILA'}</span>` : ''}</div><div class="sub">${sub}</div></div><div>${o.direita ?? selo(st)}</div>`;
  return o.acao ? `<button type="button" class="vitem ${o.sel ? 'sel' : ''}" ${o.acao}>${dentro}</button>` : `<div class="vitem">${dentro}</div>`;
}

/* ---------- ações (um só ouvinte para as telas deste módulo) ---------- */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-c]');
  if (!b || b.disabled) return;
  const acao = b.dataset.c;
  const fn = ACOES[acao];
  if (fn) fn(b.dataset, b);
});

const ACOES = {
  cautelar: (d) => iniciarRetirada(d.id),
  devolver: () => iniciarDevolucao(),
  abastecer: () => abrirAbastecimento(),
  'ver-minha': () => minha && abrirDetalheCautela(minha),
  cancelar: () => { rascunho = null; mostrar('tela-inicio'); renderInicio(); },
  'escolher-vtr': (d) => { rascunho.vtrId = d.id; rascunho.km = null; rascunho.erro = ''; renderRetirada(); },
  motivo: (d) => { rascunho.motivo = d.m; renderRetirada(); },
  'prev-rapida': (d) => { rascunho.previsao = paraLocal(new Date(Date.now() + Number(d.h) * 3600e3)); renderRetirada(); },
  comb: (d) => { rascunho.comb = Number(d.n); rascunho.erro = ''; rerender(); },
  grav: (d) => { rascunho.avGrav = d.g; rerender(); },
  voltar: () => { rascunho.passo--; rascunho.erro = ''; renderRetirada(); window.scrollTo(0, 0); },
  avancar: () => avancar(),
  'assinar-retirada': () => assinarRetirada(),
  'assinar-devolucao': () => assinarDevolucao(),
  inicio: () => { mostrar('tela-inicio'); renderInicio(); },
  'ver-ultima': () => ultima && abrirDetalheCautela(ultima),
  'abrir-cautela': (d) => { const c = listaMinhas.find((x) => x.id === d.id); if (c) abrirDetalheCautela(c); },
};
function rerender() {
  if (rascunho?.tipo === 'retirada') return renderRetirada();
  if (rascunho?.tipo === 'devolucao') return renderDevolucao();
  if (rascunho?.tipo === 'abastecimento') {
    const caixa = $('#cupom-foto');
    if (caixa) caixa.innerHTML = blocoFoto('cupom', 'Cupom fiscal', rascunho.fotos.cupom, 'fotos');
  }
}

// Campos de texto e caixas de marcar dos formulários
document.addEventListener('input', (e) => {
  const f = e.target.dataset?.f;
  if (!f || !rascunho || e.target.type === 'checkbox' || e.target.type === 'file') return;
  rascunho[f] = e.target.value;
  if (f === 'km') avisoKm(e.target.value);
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (!rascunho) return;
  if (el.dataset?.f && el.type === 'checkbox') { rascunho[el.dataset.f] = el.checked; rerender(); return; }
  if (el.dataset?.foto && el.files?.[0]) {
    try {
      const blob = await comprimir(el.files[0]);
      const grupo = rascunho[el.dataset.grupo];
      if (grupo[el.dataset.foto]?.url) URL.revokeObjectURL(grupo[el.dataset.foto].url);
      grupo[el.dataset.foto] = { blob, url: URL.createObjectURL(blob) };
      rascunho.erro = '';
      rerender();
    } catch {
      mensagem('Não foi possível ler a foto. Tente de novo.', true);
    }
  }
});

function avisoKm(valor) {
  if (rascunho.tipo === 'retirada') {
    const v = estado.viaturas.find((x) => x.id === rascunho.vtrId);
    const box = $('#aviso-km'); if (box) box.hidden = Number(valor) === v?.kmAtual;
  } else {
    const r = Number(valor) - minha.kmSaida;
    const dica = $('#km-rodado');
    if (dica) dica.innerHTML = valor !== '' && r >= 0 ? `Rodou <b>${km(r)} km</b> nesta cautela.` : 'Não pode ser menor que o KM de saída.';
    const conf = $('#km-confirma'); if (conf) conf.hidden = !(valor !== '' && r > KM_ALERTA);
  }
}

/* ---------- fotos ---------- */
function comprimir(arquivo) {
  return new Promise((ok, falha) => {
    const img = new Image();
    const url = URL.createObjectURL(arquivo);
    img.onload = () => {
      const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? ok(b) : falha(new Error('foto'))), 'image/jpeg', 0.72);
    };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error('foto')); };
    img.src = url;
  });
}
function blocoFoto(chave, rotulo, foto, grupo) {
  const input = `<input type="file" accept="image/*" capture="environment" data-foto="${chave}" data-grupo="${grupo}" aria-label="Fotografar: ${esc(rotulo)}">`;
  if (foto?.url) return `<div class="foto tem"><img src="${foto.url}" alt="${esc(rotulo)}"><span class="leg">${esc(rotulo)}</span>${input}</div>`;
  return `<label class="foto">${ICONE.camera}${esc(rotulo)}${input}</label>`;
}
function seletorComb(valor) {
  return `<div class="comb" role="group" aria-label="Nível de combustível">${COMB.map((t, i) =>
    `<button type="button" data-c="comb" data-n="${i}" class="${valor === i ? 'marcado' : ''} ${valor != null && i <= valor ? 'aceso' : ''} ${valor === 0 ? 'baixo' : ''}" aria-pressed="${valor === i}"><i></i>${t}</button>`).join('')}</div>`;
}
function blocoAvaria(titulo, dica) {
  const r = rascunho;
  return `<label class="opcao"><input type="checkbox" data-f="avaria" ${r.avaria ? 'checked' : ''}> ${esc(titulo)}</label>
    <span class="dica">${esc(dica)}</span>
    ${r.avaria ? `<div class="recuo">
      <label>O que encontrou<textarea data-f="avDesc" maxlength="500" placeholder="Ex.: amassado na porta traseira esquerda">${esc(r.avDesc)}</textarea></label>
      <div><span class="rotulo">Gravidade</span><div class="chips">${[['leve', 'Leve: pode rodar'], ['grave', 'Grave: não pode rodar']].map(([k, t]) =>
        `<button type="button" class="chip" data-c="grav" data-g="${k}" aria-pressed="${r.avGrav === k}">${t}</button>`).join('')}</div></div>
      <div><span class="rotulo">Fotos da avaria</span><div class="fotos">${blocoFoto('f1', 'Avaria 1', r.avFotos.f1, 'avFotos')}${blocoFoto('f2', 'Avaria 2', r.avFotos.f2, 'avFotos')}</div></div>
    </div>` : ''}`;
}
const fotosFaltando = (fotos) => FOTOS.filter(([k]) => !fotos[k]).map(([, r]) => r);
const paraLocal = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const erroUsuario = (msg) => Object.assign(new Error(msg), { mensagemUsuario: msg });

/* ---------- cautela (retirada) ---------- */
function iniciarRetirada(vtrId) {
  if (estado.eu.cautelaAtual) return mensagem('Você já tem uma cautela aberta. Devolva antes de cautelar outra.', true);
  const disp = disponiveis();
  if (!disp.length) return mensagem('Nenhuma viatura disponível no momento.', true);
  const prev = new Date(Date.now() + 2 * 3600e3);
  prev.setMinutes(Math.ceil(prev.getMinutes() / 15) * 15, 0, 0);
  rascunho = {
    tipo: 'retirada', passo: 1, vtrId: vtrId || disp[0].id, sugerida: disp[0].id, motivo: '', motivoTxt: '',
    missao: '', previsao: paraLocal(prev), km: null, comb: null, fotos: {}, avaria: false, avDesc: '', avGrav: 'leve', avFotos: {}, erro: '',
  };
  renderRetirada();
  mostrar('tela-retirada');
}

function renderRetirada() {
  const r = rascunho;
  if (!r || r.tipo !== 'retirada') return;
  const v = estado.viaturas.find((x) => x.id === r.vtrId);
  const nomes = ['Viatura', 'Missão', 'Estado da viatura', 'Assinatura'];
  let h = `<div class="linha separa"><div><span class="rotulo">Nova cautela</span><h1 style="margin:0">Cautelar viatura</h1></div><button type="button" class="btn leve" data-c="cancelar">Cancelar</button></div>
    <ol class="passos">${nomes.map((n, i) => `<li class="${i + 1 === r.passo ? 'atual' : i + 1 < r.passo ? 'feito' : ''}">${n}</li>`).join('')}</ol>`;
  if (r.passo === 1) {
    const disp = disponiveis();
    if (!disp.some((x) => x.id === r.vtrId)) { r.vtrId = disp[0]?.id; }
    r.sugerida = disp[0]?.id;
    h += `<div><h2>Qual viatura você vai cautelar?</h2><p class="pequeno">Na ordem de prioridade, das mais antigas para as mais novas.</p></div>
      <div class="vlista">${disp.map((x, i) => itemViatura(x, { prio: i + 1, acao: `data-c="escolher-vtr" data-id="${x.id}"`, sel: x.id === r.vtrId,
        direita: x.id === r.vtrId ? '<span class="selo s-disponivel">Esta</span>' : '' })).join('') || '<div class="alerta-caixa atencao">Nenhuma viatura disponível.</div>'}</div>`;
    if (r.vtrId && r.vtrId !== r.sugerida) {
      const sug = estado.viaturas.find((x) => x.id === r.sugerida);
      h += `<div class="caixa pilha"><div class="alerta-caixa atencao">Esta não é a viatura prioritária (${esc(sug?.prefixo)}). Informe o motivo; ele fica no histórico e no relatório do gestor.</div>
        <div class="chips">${MOTIVOS.map((m) => `<button type="button" class="chip" data-c="motivo" data-m="${esc(m)}" aria-pressed="${r.motivo === m}">${esc(m)}</button>`).join('')}</div>
        ${r.motivo === 'Outro motivo' ? `<label>Descreva o motivo<input data-f="motivoTxt" maxlength="150" value="${esc(r.motivoTxt)}"></label>` : ''}</div>`;
    }
  }
  if (r.passo === 2) {
    h += `<div class="caixa pilha">
      <div class="linha">${chaveiro(v)}${placa(v.placa)}<span class="suave">${esc(v.modelo)}</span></div>
      <label>Missão ou destino<input data-f="missao" maxlength="150" value="${esc(r.missao)}" placeholder="Ex.: condução de cadetes ao HPM"></label>
      <label>Previsão de retorno<input type="datetime-local" data-f="previsao" value="${esc(r.previsao)}"></label>
      <div class="chips">${[1, 2, 4].map((n) => `<button type="button" class="chip" data-c="prev-rapida" data-h="${n}">daqui a ${n} h</button>`).join('')}</div>
      <span class="dica">Passados ${ATRASO_MIN} min da previsão, a cautela fica em atraso e o gestor é avisado.</span></div>`;
  }
  if (r.passo === 3) {
    const kmVal = r.km ?? v.kmAtual;
    h += `<div class="caixa pilha">
      <label>KM no painel<input type="number" inputmode="numeric" data-f="km" value="${esc(kmVal)}"></label>
      <span class="dica">A última devolução registrou <b>${km(v.kmAtual)} km</b>. Confira com o painel.</span>
      <div id="aviso-km" class="alerta-caixa atencao" ${Number(kmVal) === v.kmAtual ? 'hidden' : ''}>KM diferente do último registro. A diferença vai para o gestor.</div>
      <div><span class="rotulo">Combustível</span>${seletorComb(r.comb)}</div>
      <div><span class="rotulo">Fotos da viatura (5)</span><div class="fotos">${FOTOS.map(([k, t]) => blocoFoto(k, t, r.fotos[k], 'fotos')).join('')}</div></div>
      ${blocoAvaria('Encontrou avaria antes de sair?', 'A avaria fica registrada com fotos e ligada à cautela anterior, para apuração. Avaria grave tira a viatura de uso.')}
    </div>`;
  }
  if (r.passo === 4) {
    h += `<div class="caixa pilha"><h2>Confira e assine</h2>
      <dl class="kv"><dt>Viatura</dt><dd>${chaveiro(v)} ${placa(v.placa)}</dd>
      ${r.vtrId !== r.sugerida ? `<dt>Fora da ordem</dt><dd>${esc(r.motivo === 'Outro motivo' ? r.motivoTxt : r.motivo)}</dd>` : ''}
      <dt>Missão</dt><dd>${esc(r.missao)}</dd><dt>Volta prevista</dt><dd>${dataHora(new Date(r.previsao).getTime())}</dd>
      <dt>KM de saída</dt><dd>${km(r.km ?? v.kmAtual)}</dd><dt>Combustível</dt><dd>${combMini(r.comb)}</dd>
      <dt>Fotos</dt><dd>${Object.keys(r.fotos).length} de 5</dd>${r.avaria ? `<dt>Avaria</dt><dd>${esc(r.avDesc)} (${r.avGrav})</dd>` : ''}</dl>
      <p class="pequeno">Ao assinar, a viatura e a chave ficam em seu nome até a devolução assinada.</p></div>`;
  }
  if (r.erro) h += `<div class="alerta-caixa erro" role="alert">${esc(r.erro)}</div>`;
  h += `<div class="linha separa">${r.passo > 1 ? '<button type="button" class="btn" data-c="voltar">Voltar</button>' : '<span></span>'}
    ${r.passo < 4 ? '<button type="button" class="btn prim" data-c="avancar">Continuar</button>' : `<button type="button" class="btn prim" data-c="assinar-retirada" id="btn-assinar">${ICONE.digital}Assinar cautela</button>`}</div>`;
  $('#retirada-conteudo').innerHTML = h;
}

function validarPasso() {
  const r = rascunho, v = estado.viaturas.find((x) => x.id === r.vtrId);
  if (r.passo === 1) {
    if (!v) return 'Escolha a viatura.';
    if (r.vtrId !== r.sugerida && (!r.motivo || (r.motivo === 'Outro motivo' && r.motivoTxt.trim().length < 5))) return 'Informe o motivo de não usar a viatura prioritária.';
  }
  if (r.passo === 2) {
    if (r.missao.trim().length < 3) return 'Informe a missão ou o destino.';
    const t = new Date(r.previsao).getTime();
    if (!t || t <= Date.now() + 60000) return 'A previsão de retorno precisa ser depois de agora.';
    if (t > Date.now() + 24 * 3600e3) return 'A previsão de retorno pode ser de até 24 horas.';
  }
  if (r.passo === 3) {
    const k = Number(r.km ?? v.kmAtual);
    if (!Number.isInteger(k) || k < 0) return 'Informe o KM do painel (só números).';
    if (r.comb == null) return 'Marque o nível de combustível.';
    const falta = fotosFaltando(r.fotos);
    if (falta.length) return 'Faltam fotos: ' + falta.join(', ') + '.';
    if (r.avaria && r.avDesc.trim().length < 5) return 'Descreva a avaria encontrada.';
    if (r.avaria && !r.avFotos.f1) return 'Fotografe a avaria.';
  }
  return '';
}

async function avancar() {
  const r = rascunho;
  r.erro = validarPasso();
  if (!r.erro && r.passo === 3 && r.avaria && r.avGrav === 'grave') return bloquearPorAvaria();
  if (!r.erro) r.passo++;
  renderRetirada();
  window.scrollTo(0, r.erro ? document.body.scrollHeight : 0);
}

// Avaria grave encontrada antes de sair: registra, tira a viatura de uso e volta ao início
async function bloquearPorAvaria() {
  const r = rascunho, v = estado.viaturas.find((x) => x.id === r.vtrId);
  const botao = $('[data-c="avancar"]'); if (botao) botao.disabled = true;
  try {
    const lote = writeBatch(db);
    const avRef = doc(collection(db, 'avarias'));
    lote.set(avRef, {
      vtrId: v.id, vtrPrefixo: v.prefixo, cautelaId: null, origemProvavel: v.ultimaCautela || null,
      descricao: r.avDesc.trim(), gravidade: 'grave', situacao: 'aberta', registradaPor: estado.eu.uid,
      registradaNome: nomeMilitar(estado.eu), em: serverTimestamp(),
    });
    lote.update(doc(db, 'viaturas', v.id), {
      situacao: 'manutencao', motivoSituacao: ('Avaria grave: ' + r.avDesc.trim()).slice(0, 200), avariaBloqueio: avRef.id, atualizadoEm: serverTimestamp(),
    });
    await lote.commit();
    await enfileirar('avaria', avRef.id, r.avFotos);
    rascunho = null;
    mostrar('tela-inicio');
    renderInicio();
    mensagem(`VTR ${v.prefixo} tirada de uso pela avaria grave. O gestor foi avisado; escolha outra viatura.`);
  } catch (err) {
    console.error(err);
    r.erro = traduzirErro(err);
    renderRetirada();
  }
}

async function assinarRetirada() {
  const r = rascunho, v = estado.viaturas.find((x) => x.id === r.vtrId);
  const assinatura = await assinar('Assinar cautela', `Viatura ${v.prefixo} · ${r.missao.trim()}`);
  if (!assinatura) return;
  const botao = $('#btn-assinar'); if (botao) { botao.disabled = true; botao.textContent = 'Registrando…'; }
  const kmSaida = Number(r.km ?? v.kmAtual);
  try {
    const res = await runTransaction(db, async (tx) => {
      const refCont = doc(db, 'contadores', 'cautelas');
      const refV = doc(db, 'viaturas', v.id);
      const refU = doc(db, 'usuarios', estado.eu.uid);
      const [sCont, sV, sU] = [await tx.get(refCont), await tx.get(refV), await tx.get(refU)];
      const vv = sV.data();
      if (vv.situacao !== 'ativa' || vv.cautelaAtual) throw erroUsuario('Esta viatura acabou de ser cautelada ou saiu de uso. Escolha outra.');
      if (sU.data().cautelaAtual) throw erroUsuario('Você já tem uma cautela aberta.');
      const seq = (sCont.exists() ? sCont.data().ultimo : 0) + 1;
      const id = 'c' + seq;
      const cautela = {
        seq, numero: numeroCautela(seq), vtrId: v.id, vtrPrefixo: v.prefixo, userId: estado.eu.uid, userNome: nomeMilitar(estado.eu),
        missao: r.missao.trim(), justificativa: r.vtrId !== r.sugerida ? (r.motivo === 'Outro motivo' ? r.motivoTxt.trim() : r.motivo) : null,
        saida: serverTimestamp(), previsao: Timestamp.fromDate(new Date(r.previsao)), kmSaida, combSaida: r.comb,
        divergenciaKm: kmSaida !== vv.kmAtual ? vv.kmAtual : null,
        assinaturaSaida: { metodo: assinatura.metodo, em: serverTimestamp() }, situacao: 'aberta',
      };
      tx.set(refCont, { ultimo: seq });
      tx.set(doc(db, 'cautelas', id), cautela);
      tx.update(refV, { cautelaAtual: id, kmAtual: kmSaida, combNivel: r.comb, atualizadoEm: serverTimestamp() });
      tx.update(refU, { cautelaAtual: id });
      let avariaId = null;
      if (r.avaria) {
        const avRef = doc(collection(db, 'avarias'));
        avariaId = avRef.id;
        tx.set(avRef, {
          vtrId: v.id, vtrPrefixo: v.prefixo, cautelaId: id, origemProvavel: vv.ultimaCautela || null,
          descricao: r.avDesc.trim(), gravidade: 'leve', situacao: 'aberta', registradaPor: estado.eu.uid,
          registradaNome: nomeMilitar(estado.eu), em: serverTimestamp(),
        });
      }
      return { id, cautela, avariaId };
    });
    await enfileirar('retirada', res.id, r.fotos);
    if (res.avariaId) await enfileirar('avaria', res.avariaId, r.avFotos);
    ultima = { id: res.id, ...res.cautela, saida: Timestamp.now(), assinaturaSaida: { metodo: assinatura.metodo, em: Timestamp.now() } };
    rascunho = null;
    telaConcluida('retirada', v);
  } catch (err) {
    console.error(err);
    r.erro = traduzirErro(err);
    renderRetirada();
    window.scrollTo(0, document.body.scrollHeight);
  }
}

async function enfileirar(momento, ref, fotos) {
  for (const [slot, f] of Object.entries(fotos || {})) {
    if (!f?.blob) continue;
    await ponte.enfileirarFoto({ momento, ref, slot, foto: f.blob });
  }
}

/* ---------- devolução ---------- */
function iniciarDevolucao() {
  if (!minha) return;
  rascunho = { tipo: 'devolucao', km: '', kmOk: false, comb: null, fotos: {}, obs: '', avaria: false, avDesc: '', avGrav: 'leve', avFotos: {}, abast: false, litros: '', valor: '', posto: '', justComb: '', erro: '' };
  renderDevolucao();
  mostrar('tela-devolucao');
}

function renderDevolucao() {
  const r = rascunho, c = minha;
  if (!r || r.tipo !== 'devolucao' || !c) return;
  const v = estado.viaturas.find((x) => x.id === c.vtrId) || { prefixo: c.vtrPrefixo };
  const rodou = r.km !== '' ? Number(r.km) - c.kmSaida : null;
  $('#devolucao-conteudo').innerHTML = `
    <div class="linha separa"><div><span class="rotulo">Devolução · ${esc(c.numero)}</span><h1 style="margin:0">Devolver viatura</h1></div><button type="button" class="btn leve" data-c="cancelar">Cancelar</button></div>
    <div class="caixa pilha">
      <div class="linha">${chaveiro(v)}${placa(v.placa)}<span class="suave">saiu ${dataHora(c.saida)} com ${km(c.kmSaida)} km</span></div>
      <label>KM no painel agora<input type="number" inputmode="numeric" data-f="km" value="${esc(r.km)}" placeholder="${c.kmSaida}"></label>
      <span class="dica" id="km-rodado">${rodou != null && rodou >= 0 ? `Rodou <b>${km(rodou)} km</b> nesta cautela.` : 'Não pode ser menor que o KM de saída.'}</span>
      <label class="opcao" id="km-confirma" ${rodou != null && rodou > KM_ALERTA ? '' : 'hidden'}><input type="checkbox" data-f="kmOk" ${r.kmOk ? 'checked' : ''}> Confirmo o KM: mais de ${KM_ALERTA} km rodados</label>
      <div><span class="rotulo">Combustível</span>${seletorComb(r.comb)}</div>
      ${r.comb === 0 ? `<div class="recuo erro"><div class="alerta-caixa erro">Abaixo de 1/4: registre o abastecimento ou justifique.</div>
        <label class="opcao"><input type="checkbox" data-f="abast" ${r.abast ? 'checked' : ''}> Abasteci durante a cautela</label>
        ${r.abast ? `<div class="filtros"><label>Litros<input type="number" inputmode="decimal" data-f="litros" value="${esc(r.litros)}"></label>
          <label>Valor (R$)<input type="number" inputmode="decimal" data-f="valor" value="${esc(r.valor)}"></label>
          <label>Posto<input data-f="posto" maxlength="80" value="${esc(r.posto)}"></label></div>`
        : `<label>Justificativa<input data-f="justComb" maxlength="200" value="${esc(r.justComb)}" placeholder="Ex.: posto credenciado fechado"></label>`}</div>` : ''}
      <div><span class="rotulo">Fotos da viatura (5)</span><div class="fotos">${FOTOS.map(([k, t]) => blocoFoto(k, t, r.fotos[k], 'fotos')).join('')}</div></div>
      ${blocoAvaria('Houve avaria durante a cautela?', 'Registre com fotos. Avaria grave tira a viatura de uso até o gestor liberar.')}
      <label>Observações (opcional)<textarea data-f="obs" maxlength="500">${esc(r.obs)}</textarea></label>
    </div>
    ${r.erro ? `<div class="alerta-caixa erro" role="alert">${esc(r.erro)}</div>` : ''}
    <button type="button" class="primario" data-c="assinar-devolucao" id="btn-assinar">${ICONE.digital}Assinar devolução</button>`;
}

function validarDevolucao() {
  const r = rascunho, c = minha;
  const k = Number(r.km);
  if (r.km === '' || !Number.isInteger(k)) return 'Informe o KM do painel (só números).';
  if (k < c.kmSaida) return `O KM não pode ser menor que o de saída (${km(c.kmSaida)}).`;
  if (k - c.kmSaida > 5000) return 'KM muito acima do de saída. Confira o painel.';
  if (k - c.kmSaida > KM_ALERTA && !r.kmOk) return 'Confirme o KM: a quilometragem rodada está acima do normal.';
  if (r.comb == null) return 'Marque o nível de combustível.';
  if (r.comb === 0 && r.abast && (!(Number(r.litros) > 0) || !(Number(r.valor) >= 0) || r.valor === '')) return 'Informe litros e valor do abastecimento.';
  if (r.comb === 0 && !r.abast && r.justComb.trim().length < 5) return 'Justifique a devolução com combustível na reserva.';
  const falta = fotosFaltando(r.fotos);
  if (falta.length) return 'Faltam fotos: ' + falta.join(', ') + '.';
  if (r.avaria && r.avDesc.trim().length < 5) return 'Descreva a avaria.';
  if (r.avaria && !r.avFotos.f1) return 'Fotografe a avaria.';
  return '';
}

async function assinarDevolucao() {
  const r = rascunho, c = minha;
  r.erro = validarDevolucao();
  if (r.erro) { renderDevolucao(); window.scrollTo(0, document.body.scrollHeight); return; }
  const assinatura = await assinar('Assinar devolução', `Viatura ${c.vtrPrefixo} · ${km(Number(r.km))} km`);
  if (!assinatura) return;
  const botao = $('#btn-assinar'); if (botao) { botao.disabled = true; botao.textContent = 'Registrando…'; }
  try {
    const res = await gravarDevolucao(c, {
      km: Number(r.km), comb: r.comb, obs: r.obs.trim() || null,
      justComb: r.comb === 0 && !r.abast ? r.justComb.trim() : null,
      abastecimento: r.comb === 0 && r.abast ? { litros: Number(r.litros), valor: Number(r.valor), posto: r.posto.trim() || null } : null,
      avaria: r.avaria ? { descricao: r.avDesc.trim(), gravidade: r.avGrav } : null,
    }, assinatura);
    await enfileirar('devolucao', c.id, r.fotos);
    if (res.avariaId) await enfileirar('avaria', res.avariaId, r.avFotos);
    const v = estado.viaturas.find((x) => x.id === c.vtrId) || { prefixo: c.vtrPrefixo };
    ultima = { ...c, situacao: 'encerrada', devolucao: Timestamp.now(), kmRetorno: Number(r.km), combRetorno: r.comb, assinaturaRetorno: { metodo: assinatura.metodo, em: Timestamp.now() } };
    rascunho = null;
    telaConcluida('devolucao', v);
  } catch (err) {
    console.error(err);
    r.erro = traduzirErro(err);
    renderDevolucao();
    window.scrollTo(0, document.body.scrollHeight);
  }
}

/**
 * Grava a devolução (usada pelo próprio militar e pela gestão, que pode encerrar em último caso).
 * dados: { km, comb, obs, justComb, abastecimento?, avaria? }
 */
export async function gravarDevolucao(c, dados, assinatura) {
  const uid = estado.eu.uid;
  const lote = writeBatch(db);
  lote.update(doc(db, 'cautelas', c.id), {
    situacao: 'encerrada', devolucao: serverTimestamp(), kmRetorno: dados.km, combRetorno: dados.comb,
    assinaturaRetorno: { metodo: assinatura.metodo, em: serverTimestamp() },
    obs: dados.obs || null, justComb: dados.justComb || null, encerradaPor: uid,
  });
  lote.update(doc(db, 'viaturas', c.vtrId), { cautelaAtual: null, ultimaCautela: c.id, kmAtual: dados.km, combNivel: dados.comb, atualizadoEm: serverTimestamp() });
  lote.update(doc(db, 'usuarios', c.userId), { cautelaAtual: null });
  if (dados.abastecimento && c.userId === uid) {
    lote.set(doc(collection(db, 'abastecimentos')), {
      cautelaId: c.id, vtrId: c.vtrId, vtrPrefixo: c.vtrPrefixo, userId: uid, userNome: nomeMilitar(estado.eu),
      em: serverTimestamp(), km: dados.km, ...dados.abastecimento,
    });
  }
  let avariaId = null;
  const avLeve = dados.avaria && dados.avaria.gravidade === 'leve' && c.userId === uid;
  if (avLeve) {
    const avRef = doc(collection(db, 'avarias'));
    avariaId = avRef.id;
    lote.set(avRef, {
      vtrId: c.vtrId, vtrPrefixo: c.vtrPrefixo, cautelaId: c.id, origemProvavel: c.id, descricao: dados.avaria.descricao,
      gravidade: 'leve', situacao: 'aberta', registradaPor: uid, registradaNome: nomeMilitar(estado.eu), em: serverTimestamp(),
    });
  }
  await lote.commit();
  // Avaria grave: depois da devolução, registra e tira a viatura de uso (gravação separada)
  if (dados.avaria && !avLeve) {
    const lote2 = writeBatch(db);
    const avRef = doc(collection(db, 'avarias'));
    avariaId = avRef.id;
    lote2.set(avRef, {
      vtrId: c.vtrId, vtrPrefixo: c.vtrPrefixo, cautelaId: null, origemProvavel: c.id, descricao: dados.avaria.descricao,
      gravidade: dados.avaria.gravidade, situacao: 'aberta', registradaPor: uid, registradaNome: nomeMilitar(estado.eu), em: serverTimestamp(),
    });
    if (dados.avaria.gravidade === 'grave') {
      lote2.update(doc(db, 'viaturas', c.vtrId), {
        situacao: 'manutencao', motivoSituacao: ('Avaria grave: ' + dados.avaria.descricao).slice(0, 200), avariaBloqueio: avRef.id, atualizadoEm: serverTimestamp(),
      });
    }
    await lote2.commit();
  }
  return { avariaId };
}

/* ---------- concluída ---------- */
function telaConcluida(tipo, v) {
  const c = ultima;
  $('#concluida-conteudo').innerHTML = tipo === 'retirada' ? `
    <section class="caixa concluido">
      <div class="digital ok">${ICONE.ok}</div>
      <span class="rotulo">Cautela ${esc(c.numero)} assinada às ${hora(Date.now())}</span>
      <h1 style="margin:0">Cautela registrada</h1>
      ${chaveiro(v, 'xl')}
      <div class="linha" style="justify-content:center">${placa(v.placa)}<span class="suave">${esc(v.modelo || '')}</span></div>
      <p>A viatura e a chave estão em seu nome até a devolução. Volta prevista para ${dataHora(c.previsao)}.</p>
      ${!ponte.ponteLigada() ? '<p class="pequeno">As fotos ficaram guardadas no celular e sobem para o Drive assim que o envio for ligado.</p>' : '<p class="pequeno">As fotos estão subindo para o Drive em segundo plano; pode guardar o celular.</p>'}
      <div class="linha" style="justify-content:center"><button type="button" class="btn" data-c="ver-ultima">Ver cautela</button><button type="button" class="btn prim" data-c="inicio">Ir para o início</button></div>
    </section>` : `
    <section class="caixa concluido">
      <div class="digital ok">${ICONE.ok}</div>
      <h1 style="margin:0">Devolução registrada</h1>
      <p>Devolva a chave da ${chaveiro(v)} no claviculário.</p>
      <dl class="kv" style="text-align:left"><dt>Rodou</dt><dd>${km(c.kmRetorno - c.kmSaida)} km</dd><dt>Duração</dt><dd>${duracao(ms(c.devolucao) - ms(c.saida))}</dd><dt>Combustível</dt><dd>${combMini(c.combRetorno)}</dd></dl>
      <div class="linha" style="justify-content:center"><button type="button" class="btn" data-c="ver-ultima">Ver cautela e termo</button><button type="button" class="btn prim" data-c="inicio">Ir para o início</button></div>
    </section>`;
  mostrar('tela-concluida');
}

/* ---------- abastecimento durante a cautela ---------- */
function abrirAbastecimento() {
  if (!minha) return;
  rascunho = { tipo: 'abastecimento', fotos: {} };
  const m = abrirModal(`
    <h2>Registrar abastecimento</h2>
    <form id="form-abast" class="filtros" style="margin:0">
      <label>Litros<input name="litros" type="number" inputmode="decimal" step="0.01" required></label>
      <label>Valor (R$)<input name="valor" type="number" inputmode="decimal" step="0.01" required></label>
      <label>KM no painel<input name="km" type="number" inputmode="numeric" required></label>
      <label>Posto<input name="posto" maxlength="80"></label>
    </form>
    <div><span class="rotulo">Foto do cupom</span><div class="fotos" id="cupom-foto">${blocoFoto('cupom', 'Cupom fiscal', null, 'fotos')}</div></div>
    <p class="pequeno" id="erro-abast" style="color:var(--erro)" hidden></p>
    <div class="linha separa"><button type="button" class="btn" data-fechar-modal>Cancelar</button><button type="button" class="btn prim" id="salvar-abast">Salvar</button></div>`,
  () => { if (rascunho?.tipo === 'abastecimento') rascunho = null; });
  m.querySelector('#salvar-abast').addEventListener('click', async (e) => {
    const f = m.querySelector('#form-abast');
    const litros = Number(f.litros.value), valor = Number(f.valor.value), kmP = Number(f.km.value);
    const erro = m.querySelector('#erro-abast');
    const falha = (t) => { erro.textContent = t; erro.hidden = false; };
    if (!(litros > 0) || !(valor >= 0) || f.valor.value === '' || !Number.isInteger(kmP)) return falha('Informe litros, valor e KM.');
    if (kmP < minha.kmSaida) return falha(`O KM não pode ser menor que o de saída (${km(minha.kmSaida)}).`);
    e.target.disabled = true;
    try {
      const ref = doc(collection(db, 'abastecimentos'));
      const lote = writeBatch(db);
      lote.set(ref, {
        cautelaId: minha.id, vtrId: minha.vtrId, vtrPrefixo: minha.vtrPrefixo, userId: estado.eu.uid, userNome: nomeMilitar(estado.eu),
        em: serverTimestamp(), km: kmP, litros, valor, posto: f.posto.value.trim() || null,
      });
      await lote.commit();
      if (rascunho?.fotos?.cupom) await enfileirar('cupom', ref.id, { cupom: rascunho.fotos.cupom });
      rascunho = null;
      fecharModal();
      mensagem('Abastecimento registrado.');
    } catch (err) {
      console.error(err);
      falha(traduzirErro(err));
      e.target.disabled = false;
    }
  });
}

/* ---------- minhas cautelas ---------- */
let listaMinhas = [];
document.getElementById('cartao-minhas')?.addEventListener('click', async () => {
  mostrar('tela-minhas');
  const caixa = $('#minhas-lista');
  caixa.innerHTML = '<p class="vazio">Carregando…</p>';
  try {
    const snap = await getDocs(query(collection(db, 'cautelas'), where('userId', '==', estado.eu.uid)));
    listaMinhas = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.seq - a.seq);
    caixa.innerHTML = listaMinhas.length ? listaMinhas.map((c) => {
      const v = estado.viaturas.find((x) => x.id === c.vtrId) || { prefixo: c.vtrPrefixo, modelo: '' };
      const st = c.situacao === 'aberta' ? (estaAtrasada(c) ? 'atrasada' : 'cautelada') : 'neutra';
      return `<button type="button" class="vitem" data-c="abrir-cautela" data-id="${c.id}">${figura(v)}<div><div class="meta">${chaveiro(v)}<span class="pequeno suave">${esc(c.numero)}</span></div><div class="sub">${dataHora(c.saida)} · ${esc(c.missao)}</div></div><div>${selo(st, st === 'neutra' ? 'Encerrada' : st === 'cautelada' ? 'Aberta' : null)}</div></button>`;
    }).join('') : '<p class="vazio">Você ainda não fez nenhuma cautela.</p>';
  } catch (err) {
    console.error(err);
    caixa.innerHTML = `<p class="vazio">${esc(traduzirErro(err))}</p>`;
  }
});
