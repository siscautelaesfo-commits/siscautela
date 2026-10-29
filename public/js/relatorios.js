// SisCautela · relatórios (prévia na tela e PDF), termo de cautela, ficha da cautela e compartilhar.
// Cada relatório vira um "modelo" único; a prévia na tela e o PDF saem do mesmo modelo.
import {
  collection, query, where, getDocs, Timestamp
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import {
  db, estado, avisar, ehGestao, acompanha, $, mensagem, traduzirErro, abrirModal, fecharModal,
  esc, ms, km, reais, hora, dataBR, dataCurta, dataHora, dataHoraFixa, duracao, horas, isoDia, inicioDia,
  COMB, FOTOS, ATRASO_MIN, numeroCautela, estaAtrasada, devolveuAtrasado, porPrioridade, statusViatura, ST_TEXTO,
  chaveiro, placa, selo, combMini, ICONE, SITUACOES
} from './nucleo.js';
import * as ponte from './ponte.js';

const DIA = 86400e3;
const BRASOES = { apmg: 'img/brasao-apmg.png', esfo: 'img/brasao-esfo.png' };
const numeroDe = (id) => (/^c\d+$/.test(id || '') ? numeroCautela(Number(id.slice(1))) : id || '—');
const rodou = (c) => (c.kmRetorno != null ? c.kmRetorno - c.kmSaida : 0);
const tempoUso = (c) => (ms(c.devolucao) || Date.now()) - ms(c.saida);
const atrasou = (c) => estaAtrasada(c) || devolveuAtrasado(c);
const situacaoTexto = (c) => (c.situacao === 'aberta' ? (estaAtrasada(c) ? 'Em atraso' : 'Aberta') : devolveuAtrasado(c) ? 'Devolveu atrasado' : 'Encerrada');
const periodoTexto = (de, ate) => (de === ate ? dataBR(inicioDia(de)) : `${dataBR(inicioDia(de))} a ${dataBR(inicioDia(ate))}`);
const assinaturaTexto = (s) => (s ? `${s.metodo === 'senha' ? 'Senha pessoal' : 'Biometria do celular'} em ${dataBR(s.em)} às ${hora(s.em)}` : '—');

/* =========================================================
 * Dados
 * ========================================================= */
export async function carregarPeriodo(de, ate) {
  const ini = Timestamp.fromMillis(inicioDia(de)), fim = inicioDia(ate) + DIA;
  const [cs, ab, av, abertas] = await Promise.all([
    getDocs(query(collection(db, 'cautelas'), where('saida', '>=', ini))),
    getDocs(query(collection(db, 'abastecimentos'), where('em', '>=', ini))),
    getDocs(collection(db, 'avarias')),
    getDocs(query(collection(db, 'cautelas'), where('situacao', '==', 'aberta'))),
  ]);
  const lista = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
  return {
    cautelas: lista(cs).filter((c) => ms(c.saida) < fim).sort((a, b) => ms(a.saida) - ms(b.saida)),
    abastecimentos: lista(ab).filter((a) => ms(a.em) < fim).sort((a, b) => ms(a.em) - ms(b.em)),
    avarias: lista(av).sort((a, b) => ms(b.em) - ms(a.em)),
    abertas: lista(abertas),
    de, ate,
  };
}

/* =========================================================
 * Modelos
 * ========================================================= */
function ocorrencias(cs) {
  const oc = [];
  cs.forEach((c) => {
    if (estaAtrasada(c)) oc.push(['Atraso', c.numero, `VTR ${c.vtrPrefixo} com ${c.userNome}: previsão ${hora(c.previsao)}, ainda não devolvida`]);
    else if (devolveuAtrasado(c)) oc.push(['Atraso', c.numero, `VTR ${c.vtrPrefixo}: devolvida ${duracao(ms(c.devolucao) - ms(c.previsao))} depois da previsão`]);
    if (c.justificativa) oc.push(['Fora da ordem', c.numero, `VTR ${c.vtrPrefixo}: ${c.justificativa}`]);
    if (c.divergenciaKm != null) oc.push(['KM divergente', c.numero, `Saída com ${km(c.kmSaida)} km; último registro com ${km(c.divergenciaKm)} km`]);
    if (c.justComb) oc.push(['Combustível', c.numero, `Devolvida na reserva: ${c.justComb}`]);
  });
  return oc;
}

export function modeloDia(d) {
  const dia = d.de, cs = d.cautelas;
  const ehHoje = dia === isoDia(Date.now());
  const avs = d.avarias.filter((a) => ms(a.em) >= inicioDia(dia) && ms(a.em) < inicioDia(dia) + DIA);
  const oc = ocorrencias(cs);
  const secoes = [{
    titulo: 'Cautelas do dia',
    colunas: [['Nº', 18], ['VTR', 16], ['Militar', 32], ['Missão', 52], ['Saída', 14], ['Volta', 14], ['KM', 14, 1], ['Situação', 32]],
    linhas: cs.map((c) => [c.numero, c.vtrPrefixo, c.userNome, c.missao, hora(c.saida), c.devolucao ? hora(c.devolucao) : '—', c.kmRetorno != null ? km(rodou(c)) : '—', situacaoTexto(c)]),
    destaque: cs.map((c) => (atrasou(c) ? 'erro' : c.justificativa ? 'atencao' : '')), vazio: 'Nenhuma cautela neste dia.',
  }];
  if (ehHoje) {
    secoes.push({
      titulo: 'Viaturas fora agora (chave fora do claviculário)',
      colunas: [['VTR', 16], ['Militar', 34], ['Saída', 28], ['Volta prevista', 28], ['Situação', 56]],
      linhas: d.abertas.map((c) => [c.vtrPrefixo, c.userNome, dataHoraFixa(c.saida), dataHoraFixa(c.previsao), estaAtrasada(c) ? `Em atraso há ${duracao(Date.now() - ms(c.previsao))}` : 'No prazo']),
      destaque: d.abertas.map((c) => (estaAtrasada(c) ? 'erro' : '')), vazio: 'Todas as chaves estão no claviculário.',
    });
  }
  secoes.push({ titulo: 'Ocorrências', colunas: [['Tipo', 30], ['Cautela', 20], ['Detalhe', 140]], linhas: oc, destaque: oc.map((o) => (o[0] === 'Atraso' ? 'erro' : 'atencao')), vazio: 'Nenhuma ocorrência.' });
  secoes.push({ titulo: 'Avarias registradas', colunas: [['VTR', 18], ['Gravidade', 22], ['Descrição', 92], ['Registrada por', 58]], linhas: avs.map((a) => [a.vtrPrefixo, a.gravidade === 'grave' ? 'Grave' : 'Leve', a.descricao, a.registradaNome || '—']), vazio: 'Nenhuma avaria registrada neste dia.' });
  return {
    titulo: 'Relatório do dia', sub: dataBR(inicioDia(dia)) + (ehHoje ? ` (até ${hora(Date.now())})` : ''), arquivo: `relatorio-do-dia-${dia}`,
    resumo: [[cs.length, 'cautelas no dia'], [km(cs.reduce((s, c) => s + rodou(c), 0)), 'km rodados'], [ehHoje ? d.abertas.length : cs.filter((c) => c.situacao === 'aberta').length, ehHoje ? 'viaturas fora agora' : 'sem devolução'], [oc.length, 'ocorrências']],
    secoes,
  };
}

export function modeloPeriodo(d) {
  const cs = d.cautelas, ab = d.abastecimentos;
  const vtrs = porPrioridade();
  const porV = vtrs.map((v) => {
    const vc = cs.filter((c) => c.vtrId === v.id);
    return { v, n: vc.length, km: vc.reduce((s, c) => s + rodou(c), 0), t: vc.reduce((s, c) => s + tempoUso(c), 0), lit: ab.filter((a) => a.vtrId === v.id).reduce((s, a) => s + a.litros, 0) };
  });
  const maxKm = Math.max(1, ...porV.map((x) => x.km));
  const fora = cs.filter((c) => c.justificativa);
  const atrasos = cs.filter(atrasou);
  const pessoas = [...new Set(cs.map((c) => c.userId))].map((id) => {
    const uc = cs.filter((c) => c.userId === id);
    return { nome: uc[0].userNome, n: uc.length, km: uc.reduce((s, c) => s + rodou(c), 0), at: uc.filter(atrasou).length, fo: uc.filter((c) => c.justificativa).length };
  }).sort((a, b) => b.n - a.n);
  const pct = cs.length ? Math.round(((cs.length - fora.length) / cs.length) * 100) : 0;
  const metade = Math.ceil(vtrs.length / 2), velhas = porV.slice(0, metade).reduce((s, x) => s + x.n, 0);
  return {
    titulo: 'Uso da frota', sub: periodoTexto(d.de, d.ate), arquivo: `uso-da-frota-${d.de}-a-${d.ate}`,
    resumo: [[cs.length, 'cautelas'], [km(cs.reduce((s, c) => s + rodou(c), 0)), 'km rodados'], [horas(cs.reduce((s, c) => s + tempoUso(c), 0)), 'em uso'], [atrasos.length, 'atrasos'], [pct + '%', 'com a VTR prioritária'], [km(ab.reduce((s, a) => s + a.litros, 0)) + ' L', reais(ab.reduce((s, a) => s + a.valor, 0)) + ' abastecidos']],
    secoes: [
      { titulo: 'Uso por viatura (ordem de prioridade)', nota: cs.length ? `As ${metade} viaturas mais antigas da fila fizeram ${velhas} de ${cs.length} cautelas (${Math.round((velhas / cs.length) * 100)}%).` : '',
        colunas: [['Prior.', 12, 1], ['VTR', 14], ['Modelo', 34], ['Cautelas', 16, 1], ['KM', 18, 1], ['Horas', 18, 1], ['Litros', 14, 1], ['KM rodados no período', 64, 0, 1]],
        linhas: porV.map((x) => [x.v.prioridade + 'º', x.v.prefixo, x.v.modelo, x.n, km(x.km), horas(x.t), x.lit ? km(x.lit) : '—', x.km]), max: maxKm },
      { titulo: 'Cautelas fora da ordem de prioridade', nota: fora.length ? `${fora.length} de ${cs.length} cautelas não usaram a viatura prioritária; todas têm motivo registrado.` : '',
        colunas: [['Data', 18], ['Nº', 18], ['VTR', 14], ['Militar', 32], ['Motivo', 108]], linhas: fora.map((c) => [dataCurta(c.saida), c.numero, c.vtrPrefixo, c.userNome, c.justificativa]), vazio: 'Todas as cautelas usaram a viatura prioritária.' },
      { titulo: 'Atrasos na devolução', nota: `Atraso conta a partir de ${ATRASO_MIN} min depois da previsão.`,
        colunas: [['Data', 18], ['Nº', 18], ['VTR', 14], ['Militar', 32], ['Previsão', 22], ['Devolução', 22], ['Atraso', 64]],
        linhas: atrasos.map((c) => [dataCurta(c.saida), c.numero, c.vtrPrefixo, c.userNome, hora(c.previsao), c.devolucao ? hora(c.devolucao) : 'aberta', duracao((ms(c.devolucao) || Date.now()) - ms(c.previsao))]),
        destaque: atrasos.map(() => 'erro'), vazio: 'Nenhum atraso no período.' },
      { titulo: 'Abastecimentos', colunas: [['Data', 18], ['VTR', 14], ['Militar', 32], ['Litros', 16, 1], ['Valor', 24, 1], ['Posto', 86]],
        linhas: ab.map((a) => [dataCurta(a.em), a.vtrPrefixo, a.userNome, km(a.litros), reais(a.valor), a.posto || '—']), vazio: 'Nenhum abastecimento no período.' },
      { titulo: 'Por militar', colunas: [['Militar', 46], ['Cautelas', 22, 1], ['KM', 22, 1], ['Atrasos', 22, 1], ['Fora da ordem', 78, 1]],
        linhas: pessoas.map((x) => [x.nome, x.n, km(x.km), x.at, x.fo]), destaque: pessoas.map((x) => (x.at ? 'atencao' : '')), vazio: 'Nenhuma cautela no período.' },
    ],
  };
}

export function modeloViatura(d, vtrId) {
  const v = estado.viaturas.find((x) => x.id === vtrId);
  const cs = d.cautelas.filter((c) => c.vtrId === vtrId);
  const ab = d.abastecimentos.filter((a) => a.vtrId === vtrId);
  const avs = d.avarias.filter((a) => a.vtrId === vtrId);
  return {
    titulo: 'Ficha da viatura ' + v.prefixo, sub: `${v.modelo}${v.placa ? ' · placa ' + v.placa : ''} · ${periodoTexto(d.de, d.ate)}`, arquivo: `ficha-vtr-${v.prefixo}-${d.de}-a-${d.ate}`,
    resumo: [[cs.length, 'cautelas'], [km(cs.reduce((s, c) => s + rodou(c), 0)), 'km rodados'], [horas(cs.reduce((s, c) => s + tempoUso(c), 0)), 'em uso'], [km(v.kmAtual), 'KM atual'], [avs.filter((a) => a.situacao !== 'resolvida').length, 'avarias abertas']],
    secoes: [
      { titulo: 'Dados', tipo: 'kv', pares: [['Prefixo', v.prefixo], ['Placa', v.placa || '—'], ['Modelo', v.modelo], ['Ano', v.ano || '—'], ['Prioridade', v.prioridade + 'º na fila'], ['Situação', ST_TEXTO[statusViatura(v)] + (v.situacao !== 'ativa' ? ` (${SITUACOES[v.situacao]}${v.motivoSituacao ? ': ' + v.motivoSituacao : ''})` : '')], ['Combustível', v.combNivel != null ? COMB[v.combNivel] : '—']] },
      { titulo: 'Cautelas', colunas: [['Data', 16], ['Nº', 18], ['Militar', 30], ['Missão', 58], ['KM saída', 20, 1], ['KM volta', 20, 1], ['Rodou', 14, 1], ['Situação', 18]],
        linhas: cs.map((c) => [dataCurta(c.saida), c.numero, c.userNome, c.missao, km(c.kmSaida), km(c.kmRetorno), c.kmRetorno != null ? km(rodou(c)) : '—', c.situacao === 'aberta' ? 'Aberta' : devolveuAtrasado(c) ? 'Atraso' : 'OK']),
        destaque: cs.map((c) => (atrasou(c) ? 'erro' : '')), vazio: 'Nenhuma cautela desta viatura no período.' },
      { titulo: 'Abastecimentos', colunas: [['Data', 20], ['Militar', 40], ['Litros', 20, 1], ['Valor', 28, 1], ['Posto', 82]], linhas: ab.map((a) => [dataCurta(a.em), a.userNome, km(a.litros), reais(a.valor), a.posto || '—']), vazio: 'Nenhum abastecimento no período.' },
      { titulo: 'Avarias', colunas: [['Data', 18], ['Descrição', 72], ['Gravidade', 20], ['Origem provável', 42], ['Situação', 32]],
        linhas: avs.map((a) => [dataCurta(a.em), a.descricao, a.gravidade === 'grave' ? 'Grave' : 'Leve', numeroDe(a.origemProvavel), { aberta: 'Aberta', apuracao: 'Em apuração', resolvida: 'Resolvida' }[a.situacao]]), vazio: 'Nenhuma avaria registrada.' },
    ],
  };
}

export function modeloMilitar(d, userId) {
  const cs = d.cautelas.filter((c) => c.userId === userId);
  const nome = cs[0]?.userNome || '—';
  const ids = new Set(cs.map((c) => c.id));
  const avs = d.avarias.filter((a) => ids.has(a.origemProvavel));
  return {
    titulo: 'Histórico de ' + nome, sub: periodoTexto(d.de, d.ate), arquivo: `historico-${nome.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${d.de}-a-${d.ate}`,
    resumo: [[cs.length, 'cautelas'], [km(cs.reduce((s, c) => s + rodou(c), 0)), 'km rodados'], [cs.filter(atrasou).length, 'atrasos'], [cs.filter((c) => c.justificativa).length, 'fora da ordem'], [avs.length, 'avarias ligadas']],
    secoes: [
      { titulo: 'Cautelas', colunas: [['Data', 16], ['Nº', 18], ['VTR', 14], ['Missão', 66], ['Saída', 13], ['Volta', 13], ['Rodou', 14, 1], ['Situação', 36]],
        linhas: cs.map((c) => [dataCurta(c.saida), c.numero, c.vtrPrefixo, c.missao + (c.justificativa ? ` (fora da ordem: ${c.justificativa})` : ''), hora(c.saida), c.devolucao ? hora(c.devolucao) : '—', c.kmRetorno != null ? km(rodou(c)) : '—', situacaoTexto(c)]),
        destaque: cs.map((c) => (atrasou(c) ? 'erro' : c.justificativa ? 'atencao' : '')), vazio: 'Nenhuma cautela no período.' },
      { titulo: 'Avarias com origem provável nas cautelas dele', nota: 'Avaria encontrada na retirada seguinte e atribuída, para apuração, à cautela anterior.',
        colunas: [['Data', 18], ['VTR', 14], ['Descrição', 78], ['Cautela', 20], ['Situação', 60]],
        linhas: avs.map((a) => [dataCurta(a.em), a.vtrPrefixo, a.descricao, numeroDe(a.origemProvavel), { aberta: 'Aberta', apuracao: 'Em apuração', resolvida: 'Resolvida' }[a.situacao]]), vazio: 'Nenhuma avaria ligada às cautelas deste militar.' },
    ],
  };
}

async function fotoDataUrl(reg) {
  if (!reg?.id || !ponte.ponteLigada()) return null;
  try {
    const url = await ponte.abrirArquivo(reg.id);
    const blob = await fetch(url).then((r) => r.blob());
    return await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
  } catch { return null; }
}

export async function modeloTermo(c) {
  const v = estado.viaturas.find((x) => x.id === c.vtrId) || { prefixo: c.vtrPrefixo, modelo: '', placa: '' };
  const pares = [['Viatura', `${v.prefixo} · ${v.modelo || ''}${v.placa ? ' · placa ' + v.placa : ''}`], ['Militar', c.userNome], ['Missão', c.missao]];
  if (c.justificativa) pares.push(['Fora da ordem de prioridade', c.justificativa]);
  pares.push(['Saída', `${dataBR(c.saida)} às ${hora(c.saida)} · ${km(c.kmSaida)} km · combustível ${COMB[c.combSaida]}`], ['Volta prevista', `${dataBR(c.previsao)} às ${hora(c.previsao)}`], ['Assinatura da retirada', assinaturaTexto(c.assinaturaSaida)]);
  if (c.devolucao) pares.push(['Devolução', `${dataBR(c.devolucao)} às ${hora(c.devolucao)} · ${km(c.kmRetorno)} km · combustível ${COMB[c.combRetorno]}`], ['Rodou', `${km(rodou(c))} km em ${duracao(ms(c.devolucao) - ms(c.saida))}`], ['Assinatura da devolução', assinaturaTexto(c.assinaturaRetorno)]);
  if (devolveuAtrasado(c)) pares.push(['Atraso', duracao(ms(c.devolucao) - ms(c.previsao)) + ' depois da previsão']);
  if (c.justComb) pares.push(['Combustível', c.justComb]);
  if (c.obs) pares.push(['Observações', c.obs]);
  const fotos = async (m) => Promise.all(FOTOS.map(async ([k, r]) => [r, await fotoDataUrl(c.arquivos?.[m]?.[k]), !!c.arquivos?.[m]?.[k]]));
  const secoes = [{ titulo: 'Dados da cautela', tipo: 'kv', pares }, { titulo: 'Fotos da retirada', tipo: 'fotos', itens: await fotos('retirada') }];
  if (c.devolucao) secoes.push({ titulo: 'Fotos da devolução', tipo: 'fotos', itens: await fotos('devolucao') });
  return { titulo: 'Termo de cautela ' + c.numero, sub: `Viatura ${c.vtrPrefixo} · ${situacaoTexto(c)}`, arquivo: `termo-cautela-${c.numero}`, resumo: [], secoes };
}

/* =========================================================
 * Prévia na tela
 * ========================================================= */
export function folhaHTML(m) {
  const quadros = m.resumo.length ? `<div class="quadros">${m.resumo.map(([n, r]) => `<div class="quadro"><b>${esc(n)}</b><span>${esc(r)}</span></div>`).join('')}</div>` : '';
  return `<article class="folha"><header class="folha-cab"><img src="${BRASOES.apmg}" alt="Brasão da APMG"><div><h3>${esc(m.titulo)}</h3><div class="pequeno suave">Escola de Formação de Oficiais · APMG · PMPR</div><div class="pequeno"><b>${esc(m.sub)}</b></div></div><img src="${BRASOES.esfo}" alt="Brasão da EsFO"></header>
  <div class="folha-corpo">${quadros}${m.secoes.map(secaoHTML).join('')}</div></article>`;
}
function secaoHTML(s) {
  let corpo;
  if (s.tipo === 'kv') corpo = `<dl class="kv">${s.pares.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  else if (s.tipo === 'fotos') corpo = `<div class="fotos">${s.itens.map(([r, src, tem]) => src ? `<div class="foto tem"><img src="${src}" alt="${esc(r)}"><span class="leg">${esc(r)}</span></div>` : `<div class="foto">${esc(r)}<br><span class="pequeno">${tem ? '(no Drive)' : '(sem foto)'}</span></div>`).join('')}</div>`;
  else if (!s.linhas.length) corpo = `<p class="pequeno">${esc(s.vazio || 'Sem registros.')}</p>`;
  else corpo = `<div class="tabela"><table><thead><tr>${s.colunas.map(([t, , dir]) => `<th class="${dir ? 'd' : ''}">${esc(t)}</th>`).join('')}</tr></thead><tbody>${s.linhas.map((ln, li) => `<tr class="${s.destaque?.[li] ? 'l-' + s.destaque[li] : ''}">${ln.map((val, ci) => {
    const col = s.colunas[ci];
    if (col[3]) return `<td><div class="barra"><i style="width:${Math.max(2, Math.round((val / s.max) * 100))}px"></i><span>${km(val)} km</span></div></td>`;
    return `<td class="${col[2] ? 'd' : ''}">${esc(val)}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>`;
  return `<section><h4>${esc(s.titulo)}</h4>${s.nota ? `<p class="pequeno">${esc(s.nota)}</p>` : ''}${corpo}</section>`;
}

/* =========================================================
 * PDF (jsPDF), retrato A4, com os brasões no cabeçalho
 * ========================================================= */
let jspdfCarregando = null;
function carregarJsPDF() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  jspdfCarregando ||= new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => ok(window.jspdf);
    s.onerror = () => { jspdfCarregando = null; falha(new Error('jspdf')); };
    document.head.append(s);
  });
  return jspdfCarregando;
}
const imagem = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
const limpar = (s = '') => String(s).replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/…/g, '...').replace(/→/g, '->').replace(/[^\x00-\xFF]/g, '');

export async function gerarPdf(m) {
  const { jsPDF } = await carregarJsPDF();
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const L = 10, W = 190, ALT = 297;
  const COR = { tinta: [14, 26, 43], cinza: [74, 90, 112], azul: [0, 69, 138], noite: [7, 28, 64], ouro: [245, 197, 49], erro: [180, 35, 24], atencao: [168, 88, 0], fundo: [237, 241, 246], linha: [217, 224, 234], erroBg: [253, 232, 230], atencaoBg: [253, 240, 222] };
  let y = 12;
  const fonte = (st, tam, cor = COR.tinta) => { pdf.setFont('helvetica', st); pdf.setFontSize(tam); pdf.setTextColor(...cor); };
  const quebra = (t, w) => pdf.splitTextToSize(limpar(t), w);
  const garantir = (h) => { if (y + h > ALT - 14) { pdf.addPage(); y = 14; return true; } return false; };

  const [iA, iE] = await Promise.all([imagem(BRASOES.apmg), imagem(BRASOES.esfo)]);
  const altB = 22;
  if (iA) pdf.addImage(iA, 'PNG', L, y, (altB * iA.width) / iA.height, altB);
  if (iE) { const w = (altB * iE.width) / iE.height; pdf.addImage(iE, 'PNG', L + W - w, y, w, altB); }
  fonte('bold', 14, COR.azul);
  quebra(m.titulo.toUpperCase(), 130).slice(0, 2).forEach((t, i) => pdf.text(t, L + W / 2, y + 7 + i * 6, { align: 'center' }));
  fonte('normal', 9.5, COR.cinza);
  pdf.text('Escola de Formação de Oficiais · APMG · PMPR', L + W / 2, y + 14, { align: 'center' });
  fonte('bold', 9.5);
  pdf.text(limpar(m.sub), L + W / 2, y + 19, { align: 'center' });
  y += altB + 3;
  pdf.setDrawColor(...COR.ouro); pdf.setLineWidth(1); pdf.line(L, y, L + W, y);
  y += 5;
  fonte('normal', 8, COR.cinza);
  pdf.text(limpar(`Gerado pelo SisCautela em ${dataBR(Date.now())} às ${hora(Date.now())} por ${estado.eu ? (estado.eu.curso === 'CHOE' ? 'Al Of ' : 'Cad. ') + estado.eu.nomeGuerra : '—'}`), L, y);
  y += 6;

  if (m.resumo.length) {
    const n = m.resumo.length, gap = 3, w = (W - gap * (n - 1)) / n;
    m.resumo.forEach(([num, rot], i) => {
      const x = L + i * (w + gap);
      pdf.setFillColor(...COR.fundo); pdf.roundedRect(x, y, w, 17, 1.5, 1.5, 'F');
      fonte('bold', 13); pdf.text(limpar(String(num)), x + 3, y + 7.5);
      fonte('normal', 7.5, COR.cinza); quebra(rot, w - 6).slice(0, 2).forEach((t, k) => pdf.text(t, x + 3, y + 11.8 + k * 3.2));
    });
    y += 23;
  }

  for (const s of m.secoes) {
    garantir(18);
    fonte('bold', 11.5, COR.azul); pdf.text(limpar(s.titulo), L, y); y += 5;
    if (s.nota) { fonte('normal', 8.5, COR.cinza); quebra(s.nota, W).forEach((t) => { pdf.text(t, L, y); y += 4; }); y += 1; }
    if (s.tipo === 'kv') {
      s.pares.forEach(([k, v]) => {
        const ls = quebra(v, W - 50); garantir(ls.length * 4.6 + 1);
        fonte('normal', 9, COR.cinza); pdf.text(limpar(k), L, y);
        fonte('normal', 9.5); ls.forEach((t, i) => pdf.text(t, L + 50, y + i * 4.6));
        y += ls.length * 4.6 + 1.4;
      });
      y += 4; continue;
    }
    if (s.tipo === 'fotos') {
      const cols = 3, gap = 4, w = (W - gap * (cols - 1)) / cols, h = w * 0.75;
      s.itens.forEach(([rot, src, tem], i) => {
        const col = i % cols;
        if (col === 0) garantir(h + 7);
        const x = L + col * (w + gap);
        if (src) { try { pdf.addImage(src, 'JPEG', x, y, w, h); } catch { /* foto ilegível */ } }
        else { pdf.setFillColor(...COR.fundo); pdf.rect(x, y, w, h, 'F'); fonte('normal', 8, COR.cinza); pdf.text(tem ? '(foto guardada no Drive)' : '(sem foto)', x + w / 2, y + h / 2, { align: 'center' }); }
        fonte('normal', 8, COR.cinza); pdf.text(limpar(rot), x, y + h + 4);
        if (col === cols - 1 || i === s.itens.length - 1) y += h + 8;
      });
      y += 2; continue;
    }
    if (!s.linhas.length) { fonte('italic', 9, COR.cinza); pdf.text(limpar(s.vazio || 'Sem registros.'), L, y); y += 9; continue; }
    const pad = 1.5, lh = 3.9;
    const escala = W / s.colunas.reduce((a, c) => a + c[1], 0);
    const cols = s.colunas.map(([t, w, dir, bar]) => ({ t, w: w * escala, dir, bar }));
    const cab = () => {
      pdf.setFillColor(...COR.noite); pdf.rect(L, y - 3.8, W, 6, 'F');
      fonte('bold', 7.8, [255, 255, 255]);
      let x = L; cols.forEach((c) => { pdf.text(limpar(c.t), c.dir ? x + c.w - pad : x + pad, y, { align: c.dir ? 'right' : 'left' }); x += c.w; });
      y += 5;
    };
    cab();
    s.linhas.forEach((ln, li) => {
      fonte('normal', 8.5);
      const cel = cols.map((c, ci) => (c.bar ? [''] : quebra(ln[ci] ?? '', c.w - pad * 2)));
      const h = Math.max(...cel.map((x) => x.length)) * lh + 1.6;
      if (garantir(h)) cab();
      const d = s.destaque?.[li];
      if (d) { pdf.setFillColor(...(d === 'erro' ? COR.erroBg : COR.atencaoBg)); pdf.rect(L, y - 3.3, W, h, 'F'); }
      let x = L;
      cols.forEach((c, ci) => {
        if (c.bar) {
          const bw = Math.max(0.6, ((c.w - 22) * ln[ci]) / s.max);
          pdf.setFillColor(...COR.azul); pdf.rect(x + pad, y - 2.4, bw, 2.6, 'F');
          fonte('normal', 7.5, COR.cinza); pdf.text(km(ln[ci]), x + pad + bw + 1.5, y);
        } else {
          fonte('normal', 8.5, d && ci === cols.length - 1 ? COR[d] : COR.tinta);
          cel[ci].forEach((t, k) => pdf.text(t, c.dir ? x + c.w - pad : x + pad, y + k * lh, { align: c.dir ? 'right' : 'left' }));
        }
        x += c.w;
      });
      y += h;
      pdf.setDrawColor(...COR.linha); pdf.setLineWidth(0.2); pdf.line(L, y - 3.3, L + W, y - 3.3);
    });
    y += 5;
  }
  const total = pdf.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setDrawColor(...COR.linha); pdf.setLineWidth(0.2); pdf.line(L, ALT - 10, L + W, ALT - 10);
    fonte('normal', 7.5, COR.cinza);
    pdf.text('SisCautela · Cautela de viaturas da EsFO', L, ALT - 6);
    pdf.text(`Página ${i} de ${total}`, L + W, ALT - 6, { align: 'right' });
  }
  return pdf.output('blob');
}

/* =========================================================
 * Baixar e compartilhar
 * ========================================================= */
export async function baixarPdf(m) {
  try {
    mensagem('Gerando o PDF…');
    const blob = await gerarPdf(m);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = m.arquivo + '.pdf';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    mensagem('PDF pronto.');
  } catch (err) {
    console.error(err);
    mensagem('Não foi possível gerar o PDF. Confira a internet e tente de novo.', true);
  }
}

function resumoTexto(m) {
  const l = [`*${m.titulo.toUpperCase()}*`, 'EsFO · APMG · PMPR', m.sub, ''];
  m.resumo.forEach(([n, r]) => l.push(`• ${n} ${r}`));
  for (const s of m.secoes) {
    if (s.tipo === 'fotos') continue;
    l.push('', `*${s.titulo}*`);
    if (s.tipo === 'kv') { s.pares.forEach(([k, v]) => l.push(`${k}: ${v}`)); continue; }
    if (!s.linhas.length) { l.push(s.vazio || 'Sem registros.'); continue; }
    s.linhas.slice(0, 12).forEach((ln) => l.push('- ' + ln.map((v, i) => (s.colunas[i][3] ? '' : String(v))).filter((v) => v && v !== '—').join(' · ')));
    if (s.linhas.length > 12) l.push(`(+${s.linhas.length - 12} no PDF)`);
  }
  l.push('', `_Gerado pelo SisCautela em ${dataBR(Date.now())} às ${hora(Date.now())}_`);
  return l.join('\n');
}

export async function compartilhar(m) {
  try {
    mensagem('Preparando…');
    const arquivo = new File([await gerarPdf(m)], m.arquivo + '.pdf', { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [arquivo] })) {
      try { await navigator.share({ files: [arquivo], title: m.titulo, text: `${m.titulo} · ${m.sub}` }); return; }
      catch (err) { if (err?.name === 'AbortError') return; }
    }
  } catch (err) { console.error(err); }
  // Sem envio de arquivo neste aparelho: resumo em texto para o WhatsApp
  const texto = resumoTexto(m);
  const caixa = abrirModal(`<h2>Compartilhar</h2>
    <p class="pequeno">Este aparelho não envia o PDF direto pelo menu de compartilhar. Copie o resumo para o WhatsApp ou baixe o PDF para anexar.</p>
    <label>Resumo para o WhatsApp<textarea readonly style="min-height:220px;font-size:.88rem" id="texto-compartilhar">${esc(texto)}</textarea></label>
    <div class="linha separa"><button type="button" class="btn" data-fechar-modal>Fechar</button><div class="linha"><button type="button" class="btn" id="baixar-do-compartilhar">${ICONE.pdf}Baixar PDF</button><button type="button" class="btn prim" id="copiar-texto">Copiar texto</button></div></div>`);
  caixa.querySelector('#baixar-do-compartilhar').addEventListener('click', () => { fecharModal(); baixarPdf(m); });
  caixa.querySelector('#copiar-texto').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(texto); mensagem('Texto copiado. Cole no WhatsApp.'); }
    catch { const ta = caixa.querySelector('#texto-compartilhar'); ta.focus(); ta.select(); mensagem('Texto selecionado. Copie pelo menu do celular.'); }
  });
}

/* =========================================================
 * Ficha de uma cautela (militar e gestão)
 * ========================================================= */
export function abrirDetalheCautela(c) {
  const v = estado.viaturas.find((x) => x.id === c.vtrId) || { prefixo: c.vtrPrefixo, modelo: '', placa: '' };
  const st = c.situacao === 'aberta' ? (estaAtrasada(c) ? 'atrasada' : 'cautelada') : 'neutra';
  const fotoBloco = (m) => `<div class="fotos">${FOTOS.map(([k, r]) => {
    const reg = c.arquivos?.[m]?.[k];
    return reg?.id ? `<div class="foto" data-arquivo="${esc(reg.id)}" data-rotulo="${esc(r)}">${esc(r)}<br><span class="pequeno">carregando…</span></div>` : `<div class="foto">${esc(r)}<br><span class="pequeno">${c.situacao === 'aberta' || m === 'retirada' || c.devolucao ? 'enviando…' : '—'}</span></div>`;
  }).join('')}</div>`;
  const podeEncerrar = ehGestao() && c.situacao === 'aberta' && c.userId !== estado.eu.uid;
  const m = abrirModal(`<div class="linha separa"><h2>Cautela ${esc(c.numero)}</h2>${devolveuAtrasado(c) ? selo('atrasada', 'Devolveu atrasado') : selo(st, st === 'neutra' ? 'Encerrada' : st === 'cautelada' ? 'Aberta' : null)}</div>
    <div class="linha">${chaveiro(v)}${placa(v.placa)}<span class="suave">${esc(v.modelo)}</span></div>
    <dl class="kv"><dt>Militar</dt><dd>${esc(c.userNome)}</dd><dt>Missão</dt><dd>${esc(c.missao)}</dd>
    ${c.justificativa ? `<dt>Fora da ordem</dt><dd>${esc(c.justificativa)}</dd>` : ''}
    <dt>Saída</dt><dd>${dataHora(c.saida)} · ${km(c.kmSaida)} km · ${combMini(c.combSaida)}</dd>
    ${c.divergenciaKm != null ? `<dt>KM divergente</dt><dd>último registro com ${km(c.divergenciaKm)} km</dd>` : ''}
    <dt>Volta prevista</dt><dd>${dataHora(c.previsao)}</dd><dt>Assinatura</dt><dd>${esc(assinaturaTexto(c.assinaturaSaida))}</dd>
    ${c.devolucao ? `<dt>Devolução</dt><dd>${dataHora(c.devolucao)} · ${km(c.kmRetorno)} km · ${combMini(c.combRetorno)}</dd><dt>Rodou</dt><dd>${km(rodou(c))} km em ${duracao(ms(c.devolucao) - ms(c.saida))}</dd><dt>Assinatura</dt><dd>${esc(assinaturaTexto(c.assinaturaRetorno))}</dd>` : ''}
    ${c.encerradaPor && c.encerradaPor !== c.userId ? '<dt>Encerrada</dt><dd>pela gestão</dd>' : ''}
    ${c.justComb ? `<dt>Combustível</dt><dd>${esc(c.justComb)}</dd>` : ''}${c.obs ? `<dt>Observações</dt><dd>${esc(c.obs)}</dd>` : ''}</dl>
    <span class="rotulo">Fotos da retirada</span>${fotoBloco('retirada')}
    ${c.devolucao ? `<span class="rotulo">Fotos da devolução</span>${fotoBloco('devolucao')}` : ''}
    <div class="linha separa"><button type="button" class="btn" data-fechar-modal>Fechar</button>
      <div class="linha">
        ${podeEncerrar ? '<button type="button" class="btn perigo" id="encerrar-gestao">Encerrar pela gestão</button>' : ''}
        ${c.termo?.id ? '<button type="button" class="btn" id="termo-drive">Termo no Drive</button>' : ''}
        <button type="button" class="btn" id="termo-compartilhar">${ICONE.compartilhar}Compartilhar</button>
        <button type="button" class="btn prim" id="termo-pdf">${ICONE.pdf}Termo em PDF</button>
      </div></div>`);
  // Fotos guardadas no Drive, buscadas pela ponte
  m.querySelectorAll('[data-arquivo]').forEach(async (el) => {
    if (!ponte.ponteLigada()) { el.querySelector('.pequeno').textContent = '(no Drive)'; return; }
    try {
      const url = await ponte.abrirArquivo(el.dataset.arquivo);
      el.classList.add('tem');
      el.innerHTML = `<img src="${url}" alt="${esc(el.dataset.rotulo)}"><span class="leg">${esc(el.dataset.rotulo)}</span>`;
    } catch { el.querySelector('.pequeno').textContent = '(indisponível)'; }
  });
  m.querySelector('#termo-pdf').addEventListener('click', async () => baixarPdf(await modeloTermo(c)));
  m.querySelector('#termo-compartilhar').addEventListener('click', async () => compartilhar(await modeloTermo(c)));
  m.querySelector('#termo-drive')?.addEventListener('click', async () => {
    try {
      const url = await ponte.abrirArquivo(c.termo.id);
      const a = document.createElement('a'); a.href = url; a.download = `termo-cautela-${c.numero}.pdf`; document.body.append(a); a.click(); a.remove();
    } catch (err) { mensagem(traduzirErro(err), true); }
  });
  m.querySelector('#encerrar-gestao')?.addEventListener('click', () => { fecharModal(); avisar('encerrar-cautela', c); });
}

/* =========================================================
 * Aba Relatórios (painel da gestão)
 * ========================================================= */
const TIPOS = [
  ['dia', 'Relatório do dia', 'Cautelas do dia, viaturas fora e ocorrências. Para a passagem de serviço.'],
  ['periodo', 'Uso da frota', 'Uso por viatura, cumprimento da prioridade, atrasos e combustível no período.'],
  ['viatura', 'Ficha da viatura', 'Cautelas, abastecimentos e avarias de uma viatura.'],
  ['militar', 'Histórico do militar', 'Cautelas, atrasos e avarias ligadas a um militar. Útil em apuração.'],
];
const filtro = { tipo: 'dia', dia: isoDia(Date.now()), de: isoDia(new Date(new Date().setDate(1))), ate: isoDia(Date.now()), vtrId: '', userId: '' };
let dados = null, chaveDados = '', modeloAtual = null;

export async function renderRelatorios(caixa) {
  const f = filtro;
  const de = f.tipo === 'dia' ? f.dia : f.de, ate = f.tipo === 'dia' ? f.dia : f.ate;
  const periodo = `<label>De<input type="date" data-r="de" value="${f.de}"></label><label>Até<input type="date" data-r="ate" value="${f.ate}"></label>`;
  let campos = '';
  if (f.tipo === 'dia') campos = `<label>Dia<input type="date" data-r="dia" value="${f.dia}"></label>`;
  if (f.tipo === 'periodo') campos = periodo + `<div><span class="rotulo">Atalhos</span><div class="chips"><button type="button" class="chip" data-r-atalho="mes">Este mês</button><button type="button" class="chip" data-r-atalho="mesPassado">Mês passado</button><button type="button" class="chip" data-r-atalho="30">30 dias</button></div></div>`;
  if (f.tipo === 'viatura') {
    if (!f.vtrId) f.vtrId = porPrioridade()[0]?.id || '';
    campos = `<label>Viatura<select data-r="vtrId">${porPrioridade().map((v) => `<option value="${v.id}" ${v.id === f.vtrId ? 'selected' : ''}>${esc(v.prefixo)} · ${esc(v.modelo)}</option>`).join('')}</select></label>` + periodo;
  }
  caixa.innerHTML = `<div class="tipos" role="group" aria-label="Tipo de relatório">${TIPOS.map(([k, t, d]) => `<button type="button" class="tipo" data-r-tipo="${k}" aria-pressed="${f.tipo === k}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>
    <div class="caixa" style="margin:12px 0"><div class="filtros">${campos}<span id="campo-militar"></span>
      <div class="linha"><button type="button" class="btn prim" data-r-acao="pdf">${ICONE.pdf}Baixar PDF</button><button type="button" class="btn" data-r-acao="compartilhar">${ICONE.compartilhar}Compartilhar</button></div></div></div>
    <div id="folha-relatorio"><p class="vazio">Carregando…</p></div>`;
  ligarRelatorios(caixa);
  try {
    const chave = `${de}|${ate}`;
    if (chave !== chaveDados || !dados) { dados = await carregarPeriodo(de, ate); chaveDados = chave; }
    if (f.tipo === 'militar') {
      const pessoas = [...new Map(dados.cautelas.map((c) => [c.userId, c.userNome])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
      if (!pessoas.some(([id]) => id === f.userId)) f.userId = pessoas[0]?.[0] || '';
      caixa.querySelector('#campo-militar').outerHTML = `<label>Militar<select data-r="userId">${pessoas.map(([id, n]) => `<option value="${id}" ${id === f.userId ? 'selected' : ''}>${esc(n)}</option>`).join('') || '<option value="">Nenhuma cautela no período</option>'}</select></label>` + periodo;
      ligarRelatorios(caixa);
    }
    modeloAtual = f.tipo === 'dia' ? modeloDia(dados) : f.tipo === 'periodo' ? modeloPeriodo(dados)
      : f.tipo === 'viatura' ? modeloViatura(dados, f.vtrId) : (f.userId ? modeloMilitar(dados, f.userId) : null);
    caixa.querySelector('#folha-relatorio').innerHTML = modeloAtual ? folhaHTML(modeloAtual) : '<p class="vazio">Nenhuma cautela no período escolhido.</p>';
  } catch (err) {
    console.error(err);
    caixa.querySelector('#folha-relatorio').innerHTML = `<p class="vazio">${esc(traduzirErro(err))}</p>`;
  }
}

function ligarRelatorios(caixa) {
  caixa.querySelectorAll('[data-r-tipo]').forEach((b) => (b.onclick = () => { filtro.tipo = b.dataset.rTipo; renderRelatorios(caixa); }));
  caixa.querySelectorAll('[data-r]').forEach((el) => (el.onchange = () => {
    if (!el.value) return;
    filtro[el.dataset.r] = el.value;
    if (filtro.de > filtro.ate) { if (el.dataset.r === 'de') filtro.ate = filtro.de; else filtro.de = filtro.ate; }
    renderRelatorios(caixa);
  }));
  caixa.querySelectorAll('[data-r-atalho]').forEach((b) => (b.onclick = () => {
    const hoje = new Date();
    if (b.dataset.rAtalho === 'mes') { filtro.de = isoDia(new Date(hoje.getFullYear(), hoje.getMonth(), 1)); filtro.ate = isoDia(hoje); }
    if (b.dataset.rAtalho === 'mesPassado') { filtro.de = isoDia(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)); filtro.ate = isoDia(new Date(hoje.getFullYear(), hoje.getMonth(), 0)); }
    if (b.dataset.rAtalho === '30') { filtro.de = isoDia(Date.now() - 29 * DIA); filtro.ate = isoDia(hoje); }
    renderRelatorios(caixa);
  }));
  caixa.querySelectorAll('[data-r-acao]').forEach((b) => (b.onclick = () => {
    if (!modeloAtual) return mensagem('Escolha um relatório com dados.', true);
    if (b.dataset.rAcao === 'pdf') baixarPdf(modeloAtual); else compartilhar(modeloAtual);
  }));
}

// Atalho do painel: PDF do dia direto
export async function relatorioDeHoje(acao) {
  const hoje = isoDia(Date.now());
  const m = modeloDia(await carregarPeriodo(hoje, hoje));
  return acao === 'compartilhar' ? compartilhar(m) : baixarPdf(m);
}
export const invalidarRelatorios = () => { dados = null; chaveDados = ''; };
