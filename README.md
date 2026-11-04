# SisCautela EsFO

Sistema de cautela de viaturas da Escola de Formação de Oficiais (EsFO – APMG – PMPR).
Substitui o livro de cautelas e o formulário por um aplicativo web (PWA) usado no celular.

**Situação:** versão 0.6 — acesso, usuários e viaturas; cautela em **duas etapas** (chave no
claviculário com assinatura, depois vistoria na viatura); devolução assinada; fotos no Drive pela ponte;
avarias; abastecimentos; **reserva de viatura** para missões futuras; painel da frota; relatórios em PDF;
e o claviculário eletrônico.

## Arquitetura (custo zero)

| Peça | Ferramenta |
|---|---|
| Código | Este repositório (GitHub, público) |
| Hospedagem | GitHub Pages — publicação automática a cada alteração |
| Login | Firebase Authentication — e-mail e senha |
| Banco de dados | Cloud Firestore — `southamerica-east1` (São Paulo) |
| Arquivos (fotos, termos, relatórios, cópias) | Google Drive da conta do projeto, via ponte Apps Script (`ponte-drive/`) |
| Alertas, relatórios automáticos e backup | A mesma ponte, com gatilhos de horário |
| Claviculário (ESP32 + fechadura 12 V) | Firebase Realtime Database — canal `claviculario/esfo01` |

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
  js/claviculario.js    comando de abertura, situação da porta, eventos e lista de quem pode abrir
  claviculario-virtual.html, js/claviculario-virtual.js   simulador do ESP32 para testes
  js/config.js          endereço da ponte do Drive
  js/firebase-config.js configuração pública do projeto (não é segredo)
  js/viaturas-iniciais.js  11 viaturas copiadas do app VTR-ESFO (importação única)
  img/                  brasões e figuras das viaturas
  sw.js, manifest.webmanifest, icons/   PWA
firestore.rules         regras de segurança do banco
database.rules.json     regras do Realtime Database (canal do claviculário)
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

## Cautela em duas etapas

1. **Chave (no claviculário):** o militar escolhe a viatura, informa a missão e a previsão e assina
   (biometria ou senha). A cautela começa (`etapa: 'chave'`) e o claviculário abre.
2. **Vistoria (na viatura):** KM, combustível, 5 fotos e avaria. Ao concluir, `etapa: 'em_uso'` e a viatura
   recebe o KM e o combustível. Só depois disso a devolução é possível.

Antes da vistoria o militar pode **desistir e devolver a chave** (a cautela fica `cancelada`, sem KM).
Avaria grave na vistoria também cancela a cautela e tira a viatura de uso. Passados 30 min sem vistoria,
a ponte avisa a gestão; a gestão pode cancelar a cautela pela ficha dela. Cautelas antigas (uma etapa)
continuam valendo.

## Reserva de viatura

Qualquer militar ativo reserva uma viatura por período (blocos de 30 min, até 24 h, até 14 dias antes,
até 2 reservas futuras). Até 1 h antes do início a viatura segue disponível, com a volta limitada a 30 min
antes da reserva; a partir de 1 h antes, só quem reservou cautela. Sem retirada até 30 min depois do
início, a reserva cai (não comparecimento). O banco impede duas reservas no mesmo horário: cada bloco de
30 min de cada viatura é um documento único em `reservaBlocos`. A gestão cancela com motivo pelo painel;
a ponte avisa por e-mail, marca não comparecimento, lembra na véspera e alerta quando a viatura não voltou.

## Claviculário eletrônico

O claviculário é um armário de chaves com uma porta só, travada por uma fechadura elétrica de 12 V
e controlada por um ESP32 que escuta o Realtime Database. O app não precisa estar na mesma rede.

**Como funciona no app**

1. O militar assina a cautela (ou a devolução). O app grava a cautela no Firestore e, em seguida,
   o pedido de abertura em `claviculario/esfo01/comando`.
2. O ESP32 destrava a porta (1 bipe) e grava `status.ultimoComandoId`. A tela de concluída mostra
   cada etapa: destravada, aberta, fechada e trancada (2 bipes).
3. Se a porta não abrir em 10 s, ela tranca de novo; o militar toca em *Tentar de novo* (até 3 vezes)
   ou usa *Abrir claviculário* no início, por até 15 min depois de assinar.
4. O painel da frota mostra se o claviculário está online, se a porta está aberta, os alertas
   (porta aberta mais de 30 s, abertura sem pedido) e os últimos eventos.

**Contrato com o firmware** (`claviculario/esfo01`)

| Caminho | Quem grava | Conteúdo |
|---|---|---|
| `comando` | app | `id`, `uid`, `cautelaId`, `tipo` (`retirada`/`devolucao`), `criadoEm` |
| `status` | ESP32 | `porta` (`aberta`/`fechada`), `alerta`, `ultimoComandoId`, `ultimoSinal` |
| `eventos/{id}` | ESP32 | `tipo`, `uid`, `cautelaId`, `ts` — nunca alterados nem apagados |

O ESP32 ignora comando repetido (mesmo `id`) ou com mais de 60 s, e manda sinal de vida a cada minuto;
sem sinal há 3 min, o app mostra o claviculário como offline.

**Quem pode abrir:** quem está ativo no SisCautela. O app mantém a lista `membros/{uid}` sozinho quando
um **administrador do claviculário** abre o app (aprovar e desativar cadastros já atualiza a lista).
Administrador do claviculário é quem está em `config/admins/{uid} = true` no Realtime Database; para um
gestor também manter a lista, acrescente o UID dele ali pelo console. A conta do ESP32 fica em
`config/dispositivos/esfo01`.

**Testar sem o hardware:** abra `claviculario-virtual.html` (no mesmo endereço do app) num computador
e entre com a conta do claviculário. Ele faz o papel do ESP32, com os mesmos tempos e eventos. O login
fica só naquela aba e não interfere no login do SisCautela.

### Botão de emergência

Um botão no claviculário (contato NA no GPIO 33, segurado por 1 s) destrava a porta sem o app e mesmo
sem internet: 3 bipes e o evento `emergencia` (com `ts` e, se gravado depois, `ocorreuEm`), sem `uid`.

1. **Aviso a todos:** o início do app mostra "a porta foi aberta pelo botão de emergência" com
   *Fui eu: peguei uma viatura* e *Fui eu: não retirei chave*.
2. **Peguei uma viatura:** a cautela é registrada como de emergência (`cautelas.emergencia` = id do
   evento), sem abrir a porta de novo e sem motivo de prioridade; depois vêm a vistoria e a devolução
   normais. O registro `emergencias/{id}` fica `regularizada`, com a cautela.
3. **Não retirei chave:** o militar explica o que houve (`justificada`).
4. **Gestão:** alerta no painel na hora; a ponte (a cada 10 min) cria o registro pendente e manda e-mail.
   Sem registro em 2 h, novo e-mail; no painel, *Encerrar* registra a observação da gestão (`encerrada`).
5. O termo da cautela e o relatório do dia mostram as aberturas de emergência.

Sem energia o botão não abre; vale a liberação mecânica. A ponte lê o Realtime Database com a conta do
sistema (escopo `firebase.database`), e o índice `.indexOn: tipo` dos eventos fica em `database.rules.json`.

## Publicar

**App:** https://siscautelaesfo-commits.github.io/siscautela/

Qualquer alteração na pasta `public/` da branch `main` é publicada automaticamente pelo
GitHub Actions (`.github/workflows/pages.yml`), em cerca de 1 minuto.

**Regras do banco:** não são publicadas automaticamente. Depois de alterar `firestore.rules`,
copie o conteúdo para Console do Firebase → Firestore → Regras → Publicar. O mesmo vale para
`database.rules.json` em Realtime Database → Regras.

O domínio `siscautelaesfo-commits.github.io` está autorizado em Authentication → Configurações →
Domínios autorizados.

## Testar as regras

Requer Java 21+ e Node.js 20+.

```bash
npm install
npm run test:regras
```

## Próximas etapas

- Completar placa e ano das viaturas e definir a ordem oficial de prioridade
- Conferência diária do claviculário pelo conferente
- Gravar o firmware no ESP32 e fazer os testes de bancada e integrados do claviculário
