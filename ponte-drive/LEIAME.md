# SisCautela · ponte com o Google Drive

A ponte é um pequeno programa em Apps Script que roda **na conta Google do sistema**. Ele liga o app ao Drive dessa conta:

- recebe as fotos tiradas no app e grava cada uma na pasta certa;
- gera o **termo de cada cautela** (PDF com dados, fotos e assinaturas) e arquiva;
- gera sozinho o **relatório do dia**, o **relatório mensal** e a **cópia de segurança** do banco;
- avisa por e-mail o gestor e o cadete quando uma cautela **passa da previsão**;
- entrega ao app os arquivos guardados, só para quem tem direito de ver.

O **Firestore continua sendo o banco**: situação de cada viatura, cautelas, usuários e regras de acesso. O **Drive é o arquivo**: no banco fica só o identificador de cada arquivo.

## Conteúdo do pacote

| Arquivo | Para quê |
|---|---|
| `Codigo.gs` | O código da ponte (colar no Apps Script) |
| `appsscript.json` | O manifesto: fuso horário, permissões e publicação |
| `../public/js/ponte.js` | Módulo do app: chama a ponte, fila de fotos offline, abre arquivos |
| `../firestore.rules` | Regras do banco; bloqueiam para o app os campos gravados pela ponte |
| `../public/img/brasao-*.png` | Brasões da APMG e da EsFO, que vão para a pasta `SisCautela › Sistema` |

## Pastas que a ponte cria no Drive

```
SisCautela/
  Fotos/2026/10/VTR-14058/C-0053_retirada_frente.jpg
  Avarias/2026/10/A-0004_VTR-14058_f1.jpg
  Abastecimentos/2026/10/AB-0012_VTR-14058_cupom.jpg
  Termos/2026/10/C-0053_VTR-14058_Romeiro.pdf
  Relatórios/
    Diários/2026/2026-10-29_relatorio-do-dia.pdf
    Mensais/2026-10_uso-da-frota.pdf
    Gerados no app/2026/10/...
  Cópias de segurança/2026-11-01_banco.zip  (+ planilha de consulta)
  Sistema/brasao-apmg.png, brasao-esfo.png
```

Tudo é **privado** na conta do sistema. Para o comando acompanhar sem usar o app, compartilhe só a pasta `Relatórios` com o oficial responsável, no modo **Leitor**.

## Instalação (uma vez, uns 20 minutos)

Faça tudo **logado na conta Google do sistema**, a mesma que é dona do projeto Firebase.

1. **Criar o projeto.** Abra [script.google.com](https://script.google.com), clique em *Novo projeto* e dê o nome **SisCautela · Ponte Drive**.
2. **Manifesto.** Em *Configurações do projeto* (engrenagem), marque *Mostrar o arquivo de manifesto "appsscript.json" no editor*. Volte ao editor, abra `appsscript.json` e substitua o conteúdo pelo do pacote.
3. **Código.** Abra `Código.gs`, apague o que houver e cole o conteúdo de `Codigo.gs`. Salve.
4. **Propriedades do script.** Em *Configurações do projeto › Propriedades do script*, adicione:

   | Propriedade | Valor |
   |---|---|
   | `FIREBASE_PROJECT_ID` | ID do projeto Firebase do SisCautela (Configurações do projeto no console do Firebase) |
   | `FIREBASE_API_KEY` | A *Chave de API da Web* do mesmo projeto |
   | `EMAILS_EXTRA` | (opcional) e-mails que também recebem alertas e relatórios, separados por vírgula |
   | `RETENCAO_FOTOS_MESES` | (deixe vazio por enquanto) prazo de guarda das fotos, quando o comando definir; ex.: `24` |

   A chave de API da Web não é segredo: ela já vai dentro do app. O que protege os dados são as regras do Firestore e as conferências da ponte.
5. **Instalar.** No editor, escolha a função `instalar` e clique em *Executar*. Na primeira vez o Google pede autorização: confira que é a conta do sistema e permita. A função cria as pastas, instala as rotinas automáticas e mostra no registro o teste de conexão com o banco e o Drive.
6. **Brasões.** Envie os dois brasões de `public/img/` (`brasao-apmg.png` e `brasao-esfo.png`) para `SisCautela › Sistema`, no Drive.
7. **Publicar.** Clique em *Implantar › Nova implantação*, tipo **App da Web**:
   - *Executar como*: **Eu** (a conta do sistema)
   - *Quem pode acessar*: **Qualquer pessoa**

   Copie o endereço que termina em `/exec`. Ele vai no app em `public/js/config.js` (`URL_PONTE`). "Qualquer pessoa" só deixa o pedido chegar: a ponte recusa quem não manda um login válido do Firebase de um usuário ativo.
8. **Regras do Firestore.** As regras do repositório (`firestore.rules`) já bloqueiam para os celulares os campos que só a ponte grava.
9. **Conferir.** Rode `testarConexao` (mostra viaturas, usuários, e-mails dos gestores e brasões) e `testarRelatorioDiario` (gera um relatório do dia na pasta).

### Atualizar o código depois

Cole o código novo e use *Implantar › Gerenciar implantações › editar (lápis) › Versão: Nova versão*. Assim o endereço `/exec` continua o mesmo e o app não precisa mudar.

## Rotinas automáticas

| Quando | Rotina | O que faz |
|---|---|---|
| A cada 30 min | `verificarAtrasos` | Cautela que passou 30 min da previsão: e-mail ao gestor e ao cadete, uma vez só |
| Todo dia, 19 h | `relatorioDiario` | PDF do dia em `Relatórios › Diários` e por e-mail aos gestores (sem movimento no fim de semana, não gera) |
| Todo dia, 22 h | `gerarTermosPendentes` | Gera os termos que faltaram (fotos que chegaram atrasadas, por exemplo) |
| Dia 1, 6 h | `relatorioMensal` | Uso da frota do mês anterior: por viatura, prioridade, atrasos e combustível |
| Domingo, 3 h | `copiaSeguranca` | Banco inteiro em `.zip` (para restaurar) e em planilha (para consultar); guarda as 26 últimas |
| Dia 2, 4 h | `aplicarRetencao` | Só age com `RETENCAO_FOTOS_MESES` preenchida: manda à lixeira as fotos mais antigas que o prazo |

Os horários ficam no início do `Codigo.gs` (`CFG`). Depois de mudar, rode `instalar` de novo; ela não duplica nada.

## Segurança

- **Login conferido no Google a cada pedido.** O app manda o token do Firebase. A ponte confere no Google e depois lê o perfil no banco, então um usuário desativado perde o acesso na hora.
- **Cada um só mexe no que é seu.** O cadete só envia fotos das próprias cautelas e só abre arquivos dos próprios registros. Gestor e administrador veem tudo.
- **Foto registrada não é trocada.** Cada posição (frente, traseira…) aceita um arquivo só. O reenvio da mesma foto pela fila é reconhecido e não duplica.
- **Prazo de envio.** As fotos de um registro são aceitas até 48 h depois dele. Isso cobre a fila offline, mas impede incluir fotos dias depois.
- **Conteúdo conferido.** O tipo do arquivo é lido dos próprios bytes (JPEG, PNG, WebP ou PDF), com limite de tamanho e de envios por usuário a cada 10 minutos.
- **Campos protegidos no banco.** `arquivos`, `termo`, `fotos`, `cupom` e `alertaAtraso` só são gravados pela ponte (regras do passo 8).
- **Trilha de auditoria.** Cada foto e relatório salvo gera uma linha na coleção `log`.
- **A conta do sistema é a chave de tudo.** Ela precisa de verificação em duas etapas, de e-mail e telefone de recuperação da Escola, e de um segundo responsável (o oficial da frota). Nunca vincule cartão ao Firebase.

## Modelo de dados que a ponte lê

É o mesmo do app (veja o README do repositório). As datas são do tipo *timestamp*.

- `usuarios/{uid}`: `numero`, `nomeGuerra`, `curso` (CFO/CHOE), `turma`, `email`, `telefone`, `perfil` (`usuario` | `conferente` | `gestor` | `admin`), `situacao`, `cautelaAtual`
- `viaturas/vtr-{prefixo}`: `prefixo`, `placa`, `modelo`, `prioridade`, `situacao`, `kmAtual`, `cautelaAtual`, `ultimaCautela`
- `cautelas/c{n}`: `numero` (C-0001), `vtrId`, `vtrPrefixo`, `userId`, `userNome`, `missao`, `saida`, `previsao`, `devolucao`, `kmSaida`, `kmRetorno`, `combSaida`, `combRetorno`, `situacao`, `justificativa`, `justComb`, `obs`, `divergenciaKm`, `assinaturaSaida`, `assinaturaRetorno`
  - gravados só pela ponte: `arquivos.retirada.<posição>`, `arquivos.devolucao.<posição>`, `termo`, `alertaAtraso`
- `avarias/{id}`: `vtrId`, `vtrPrefixo`, `cautelaId`, `origemProvavel`, `descricao`, `gravidade`, `situacao`, `registradaPor`, `registradaNome`, `em`; gravado só pela ponte: `fotos.f1…f4`
- `abastecimentos/{id}`: `cautelaId`, `vtrId`, `vtrPrefixo`, `userId`, `userNome`, `em`, `km`, `litros`, `valor`, `posto`; gravado só pela ponte: `cupom`
- `log/{id}`: `em`, `userId`, `acao`, `detalhe`

## Ordem de uso no app

1. O cadete assina a cautela. O app grava o documento no Firestore e recebe o `id`.
2. As fotos entram na fila (`enfileirarFoto`) e sobem em segundo plano. A tela mostra "3 fotos aguardando envio" (`ouvirFila`).
3. Na devolução, a mesma coisa. Depois o app chama `pedirTermo`. Se ainda houver foto subindo, a rotina das 22 h gera o termo.
4. Para mostrar uma foto ou abrir um termo: `abrirArquivo(id)`. O aparelho guarda uma cópia, porque arquivo guardado não muda.
5. O gestor pode salvar no Drive um relatório gerado no app (`salvarRelatorioNoDrive`) e compartilhar o link.

## Limites do plano gratuito (conferir na implantação)

O SisCautela usa uma fração pequena do que a conta gratuita permite. Os valores abaixo são aproximados e o Google pode mudar; confira em *developers.google.com/apps-script/guides/services/quotas*.

| Recurso | Uso previsto | Limite aproximado da conta gratuita |
|---|---|---|
| E-mails por dia | 2 a 10 | 100 destinatários |
| Tempo das rotinas automáticas | poucos minutos por dia | 90 min por dia |
| Tempo de cada execução | segundos (o termo leva mais) | 6 min |
| Espaço no Drive | 2 a 3 GB por ano | 15 GB, divididos com o Gmail da conta |
