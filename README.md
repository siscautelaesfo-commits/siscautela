# SisCautela EsFO

Sistema de cautela de viaturas da Escola de Formação de Oficiais (EsFO – APMG – PMPR).
Substitui o livro de cautelas e o formulário por um aplicativo web (PWA) usado no celular.

**Situação:** versão 0.1 — login, primeiro acesso e ativação. Cautela, devolução, fotos e
painel da frota ainda não foram implementados.

## Arquitetura (custo zero)

| Peça | Ferramenta |
|---|---|
| Código | Este repositório (GitHub, público) |
| Hospedagem | GitHub Pages — publicação automática a cada alteração |
| Login | Firebase Authentication — e-mail e senha |
| Banco de dados | Cloud Firestore — `southamerica-east1` (São Paulo) |
| Fotos | Google Drive da conta do projeto, via ponte Apps Script (a fazer) |
| Alertas e backup | Apps Script com gatilhos de horário (a fazer) |

Conta dona de tudo: `siscautela.esfo@gmail.com` — nunca vincular cartão de crédito ao projeto Firebase.

## Estrutura

```
public/                 app (o que vai para o GitHub Pages)
  index.html            telas
  css/estilo.css
  js/app.js             lógica de login, primeiro acesso e ativação
  js/firebase-config.js configuração pública do projeto (não é segredo)
  sw.js, manifest.webmanifest, icons/   PWA
firestore.rules         regras de segurança do banco
tests/regras.test.js    testes das regras (emulador)
docs/precadastro-exemplo.csv
```

## Como funciona o acesso

1. **Pré-cadastro (gestor):** cria um documento em `precadastro/{email em minúsculas}` com
   `numero`, `nomeGuerra`, `curso`, `turma`, `perfil` (`usuario`, `conferente`, `gestor` ou `admin`),
   `email` e `situacao: "pendente"`.
2. **Primeiro acesso (militar):** informa o e-mail e cria a senha; recebe um link de confirmação.
3. **Ativação:** após confirmar o e-mail, informa o número funcional. Se bater com o pré-cadastro,
   o app cria `usuarios/{uid}` copiando os dados do pré-cadastro e marca o pré-cadastro como `ativado`.
4. **Desativação:** a gestão muda `usuarios/{uid}.situacao` para `desativado` (formatura/desligamento).

As regras do Firestore garantem que ninguém se ativa sem pré-cadastro, ninguém altera o próprio
perfil e só gestor/admin lê a lista de usuários ou altera cadastros.

### Primeiro administrador

Antes de existir uma tela de gestão, o primeiro administrador é pré-cadastrado à mão:
Console do Firebase → Firestore → Iniciar coleção `precadastro` → ID do documento = e-mail em
minúsculas → campos (todos texto): `numero`, `nomeGuerra`, `curso`, `turma`, `perfil` = `admin`,
`email`, `situacao` = `pendente`. Depois é só fazer o primeiro acesso pelo app.

## Publicar

**App:** https://siscautelaesfo-commits.github.io/siscautela/

Qualquer alteração na pasta `public/` da branch `main` é publicada automaticamente pelo
GitHub Actions (`.github/workflows/pages.yml`), em cerca de 1 minuto.

**Regras do banco:** não são publicadas automaticamente. Depois de alterar `firestore.rules`,
copie o conteúdo para Console do Firebase → Firestore → Regras → Publicar.

O domínio `siscautelaesfo-commits.github.io` está autorizado em Authentication → Configurações →
Domínios autorizados.

## Testar as regras

Requer Java 21+ e Node.js 20+.

```bash
npm install
npm run test:regras
```

## Próximas etapas

- Tela de gestão: importar pré-cadastro por planilha, desativar em lote
- Assinatura por biometria (WebAuthn) no primeiro acesso e em cada cautela
- Cadastro de viaturas e prioridade
- Cautela e devolução com fotos (ponte Apps Script → Drive)
- Painel da frota, alertas e relatórios
