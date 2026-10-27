// Testes das regras do Firestore (rodam no emulador local, sem tocar no projeto real).
// Uso: npm install && npm run test:regras
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, writeBatch, serverTimestamp, collection, getDocs, updateDoc } from 'firebase/firestore';

let env;

const PRE = {
  numero: '123456',
  nomeGuerra: 'Romeiro',
  curso: 'CFO',
  turma: '1º Pel Alfa',
  perfil: 'usuario',
  email: 'cadete@exemplo.com',
  situacao: 'pendente'
};

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-siscautela',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') }
  });
});

after(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'precadastro', PRE.email), PRE);
    await setDoc(doc(db, 'precadastro', 'gestor@exemplo.com'),
      { ...PRE, numero: '999', nomeGuerra: 'Gestor', perfil: 'gestor', email: 'gestor@exemplo.com', situacao: 'ativado' });
    await setDoc(doc(db, 'usuarios', 'uid-gestor'),
      { numero: '999', nomeGuerra: 'Gestor', curso: 'CFO', turma: '-', perfil: 'gestor',
        email: 'gestor@exemplo.com', situacao: 'ativo' });
  });
});

const cadete = (verificado = true, email = PRE.email, uid = 'uid-cadete') =>
  env.authenticatedContext(uid, { email, email_verified: verificado }).firestore();
const gestor = () =>
  env.authenticatedContext('uid-gestor', { email: 'gestor@exemplo.com', email_verified: true }).firestore();

function ativar(db, uid, email, dados = {}) {
  const lote = writeBatch(db);
  lote.set(doc(db, 'usuarios', uid), {
    numero: PRE.numero, nomeGuerra: PRE.nomeGuerra, curso: PRE.curso, turma: PRE.turma,
    perfil: PRE.perfil, email, situacao: 'ativo', ativadoEm: serverTimestamp(), ...dados
  });
  lote.update(doc(db, 'precadastro', email), { situacao: 'ativado', uid, ativadoEm: serverTimestamp() });
  return lote.commit();
}

test('anônimo não lê nada', async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'precadastro', PRE.email)));
  await assertFails(getDoc(doc(db, 'usuarios', 'uid-gestor')));
});

test('cadete com e-mail NÃO confirmado não lê o pré-cadastro', async () => {
  await assertFails(getDoc(doc(cadete(false), 'precadastro', PRE.email)));
});

test('cadete confirmado lê o próprio pré-cadastro, mas não o de outro', async () => {
  const db = cadete();
  await assertSucceeds(getDoc(doc(db, 'precadastro', PRE.email)));
  await assertFails(getDoc(doc(db, 'precadastro', 'gestor@exemplo.com')));
  await assertFails(getDocs(collection(db, 'precadastro')));
});

test('ativação correta funciona', async () => {
  await assertSucceeds(ativar(cadete(), 'uid-cadete', PRE.email));
});

test('ativação não permite se promover a gestor', async () => {
  await assertFails(ativar(cadete(), 'uid-cadete', PRE.email, { perfil: 'gestor' }));
});

test('ativação não permite alterar número ou nome', async () => {
  await assertFails(ativar(cadete(), 'uid-cadete', PRE.email, { numero: '000' }));
  await assertFails(ativar(cadete(), 'uid-cadete', PRE.email, { nomeGuerra: 'Outro' }));
});

test('ativação não permite campos extras', async () => {
  await assertFails(ativar(cadete(), 'uid-cadete', PRE.email, { admin: true }));
});

test('e-mail sem pré-cadastro não consegue se ativar', async () => {
  const db = cadete(true, 'intruso@exemplo.com', 'uid-intruso');
  await assertFails(setDoc(doc(db, 'usuarios', 'uid-intruso'), {
    numero: '1', nomeGuerra: 'X', curso: 'CFO', turma: '-', perfil: 'usuario',
    email: 'intruso@exemplo.com', situacao: 'ativo', ativadoEm: serverTimestamp()
  }));
});

test('não dá para ativar duas vezes o mesmo pré-cadastro', async () => {
  await assertSucceeds(ativar(cadete(), 'uid-cadete', PRE.email));
  const outro = env.authenticatedContext('uid-outro', { email: PRE.email, email_verified: true }).firestore();
  await assertFails(ativar(outro, 'uid-outro', PRE.email));
});

test('cadete lê o próprio usuário, mas não o de outros', async () => {
  await ativar(cadete(), 'uid-cadete', PRE.email);
  const db = cadete();
  await assertSucceeds(getDoc(doc(db, 'usuarios', 'uid-cadete')));
  await assertFails(getDoc(doc(db, 'usuarios', 'uid-gestor')));
});

test('cadete não altera o próprio perfil depois de ativo', async () => {
  await ativar(cadete(), 'uid-cadete', PRE.email);
  await assertFails(updateDoc(doc(cadete(), 'usuarios', 'uid-cadete'), { perfil: 'admin' }));
});

test('gestor cria pré-cadastro, lista usuários e desativa conta', async () => {
  const db = gestor();
  await assertSucceeds(setDoc(doc(db, 'precadastro', 'novo@exemplo.com'),
    { ...PRE, email: 'novo@exemplo.com' }));
  await ativar(cadete(), 'uid-cadete', PRE.email);
  await assertSucceeds(getDocs(collection(db, 'usuarios')));
  await assertSucceeds(updateDoc(doc(db, 'usuarios', 'uid-cadete'), { situacao: 'desativado' }));
});

test('cadete não cria pré-cadastro', async () => {
  await assertFails(setDoc(doc(cadete(), 'precadastro', 'amigo@exemplo.com'),
    { ...PRE, email: 'amigo@exemplo.com' }));
});

test('usuário desativado perde poderes de gestão', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'usuarios', 'uid-gestor'), { situacao: 'desativado' });
  });
  await assertFails(getDocs(collection(gestor(), 'usuarios')));
});

test('ninguém apaga usuários nem acessa coleções não previstas', async () => {
  await assertFails(setDoc(doc(gestor(), 'qualquer', 'x'), { a: 1 }));
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'usuarios', 'uid-x'), { situacao: 'ativo' });
  });
  const { deleteDoc } = await import('firebase/firestore');
  await assertFails(deleteDoc(doc(gestor(), 'usuarios', 'uid-x')));
});
