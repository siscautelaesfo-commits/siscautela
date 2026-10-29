// SisCautela · conversa com a ponte do Google Drive (Apps Script da conta do sistema).
// As fotos entram numa fila guardada no aparelho (IndexedDB) e sobem em segundo plano;
// sem sinal, sobem quando a internet voltar, mesmo que o app seja fechado e aberto de novo.
// Reenviar a mesma foto não duplica nada: a ponte reconhece.
import { auth } from './nucleo.js';
import { URL_PONTE as URL_CONFIG } from './config.js';

let URL_PONTE = URL_CONFIG
let obterToken = async () => auth.currentUser?.getIdToken()

const BANCO = 'siscautela-ponte'
const FILA = 'fila'
const CACHE = 'arquivos'
const MAX_CACHE = 80 // arquivos guardados no aparelho para abrir sem baixar de novo

// Erros que não se resolvem tentando de novo: a foto sai da fila e vai para "falhas"
const DEFINITIVOS = ['invalido', 'ja_enviada', 'prazo', 'sem_permissao', 'grande_demais', 'acao_desconhecida', 'pedido_invalido']

export const ponteLigada = () => !!URL_PONTE

let configurada = false
export function configurar({ url, obterToken: fn } = {}) {
  if (url) URL_PONTE = url
  if (fn) obterToken = fn
  if (configurada) return processarFila()
  configurada = true
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => processarFila())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') processarFila()
    })
    setInterval(() => processarFila(), 60_000)
    processarFila()
  }
}

/* ---------- chamada à ponte ---------- */

export class ErroPonte extends Error {
  constructor(codigo, mensagem) {
    super(mensagem || codigo)
    this.codigo = codigo
  }
}

export async function chamar(acao, dados = {}) {
  if (!URL_PONTE) throw new ErroPonte('configuracao', 'Endereço da ponte não configurado.')
  const idToken = await obterToken()
  if (!idToken) throw new ErroPonte('sem_login', 'Faça login para continuar.')
  let resp
  try {
    // text/plain evita a verificação prévia (CORS) que o Apps Script não responde
    resp = await fetch(URL_PONTE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ acao, idToken, ...dados }),
    })
  } catch {
    throw new ErroPonte('rede', 'Sem conexão com o servidor.')
  }
  let json
  try {
    json = await resp.json()
  } catch {
    throw new ErroPonte('rede', 'Resposta inválida do servidor.')
  }
  if (!json.ok) throw new ErroPonte(json.erro, json.mensagem)
  return json
}

/* ---------- fila de fotos ---------- */

/**
 * Coloca uma foto na fila de envio.
 * momento: 'retirada' | 'devolucao' | 'avaria' | 'cupom'
 * ref: id do documento no Firestore (cautela, avaria ou abastecimento)
 * slot: frente | traseira | latEsq | latDir | painel (cautela) · f1..f4 (avaria) · cupom
 * foto: Blob já comprimido (JPEG ~ 1280 px, qualidade 0.7)
 */
export async function enfileirarFoto({ momento, ref, slot, foto }) {
  const base64 = await blobParaBase64(foto)
  const item = { chave: `${momento}/${ref}/${slot}`, momento, ref, slot, base64, tentativas: 0, proxima: 0, criadoEm: Date.now() }
  await tx(FILA, 'readwrite', (s) => s.put(item))
  avisar()
  processarFila()
}

let processando = false
export async function processarFila() {
  if (processando || !URL_PONTE) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return avisar()
  processando = true
  avisar()
  try {
    const itens = (await tx(FILA, 'readonly', (s) => s.getAll())).filter((i) => !i.falhou && i.proxima <= Date.now())
    for (const item of itens) {
      try {
        const r = await chamar('enviarFoto', { momento: item.momento, ref: item.ref, slot: item.slot, base64: item.base64 })
        await tx(FILA, 'readwrite', (s) => s.delete(item.chave))
        ouvintesEnvio.forEach((fn) => fn({ ...item, base64: undefined, id: r.id }))
      } catch (e) {
        if (e.codigo === 'sem_login' || e.codigo === 'rede') break // tenta tudo de novo mais tarde
        const definitivo = DEFINITIVOS.includes(e.codigo)
        const tentativas = item.tentativas + 1
        // 30 s, 1 min, 2 min... até 30 min entre tentativas
        const espera = Math.min(30 * 60_000, 30_000 * 2 ** (tentativas - 1))
        await tx(FILA, 'readwrite', (s) =>
          s.put({ ...item, tentativas, proxima: Date.now() + espera, falhou: definitivo, erro: e.message, codigo: e.codigo }),
        )
      }
      avisar()
    }
  } finally {
    processando = false
    avisar()
  }
}

// Foto que a ponte recusou de vez: o app mostra o motivo e o usuário descarta
export async function descartarFalha(chave) {
  await tx(FILA, 'readwrite', (s) => s.delete(chave))
  avisar()
}

const ouvintes = new Set()
const ouvintesEnvio = new Set()

// Estado da fila para a tela: "3 fotos aguardando envio"
export function ouvirFila(fn) {
  ouvintes.add(fn)
  avisar()
  return () => ouvintes.delete(fn)
}

// Avisa quando uma foto chega ao Drive (para trocar a prévia local pela foto guardada)
export function ouvirEnvios(fn) {
  ouvintesEnvio.add(fn)
  return () => ouvintesEnvio.delete(fn)
}

async function avisar() {
  if (!ouvintes.size) return
  let itens = []
  try {
    itens = await tx(FILA, 'readonly', (s) => s.getAll())
  } catch {
    /* IndexedDB indisponível */
  }
  const estado = {
    pendentes: itens.filter((i) => !i.falhou).length,
    falhas: itens.filter((i) => i.falhou).map(({ chave, momento, ref, slot, erro }) => ({ chave, momento, ref, slot, erro })),
    enviando: processando,
    offline: typeof navigator !== 'undefined' && navigator.onLine === false,
  }
  ouvintes.forEach((fn) => fn(estado))
}

/* ---------- abrir arquivos guardados ---------- */

// Devolve um endereço local (blob:) para mostrar a foto ou abrir o PDF.
// Fotos guardadas no Drive nunca mudam, então o aparelho guarda uma cópia e não baixa de novo.
export async function abrirArquivo(id) {
  let salvo = null
  try {
    salvo = await tx(CACHE, 'readonly', (s) => s.get(id))
  } catch {
    /* sem cache */
  }
  if (!salvo) {
    const r = await chamar('arquivo', { id })
    salvo = { id, mime: r.mime, nome: r.nome, blob: base64ParaBlob(r.base64, r.mime), usadoEm: Date.now() }
    try {
      await tx(CACHE, 'readwrite', (s) => s.put(salvo))
      limparCache()
    } catch {
      /* sem cache: segue */
    }
  } else {
    tx(CACHE, 'readwrite', (s) => s.put({ ...salvo, usadoEm: Date.now() })).catch(() => {})
  }
  return URL.createObjectURL(salvo.blob)
}

async function limparCache() {
  const todos = await tx(CACHE, 'readonly', (s) => s.getAll())
  if (todos.length <= MAX_CACHE) return
  const velhos = todos.sort((a, b) => a.usadoEm - b.usadoEm).slice(0, todos.length - MAX_CACHE)
  await tx(CACHE, 'readwrite', (s) => velhos.forEach((v) => s.delete(v.id)))
}

/* ---------- termo e relatórios ---------- */

// Depois da devolução: pede o termo em PDF. Se ainda faltam fotos subindo, a ponte responde
// { pendente: true } e a rotina das 22 h gera o termo do mesmo jeito.
export function pedirTermo(cautelaId) {
  return chamar('gerarTermo', { cautelaId })
}

// Gestor: guarda no Drive um relatório gerado no app e recebe o link para compartilhar
export async function salvarRelatorioNoDrive(pdfBlob, nome) {
  return chamar('salvarRelatorio', { nome, base64: await blobParaBase64(pdfBlob) })
}

/* ---------- utilidades ---------- */

function blobParaBase64(blob) {
  return new Promise((ok, falha) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result).split(',')[1])
    r.onerror = falha
    r.readAsDataURL(blob)
  })
}

function base64ParaBlob(b64, mime) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

let bancoAberto = null
function banco() {
  if (!bancoAberto) {
    bancoAberto = new Promise((ok, falha) => {
      const req = indexedDB.open(BANCO, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(FILA, { keyPath: 'chave' })
        req.result.createObjectStore(CACHE, { keyPath: 'id' })
      }
      req.onsuccess = () => ok(req.result)
      req.onerror = () => falha(req.error)
    })
  }
  return bancoAberto
}

async function tx(loja, modo, fn) {
  const db = await banco()
  return new Promise((ok, falha) => {
    const t = db.transaction(loja, modo)
    const r = fn(t.objectStore(loja))
    t.oncomplete = () => ok(r && 'result' in r ? r.result : undefined)
    t.onerror = () => falha(t.error)
    t.onabort = () => falha(t.error)
  })
}
