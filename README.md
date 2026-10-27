# SisCautela EsFO

Sistema de cautela de viaturas da Escola de Formação de Oficiais (EsFO – APMG – PMPR).
Substitui o livro de cautelas e o formulário por um aplicativo web (PWA) usado no celular.

**Situação:** versão 0.2 — login, autocadastro com aprovação do gestor e gestão de usuários.
Cautela, devolução, fotos e painel da frota ainda não foram implementados.

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
  js/app.js             login, autocadastro, aprovação e gestão de usuários
  js/firebase-config.js configuração pública do projeto (não é segredo)
  sw.js, manifest.webmanifest, icons/   PWA
firestore.rules         regras de segurança do banco
tests/regras.test.js    testes das regras (emulador)
.github/workflows/      publicação automática no GitHub Pages
```

## Como funciona o acesso

1. **Primeiro acesso (militar):** informa número, nome de guerra, curso, turma, e-mail e senha;
   recebe um link de confirmação no e-mail.
2. **Envio do cadastro:** depois de confirmar o e-mail, o app cria `usuarios/{uid}` com
   `situacao: "pendente"` e `perfil: "usuario"`. O militar vê "Aguardando aprovação".
3. **Aprovação (gestor/admin):** em *Gestão de usuários*, aba *Pendentes*, o gestor confere os dados,
   escolhe o perfil e toca em **Aprovar** (ou **Recusar**). A tela do militar muda sozinha.
4. **Desativação:** aba *Ativos* → **Desativar** (formatura/desligamento). Aba *Inativos* → **Reativar**.

Perfis: `usuario`, `conferente`, `gestor`, `admin`.

As regras do Firestore garantem que:
- o militar só cria o próprio cadastro, com e-mail confirmado, sempre como `usuario` e `pendente`;
- enquanto pendente, ele só corrige número, nome, curso e turma;
- só gestor/admin aprova, recusa, desativa e define perfil, sempre registrando quem decidiu;
- gestor só concede `usuario` ou `conferente` e não altera outros gestores ou o admin;
- ninguém altera o próprio cadastro pela gestão, e nenhum cadastro é apagado.

O primeiro administrador foi criado manualmente pelo console do Firebase.

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

- Assinatura por biometria (WebAuthn) no primeiro acesso e em cada cautela
- Cadastro de viaturas e prioridade
- Cautela e devolução com fotos (ponte Apps Script → Drive)
- Painel da frota, alertas e relatórios
