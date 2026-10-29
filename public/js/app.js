// SisCautela EsFO — versão 0.4: acesso, usuários e viaturas (este arquivo),
// cautela e devolução (cautela.js), painel e relatórios (painel.js, relatorios.js).
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {
  doc, setDoc, updateDoc, collection, onSnapshot, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
import { VIATURAS_INICIAIS } from './viaturas-iniciais.js';
import {
  auth, db, estado, avisar, $, mostrar, telaAtual, mensagem, traduzirErro, ehGestao, acompanha, SITUACOES, posto
} from './nucleo.js';
import { iniciarCautelas, pararCautelas, telasCautela } from './cautela.js';
import { iniciarPainel, pararPainel, telasPainel } from './painel.js';

const PERFIS = {
  usuario: 'Usuário',
  conferente: 'Conferente',
  gestor: 'Gestor de frota',
  admin: 'Administrador'
};
const CHAVE_RASCUNHO = 'siscautela-cadastro';
const COMBUSTIVEIS = { flex: 'Flex', gasolina: 'Gasolina', diesel: 'Diesel', eletrico: 'Elétrico' };

// ---------- utilidades de tela ----------
function travar(form, travado) {
  form.querySelectorAll('button, input, select').forEach((el) => { el.disabled = travado; });
}

function criar(tag, props = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'texto') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  filhos.flat().forEach((f) => f && el.append(f));
  return el;
}

const normalizarEmail = (e) => String(e || '').trim().toLowerCase();

// ---------- dados do cadastro ----------
function lerDados(form) {
  return {
    numero: String(form.numero.value || '').replace(/\D/g, ''),
    nomeGuerra: String(form.nomeGuerra.value || '').trim().replace(/\s+/g, ' '),
    curso: form.curso.value,
    turma: String(form.turma.value || '').trim().replace(/\s+/g, ' ')
  };
}

function validarDados(d) {
  if (!/^\d{1,10}$/.test(d.numero)) return 'Informe o número (somente dígitos).';
  if (d.nomeGuerra.length < 2 || d.nomeGuerra.length > 40) return 'Informe o nome de guerra.';
  if (!['CFO', 'CHOE'].includes(d.curso)) return 'Selecione o curso.';
  if (d.turma.length < 1 || d.turma.length > 40) return 'Informe a turma ou pelotão.';
  return null;
}

function preencher(form, d) {
  if (!d) return;
  form.numero.value = d.numero || '';
  form.nomeGuerra.value = d.nomeGuerra || '';
  form.curso.value = d.curso || '';
  form.turma.value = d.turma || '';
}

function guardarRascunho(d) {
  try { localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(d)); } catch { /* sem armazenamento */ }
}
function lerRascunho() {
  try { return JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) || 'null'); } catch { return null; }
}
function apagarRascunho() {
  try { localStorage.removeItem(CHAVE_RASCUNHO); } catch { /* sem armazenamento */ }
}

// ---------- estado ----------
let eu = null;              // dados do meu usuário no banco (também em estado.eu)
let pararMeuDoc = null;     // listener do meu documento
let pararColecao = null;    // listener da lista de usuários (gestão)
let usuarios = [];          // lista para a gestão
let filtro = 'pendente';
let pararViaturas = null;   // listener das viaturas
let viaturas = [];
let viaturaEditando = null;

function pararTudo() {
  pararMeuDoc?.(); pararMeuDoc = null;
  pararColecao?.(); pararColecao = null;
  pararViaturas?.(); pararViaturas = null;
  pararCautelas();
  pararPainel();
  eu = null; usuarios = []; viaturas = [];
  estado.eu = null; estado.viaturas = [];
}

// ---------- navegação por botões ----------
document.addEventListener('click', (e) => {
  const ir = e.target.closest('[data-ir]');
  if (ir) mostrar(ir.dataset.ir);
  if (e.target.closest('[data-acao="sair"]')) signOut(auth);
});

// ---------- roteamento ----------
function rotear(user) {
  pararTudo();
  if (!user) return mostrar('tela-login');

  if (!user.emailVerified) {
    $('#email-verificar').textContent = user.email;
    return mostrar('tela-verificar');
  }

  // Acompanha o meu cadastro em tempo real: quando o gestor aprovar, a tela muda sozinha.
  pararMeuDoc = onSnapshot(doc(db, 'usuarios', user.uid), (snap) => {
    if (!snap.exists()) {
      eu = null; estado.eu = null;
      preencher($('#form-completar'), lerRascunho());
      return mostrar('tela-completar');
    }
    eu = { uid: user.uid, ...snap.data() };
    estado.eu = eu;
    if (eu.situacao === 'pendente') {
      mostrarFicha();
      return mostrar('tela-aguardando');
    }
    if (eu.situacao !== 'ativo') {
      $('#msg-sem-acesso').textContent = eu.situacao === 'recusado'
        ? 'Seu cadastro não foi aprovado. Procure o gestor da frota.'
        : 'Seu acesso está desativado. Procure o gestor da frota.';
      return mostrar('tela-sem-acesso');
    }
    montarInicio();
    avisar('eu', eu);
    const telasLogado = ['tela-inicio', 'tela-gestao', 'tela-viaturas', 'tela-viatura-form', ...telasCautela, ...telasPainel];
    if (!telasLogado.includes(telaAtual())) mostrar('tela-inicio');
    if (['tela-gestao', 'tela-viatura-form'].includes(telaAtual()) && !ehGestao()) mostrar('tela-inicio');
    if (telasPainel.includes(telaAtual()) && !acompanha()) mostrar('tela-inicio');
  }, (err) => {
    console.error(err);
    $('#msg-sem-acesso').textContent = 'Não foi possível verificar seu acesso agora.';
    mostrar('tela-sem-acesso');
  });
}

onAuthStateChanged(auth, rotear);

function mostrarFicha() {
  const dl = criar('dl', {},
    criar('dt', { texto: 'Nome de guerra' }), criar('dd', { texto: eu.nomeGuerra }),
    criar('dt', { texto: 'Número' }), criar('dd', { texto: eu.numero }),
    criar('dt', { texto: 'Curso e turma' }), criar('dd', { texto: `${eu.curso} · ${eu.turma}` }),
    criar('dt', { texto: 'E-mail' }), criar('dd', { texto: eu.email })
  );
  $('#ficha-aguardando').replaceChildren(dl);
}

function montarInicio() {
  $('#saudacao').textContent = `Olá, ${posto(eu)} ${eu.nomeGuerra}`;
  $('#info-usuario').textContent =
    `${eu.curso} · ${eu.turma} · nº ${eu.numero} · ${PERFIS[eu.perfil] || eu.perfil}`;
  $('#cartao-gestao').hidden = !ehGestao();
  $('#cartao-painel').hidden = !acompanha();
  if (ehGestao() && !pararColecao) iniciarGestao();
  if (!ehGestao() && pararColecao) { pararColecao(); pararColecao = null; }
  if (!pararViaturas) iniciarViaturas();
  iniciarCautelas();
  if (acompanha()) iniciarPainel(); else pararPainel();
}

// ---------- login ----------
$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const email = normalizarEmail(f.email.value);
  const senha = f.senha.value;
  if (!email || !senha) return mensagem('Preencha e-mail e senha.', true);
  travar(f, true);
  try {
    await signInWithEmailAndPassword(auth, email, senha);
    f.reset();
  } catch (err) {
    mensagem(traduzirErro(err), true);
  } finally {
    travar(f, false);
  }
});

// ---------- primeiro acesso ----------
$('#form-primeiro-acesso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const dados = lerDados(f);
  const problema = validarDados(dados);
  if (problema) return mensagem(problema, true);
  const email = normalizarEmail(f.email.value);
  if (!email) return mensagem('Informe o e-mail.', true);
  if (f.senha.value.length < 8) return mensagem('A senha precisa ter pelo menos 8 caracteres.', true);
  if (f.senha.value !== f.senha2.value) return mensagem('As senhas não conferem.', true);
  travar(f, true);
  try {
    guardarRascunho(dados);
    const cred = await createUserWithEmailAndPassword(auth, email, f.senha.value);
    await sendEmailVerification(cred.user);
    f.reset();
    mensagem('Link de confirmação enviado para o seu e-mail.');
  } catch (err) {
    mensagem(traduzirErro(err), true);
  } finally {
    travar(f, false);
  }
});

// ---------- esqueci a senha ----------
$('#form-esqueci').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const email = normalizarEmail(f.email.value);
  if (!email) return mensagem('Informe o e-mail.', true);
  travar(f, true);
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    if (err?.code === 'auth/invalid-email') { travar(f, false); return mensagem(traduzirErro(err), true); }
    // Para não revelar quais e-mails têm acesso, a resposta é sempre a mesma.
  }
  travar(f, false);
  f.reset();
  mensagem('Se houver acesso com esse e-mail, o link foi enviado.');
  mostrar('tela-login');
});

// ---------- verificação de e-mail ----------
$('#btn-ja-confirmei').addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return mostrar('tela-login');
  await user.reload();
  if (!user.emailVerified) return mensagem('O e-mail ainda não foi confirmado. Abra o link recebido.', true);
  await user.getIdToken(true); // atualiza o token para o banco reconhecer o e-mail confirmado
  rotear(user);
});

$('#btn-reenviar').addEventListener('click', async () => {
  const user = auth.currentUser;
  if (!user) return mostrar('tela-login');
  try {
    await sendEmailVerification(user);
    mensagem('E-mail reenviado.');
  } catch (err) {
    mensagem(traduzirErro(err), true);
  }
});

// ---------- enviar cadastro para aprovação ----------
$('#form-completar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const user = auth.currentUser;
  if (!user) return mostrar('tela-login');
  const dados = lerDados(f);
  const problema = validarDados(dados);
  if (problema) return mensagem(problema, true);
  travar(f, true);
  try {
    await setDoc(doc(db, 'usuarios', user.uid), {
      ...dados,
      email: normalizarEmail(user.email),
      perfil: 'usuario',
      situacao: 'pendente',
      criadoEm: serverTimestamp()
    });
    apagarRascunho();
    f.reset();
    mensagem('Cadastro enviado para aprovação.');
  } catch (err) {
    console.error(err);
    mensagem(traduzirErro(err), true);
  } finally {
    travar(f, false);
  }
});

// ---------- gestão de usuários ----------
$('#cartao-gestao').addEventListener('click', () => { renderizarLista(); mostrar('tela-gestao'); });

document.querySelectorAll('.aba').forEach((aba) => aba.addEventListener('click', () => {
  filtro = aba.dataset.filtro;
  document.querySelectorAll('.aba').forEach((a) => a.classList.toggle('ativa', a === aba));
  renderizarLista();
}));
$('#busca-usuarios').addEventListener('input', renderizarLista);

function iniciarGestao() {
  pararColecao = onSnapshot(collection(db, 'usuarios'), (snap) => {
    usuarios = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    atualizarContagens();
    if (telaAtual() === 'tela-gestao') renderizarLista();
  }, (err) => {
    console.error(err);
    mensagem(traduzirErro(err), true);
  });
}

const categoria = (u) => (u.situacao === 'pendente' ? 'pendente' : u.situacao === 'ativo' ? 'ativo' : 'inativo');

function atualizarContagens() {
  const cont = { pendente: 0, ativo: 0, inativo: 0 };
  usuarios.forEach((u) => { cont[categoria(u)]++; });
  for (const k of Object.keys(cont)) $(`#cont-${k}`).textContent = cont[k] ? `(${cont[k]})` : '';
  $('#resumo-gestao').textContent = cont.pendente
    ? `${cont.pendente} cadastro${cont.pendente > 1 ? 's' : ''} aguardando aprovação`
    : 'Aprovar cadastros e desativar contas';
}

// Gestor só mexe em usuário/conferente; admin mexe em todos. Ninguém mexe em si mesmo.
function possoAlterar(u) {
  if (!ehGestao() || u.uid === eu.uid) return false;
  if (eu.perfil === 'admin') return true;
  return ['usuario', 'conferente'].includes(u.perfil);
}
function perfisQuePossoDar() {
  return eu.perfil === 'admin' ? Object.keys(PERFIS) : ['usuario', 'conferente'];
}

function seletorPerfil(atual) {
  const sel = criar('select', { 'aria-label': 'Perfil' });
  perfisQuePossoDar().forEach((p) => sel.append(criar('option', { value: p, texto: PERFIS[p] })));
  sel.value = perfisQuePossoDar().includes(atual) ? atual : 'usuario';
  return sel;
}

async function decidir(u, situacao, perfil, textoOk) {
  try {
    await updateDoc(doc(db, 'usuarios', u.uid), {
      situacao,
      perfil,
      decididoPor: eu.uid,
      decididoEm: serverTimestamp()
    });
    mensagem(textoOk);
  } catch (err) {
    console.error(err);
    mensagem(traduzirErro(err), true);
  }
}

function renderizarLista() {
  const termo = $('#busca-usuarios').value.trim().toLowerCase();
  const lista = usuarios
    .filter((u) => categoria(u) === filtro)
    .filter((u) => !termo || [u.nomeGuerra, u.numero, u.turma, u.curso, u.email]
      .some((v) => String(v || '').toLowerCase().includes(termo)))
    .sort((a, b) => String(a.nomeGuerra).localeCompare(String(b.nomeGuerra), 'pt-BR'));

  const caixa = $('#lista-usuarios');
  if (!lista.length) {
    const vazio = { pendente: 'Nenhum cadastro aguardando aprovação.', ativo: 'Nenhum usuário ativo.', inativo: 'Nenhum usuário inativo.' };
    return caixa.replaceChildren(criar('p', { class: 'vazio', texto: termo ? 'Nada encontrado.' : vazio[filtro] }));
  }
  caixa.replaceChildren(...lista.map(itemUsuario));
}

function itemUsuario(u) {
  const ehEu = u.uid === eu.uid;
  const etiqueta = ehEu ? 'Você' : (u.situacao === 'recusado' ? 'Recusado' : u.situacao === 'desativado' ? 'Desativado' : PERFIS[u.perfil] || u.perfil);
  const item = criar('article', { class: 'item' },
    criar('div', { class: 'item-topo' },
      criar('span', { class: 'item-nome', texto: u.nomeGuerra || '(sem nome)' }),
      criar('span', { class: 'item-num', texto: `nº ${u.numero || '—'}` })
    ),
    criar('div', { class: 'item-det', texto: `${u.curso || ''} · ${u.turma || ''}` }),
    criar('div', { class: 'item-det', texto: u.email || '' }),
    criar('span', { class: 'etiqueta', texto: etiqueta })
  );

  if (!possoAlterar(u)) {
    if (!ehEu) item.append(criar('div', { class: 'item-det', texto: 'Somente o administrador pode alterar este cadastro.' }));
    return item;
  }

  const acoes = criar('div', { class: 'item-acoes' });
  if (u.situacao === 'pendente') {
    const sel = seletorPerfil('usuario');
    acoes.append(
      sel,
      criar('button', { type: 'button', class: 'btn-acao aprovar', texto: 'Aprovar',
        onclick: () => decidir(u, 'ativo', sel.value, `${u.nomeGuerra} aprovado.`) }),
      criar('button', { type: 'button', class: 'btn-acao perigo', texto: 'Recusar',
        onclick: () => confirm(`Recusar o cadastro de ${u.nomeGuerra}?`) && decidir(u, 'recusado', u.perfil, 'Cadastro recusado.') })
    );
  } else if (u.situacao === 'ativo') {
    const sel = seletorPerfil(u.perfil);
    acoes.append(
      sel,
      criar('button', { type: 'button', class: 'btn-acao', texto: 'Salvar perfil',
        onclick: () => sel.value !== u.perfil
          ? decidir(u, 'ativo', sel.value, 'Perfil atualizado.')
          : mensagem('O perfil já é esse.') }),
      criar('button', { type: 'button', class: 'btn-acao perigo', texto: 'Desativar',
        onclick: () => confirm(`Desativar o acesso de ${u.nomeGuerra}?`) && decidir(u, 'desativado', u.perfil, 'Acesso desativado.') })
    );
  } else {
    acoes.append(
      criar('button', { type: 'button', class: 'btn-acao aprovar', texto: 'Reativar',
        onclick: () => decidir(u, 'ativo', perfisQuePossoDar().includes(u.perfil) ? u.perfil : 'usuario', 'Acesso reativado.') })
    );
  }
  item.append(acoes);
  return item;
}

// ---------- viaturas ----------
const idViatura = (prefixo) => 'vtr-' + String(prefixo).toLowerCase();

function iniciarViaturas() {
  pararViaturas = onSnapshot(collection(db, 'viaturas'), (snap) => {
    viaturas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    estado.viaturas = viaturas;
    avisar('viaturas', viaturas);
    atualizarResumoViaturas();
    if (telaAtual() === 'tela-viaturas') renderizarViaturas();
  }, (err) => {
    console.error(err);
    mensagem(traduzirErro(err), true);
  });
}

function atualizarResumoViaturas() {
  const disp = viaturas.filter((v) => v.situacao === 'ativa' && !v.cautelaAtual).length;
  const texto = viaturas.length
    ? `${disp} disponíve${disp === 1 ? 'l' : 'is'} de ${viaturas.length} viatura${viaturas.length === 1 ? '' : 's'}`
    : 'Nenhuma viatura cadastrada';
  $('#resumo-viaturas').textContent = texto;
  $('#resumo-frota').textContent = texto;
}

$('#cartao-viaturas').addEventListener('click', () => { renderizarViaturas(); mostrar('tela-viaturas'); });

function renderizarViaturas() {
  $('#btn-nova-viatura').hidden = !ehGestao();
  $('#caixa-importar').hidden = !(ehGestao() && viaturas.length === 0);
  const lista = [...viaturas].sort((a, b) =>
    (a.prioridade - b.prioridade) || String(a.prefixo).localeCompare(String(b.prefixo), 'pt-BR'));
  const caixa = $('#lista-viaturas');
  if (!lista.length) {
    return caixa.replaceChildren(criar('p', { class: 'vazio', texto: 'Nenhuma viatura cadastrada.' }));
  }
  caixa.replaceChildren(...lista.map(itemViatura));
}

function itemViatura(v) {
  const extras = [
    COMBUSTIVEIS[v.combustivel] || v.combustivel,
    v.temRadio ? 'com rádio' : 'sem rádio',
    v.usaArla ? 'Arla 32' : null,
    v.nova ? 'nova' : null
  ].filter(Boolean).join(' · ');
  const placaAno = [v.placa ? `Placa ${v.placa}` : 'Placa não cadastrada', v.ano ? `ano ${v.ano}` : null]
    .filter(Boolean).join(' · ');
  const item = criar('article', { class: 'item' },
    criar('div', { class: 'item-topo' },
      criar('span', { class: 'vtr-prefixo', texto: v.prefixo }),
      criar('span', { class: 'item-num', texto: `${Number(v.kmAtual || 0).toLocaleString('pt-BR')} km` })
    ),
    criar('div', { class: 'item-nome', texto: v.modelo }),
    criar('div', { class: 'item-det', texto: extras }),
    criar('div', { class: 'item-det', texto: placaAno }),
    v.situacao !== 'ativa' && v.motivoSituacao ? criar('div', { class: 'item-det', texto: `Motivo: ${v.motivoSituacao}` }) : null,
    criar('div', { class: 'item-tags' },
      criar('span', { class: `situacao ${v.situacao}`, texto: v.situacao === 'ativa' && v.cautelaAtual ? 'Cautelada' : SITUACOES[v.situacao] || v.situacao }),
      criar('span', { class: 'etiqueta', texto: `Prioridade ${v.prioridade}` })
    )
  );
  if (ehGestao()) {
    item.append(criar('div', { class: 'item-acoes' },
      criar('button', { type: 'button', class: 'btn-acao', texto: 'Editar', onclick: () => abrirFormViatura(v) })
    ));
  }
  return item;
}

$('#btn-nova-viatura').addEventListener('click', () => abrirFormViatura(null));

function abrirFormViatura(v) {
  viaturaEditando = v;
  const f = $('#form-viatura');
  f.reset();
  $('#titulo-viatura-form').textContent = v ? `Viatura ${v.prefixo}` : 'Nova viatura';
  f.prefixo.disabled = !!v;
  if (v) {
    f.prefixo.value = v.prefixo;
    f.modelo.value = v.modelo || '';
    f.placa.value = v.placa || '';
    f.ano.value = v.ano || '';
    f.combustivel.value = v.combustivel || 'flex';
    f.kmAtual.value = v.kmAtual ?? '';
    f.prioridade.value = v.prioridade ?? '';
    f.situacao.value = v.situacao || 'ativa';
    f.motivoSituacao.value = v.motivoSituacao || '';
    f.temRadio.checked = !!v.temRadio;
    f.usaArla.checked = !!v.usaArla;
    f.nova.checked = !!v.nova;
  } else {
    f.temRadio.checked = true;
  }
  mostrar('tela-viatura-form');
}

function lerViatura(f) {
  const ano = String(f.ano.value || '').replace(/\D/g, '');
  return {
    prefixo: String(f.prefixo.value || '').trim().toUpperCase(),
    modelo: String(f.modelo.value || '').trim().replace(/\s+/g, ' '),
    placa: String(f.placa.value || '').trim().toUpperCase().replace(/\s+/g, ''),
    ano: ano ? Number(ano) : null,
    combustivel: f.combustivel.value,
    kmAtual: Number(String(f.kmAtual.value || '').replace(/\D/g, '')),
    prioridade: Number(String(f.prioridade.value || '').replace(/\D/g, '')),
    situacao: f.situacao.value,
    motivoSituacao: f.situacao.value === 'ativa' ? null : (String(f.motivoSituacao.value || '').trim().slice(0, 200) || null),
    temRadio: f.temRadio.checked,
    usaArla: f.usaArla.checked,
    nova: f.nova.checked
  };
}

function validarViatura(v) {
  if (!/^[A-Z0-9-]{1,10}$/.test(v.prefixo)) return 'Informe o prefixo (letras, números ou hífen).';
  if (v.modelo.length < 2) return 'Informe o modelo.';
  if (v.placa && !/^[A-Z0-9-]{5,10}$/.test(v.placa)) return 'Placa inválida.';
  if (v.ano !== null && (v.ano < 1980 || v.ano > 2100)) return 'Ano inválido.';
  if (!Number.isInteger(v.kmAtual) || v.kmAtual < 0 || v.kmAtual > 9999999) return 'KM inválido.';
  if (!Number.isInteger(v.prioridade) || v.prioridade > 999) return 'Prioridade inválida.';
  if (!SITUACOES[v.situacao]) return 'Selecione a situação.';
  if (!COMBUSTIVEIS[v.combustivel]) return 'Selecione o combustível.';
  return null;
}

$('#form-viatura').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  if (!ehGestao()) return mensagem('Somente gestor ou admin altera viaturas.', true);
  const v = lerViatura(f);
  const problema = validarViatura(v);
  if (problema) return mensagem(problema, true);
  if (!String(f.kmAtual.value).trim()) return mensagem('Informe o KM atual.', true);
  if (!v.prioridade) return mensagem('Informe a prioridade (1 ou mais).', true);
  const id = viaturaEditando ? viaturaEditando.id : idViatura(v.prefixo);
  if (!viaturaEditando && viaturas.some((x) => x.id === id)) return mensagem('Já existe viatura com esse prefixo.', true);
  const atual = viaturas.find((x) => x.id === id);
  if (atual?.cautelaAtual && v.situacao !== atual.situacao && v.situacao !== 'ativa') {
    return mensagem('A viatura está cautelada. Mude a situação depois da devolução.', true);
  }
  travar(f, true);
  try {
    // merge: mantém a cautela em andamento e o último combustível, que não são do cadastro
    await setDoc(doc(db, 'viaturas', id), { ...v, atualizadoPor: eu.uid, atualizadoEm: serverTimestamp() }, { merge: !!viaturaEditando });
    mensagem(viaturaEditando ? 'Viatura atualizada.' : 'Viatura cadastrada.');
    renderizarViaturas();
    mostrar('tela-viaturas');
  } catch (err) {
    console.error(err);
    mensagem(traduzirErro(err), true);
  } finally {
    travar(f, false);
    if (viaturaEditando) f.prefixo.disabled = true;
  }
});

$('#btn-importar').addEventListener('click', async (e) => {
  if (!ehGestao() || viaturas.length) return;
  if (!confirm(`Importar ${VIATURAS_INICIAIS.length} viaturas do VTR-ESFO?`)) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const lote = writeBatch(db);
    VIATURAS_INICIAIS.forEach((v) => lote.set(doc(db, 'viaturas', idViatura(v.prefixo)), {
      ...v, placa: '', ano: null, motivoSituacao: null, atualizadoPor: eu.uid, atualizadoEm: serverTimestamp()
    }));
    await lote.commit();
    mensagem('Viaturas importadas.');
  } catch (err) {
    console.error(err);
    mensagem(traduzirErro(err), true);
  } finally {
    btn.disabled = false;
  }
});

// ---------- PWA ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
