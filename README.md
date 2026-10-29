# SisCautela EsFO

Sistema de cautela de viaturas da Escola de Formação de Oficiais (EsFO – APMG – PMPR).
Substitui o livro de cautelas e o formulário por um aplicativo web (PWA) usado no celular.

**Situação:** versão 0.4 — além do acesso, usuários e viaturas: cautela e devolução com assinatura
(biometria do celular ou senha), fotos enviadas ao Drive pela ponte, avarias, abastecimentos,
painel da frota e relatórios em PDF para baixar ou compartilhar.

## Arquitetura (custo zero)

| Peça | Ferramenta |
|---|---|
| Código | Este repositório (GitHub, público) |
| Hospedagem | GitHub Pages — publicação automática a cada alteração |
| Login | Firebase Authentication — e-mail e senha |
| Banco de dados | Cloud Firestore — `southamerica-east1` (São Paulo) |
| Arquivos (fotos, termos, relatórios, cópias) | Google Drive da conta do projeto, via ponte Apps Script (`ponte-drive/`) |
| Alertas, relatórios automáticos e backup | A mesma ponte, com gatilhos de horário |

Conta dona de tudo: `siscautela.esfo@gmail.com` — nunca vincular cartão de crédito ao projeto Firebase.

## Estrutura

```
public/                 app (o que vai para o GitHub Pages)
  index.html            telas
  css/estilo.css        visual dos brasões (azul-noite, filete ouro, Barlow)
  js/app.js             login, autocadastro, aprovação, gestão de usuários e viaturas
  js/nucleo.js          Firebase, estado, telas, formatação e regras de negócio comuns
  js/cautela.js         início do militar, cautela, devolução, abastecimento, minhas cautelas
  js/assinatura.js      assinatura por biometria (WebAuthn) ou senha
  js/painel.js          painel da frota, cautelas, avarias, encerramento pela gestão
  js/relatorios.js      relatórios, termo de cautela, PDF e compartilhar
  js/ponte.js           envio das fotos ao Drive (fila no celular) e leitura dos arquivos
  js/config.js          endereço da ponte do Drive
  js/firebase-config.js configuração pública do projeto (não é segredo)
  js/viaturas-iniciais.js  11 viaturas copiadas do app VTR-ESFO (importação única)
  img/                  brasões e figuras das viaturas
  sw.js, manifest.webmanifest, icons/   PWA
firestore.rules         regras de segurança do banco
tests/regras.test.js    testes das regras (emulador)
ponte-drive/            Apps Script da ponte com o Drive (instalar na conta do sistema; ver LEIAME)
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

## Viaturas

Coleção `viaturas`, ID `vtr-{prefixo em minúsculas}`. Campos: prefixo, modelo, placa, ano,
combustível, KM atual, prioridade (1 = usar primeiro), situação (`ativa`, `manutencao`, `baixada`,
`usoExclusivo`), rádio, Arla 32 e se é nova.

- Todos os usuários ativos veem a lista; só gestor/admin cadastra e edita.
- Nenhuma viatura é apagada; para tirar de uso, mude a situação para `baixada`.
- Com a lista vazia, a gestão vê o botão **Importar viaturas do VTR-ESFO**, que cadastra as 11
  viaturas do app VTR-ESFO (placa e ano ficam para completar).

## Cautela e devolução

1. **Início do militar:** viaturas disponíveis na ordem de prioridade (as mais antigas primeiro) e as
   indisponíveis abaixo. Toque na viatura para cautelar; outra que não a primeira pede o motivo.
2. **Cautela:** viatura → missão e previsão de retorno (até 24 h) → KM, combustível, 5 fotos e avaria
   (se houver) → assinatura. Numeração sequencial (C-0001…), gravada numa transação junto com a
   viatura e o militar: uma cautela aberta por militar e por viatura.
3. **Devolução:** KM (não menor que o de saída; acima de 400 km pede confirmação), combustível
   (na reserva pede abastecimento ou justificativa), 5 fotos, avaria e observações → assinatura.
4. **Avaria:** leve fica registrada e ligada à cautela anterior para apuração; grave tira a viatura
   de uso até a gestão resolver.
5. **Fotos:** comprimidas no celular e guardadas numa fila; sobem ao Drive em segundo plano pela
   ponte (`public/js/config.js` → `URL_PONTE`). Sem a ponte ligada, ficam guardadas no aparelho.
6. **Assinatura:** biometria do celular (WebAuthn; a biometria não sai do aparelho) ou a senha do
   SisCautela, conferida no Firebase.

## Painel e relatórios (conferente, gestor e administrador)

- **Painel:** disponíveis, cauteladas, em atraso e indisponíveis; quem está com cada viatura;
  alertas de atraso, KM divergente, avarias e cadastros pendentes.
- **Cautelas:** últimos 90 dias, com filtro por viatura e a ficha de cada cautela (fotos e termo).
- **Avarias:** em apuração / resolvida; resolver a avaria grave libera a viatura.
- **Relatórios:** do dia, uso da frota no período, ficha da viatura e histórico do militar.
  Prévia na tela, **PDF** com os brasões e **compartilhar** (menu do celular ou resumo em texto).
- A gestão pode **encerrar uma cautela** em último caso (com motivo e assinatura).

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

- Instalar a ponte do Drive na conta do sistema e preencher `URL_PONTE` (ver `ponte-drive/LEIAME.md`)
- Completar placa e ano das viaturas e definir a ordem oficial de prioridade
- Conferência diária do claviculário pelo conferente
