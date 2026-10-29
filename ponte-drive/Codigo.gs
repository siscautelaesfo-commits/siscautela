/**
 * SisCautela EsFO · Ponte com o Google Drive
 *
 * Roda no Apps Script da conta Google do sistema (a mesma que é dona do projeto Firebase).
 * Faz quatro coisas:
 *   1. Recebe do app as fotos (viatura, avaria, cupom) e grava no Drive, em pastas organizadas.
 *   2. Gera o termo de cada cautela encerrada (PDF com dados, fotos e assinaturas) e arquiva.
 *   3. Rotinas automáticas: alerta de atraso, relatório do dia, relatório mensal, termos pendentes,
 *      cópia de segurança semanal do banco e (se ativada) a retenção das fotos antigas.
 *   4. Entrega ao app os arquivos guardados, só para quem tem direito de ver.
 *
 * O Firestore continua sendo o banco do sistema. O Drive é o arquivo: aqui só se grava o arquivo e,
 * no banco, o identificador dele. Os campos que a ponte grava (arquivos, termo, fotos, cupom,
 * alertaAtraso) ficam bloqueados para o app nas regras do Firestore (ver LEIAME.md).
 *
 * Instalação e configuração: LEIAME.md.
 */

const VERSAO = '1.0.0';

const CFG = {
  FUSO: 'America/Sao_Paulo',
  PASTA_RAIZ: 'SisCautela',
  TAM_MAX_FOTO: 2 * 1024 * 1024,     // fotos chegam comprimidas (200 a 400 KB); 2 MB é folga
  TAM_MAX_PDF: 15 * 1024 * 1024,
  TAM_MAX_ENTREGA: 6 * 1024 * 1024,  // maior arquivo que a ponte devolve ao app
  ENVIOS_POR_10MIN: 80,              // por usuário; uma cautela completa tem 10 a 14 fotos
  PRAZO_ENVIO_H: 48,                 // fotos de uma cautela aceitas até 48 h depois do fato (fila offline)
  ATRASO_MIN: 30,
  HORA_RELATORIO_DIA: 19,
  HORA_TERMOS_PENDENTES: 22,
  COPIAS_GUARDADAS: 26,              // cópias semanais do banco: cerca de 6 meses
  COLECOES: ['viaturas', 'usuarios', 'cautelas', 'avarias', 'abastecimentos', 'log'],
  PERFIS_GESTAO: ['admin', 'gestor'],
};

const PASTAS = {
  fotos: ['Fotos'],
  avarias: ['Avarias'],
  cupons: ['Abastecimentos'],
  termos: ['Termos'],
  diarios: ['Relatórios', 'Diários'],
  mensais: ['Relatórios', 'Mensais'],
  doApp: ['Relatórios', 'Gerados no app'],
  copias: ['Cópias de segurança'],
  sistema: ['Sistema'],
};

const SLOTS = {
  retirada: ['frente', 'traseira', 'latEsq', 'latDir', 'painel'],
  devolucao: ['frente', 'traseira', 'latEsq', 'latDir', 'painel'],
  avaria: ['f1', 'f2', 'f3', 'f4'],
  cupom: ['cupom'],
};
const ROTULO_FOTO = { frente: 'Frente', traseira: 'Traseira', latEsq: 'Lateral esquerda', latDir: 'Lateral direita', painel: 'Painel (KM e combustível)' };
const COMB = ['Reserva', '1/4', '1/2', '3/4', 'Cheio'];

/* =========================================================================
 * Web app: o app conversa com a ponte por POST (texto JSON)
 * ========================================================================= */

const ACOES_ = {
  status: acaoStatus_,
  enviarFoto: acaoEnviarFoto_,
  arquivo: acaoArquivo_,
  gerarTermo: acaoGerarTermo_,
  salvarRelatorio: acaoSalvarRelatorio_,
};

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return resposta_({ ok: false, erro: 'pedido_invalido', mensagem: 'Pedido inválido.' });
  }
  try {
    const fn = ACOES_[req.acao];
    if (!fn) throw erro_('acao_desconhecida', 'Ação desconhecida.');
    const usuario = autenticar_(req.idToken);
    return resposta_({ ok: true, ...fn(usuario, req) });
  } catch (err) {
    if (err && err.codigo) return resposta_({ ok: false, erro: err.codigo, mensagem: err.message });
    console.error('Erro interno', req && req.acao, err && err.stack);
    return resposta_({ ok: false, erro: 'interno', mensagem: 'Erro interno na ponte. Tente de novo em instantes.' });
  }
}

// Só confirma que a ponte está no ar (não mostra dado nenhum)
function doGet() {
  return resposta_({ ok: true, servico: 'SisCautela · ponte Drive', versao: VERSAO });
}

function resposta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function erro_(codigo, mensagem) {
  const e = new Error(mensagem);
  e.codigo = codigo;
  return e;
}

/* =========================================================================
 * Segurança: quem está chamando
 * ========================================================================= */

// Confere o login do Firebase no próprio Google e lê o perfil no banco a cada pedido,
// para que um usuário desativado perca o acesso na hora.
function autenticar_(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 4096) {
    throw erro_('sem_login', 'Faça login de novo.');
  }
  const cache = CacheService.getScriptCache();
  const chave = 'tok_' + hash_(idToken);
  let uid = cache.get(chave);
  if (!uid) {
    const r = UrlFetchApp.fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(propObrig_('FIREBASE_API_KEY')),
      { method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true },
    );
    if (r.getResponseCode() !== 200) throw erro_('sem_login', 'Sua sessão expirou. Faça login de novo.');
    const conta = (JSON.parse(r.getContentText()).users || [])[0];
    if (!conta || conta.disabled) throw erro_('sem_login', 'Sua sessão expirou. Faça login de novo.');
    uid = conta.localId;
    cache.put(chave, uid, 600); // o token vale 1 h; a conferência fica guardada por 10 min
  }
  const perfil = lerDoc_('usuarios/' + uid);
  if (!perfil || perfil.situacao !== 'ativo') throw erro_('sem_acesso', 'Seu cadastro não está ativo no SisCautela.');
  return Object.assign({}, perfil, { uid: uid, gestao: CFG.PERFIS_GESTAO.indexOf(perfil.perfil) >= 0 });
}

function limitar_(uid) {
  const cache = CacheService.getScriptCache();
  const chave = 'rl_' + uid + '_' + Math.floor(Date.now() / 600000);
  const n = Number(cache.get(chave) || 0) + 1;
  if (n > CFG.ENVIOS_POR_10MIN) throw erro_('limite', 'Muitos envios em pouco tempo. Aguarde alguns minutos.');
  cache.put(chave, String(n), 660);
}

function exigirGestao_(u) {
  if (!u.gestao) throw erro_('sem_permissao', 'Só o gestor ou o administrador pode fazer isso.');
}

// Identificadores aceitos: os documentos do banco (letras, números, - e _)
function validarId_(id, nome) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw erro_('invalido', 'Identificador inválido: ' + nome + '.');
  return id;
}

function dentroDoPrazo_(momentoMs) {
  return momentoMs && Date.now() - momentoMs <= CFG.PRAZO_ENVIO_H * 3600e3;
}

/* =========================================================================
 * Ações do app
 * ========================================================================= */

function acaoStatus_(u) {
  return { versao: VERSAO, usuario: nomeDe_(u), gestao: u.gestao };
}

/**
 * Foto da viatura, de avaria ou do cupom de abastecimento.
 * Pedido: { momento: 'retirada'|'devolucao'|'avaria'|'cupom', ref: id do documento, slot, base64 }
 *  - retirada/devolucao: ref = id da cautela; slot = frente|traseira|latEsq|latDir|painel
 *  - avaria: ref = id da avaria; slot = f1..f4
 *  - cupom: ref = id do abastecimento; slot = cupom
 * Cada espaço recebe uma foto só: o que foi gravado não é trocado (o reenvio da mesma foto é aceito).
 */
function acaoEnviarFoto_(u, req) {
  limitar_(u.uid);
  const momento = req.momento;
  if (!SLOTS[momento]) throw erro_('invalido', 'Tipo de foto inválido.');
  const slot = req.slot;
  if (SLOTS[momento].indexOf(slot) < 0) throw erro_('invalido', 'Posição da foto inválida.');
  const ref = validarId_(req.ref, 'referência');

  const bytes = decodificar_(req.base64, CFG.TAM_MAX_FOTO);
  const tipo = tipoImagem_(bytes);
  if (!tipo) throw erro_('invalido', 'O arquivo enviado não é uma foto (JPEG, PNG ou WebP).');
  const sha = hash_(bytes);

  // Documento dono da foto, quem pode enviar e onde fica no banco
  let colecao, campo, existente, pasta, nome, dono, quando, prefixo, numero;
  if (momento === 'retirada' || momento === 'devolucao') {
    colecao = 'cautelas';
    const c = lerDoc_('cautelas/' + ref);
    if (!c) throw erro_('nao_encontrado', 'Cautela não encontrada.');
    dono = c.userId;
    quando = momento === 'retirada' ? c.saida : c.devolucao;
    if (momento === 'devolucao' && !c.devolucao) throw erro_('fora_de_ordem', 'Registre a devolução antes de enviar as fotos dela.');
    campo = 'arquivos.' + momento + '.' + slot;
    existente = c.arquivos && c.arquivos[momento] && c.arquivos[momento][slot];
    prefixo = c.vtrPrefixo || prefixoDe_(c.vtrId);
    numero = c.numero || ref;
    pasta = PASTAS.fotos.concat(anoMes_(quando), ['VTR-' + prefixo]);
    nome = [numero, momento, slot].join('_');
  } else if (momento === 'avaria') {
    colecao = 'avarias';
    const a = lerDoc_('avarias/' + ref);
    if (!a) throw erro_('nao_encontrado', 'Avaria não encontrada.');
    dono = a.registradaPor;
    quando = a.em;
    campo = 'fotos.' + slot;
    existente = a.fotos && a.fotos[slot];
    prefixo = a.vtrPrefixo || prefixoDe_(a.vtrId);
    numero = a.numero || ref;
    pasta = PASTAS.avarias.concat(anoMes_(quando));
    nome = [numero, 'VTR-' + prefixo, slot].join('_');
  } else {
    colecao = 'abastecimentos';
    const ab = lerDoc_('abastecimentos/' + ref);
    if (!ab) throw erro_('nao_encontrado', 'Abastecimento não encontrado.');
    dono = ab.userId;
    quando = ab.em;
    campo = 'cupom';
    existente = ab.cupom;
    prefixo = ab.vtrPrefixo || prefixoDe_(ab.vtrId);
    pasta = PASTAS.cupons.concat(anoMes_(quando));
    nome = [ab.numero || ref, 'VTR-' + prefixo, 'cupom'].join('_');
  }

  if (dono !== u.uid && !u.gestao) throw erro_('sem_permissao', 'Você só pode enviar fotos dos seus próprios registros.');
  if (existente) {
    if (existente.sha === sha) return { id: existente.id, repetida: true }; // reenvio da fila: já está gravada
    throw erro_('ja_enviada', 'Esta foto já foi registrada e não pode ser trocada.');
  }
  if (!dentroDoPrazo_(quando)) throw erro_('prazo', 'O prazo para enviar fotos deste registro terminou.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // Confere de novo dentro da trava: dois envios simultâneos da mesma foto gravam um arquivo só
    const atual = lerDoc_(colecao + '/' + ref);
    const ja = valorEm_(atual, campo);
    if (ja) {
      if (ja.sha === sha) return { id: ja.id, repetida: true };
      throw erro_('ja_enviada', 'Esta foto já foi registrada e não pode ser trocada.');
    }
    const arquivo = pasta_(pasta).createFile(Utilities.newBlob(bytes, tipo.mime, nome + '.' + tipo.ext));
    arquivo.setDescription(JSON.stringify({ sistema: 'SisCautela', tipo: 'foto', momento: momento, colecao: colecao, ref: ref, dono: dono, enviadoPor: u.uid, sha: sha }));
    const registro = { id: arquivo.getId(), em: new Date(), sha: sha, tamanho: bytes.length };
    const campos = {};
    campos[campo] = registro;
    atualizarDoc_(colecao + '/' + ref, campos);
    registrarLog_(u.uid, 'foto_enviada', colecao + '/' + ref + ' · ' + momento + ' · ' + slot);
    return { id: registro.id };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Entrega um arquivo guardado ao app (foto ou PDF), em base64.
 * O gestor vê tudo; o cadete vê só o que é dos registros dele.
 */
function acaoArquivo_(u, req) {
  const id = req.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(id)) throw erro_('invalido', 'Arquivo inválido.');
  let arquivo, meta;
  try {
    arquivo = DriveApp.getFileById(id);
    meta = JSON.parse(arquivo.getDescription() || '{}');
  } catch (err) {
    throw erro_('nao_encontrado', 'Arquivo não encontrado.');
  }
  if (meta.sistema !== 'SisCautela' || arquivo.isTrashed()) throw erro_('nao_encontrado', 'Arquivo não encontrado.');
  if (!u.gestao && meta.dono !== u.uid) throw erro_('sem_permissao', 'Você não tem acesso a este arquivo.');
  if (arquivo.getSize() > CFG.TAM_MAX_ENTREGA) throw erro_('grande_demais', 'Arquivo grande demais para abrir no app. Peça ao gestor o link do Drive.');
  const blob = arquivo.getBlob();
  return { nome: arquivo.getName(), mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

// O app pede o termo logo depois da devolução; a rotina das 22 h gera os que faltarem.
function acaoGerarTermo_(u, req) {
  const id = validarId_(req.cautelaId, 'cautela');
  const c = lerDoc_('cautelas/' + id);
  if (!c) throw erro_('nao_encontrado', 'Cautela não encontrada.');
  if (c.userId !== u.uid && !u.gestao) throw erro_('sem_permissao', 'Você só pode pedir o termo das suas cautelas.');
  if (c.situacao !== 'encerrada') throw erro_('cautela_aberta', 'O termo é gerado quando a cautela é encerrada.');
  if (c.termo && c.termo.id) return { id: c.termo.id, existente: true };
  const faltam = fotosFaltando_(c);
  if (faltam.length && Date.now() - c.devolucao < 2 * 3600e3) {
    return { pendente: true, faltam: faltam.length, mensagem: 'O termo será gerado quando todas as fotos chegarem.' };
  }
  return { id: gerarTermo_(c) };
}

// O administrador guarda no Drive um relatório gerado no app (para compartilhar por link)
function acaoSalvarRelatorio_(u, req) {
  exigirGestao_(u);
  limitar_(u.uid);
  const bytes = decodificar_(req.base64, CFG.TAM_MAX_PDF);
  if (String.fromCharCode.apply(null, bytes.slice(0, 4).map(function (b) { return b & 0xff; })) !== '%PDF') {
    throw erro_('invalido', 'O arquivo enviado não é um PDF.');
  }
  const nome = String(req.nome || 'relatorio').replace(/[^\w\-. ]+/g, '').replace(/\.pdf$/i, '').slice(0, 90) || 'relatorio';
  const arquivo = pasta_(PASTAS.doApp.concat(anoMes_(Date.now()))).createFile(Utilities.newBlob(bytes, 'application/pdf', nome + '.pdf'));
  arquivo.setDescription(JSON.stringify({ sistema: 'SisCautela', tipo: 'relatorio', dono: u.uid, enviadoPor: u.uid }));
  registrarLog_(u.uid, 'relatorio_salvo', nome);
  return { id: arquivo.getId(), link: arquivo.getUrl() };
}

/* =========================================================================
 * Termo de cautela (PDF)
 * ========================================================================= */

function fotosFaltando_(c) {
  const falta = [];
  ['retirada', 'devolucao'].forEach(function (m) {
    SLOTS[m].forEach(function (s) {
      if (!(c.arquivos && c.arquivos[m] && c.arquivos[m][s])) falta.push(m + '.' + s);
    });
  });
  return falta;
}

function gerarTermo_(c) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const atual = lerDoc_('cautelas/' + c._id);
    if (atual.termo && atual.termo.id) return atual.termo.id;
    c = atual;
    const usuario = lerDoc_('usuarios/' + c.userId) || {};
    const v = lerDoc_('viaturas/' + c.vtrId) || {};
    const numero = c.numero || c._id;
    const prefixo = c.vtrPrefixo || v.prefixo || '';
    const avs = consultar_('avarias', [['origemProvavel', 'EQUAL', c._id]]).concat(consultar_('avarias', [['cautelaId', 'EQUAL', c._id]]));

    const assin = function (s) { return s ? (s.metodo === 'senha' ? 'Senha pessoal' : 'Biometria do celular') + ' em ' + dataHora_(s.em) : '—'; };
    const pares = [
      ['Viatura', prefixo + ' · ' + (v.modelo || '') + ' · placa ' + (v.placa || '')],
      ['Militar', nomeDe_(usuario) + ' · ' + (usuario.curso || '') + ' · ' + (usuario.turma || usuario.pelotao || '')],
      ['Missão', c.missao || '—'],
    ];
    if (c.justificativa) pares.push(['Fora da ordem de prioridade', c.justificativa]);
    pares.push(
      ['Saída', dataHora_(c.saida) + ' · ' + km_(c.kmSaida) + ' km · combustível ' + (COMB[c.combSaida] || '—')],
      ['Volta prevista', dataHora_(c.previsao)],
      ['Assinatura da retirada', assin(c.assinaturaSaida)],
      ['Devolução', dataHora_(c.devolucao) + ' · ' + km_(c.kmRetorno) + ' km · combustível ' + (COMB[c.combRetorno] || '—')],
      ['Rodou', km_(c.kmRetorno - c.kmSaida) + ' km em ' + duracao_(c.devolucao - c.saida)],
      ['Assinatura da devolução', assin(c.assinaturaRetorno)],
    );
    if (c.devolucao > c.previsao + CFG.ATRASO_MIN * 60e3) pares.push(['Atraso', duracao_(c.devolucao - c.previsao) + ' depois da previsão']);
    if (c.justComb) pares.push(['Combustível', c.justComb]);
    if (c.obs) pares.push(['Observações', c.obs]);

    let corpo = secao_('Dados da cautela', kv_(pares));
    corpo += secao_('Fotos da retirada', gradeFotos_(c.arquivos && c.arquivos.retirada));
    corpo += secao_('Fotos da devolução', gradeFotos_(c.arquivos && c.arquivos.devolucao));
    if (avs.length) {
      corpo += secao_('Avarias ligadas a esta cautela', tabela_(['Data', 'Descrição', 'Gravidade', 'Ligação'], avs.map(function (a) {
        return [dataCurta_(a.em), a.descricao, a.gravidade === 'grave' ? 'Grave' : 'Leve', a.origemProvavel === c._id ? 'Origem provável nesta cautela' : 'Encontrada nesta cautela'];
      })));
    }
    const html = documento_('Termo de cautela ' + numero, 'Viatura ' + prefixo + ' · ' + nomeDe_(usuario), corpo);
    const pdf = htmlParaPdf_(html, [numero, 'VTR-' + prefixo, limparNome_(usuario.nomeGuerra || usuario.nome || '')].join('_'));
    const arquivo = pasta_(PASTAS.termos.concat(anoMes_(c.saida))).createFile(pdf);
    arquivo.setDescription(JSON.stringify({ sistema: 'SisCautela', tipo: 'termo', colecao: 'cautelas', ref: c._id, dono: c.userId }));
    atualizarDoc_('cautelas/' + c._id, { termo: { id: arquivo.getId(), em: new Date(), fotosFaltando: fotosFaltando_(c).length } });
    return arquivo.getId();
  } finally {
    lock.releaseLock();
  }
}

function gradeFotos_(mapa) {
  const celulas = SLOTS.retirada.map(function (s) {
    const reg = mapa && mapa[s];
    let img = '<div class="semfoto">sem foto</div>';
    if (reg && reg.id) {
      try {
        const b = DriveApp.getFileById(reg.id).getBlob();
        img = '<img src="data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) + '">';
      } catch (err) {
        img = '<div class="semfoto">foto indisponível</div>';
      }
    }
    return '<td>' + img + '<div class="rot">' + esc_(ROTULO_FOTO[s]) + '</div></td>';
  });
  let html = '<table class="fotos">';
  for (let i = 0; i < celulas.length; i += 3) html += '<tr>' + celulas.slice(i, i + 3).join('') + '</tr>';
  return html + '</table>';
}

/* =========================================================================
 * Rotinas automáticas (gatilhos criados por instalar())
 * ========================================================================= */

// A cada 30 min: cautela que passou da previsão + 30 min avisa o gestor e o cadete, uma vez só
function verificarAtrasos() {
  const agora = Date.now();
  const abertas = consultar_('cautelas', [['situacao', 'EQUAL', 'aberta']]);
  abertas.filter(function (c) {
    return c.previsao && agora > c.previsao + CFG.ATRASO_MIN * 60e3 && !c.alertaAtraso;
  }).forEach(function (c) {
    const u = lerDoc_('usuarios/' + c.userId) || {};
    const prefixo = c.vtrPrefixo || prefixoDe_(c.vtrId);
    const texto = 'A VTR ' + prefixo + ' está com ' + nomeDe_(u) + ' desde ' + dataHora_(c.saida) +
      '. A volta estava prevista para ' + dataHora_(c.previsao) + ' (' + duracao_(agora - c.previsao) + ' atrás).' +
      (u.telefone ? ' Contato: ' + u.telefone + '.' : '');
    enviarEmail_(gestores_(), '[SisCautela] Cautela em atraso · VTR ' + prefixo, '<p>' + esc_(texto) + '</p><p>Missão: ' + esc_(c.missao || '—') + '</p>');
    if (u.email) {
      enviarEmail_([u.email], '[SisCautela] Sua cautela da VTR ' + prefixo + ' está em atraso',
        '<p>A volta da VTR ' + esc_(prefixo) + ' estava prevista para ' + esc_(dataHora_(c.previsao)) + '. Devolva a viatura e registre a devolução no app, ou avise o gestor.</p>');
    }
    atualizarDoc_('cautelas/' + c._id, { alertaAtraso: { em: new Date() } });
  });
}

// Fim do expediente: relatório do dia em PDF no Drive e por e-mail aos gestores
function relatorioDiario() {
  const hoje = inicioDoDia_(new Date());
  const r = montarRelatorioDia_(hoje);
  if (r.vazio && [0, 6].indexOf(new Date(hoje).getDay()) >= 0) return; // fim de semana sem movimento: sem relatório
  const nome = Utilities.formatDate(new Date(hoje), CFG.FUSO, 'yyyy-MM-dd') + '_relatorio-do-dia';
  const pasta = pasta_(PASTAS.diarios.concat([Utilities.formatDate(new Date(hoje), CFG.FUSO, 'yyyy')]));
  substituir_(pasta, nome + '.pdf'); // um relatório por dia: a nova geração substitui a anterior
  const arquivo = pasta.createFile(htmlParaPdf_(r.html, nome));
  arquivo.setDescription(JSON.stringify({ sistema: 'SisCautela', tipo: 'relatorio', dono: 'gestao' }));
  enviarEmail_(gestores_(), '[SisCautela] Relatório do dia ' + dataCurta_(hoje, true) + ' · ' + r.titulo,
    r.resumoHtml + '<p>O PDF segue anexo e está no Drive do sistema, em Relatórios › Diários.</p>', [arquivo.getBlob()]);
}

function montarRelatorioDia_(diaMs) {
  const fim = diaMs + 86400e3;
  const doDia = consultar_('cautelas', [['saida', 'GREATER_THAN_OR_EQUAL', new Date(diaMs)]]).filter(function (c) { return c.saida < fim; });
  const abertas = consultar_('cautelas', [['situacao', 'EQUAL', 'aberta']]);
  const avs = consultar_('avarias', [['em', 'GREATER_THAN_OR_EQUAL', new Date(diaMs)]]).filter(function (a) { return a.em < fim; });
  const usuarios = mapaUsuarios_();
  const nome = function (id) { return nomeDe_(usuarios[id] || {}); };
  const pref = function (c) { return c.vtrPrefixo || prefixoDe_(c.vtrId); };
  const agora = Date.now();
  const atrasada = function (c) { return c.situacao === 'aberta' ? agora > c.previsao + CFG.ATRASO_MIN * 60e3 : c.devolucao > c.previsao + CFG.ATRASO_MIN * 60e3; };
  doDia.sort(function (a, b) { return a.saida - b.saida; });

  const oc = [];
  doDia.forEach(function (c) {
    if (atrasada(c)) oc.push(['Atraso', c.numero || c._id, 'VTR ' + pref(c) + ' · ' + nome(c.userId) + ' · previsão ' + hora_(c.previsao) + (c.devolucao ? ', devolvida ' + hora_(c.devolucao) : ', não devolvida')]);
    if (c.justificativa) oc.push(['Fora da ordem', c.numero || c._id, 'VTR ' + pref(c) + ': ' + c.justificativa]);
    if (c.divergenciaKm) oc.push(['KM divergente', c.numero || c._id, 'Saída com ' + km_(c.kmSaida) + ' km; última devolução com ' + km_(c.divergenciaKm) + ' km']);
    if (c.justComb) oc.push(['Combustível', c.numero || c._id, 'Devolvida na reserva: ' + c.justComb]);
  });
  const kmDia = doDia.reduce(function (s, c) { return s + (c.kmRetorno != null ? c.kmRetorno - c.kmSaida : 0); }, 0);

  let corpo = quadros_([[doDia.length, 'cautelas no dia'], [km_(kmDia), 'km rodados'], [abertas.length, 'viaturas fora agora'], [oc.length, 'ocorrências']]);
  corpo += secao_('Cautelas do dia', tabela_(['Nº', 'VTR', 'Cadete', 'Missão', 'Saída', 'Volta', 'KM', 'Situação'], doDia.map(function (c) {
    return [c.numero || c._id, pref(c), nome(c.userId), c.missao, hora_(c.saida), c.devolucao ? hora_(c.devolucao) : '—', c.kmRetorno != null ? km_(c.kmRetorno - c.kmSaida) : '—',
      c.situacao === 'aberta' ? (atrasada(c) ? 'Em atraso' : 'Aberta') : atrasada(c) ? 'Devolveu atrasado' : 'Encerrada'];
  }), doDia.map(function (c) { return atrasada(c) ? 'crit' : c.justificativa ? 'warn' : ''; }), 'Nenhuma cautela neste dia.'));
  corpo += secao_('Viaturas fora agora (chave fora do claviculário)', tabela_(['VTR', 'Cadete', 'Saída', 'Volta prevista', 'Situação'], abertas.map(function (c) {
    return [pref(c), nome(c.userId), dataHora_(c.saida), dataHora_(c.previsao), atrasada(c) ? 'Em atraso há ' + duracao_(agora - c.previsao) : 'No prazo'];
  }), abertas.map(function (c) { return atrasada(c) ? 'crit' : ''; }), 'Todas as chaves estão no claviculário.'));
  corpo += secao_('Ocorrências', tabela_(['Tipo', 'Cautela', 'Detalhe'], oc, oc.map(function (o) { return o[0] === 'Atraso' ? 'crit' : 'warn'; }), 'Nenhuma ocorrência.'));
  corpo += secao_('Avarias registradas', tabela_(['VTR', 'Gravidade', 'Descrição', 'Registrada por'], avs.map(function (a) {
    return [a.vtrPrefixo || prefixoDe_(a.vtrId), a.gravidade === 'grave' ? 'Grave' : 'Leve', a.descricao, nome(a.registradaPor)];
  }), null, 'Nenhuma avaria registrada.'));

  const titulo = abertas.length ? abertas.length + ' viatura(s) fora' : 'todas as chaves no claviculário';
  const resumoHtml = '<p><b>' + doDia.length + '</b> cautela(s) no dia, <b>' + km_(kmDia) + '</b> km rodados, <b>' + abertas.length +
    '</b> viatura(s) fora agora e <b>' + oc.length + '</b> ocorrência(s).</p>' +
    (abertas.length ? '<p>Fora agora: ' + abertas.map(function (c) { return esc_(pref(c) + ' com ' + nome(c.userId)); }).join('; ') + '.</p>' : '');
  return {
    html: documento_('Relatório do dia', dataCurta_(diaMs, true) + ' (gerado às ' + hora_(agora) + ')', corpo),
    titulo: titulo, resumoHtml: resumoHtml, vazio: !doDia.length && !abertas.length,
  };
}

// Dia 1 de cada mês: relatório de uso da frota do mês anterior
function relatorioMensal() {
  const hoje = new Date();
  const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1).getTime();
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 1).getTime();
  const cs = consultar_('cautelas', [['saida', 'GREATER_THAN_OR_EQUAL', new Date(ini)]]).filter(function (c) { return c.saida < fim; });
  const ab = consultar_('abastecimentos', [['em', 'GREATER_THAN_OR_EQUAL', new Date(ini)]]).filter(function (a) { return a.em < fim; });
  const vtrs = listarColecao_('viaturas').sort(function (a, b) { return (a.prioridade || 99) - (b.prioridade || 99); });
  const usuarios = mapaUsuarios_();
  const rod = function (c) { return c.kmRetorno != null ? c.kmRetorno - c.kmSaida : 0; };
  const uso = function (c) { return (c.devolucao || Date.now()) - c.saida; };
  const atrasou = function (c) { return c.devolucao ? c.devolucao > c.previsao + CFG.ATRASO_MIN * 60e3 : Date.now() > c.previsao + CFG.ATRASO_MIN * 60e3; };
  const fora = cs.filter(function (c) { return c.justificativa; });
  const atrasos = cs.filter(atrasou);
  const pct = cs.length ? Math.round(((cs.length - fora.length) / cs.length) * 100) : 0;

  let corpo = quadros_([
    [cs.length, 'cautelas'], [km_(cs.reduce(function (s, c) { return s + rod(c); }, 0)), 'km rodados'],
    [horas_(cs.reduce(function (s, c) { return s + uso(c); }, 0)), 'em uso'], [atrasos.length, 'atrasos'], [pct + '%', 'com a VTR prioritária'],
    [km_(ab.reduce(function (s, a) { return s + (a.litros || 0); }, 0)) + ' L', reais_(ab.reduce(function (s, a) { return s + (a.valor || 0); }, 0)) + ' abastecidos'],
  ]);
  corpo += secao_('Uso por viatura (ordem de prioridade)', tabela_(['Prior.', 'VTR', 'Modelo', 'Cautelas', 'KM', 'Horas', 'Litros'], vtrs.map(function (v) {
    const vc = cs.filter(function (c) { return c.vtrId === v._id; });
    return [(v.prioridade || '—') + 'º', v.prefixo, v.modelo, vc.length, km_(vc.reduce(function (s, c) { return s + rod(c); }, 0)), horas_(vc.reduce(function (s, c) { return s + uso(c); }, 0)),
      km_(ab.filter(function (a) { return a.vtrId === v._id; }).reduce(function (s, a) { return s + (a.litros || 0); }, 0))];
  })));
  corpo += secao_('Cautelas fora da ordem de prioridade', tabela_(['Data', 'Nº', 'VTR', 'Cadete', 'Motivo'], fora.map(function (c) {
    return [dataCurta_(c.saida), c.numero || c._id, c.vtrPrefixo || prefixoDe_(c.vtrId), nomeDe_(usuarios[c.userId] || {}), c.justificativa];
  }), null, 'Todas as cautelas usaram a viatura prioritária.'));
  corpo += secao_('Atrasos na devolução', tabela_(['Data', 'Nº', 'VTR', 'Cadete', 'Previsão', 'Devolução'], atrasos.map(function (c) {
    return [dataCurta_(c.saida), c.numero || c._id, c.vtrPrefixo || prefixoDe_(c.vtrId), nomeDe_(usuarios[c.userId] || {}), hora_(c.previsao), c.devolucao ? hora_(c.devolucao) : 'não devolvida'];
  }), atrasos.map(function () { return 'crit'; }), 'Nenhum atraso no mês.'));

  const mesTxt = Utilities.formatDate(new Date(ini), CFG.FUSO, 'MM/yyyy');
  const nome = Utilities.formatDate(new Date(ini), CFG.FUSO, 'yyyy-MM') + '_uso-da-frota';
  const pasta = pasta_(PASTAS.mensais);
  substituir_(pasta, nome + '.pdf');
  const arquivo = pasta.createFile(htmlParaPdf_(documento_('Uso da frota', 'Mês ' + mesTxt, corpo), nome));
  arquivo.setDescription(JSON.stringify({ sistema: 'SisCautela', tipo: 'relatorio', dono: 'gestao' }));
  enviarEmail_(gestores_(), '[SisCautela] Uso da frota · ' + mesTxt,
    '<p>' + cs.length + ' cautelas no mês, ' + atrasos.length + ' atraso(s) e ' + pct + '% com a viatura prioritária.</p><p>O PDF segue anexo e está em Relatórios › Mensais.</p>', [arquivo.getBlob()]);
}

// 22 h: gera os termos das cautelas encerradas nos últimos 7 dias que ainda não têm termo
function gerarTermosPendentes() {
  const desde = new Date(Date.now() - 7 * 86400e3);
  consultar_('cautelas', [['devolucao', 'GREATER_THAN_OR_EQUAL', desde]])
    .filter(function (c) { return c.situacao === 'encerrada' && !(c.termo && c.termo.id); })
    .forEach(function (c) {
      try {
        gerarTermo_(c);
      } catch (err) {
        console.error('Termo não gerado', c._id, err && err.stack);
      }
    });
}

// Domingo 3 h: cópia do banco em JSON compactado (para restaurar) e em planilha (para consultar)
function copiaSeguranca() {
  const dados = {};
  CFG.COLECOES.forEach(function (col) { dados[col] = listarColecao_(col); });
  const data = Utilities.formatDate(new Date(), CFG.FUSO, 'yyyy-MM-dd');
  const pasta = pasta_(PASTAS.copias);

  const json = Utilities.newBlob(JSON.stringify({ versao: VERSAO, geradoEm: new Date().toISOString(), dados: dados }), 'application/json', data + '_banco.json');
  pasta.createFile(Utilities.zip([json], data + '_banco.zip'))
    .setDescription(JSON.stringify({ sistema: 'SisCautela', tipo: 'copia', dono: 'gestao' }));

  const planilha = SpreadsheetApp.create(data + '_banco');
  CFG.COLECOES.forEach(function (col, i) {
    const aba = i === 0 ? planilha.getSheets()[0].setName(col) : planilha.insertSheet(col);
    const docs = dados[col];
    if (!docs.length) { aba.getRange(1, 1).setValue('(vazio)'); return; }
    const colunas = ['_id'].concat(Object.keys(docs.reduce(function (o, d) { Object.keys(d).forEach(function (k) { if (k[0] !== '_') o[k] = 1; }); return o; }, {})));
    const linhas = docs.map(function (d) {
      return colunas.map(function (k) {
        const v = d[k];
        if (v == null) return '';
        if (typeof v === 'object') return JSON.stringify(v).slice(0, 49000);
        if (typeof v === 'number' && v > 1e12 && v < 4e12) return new Date(v); // datas do banco ficam legíveis
        return typeof v === 'string' ? v.slice(0, 49000) : v;
      });
    });
    aba.getRange(1, 1, 1, colunas.length).setValues([colunas]).setFontWeight('bold');
    aba.getRange(2, 1, linhas.length, colunas.length).setValues(linhas);
    aba.setFrozenRows(1);
  });
  DriveApp.getFileById(planilha.getId()).moveTo(pasta);

  // Mantém só as cópias mais recentes (cada cópia = um .zip e uma planilha)
  const arquivos = [];
  const it = pasta.getFiles();
  while (it.hasNext()) arquivos.push(it.next());
  arquivos.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  arquivos.slice(CFG.COPIAS_GUARDADAS * 2).forEach(function (f) { f.setTrashed(true); });
}

/**
 * Retenção das fotos (LGPD). Só age com a propriedade RETENCAO_FOTOS_MESES definida,
 * depois que o comando fixar o prazo. Envia para a lixeira as pastas de mês mais antigas que o prazo
 * (a lixeira do Drive guarda por 30 dias). Termos, relatórios e o histórico no banco ficam.
 */
function aplicarRetencao() {
  const meses = Number(prop_('RETENCAO_FOTOS_MESES') || 0);
  if (!meses) return;
  const limite = new Date();
  limite.setMonth(limite.getMonth() - meses);
  const corte = Utilities.formatDate(limite, CFG.FUSO, 'yyyy-MM');
  [PASTAS.fotos, PASTAS.avarias, PASTAS.cupons].forEach(function (base) {
    const anos = pasta_(base).getFolders();
    while (anos.hasNext()) {
      const ano = anos.next();
      const mesesIt = ano.getFolders();
      while (mesesIt.hasNext()) {
        const mes = mesesIt.next();
        if (ano.getName() + '-' + mes.getName() < corte) mes.setTrashed(true);
      }
    }
  });
  registrarLog_('sistema', 'retencao', 'Fotos anteriores a ' + corte + ' enviadas à lixeira');
}

/* =========================================================================
 * Instalação e testes (executar pelo editor do Apps Script)
 * ========================================================================= */

/**
 * Executar uma vez, depois de preencher as Propriedades do script.
 * Cria a pasta SisCautela e as subpastas e instala as rotinas automáticas.
 * Pode ser executada de novo sem duplicar nada.
 */
function instalar() {
  propObrig_('FIREBASE_API_KEY');
  propObrig_('FIREBASE_PROJECT_ID');

  let raiz = null;
  const idRaiz = prop_('PASTA_RAIZ_ID');
  if (idRaiz) {
    try { raiz = DriveApp.getFolderById(idRaiz); } catch (err) { raiz = null; }
  }
  if (!raiz) {
    const it = DriveApp.getRootFolder().getFoldersByName(CFG.PASTA_RAIZ);
    raiz = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(CFG.PASTA_RAIZ);
    PropertiesService.getScriptProperties().setProperty('PASTA_RAIZ_ID', raiz.getId());
  }
  Object.keys(PASTAS).forEach(function (k) { pasta_(PASTAS[k]); });

  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('verificarAtrasos').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('relatorioDiario').timeBased().everyDays(1).atHour(CFG.HORA_RELATORIO_DIA).inTimezone(CFG.FUSO).create();
  ScriptApp.newTrigger('gerarTermosPendentes').timeBased().everyDays(1).atHour(CFG.HORA_TERMOS_PENDENTES).inTimezone(CFG.FUSO).create();
  ScriptApp.newTrigger('relatorioMensal').timeBased().onMonthDay(1).atHour(6).inTimezone(CFG.FUSO).create();
  ScriptApp.newTrigger('copiaSeguranca').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).inTimezone(CFG.FUSO).create();
  ScriptApp.newTrigger('aplicarRetencao').timeBased().onMonthDay(2).atHour(4).inTimezone(CFG.FUSO).create();

  testarConexao();
  console.log('Instalação concluída. Pasta do sistema: ' + raiz.getUrl());
  console.log('Próximo passo: envie os brasões para a pasta SisCautela › Sistema e publique o app da Web (LEIAME.md, passo 6).');
}

// Confere o acesso ao banco e ao Drive e mostra o que encontrou
function testarConexao() {
  const vtrs = listarColecao_('viaturas');
  const usuarios = listarColecao_('usuarios');
  console.log('Banco OK: ' + vtrs.length + ' viatura(s) e ' + usuarios.length + ' usuário(s).');
  console.log('Drive OK: ' + DriveApp.getFolderById(propObrig_('PASTA_RAIZ_ID')).getName());
  console.log('Gestores que recebem e-mail: ' + (gestores_().join(', ') || 'nenhum (cadastre e-mail no perfil ou em EMAILS_EXTRA)'));
  console.log('Brasões na pasta Sistema: ' + (brasoes_().apmg ? 'APMG ✓' : 'APMG falta') + ' · ' + (brasoes_().esfo ? 'EsFO ✓' : 'EsFO falta'));
  console.log('E-mails restantes hoje: ' + MailApp.getRemainingDailyQuota());
}

// Gera agora o relatório do dia, sem esperar o horário (para conferir o layout)
function testarRelatorioDiario() {
  relatorioDiario();
  console.log('Relatório gerado em SisCautela › Relatórios › Diários.');
}

/* =========================================================================
 * Firestore (REST, com a autorização da própria conta do sistema)
 * ========================================================================= */

function fsBase_() {
  return 'https://firestore.googleapis.com/v1/projects/' + propObrig_('FIREBASE_PROJECT_ID') + '/databases/(default)/documents';
}

function fsFetch_(url, opcoes) {
  const r = UrlFetchApp.fetch(url, Object.assign({
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'x-goog-user-project': propObrig_('FIREBASE_PROJECT_ID') },
  }, opcoes || {}));
  const code = r.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) {
    console.error('Firestore ' + code + ': ' + r.getContentText().slice(0, 800));
    throw erro_('banco', 'Não foi possível acessar o banco de dados agora.');
  }
  const txt = r.getContentText();
  return txt ? JSON.parse(txt) : {};
}

function lerDoc_(caminho) {
  const d = fsFetch_(fsBase_() + '/' + caminho);
  return d ? doc_(d) : null;
}

// Atualiza só os campos informados (caminhos com ponto: 'arquivos.retirada.frente')
function atualizarDoc_(caminho, campos) {
  const aninhado = {};
  Object.keys(campos).forEach(function (k) { aninhar_(aninhado, k.split('.'), campos[k]); });
  const mascara = Object.keys(campos).map(function (k) {
    return 'updateMask.fieldPaths=' + encodeURIComponent(k.split('.').map(campoFs_).join('.'));
  }).join('&');
  fsFetch_(fsBase_() + '/' + caminho + '?' + mascara + '&currentDocument.exists=true', {
    method: 'patch',
    payload: JSON.stringify({ fields: paraFs_(aninhado).mapValue.fields }),
  });
}

function criarDoc_(colecao, dados) {
  return fsFetch_(fsBase_() + '/' + colecao, { method: 'post', payload: JSON.stringify({ fields: paraFs_(dados).mapValue.fields }) });
}

// Consulta simples (um filtro por campo; o restante é filtrado aqui, sem exigir índices compostos)
function consultar_(colecao, filtros) {
  const fs = filtros.map(function (f) {
    return { fieldFilter: { field: { fieldPath: f[0] }, op: f[1], value: paraFs_(f[2]) } };
  });
  const consulta = { structuredQuery: { from: [{ collectionId: colecao }], limit: 2000 } };
  if (fs.length === 1) consulta.structuredQuery.where = fs[0];
  if (fs.length > 1) consulta.structuredQuery.where = { compositeFilter: { op: 'AND', filters: fs } };
  const r = fsFetch_(fsBase_() + ':runQuery', { method: 'post', payload: JSON.stringify(consulta) }) || [];
  return r.filter(function (x) { return x.document; }).map(function (x) { return doc_(x.document); });
}

function listarColecao_(colecao) {
  const docs = [];
  let token = '';
  do {
    const r = fsFetch_(fsBase_() + '/' + colecao + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : '')) || {};
    (r.documents || []).forEach(function (d) { docs.push(doc_(d)); });
    token = r.nextPageToken || '';
  } while (token);
  return docs;
}

function registrarLog_(uid, acao, detalhe) {
  try {
    criarDoc_('log', { em: new Date(), userId: uid, acao: acao, detalhe: detalhe, origem: 'ponte-drive' });
  } catch (err) {
    console.error('Log não gravado', acao, detalhe);
  }
}

// Conversão entre os valores tipados do Firestore REST e objetos comuns (datas viram milissegundos)
function deFs_(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return new Date(v.timestampValue).getTime();
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return objFs_(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(deFs_);
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  return null;
}
function objFs_(campos) {
  const o = {};
  Object.keys(campos).forEach(function (k) { o[k] = deFs_(campos[k]); });
  return o;
}
function doc_(d) {
  const o = objFs_(d.fields || {});
  o._id = d.name.split('/').pop();
  return o;
}
function paraFs_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(paraFs_) } };
  const f = {};
  Object.keys(v).forEach(function (k) { f[k] = paraFs_(v[k]); });
  return { mapValue: { fields: f } };
}
function aninhar_(alvo, partes, valor) {
  let o = alvo;
  for (let i = 0; i < partes.length - 1; i++) o = o[partes[i]] = o[partes[i]] || {};
  o[partes[partes.length - 1]] = valor;
}
function campoFs_(nome) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(nome) ? nome : '`' + nome.replace(/`/g, '\\`') + '`';
}
function valorEm_(obj, caminho) {
  return caminho.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
}

/* =========================================================================
 * Drive, e-mail e utilidades
 * ========================================================================= */

// Pasta pelo caminho a partir da raiz (cria o que faltar); guarda o id em cache por 6 h.
// Quem grava arquivo pelo app chama esta função já dentro da trava do script (LockService),
// então dois envios simultâneos não criam a mesma pasta duas vezes.
function pasta_(caminho) {
  const cache = CacheService.getScriptCache();
  const chave = 'p_' + hash_(caminho.join('/'));
  const id = cache.get(chave);
  if (id) {
    try {
      const salva = DriveApp.getFolderById(id);
      if (!salva.isTrashed()) return salva;
    } catch (err) { /* removida: recria abaixo */ }
  }
  let p = DriveApp.getFolderById(propObrig_('PASTA_RAIZ_ID'));
  caminho.forEach(function (nome) {
    const it = p.getFoldersByName(nome);
    p = it.hasNext() ? it.next() : p.createFolder(nome);
  });
  cache.put(chave, p.getId(), 21600);
  return p;
}

function substituir_(pasta, nome) {
  const it = pasta.getFilesByName(nome);
  while (it.hasNext()) it.next().setTrashed(true);
}

function anoMes_(ms) {
  const d = new Date(ms || Date.now());
  return [Utilities.formatDate(d, CFG.FUSO, 'yyyy'), Utilities.formatDate(d, CFG.FUSO, 'MM')];
}

function decodificar_(base64, max) {
  if (typeof base64 !== 'string' || !base64) throw erro_('invalido', 'Arquivo vazio.');
  const limpo = base64.replace(/^data:[^,]*,/, '');
  if (limpo.length > Math.ceil((max * 4) / 3) + 8) throw erro_('grande_demais', 'Arquivo maior que o permitido.');
  let bytes;
  try { bytes = Utilities.base64Decode(limpo); } catch (err) { throw erro_('invalido', 'Arquivo corrompido.'); }
  if (!bytes.length || bytes.length > max) throw erro_('grande_demais', 'Arquivo maior que o permitido.');
  return bytes;
}

// O tipo vem do conteúdo do arquivo, nunca do nome nem do que o app diz
function tipoImagem_(b) {
  const u = function (i) { return b[i] & 0xff; };
  if (b.length > 3 && u(0) === 0xff && u(1) === 0xd8 && u(2) === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length > 8 && u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4e && u(3) === 0x47) return { mime: 'image/png', ext: 'png' };
  if (b.length > 12 && u(0) === 0x52 && u(1) === 0x49 && u(2) === 0x46 && u(3) === 0x46 && u(8) === 0x57 && u(9) === 0x45 && u(10) === 0x42 && u(11) === 0x50) return { mime: 'image/webp', ext: 'webp' };
  return null;
}

function hash_(entrada) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, entrada);
  return Utilities.base64EncodeWebSafe(d).replace(/=+$/, '');
}

function gestores_() {
  const daBase = consultar_('usuarios', [['perfil', 'IN', CFG.PERFIS_GESTAO]])
    .filter(function (u) { return u.situacao === 'ativo' && u.email; })
    .map(function (u) { return u.email; });
  const extras = String(prop_('EMAILS_EXTRA') || '').split(/[,;\s]+/).filter(function (e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); });
  return daBase.concat(extras).filter(function (e, i, a) { return a.indexOf(e) === i; });
}

function enviarEmail_(para, assunto, html, anexos) {
  if (!para || !para.length) return;
  if (MailApp.getRemainingDailyQuota() < para.length) {
    console.error('Cota diária de e-mails esgotada; não enviado: ' + assunto);
    return;
  }
  MailApp.sendEmail({
    to: para.join(','),
    subject: assunto,
    name: 'SisCautela EsFO',
    htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#0e1a2b">' + html +
      '<p style="color:#4a5a70;font-size:12px">Mensagem automática do SisCautela · Cautela de viaturas da EsFO. Não responda.</p></div>',
    attachments: anexos || [],
  });
}

function mapaUsuarios_() {
  const m = {};
  listarColecao_('usuarios').forEach(function (u) { m[u._id] = u; });
  return m;
}

function prefixoDe_(vtrId) {
  if (!vtrId) return '';
  const cache = CacheService.getScriptCache();
  const k = 'vtr_' + vtrId;
  let p = cache.get(k);
  if (!p) {
    const v = lerDoc_('viaturas/' + vtrId);
    p = (v && v.prefixo) || vtrId;
    cache.put(k, p, 21600);
  }
  return p;
}

// "Cad. Romeiro" (CFO) ou "Al Of Silva" (CHOE), como no app
function nomeDe_(u) {
  if (u.nomeGuerra) return (u.curso === 'CHOE' ? 'Al Of ' : 'Cad. ') + u.nomeGuerra;
  return ((u.posto ? u.posto + ' ' : '') + (u.nome || '')).trim() || '—';
}
function limparNome_(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '').slice(0, 30);
}
function prop_(k) {
  return PropertiesService.getScriptProperties().getProperty(k);
}
function propObrig_(k) {
  const v = prop_(k);
  if (!v) throw erro_('configuracao', 'Falta a propriedade do script ' + k + ' (veja o LEIAME.md).');
  return v;
}
function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function km_(n) {
  return n == null || isNaN(n) ? '—' : Number(n).toLocaleString('pt-BR');
}
function reais_(n) {
  return 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function hora_(ms) {
  return ms ? Utilities.formatDate(new Date(ms), CFG.FUSO, 'HH:mm') : '—';
}
function dataHora_(ms) {
  return ms ? Utilities.formatDate(new Date(ms), CFG.FUSO, "dd/MM/yyyy 'às' HH:mm") : '—';
}
function dataCurta_(ms, comAno) {
  return ms ? Utilities.formatDate(new Date(ms), CFG.FUSO, comAno ? 'dd/MM/yyyy' : 'dd/MM') : '—';
}
function inicioDoDia_(d) {
  const iso = Utilities.formatDate(d, CFG.FUSO, "yyyy-MM-dd'T'00:00:00XXX");
  return new Date(iso).getTime();
}
function duracao_(ms) {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h + ' h' + (r ? ' ' + (r < 10 ? '0' : '') + r : '');
}
function horas_(ms) {
  return (Math.round((ms / 3600e3) * 10) / 10).toString().replace('.', ',') + ' h';
}

/* =========================================================================
 * Layout dos PDFs (mesma identidade do app: brasões, azul do escudo e filete ouro)
 * ========================================================================= */

function brasoes_() {
  const cache = CacheService.getScriptCache();
  const salvo = cache.get('brasoes');
  if (salvo) return JSON.parse(salvo);
  const r = {};
  try {
    const p = pasta_(PASTAS.sistema);
    [['apmg', 'brasao-apmg.png'], ['esfo', 'brasao-esfo.png']].forEach(function (x) {
      const it = p.getFilesByName(x[1]);
      if (it.hasNext()) {
        const b = it.next().getBlob();
        r[x[0]] = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
      }
    });
  } catch (err) { /* sem brasões, o PDF sai sem eles */ }
  const txt = JSON.stringify(r);
  if (txt.length < 95000) cache.put('brasoes', txt, 21600);
  return r;
}

function documento_(titulo, sub, corpo) {
  const b = brasoes_();
  const img = function (src) { return src ? '<img src="' + src + '" style="height:70px">' : ''; };
  return '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;color:#0e1a2b;font-size:10.5pt;margin:0}' +
    '.cab{width:100%;border-bottom:3px solid #f5c531;margin-bottom:10px}.cab td{vertical-align:middle}' +
    'h1{color:#00458a;font-size:15pt;margin:0;text-transform:uppercase;letter-spacing:.5px}' +
    '.sub{color:#4a5a70;font-size:9.5pt}.sub2{font-weight:bold;font-size:10pt}' +
    'h2{color:#00458a;font-size:12pt;margin:16px 0 6px}' +
    'table.t{width:100%;border-collapse:collapse;font-size:9pt}table.t th{background:#071c40;color:#fff;text-align:left;padding:4px 5px}' +
    'table.t td{border-bottom:1px solid #d9e0ea;padding:4px 5px;vertical-align:top}tr.crit td{background:#fde8e6}tr.warn td{background:#fdf0de}' +
    '.quadros{width:100%;border-collapse:separate;border-spacing:4px}.quadros td{background:#edf1f6;padding:6px 8px;width:16%}' +
    '.quadros b{font-size:14pt;display:block}.quadros span{color:#4a5a70;font-size:8pt}' +
    '.kv td{padding:3px 6px;vertical-align:top;font-size:9.5pt}.kv td.k{color:#4a5a70;width:32%}' +
    '.fotos{width:100%;border-collapse:separate;border-spacing:6px}.fotos td{width:33%;vertical-align:top}' +
    '.fotos img{width:100%;height:auto}.semfoto{background:#edf1f6;color:#4a5a70;text-align:center;padding:40px 0;font-size:8.5pt}' +
    '.rot{color:#4a5a70;font-size:8pt;margin-top:2px}.vazio{color:#4a5a70;font-style:italic;font-size:9pt}' +
    '.rodape{color:#4a5a70;font-size:7.5pt;border-top:1px solid #d9e0ea;margin-top:16px;padding-top:4px}' +
    '</style></head><body>' +
    '<table class="cab"><tr><td style="width:90px">' + img(b.apmg) + '</td><td style="text-align:center"><h1>' + esc_(titulo) + '</h1>' +
    '<div class="sub">Escola de Formação de Oficiais · APMG · PMPR</div><div class="sub2">' + esc_(sub) + '</div></td>' +
    '<td style="width:90px;text-align:right">' + img(b.esfo) + '</td></tr></table>' +
    corpo +
    '<div class="rodape">Gerado automaticamente pelo SisCautela em ' + esc_(dataHora_(Date.now())) + '.</div></body></html>';
}

function secao_(titulo, conteudo) {
  return '<h2>' + esc_(titulo) + '</h2>' + conteudo;
}

function tabela_(colunas, linhas, destaques, vazio) {
  if (!linhas.length) return '<p class="vazio">' + esc_(vazio || 'Sem registros.') + '</p>';
  return '<table class="t"><tr>' + colunas.map(function (c) { return '<th>' + esc_(c) + '</th>'; }).join('') + '</tr>' +
    linhas.map(function (l, i) {
      const d = destaques && destaques[i];
      return '<tr' + (d ? ' class="' + d + '"' : '') + '>' + l.map(function (v) { return '<td>' + esc_(v) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</table>';
}

function kv_(pares) {
  return '<table class="kv">' + pares.map(function (p) { return '<tr><td class="k">' + esc_(p[0]) + '</td><td>' + esc_(p[1]) + '</td></tr>'; }).join('') + '</table>';
}

function quadros_(itens) {
  return '<table class="quadros"><tr>' + itens.map(function (q) { return '<td><b>' + esc_(q[0]) + '</b><span>' + esc_(q[1]) + '</span></td>'; }).join('') + '</tr></table>';
}

function htmlParaPdf_(html, nome) {
  return Utilities.newBlob(html, 'text/html', nome + '.html').getAs('application/pdf').setName(nome + '.pdf');
}
