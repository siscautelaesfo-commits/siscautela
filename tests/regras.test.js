// Testes das regras do Firestore (rodam no emulador local, sem tocar no projeto real).
// Uso: npm install && npm run test:regras
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, serverTimestamp
} from 'firebase/firestore';

let env;

const DADOS = { numero: '1021', nomeGuerra: 'Novato', curso: 'CFO', turma: '1º Pel Alfa' };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-siscautela',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') }
  });
});

after(async () => { await env.cleanup(); });

// Cenário base: um admin, um gestor e um usuário ativos.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const base = { curso: 'CFO', turma: '-', situacao: 'ativo' };
    await setDoc(doc(db, 'usuarios', 'uid-admin'), { ...base, numero: '1', nomeGuerra: 'Admin', email: 'admin@x.com', perfil: 'admin' });
    await setDoc(doc(db, 'usuarios', 'uid-gestor'), { ...base, numero: '2', nomeGuerra: 'Gestor', email: 'gestor@x.com', perfil: 'gestor' });
    await setDoc(doc(db, 'usuarios', 'uid-user'), { ...base, numero: '3', nomeGuerra: 'User', email: 'user@x.com', perfil: 'usuario' });
  });
});

const ctx = (uid, email, verificado = true) =>
  env.authenticatedContext(uid, { email, email_verified: verificado }).firestore();
const novato = (verificado = true) => ctx('uid-novo', 'novo@x.com', verificado);
const admin = () => ctx('uid-admin', 'admin@x.com');
const gestor = () => ctx('uid-gestor', 'gestor@x.com');
const user = () => ctx('uid-user', 'user@x.com');

const cadastro = (extra = {}) => ({
  ...DADOS, email: 'novo@x.com', perfil: 'usuario', situacao: 'pendente', criadoEm: serverTimestamp(), ...extra
});
const criarPendente = (db = novato(), extra = {}) => setDoc(doc(db, 'usuarios', 'uid-novo'), cadastro(extra));

// ---- autocadastro ----
test('autocadastro pendente funciona com e-mail confirmado', async () => {
  await assertSucceeds(criarPendente());
});

test('autocadastro exige e-mail confirmado', async () => {
  await assertFails(criarPendente(novato(false)));
});

test('não dá para se cadastrar já ativo ou como gestor', async () => {
  await assertFails(criarPendente(novato(), { situacao: 'ativo' }));
  await assertFails(criarPendente(novato(), { perfil: 'gestor' }));
  await assertFails(criarPendente(novato(), { perfil: 'admin' }));
});

test('não dá para cadastrar outra pessoa ou usar e-mail diferente', async () => {
  await assertFails(setDoc(doc(novato(), 'usuarios', 'uid-outro'), cadastro()));
  await assertFails(criarPendente(novato(), { email: 'outro@x.com' }));
});

test('dados inválidos são recusados', async () => {
  await assertFails(criarPendente(novato(), { numero: '12a' }));
  await assertFails(criarPendente(novato(), { curso: 'XYZ' }));
  await assertFails(criarPendente(novato(), { nomeGuerra: 'A' }));
  await assertFails(criarPendente(novato(), { extra: true }));
});

test('pendente corrige os próprios dados, mas não se aprova', async () => {
  await criarPendente();
  const db = novato();
  await assertSucceeds(updateDoc(doc(db, 'usuarios', 'uid-novo'), { turma: '2º Pel Bravo' }));
  await assertFails(updateDoc(doc(db, 'usuarios', 'uid-novo'), { situacao: 'ativo' }));
  await assertFails(updateDoc(doc(db, 'usuarios', 'uid-novo'), { perfil: 'admin' }));
});

test('pendente não lê a lista de usuários', async () => {
  await criarPendente();
  await assertFails(getDocs(collection(novato(), 'usuarios')));
  await assertSucceeds(getDoc(doc(novato(), 'usuarios', 'uid-novo')));
});

// ---- gestão ----
const decidir = (db, uidAlvo, quem, situacao, perfil) =>
  updateDoc(doc(db, 'usuarios', uidAlvo), { situacao, perfil, decididoPor: quem, decididoEm: serverTimestamp() });

test('gestor aprova como usuário ou conferente', async () => {
  await criarPendente();
  await assertSucceeds(decidir(gestor(), 'uid-novo', 'uid-gestor', 'ativo', 'conferente'));
});

test('gestor não promove ninguém a gestor ou admin', async () => {
  await criarPendente();
  await assertFails(decidir(gestor(), 'uid-novo', 'uid-gestor', 'ativo', 'gestor'));
  await assertFails(decidir(gestor(), 'uid-novo', 'uid-gestor', 'ativo', 'admin'));
});

test('gestor não mexe em outro gestor nem no admin', async () => {
  await assertFails(decidir(gestor(), 'uid-admin', 'uid-gestor', 'desativado', 'admin'));
});

test('admin aprova como gestor e desativa gestor', async () => {
  await criarPendente();
  await assertSucceeds(decidir(admin(), 'uid-novo', 'uid-admin', 'ativo', 'gestor'));
  await assertSucceeds(decidir(admin(), 'uid-gestor', 'uid-admin', 'desativado', 'gestor'));
});

test('ninguém altera o próprio cadastro pela gestão', async () => {
  await assertFails(decidir(admin(), 'uid-admin', 'uid-admin', 'ativo', 'usuario'));
  await assertFails(decidir(gestor(), 'uid-gestor', 'uid-gestor', 'ativo', 'admin'));
});

test('decisão precisa registrar quem decidiu', async () => {
  await criarPendente();
  await assertFails(decidir(gestor(), 'uid-novo', 'uid-admin', 'ativo', 'usuario'));
});

test('usuário comum não aprova nem lista', async () => {
  await criarPendente();
  await assertFails(decidir(user(), 'uid-novo', 'uid-user', 'ativo', 'usuario'));
  await assertFails(getDocs(collection(user(), 'usuarios')));
});

test('gestor desativado perde os poderes', async () => {
  await criarPendente();
  await env.withSecurityRulesDisabled(async (c) => {
    await updateDoc(doc(c.firestore(), 'usuarios', 'uid-gestor'), { situacao: 'desativado' });
  });
  await assertFails(decidir(gestor(), 'uid-novo', 'uid-gestor', 'ativo', 'usuario'));
});

test('ninguém apaga usuários nem acessa coleções não previstas', async () => {
  await assertFails(deleteDoc(doc(admin(), 'usuarios', 'uid-user')));
  await assertFails(setDoc(doc(admin(), 'qualquer', 'x'), { a: 1 }));
});

// ---- viaturas ----
const viatura = (quem, extra = {}) => ({
  prefixo: '17692', modelo: 'Renault/Master', placa: '', ano: null, combustivel: 'diesel',
  kmAtual: 2749, prioridade: 1, situacao: 'ativa', temRadio: true, usaArla: false, nova: true,
  atualizadoPor: quem, atualizadoEm: serverTimestamp(), ...extra
});

test('gestor cadastra viatura; usuário comum só lê', async () => {
  await assertSucceeds(setDoc(doc(gestor(), 'viaturas', 'vtr-17692'), viatura('uid-gestor')));
  await assertSucceeds(getDocs(collection(user(), 'viaturas')));
  await assertFails(setDoc(doc(user(), 'viaturas', 'vtr-99999'), viatura('uid-user', { prefixo: '99999' })));
});

test('pendente não lê viaturas', async () => {
  await criarPendente();
  await assertFails(getDocs(collection(novato(), 'viaturas')));
});

test('viatura inválida é recusada', async () => {
  await assertFails(setDoc(doc(gestor(), 'viaturas', 'vtr-outro'), viatura('uid-gestor')));
  await assertFails(setDoc(doc(gestor(), 'viaturas', 'vtr-17692'), viatura('uid-gestor', { situacao: 'xyz' })));
  await assertFails(setDoc(doc(gestor(), 'viaturas', 'vtr-17692'), viatura('uid-gestor', { kmAtual: -1 })));
  await assertFails(setDoc(doc(gestor(), 'viaturas', 'vtr-17692'), viatura('uid-admin')));
});

test('prefixo não muda e viatura não é apagada', async () => {
  await setDoc(doc(gestor(), 'viaturas', 'vtr-17692'), viatura('uid-gestor'));
  await assertSucceeds(setDoc(doc(gestor(), 'viaturas', 'vtr-17692'), viatura('uid-gestor', { placa: 'ABC1D23' })));
  await assertFails(deleteDoc(doc(admin(), 'viaturas', 'vtr-17692')));
});
