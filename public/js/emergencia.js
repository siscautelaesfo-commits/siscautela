// SisCautela · botão de emergência do claviculário.
//
// O botão fica no próprio claviculário e abre a porta sem o app (segurado por 1 s). O ESP32 grava o
// evento `emergencia` em claviculario/esfo01/eventos, com data e hora, sem saber quem apertou.
// Depois, no app:
//  - quem usou se apresenta: "Fui eu, peguei uma viatura" (faz a cautela sem abrir a porta de novo)
//    ou "Fui eu, não retirei chave" (com uma explicação);
//  - a gestão é avisada na hora (painel e e-mail da ponte) e de novo se passar 2 h sem registro;
//    ela pode encerrar a pendência com uma observação.
// O registro de cada abertura fica em emergencias/{id do evento} no Firestore.
import {
  doc, collection, query, where, onSnapshot, runTransaction, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import {
  ref, query as rq, orderByChild, equalTo, limitToLast, onValue
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';
import {
  db, estado, avisar, mensagem, traduzirErro, abrirModal, fecharModal, ehGestao, esc, ms, dataHora, duracao, nomeMilitar
} from './nucleo.js';
import { rtdb, DISPOSITIVO } from './claviculario.js';

export const PRAZO_MS = 2 * 3600e3;        // sem registro em 2 h, a gestão é avisada de novo
const JANELA_MS = 30 * 86400e3;            // aberturas dos últimos 30 dias

let eventos = [];          // eventos `emergencia` do claviculário: { id, ts }
let registros = {};        // emergencias/{id} do Firestore
const parar = [];

export function iniciarEmergencias() {
  if (parar.length) return;
  parar.push(onValue(rq(ref(rtdb, `claviculario/${DISPOSITIVO}/eventos`), orderByChild('tipo'), equalTo('emergencia'), limitToLast(30)), (s) => {
    eventos = Object.entries(s.val() || {}).map(([id, e]) => ({ id, ts: Number(e.ocorreuEm) || Number(e.ts) || 0 })).filter((e) => e.ts);
    avisar('emergencias');
  }, (err) => console.warn('emergências do claviculário:', err.code || err)));
  const desde = Timestamp.fromMillis(Date.now() - JANELA_MS);
  parar.push(onSnapshot(query(collection(db, 'emergencias'), where('em', '>=', desde)), (s) => {
    registros = {};
    s.docs.forEach((d) => { registros[d.id] = { id: d.id, ...d.data() }; });
    avisar('emergencias');
  }, (err) => console.warn('emergências:', err.code || err)));
}

export function pararEmergencias() {
  parar.splice(0).forEach((fn) => fn());
  eventos = []; registros = {};
}

// Todas as aberturas de emergência recentes, da mais nova para a mais antiga
export function emergencias() {
  const ids = new Set([...eventos.map((e) => e.id), ...Object.keys(registros)]);
  return [...ids].map((id) => {
    const r = registros[id], e = eventos.find((x) => x.id === id);
    return { id, situacao: 'pendente', ...r, em: r?.em ? ms(r.em) : e?.ts };
  }).filter((x) => x.em && Date.now() - x.em < JANELA_MS).sort((a, b) => b.em - a.em);
}
export const pendentes = () => emergencias().filter((x) => x.situacao === 'pendente');
export const registroDe = (id) => emergencias().find((x) => x.id === id) || null;
export const passouPrazo = (x) => Date.now() - x.em > PRAZO_MS;

// Texto curto da situação de uma abertura
export function situacaoEmergencia(x) {
  if (x.situacao === 'regularizada') return `Registrada por ${x.userNome} · cautela ${x.cautelaNumero || ''}`.trim();
  if (x.situacao === 'justificada') return `${x.userNome} informou que não retirou chave: ${x.observacao}`;
  if (x.situacao === 'encerrada') return `Encerrada pela gestão: ${x.observacao}`;
  return passouPrazo(x) ? `Sem registro há ${duracao(Date.now() - x.em)}` : 'Aguardando quem abriu se apresentar';
}

/* ---------- gravações ---------- */
// Grava (ou completa) o registro da abertura. Dentro de uma transação, para não haver dois registros.
// `extra(tx)` grava junto o que mais for preciso (a cautela, na regularização com viatura).
export async function registrar(id, dados, extra = null) {
  const x = registroDe(id);
  if (!x) throw Object.assign(new Error('emergência'), { mensagemUsuario: 'Esta abertura de emergência não foi encontrada.' });
  const refE = doc(db, 'emergencias', id);
  return runTransaction(db, async (tx) => {
    const s = await tx.get(refE);
    if (s.exists() && s.data().situacao !== 'pendente') {
      throw Object.assign(new Error('já registrada'), { mensagemUsuario: 'Esta abertura de emergência já foi registrada por outra pessoa.' });
    }
    const res = extra ? await extra(tx) : null;
    const campos = { ...dados, ...(res?.campos || {}), regularizadaEm: serverTimestamp() };
    if (s.exists()) tx.update(refE, campos);
    else tx.set(refE, { em: Timestamp.fromMillis(x.em), ...campos });
    return res;
  });
}

// "Fui eu, não retirei chave" (abriu por engano, só devolveu uma chave…)
export function pedirJustificativa(id) {
  const x = registroDe(id);
  if (!x) return;
  const m = abrirModal(`<h2>Abertura de emergência</h2>
    <p>Aberta pelo botão ${esc(dataHora(x.em))}. Conte o que aconteceu; o registro fica no seu nome e a gestão vê.</p>
    <label>O que aconteceu<textarea id="emerg-obs" maxlength="300" placeholder="Ex.: apertei por engano e fechei a porta sem tirar nada"></textarea></label>
    <p class="pequeno" id="emerg-erro" style="color:var(--erro)" hidden></p>
    <div class="linha separa"><button type="button" class="btn" data-fechar-modal>Voltar</button><button type="button" class="btn prim" id="emerg-ok">Registrar</button></div>`);
  m.querySelector('#emerg-ok').addEventListener('click', async (e) => {
    const obs = m.querySelector('#emerg-obs').value.trim(), erro = m.querySelector('#emerg-erro');
    if (obs.length < 5) { erro.textContent = 'Escreva pelo menos uma frase curta.'; erro.hidden = false; return; }
    e.target.disabled = true;
    try {
      await registrar(id, { situacao: 'justificada', userId: estado.eu.uid, userNome: nomeMilitar(estado.eu), observacao: obs });
      fecharModal(); mensagem('Registro feito. Obrigado.');
    } catch (err) {
      console.error(err); erro.textContent = traduzirErro(err); erro.hidden = false; e.target.disabled = false;
    }
  });
}

// A gestão encerra uma pendência que ninguém assumiu
export function encerrarPelaGestao(id) {
  const x = registroDe(id);
  if (!x || !ehGestao()) return;
  const m = abrirModal(`<h2>Encerrar abertura de emergência</h2>
    <p>Aberta pelo botão ${esc(dataHora(x.em))} e ainda sem registro de quem abriu.</p>
    <label>Observação da gestão<textarea id="emerg-obs" maxlength="300" placeholder="Ex.: Cad. Fulano pegou a VTR 0123 para socorro; viatura já devolvida e conferida"></textarea></label>
    <p class="pequeno" id="emerg-erro" style="color:var(--erro)" hidden></p>
    <div class="linha separa"><button type="button" class="btn" data-fechar-modal>Voltar</button><button type="button" class="btn prim" id="emerg-ok">Encerrar</button></div>`);
  m.querySelector('#emerg-ok').addEventListener('click', async (e) => {
    const obs = m.querySelector('#emerg-obs').value.trim(), erro = m.querySelector('#emerg-erro');
    if (obs.length < 5) { erro.textContent = 'Escreva a observação.'; erro.hidden = false; return; }
    e.target.disabled = true;
    try {
      await registrar(id, { situacao: 'encerrada', encerradaPor: estado.eu.uid, observacao: obs });
      fecharModal(); mensagem('Pendência encerrada.');
    } catch (err) {
      console.error(err); erro.textContent = traduzirErro(err); erro.hidden = false; e.target.disabled = false;
    }
  });
}

/* ---------- telas ---------- */
// Aviso no início, para todos: alguém abriu pelo botão e ainda não se apresentou
export function htmlAvisoInicio(temCautela) {
  return pendentes().map((x) => `<section class="caixa critica pilha">
    <span class="rotulo">Claviculário · abertura de emergência</span>
    <p style="margin:0">A porta foi aberta pelo <b>botão de emergência</b> ${esc(dataHora(x.em))} e ninguém registrou ainda quem abriu. Se foi você, registre agora.</p>
    <div class="linha">${temCautela ? '' : `<button type="button" class="btn prim" data-c="emerg-viatura" data-id="${esc(x.id)}">Fui eu: peguei uma viatura</button>`}
    <button type="button" class="btn" data-c="emerg-sem-chave" data-id="${esc(x.id)}">Fui eu: não retirei chave</button></div>
    ${passouPrazo(x) ? '<p class="pequeno" style="margin:0">Passaram 2 h e a gestão foi avisada de novo.</p>' : ''}
  </section>`).join('');
}

// Alertas do painel da frota
export function alertasEmergencia() {
  return pendentes().map((x) => ['erro', 'Abertura de emergência sem registro',
    `Botão acionado ${dataHora(x.em)} · ${situacaoEmergencia(x)}`,
    ehGestao() ? `data-p="emergencia" data-id="${esc(x.id)}"` : '', ehGestao() ? 'Encerrar' : '']);
}

// Para o quadro do claviculário: texto que acompanha o evento `emergencia`
export function legendaEvento(id) {
  const x = registroDe(id);
  return x ? situacaoEmergencia(x) : '';
}
