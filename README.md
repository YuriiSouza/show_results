# Dashboard HUB LGO 03 — aplicativo desktop

Aplicativo para **Windows e Linux** que lê a planilha Google Sheets do HUB e mostra os dados em dashboards (cores Shopee/SPX).
A planilha continua sendo **só para digitação**; o app apenas lê. Clique em **Atualizar**; o app também atualiza sozinho a cada 30 minutos.

**Privacidade:** não existe site nem link público. Cada pessoa entra com a **própria conta Google** e o app fala direto
com a API do Google em nome dela. A planilha continua privada: só é lida por quem estiver compartilhado nela.

Menu lateral retrátil (☰ no topo ou **Recolher** no rodapé do menu) com as seções:
**Visão geral · Recebimento · HC & PHD · Inventário · Reversa · Transporte · Audit de gestão · Missing (planilha) · HSE · Report T3**,
com filtro de período, dia de referência, metas (✓/⚠), botão **Tabela** em cada gráfico, **Modo TV** e tema claro/escuro.

## Audit de gestão (relatórios LMHub)

> **Nomes das colunas do relatório** (nas telas **Audit de gestão** e **Missing**; o **?** ao lado do número explica):
> - **Não bipados na conferência** (*Missing Orders*): pacotes da rota que não foram bipados na conferência — o pacote
>   estava ali e não foi bipado, ou nem estava fisicamente na rota.
> - **Pacotes de outra rota** (*Missorted Orders*): pacotes bipados na conferência de uma rota, mas que são de outra
>   (ex.: na conferência da A-1 apareceu um da A-2). Não dá para saber se foi erro de etiquetagem ou de separação.

Todo dia são gerados três relatórios de Audit, um por turno (**AM, PM1, PM2**). Para analisar:

1. Abra **Audit de gestão** no menu e clique em **Importar relatório** (ou arraste o `.csv` para a tela).
2. Escolha o arquivo `.csv` exportado do LMHub. O app sugere o dia pelo horário das validações; confira.
3. Escolha o **turno** do relatório e clique em **Importar**. Se já existir relatório daquele dia e turno, ele é substituído.

**As linhas do CSV não são guardadas.** De cada importação fica só o **resumo calculado**: indicadores do turno,
totais por operador e por corredor, tempos de conferência, validações por hora e a lista das **ATs de atenção**
(com missing, missorted ou acima da meta de tempo).

A aba usa o **filtro de Período** do app: um dia mostra a visão diária; vários dias somam todos os relatórios
do período (e aparecem a evolução por dia e os corredores reincidentes). Os botões de turno filtram AM, PM1 ou PM2.

O que a aba mostra:
- **Dia + turno** (ou **Todos** os turnos do dia): ATs, pedidos, missing e missorted (com meta), ATs com divergência,
  tempo médio por AT, comparação com o relatório anterior do mesmo turno, destaques automáticos.
- Comparativo entre AM, PM1 e PM2 do dia; gráficos por corredor, por rua, por hora e por tempo de validação;
  ranking de operadores; lista de ATs com busca.
- **Relatórios importados**: lista para abrir ou excluir cada relatório.

## Parcel (relatório de contagem + rastreio no SPX)

Aba **Parcel** (grupo Qualidade), com duas sub-abas: **Relatório de contagem** (o arquivo importado) e **Rastreio (requisição)**
(o resultado da consulta ao SPX). Relatório, resultado e sessão ficam só na memória, até fechar o app; só os **filtros escolhidos**
ficam salvos no aparelho, para continuarem lá quando você voltar à tela.

1. **Importar relatório** de contagem do hub (`.tsv`, `.csv` ou `.xlsx`; também dá para arrastar o arquivo). Os códigos são lidos como texto.
2. **Filtrar**: busca na coluna do código e filtro de múltipla escolha em cada coluna (atalho **Count Type = Missing**).
   O contador mostra "X de Y linhas". Marque linhas específicas ou deixe sem seleção para usar todas as filtradas.
3. **Consultar rastreio** (só no app desktop). Na primeira vez o app pede a **Sessão SPX**: no navegador, com o SPX logado,
   F12 → Rede → Fetch/XHR → requisição `tracking_info` → *Copiar como cURL* → colar no app.
   A consulta roda com no máximo 2 códigos ao mesmo tempo (com um intervalo mínimo entre as chamadas), tenta de novo em 429/5xx,
   e quando o SPX recusa com cara de sessão expirada (403, redirecionamento, resposta que não é JSON) espera 8 s, 20 s e 45 s e tenta
   de novo antes de pedir uma sessão nova. Limite de 15 s por tentativa,
   pode ser cancelada, e um código com erro não derruba os outros. Código já consultado não é consultado de novo na mesma sessão.
4. **Resultado** (exportável em CSV): operador do missing, AT anterior ao missing, gaiola, ID e nome do motorista e observações.

São duas requisições ao SPX, as mesmas que o site faz:
- **rastreio do pedido** (`/api/fleet_order/order/detail/tracking_info?shipment_id=…`): dele saem o operador do missing e a AT anterior;
- **detalhe da AT** (`/spx_delivery/admin/assignment/assignment_task/detail?assignment_task_id=…`): dele saem a **gaiola**
  (`corridor_cage`) e o **motorista** (`driver_id` / `driver_name`). É uma consulta por AT, reaproveitada por todos os pedidos dela.

Regras (em `js/parcel-core.js`, testadas em `test/parcel.test.js` — `npm test`):
missing = 1º evento a partir da chegada ao hub com status 581 ou "marked as missing"; AT anterior = última AT antes do missing
(evento com status 49/50 ou o texto "em processamento na / adicionado à Assignment Task [AT…]"). ATs depois do missing não entram.
Se o detalhe da AT falhar, o motorista é o do evento seguinte de status 2 no rastreio (por proximidade de horário), com aviso.
O botão **Copiar JSON** de cada linha copia as duas respostas daquele código (sem cookies).

> **Sessão do SPX:** o cURL colado vale como uma senha. Ele fica só na memória do processo do app (nunca em arquivo ou log)
> e só os cabeçalhos `cookie`, `x-csrftoken`, `device-id`, `app`, `referer`, `user-agent`, `accept` e `accept-language`
> são reaproveitados. As assinaturas `x-sap-*` não são enviadas; se o SPX recusar a consulta (401/403), o caminho é pedir
> ao time do SPX uma exportação/API oficial em lote.

## Instalar

> **Publicar uma nova versão e avisar todos os usuários:** veja o passo a passo em [DEPLOY.md](DEPLOY.md).

Os instaladores ficam em `dist/`:

| Sistema | Arquivo | Como usar |
|---|---|---|
| Windows | `Dashboard-HUB-LGO03-<versão>-Windows-Instalador.exe` | Instala e cria atalho no menu Iniciar |
| Windows | `Dashboard-HUB-LGO03-<versão>-Windows-Portatil.exe` | Roda direto, sem instalar (bom para PC sem permissão de admin) |
| Linux | `Dashboard-HUB-LGO03-<versão>-Linux-x86_64.AppImage` | `chmod +x` no arquivo e abrir |
| Linux (Ubuntu/Debian) | `Dashboard-HUB-LGO03-<versão>-Linux-amd64.deb` | `sudo apt install ./arquivo.deb` |

O app não é assinado digitalmente. Por isso, no Windows, o SmartScreen pode avisar "Editor desconhecido":
clique em **Mais informações → Executar assim mesmo**.

## Login Google (OAuth)

Cada pessoa clica em **Entrar com Google** (em **Conectar planilhas**) e autoriza no navegador. O acesso é controlado
pelo **compartilhamento das planilhas** com a conta de cada um — não existe mais chave de conta de serviço no app.

Os clients OAuth ficam em `google-oauth.local.json` na raiz do projeto (fora do git; modelo em `google-oauth.example.json`):

- `desktop`: client "App para computador" (client id + secret). Vai dentro do instalador; o `npm run dist` se recusa a gerar
  o instalador sem ele. No GitHub Actions o arquivo vem do secret `GOOGLE_OAUTH_JSON`.
- `android`: client Android (só o client id). O `npm run mobile:build` grava em `mobile/www/js/oauth-config.js` e o
  `android/app/build.gradle` registra o esquema reverso (`com.googleusercontent.apps.<id>`) para o retorno do login.

No computador o refresh token fica cifrado (`safeStorage`) na pasta de dados do usuário; no Android, no Keystore.

## Conectar as planilhas (uma por mês)

> As planilhas de **junho a dezembro de 2026** já vêm conectadas por padrão (`DEFAULT_MONTHS` em `js/config.js`).
> Só é preciso usar esta tela para trocar o link de um mês ou incluir outros meses.

Cada mês tem a sua planilha. A conexão fica sempre disponível no botão **Conectar planilhas**, no rodapé
do menu lateral (bolinha verde = tudo ok, amarela = dados de exemplo, vermelha = algum mês com erro),
ou pela engrenagem ⚙ no topo.

1. Entre com a sua conta Google (**Entrar com Google**). Cada planilha do mês precisa estar compartilhada com
   a sua conta (como **Leitor**, pelo menos).
2. No app, escolha o **ano** e cole o link de cada planilha no **mês correspondente**
   (deixe em branco os meses que ainda não existem).
3. Clique em **Testar**: cada mês mostra ✓ com o nome da planilha e quantos dias foram lidos, ou ⚠ com o erro.
   O teste também avisa se a planilha colada tiver datas de outro mês.
4. Clique em **Salvar e atualizar**.

Como o app usa os meses:
- Todos os meses são juntados num período contínuo: o seletor **Período** navega entre os meses (‹ ›) e
  aceita intervalos que cruzam meses (ex.: 15/08 → 15/09). Atalhos: últimos 7/30 dias, mês atual, mês anterior, tudo.
- Ao abrir, o período padrão é o **mês atual** (ou o último intervalo escolhido).
- **Report T3, HSE e Missing (planilha)** vêm da planilha do mês mais recente.
- Meses fechados ficam guardados no aparelho: o **Atualizar** busca de novo só o mês atual e o anterior.
  Se uma planilha antiga for corrigida, use **Recarregar todos os meses** na tela de conexão.
- Se um mês falhar (ex.: sem permissão), os outros continuam aparecendo e o erro é mostrado ao lado do mês.

O botão **📘 Passo a passo detalhado** mostra essas instruções dentro do app.
Copiar e colar funciona com **Ctrl+C / Ctrl+V** (⌘ no Mac) e pelo **botão direito**.

Sem link configurado, o app abre em **modo demonstração**, com dados fictícios.

## Reports de turno

No menu **Reports** há cinco telas: **Parcial T1**, **Fechamento T1**, **Parcial T3**, **Fechamento T3** e **Report Geral**.
T1 usa as colunas **PM** das guias e T3 as colunas **AM**; o Report Geral é o **acumulado do dia**.

- **Dia do report:** começa em hoje e não depende do filtro de período (que não aparece nos reports). As setas ‹ › trocam o dia e o
  botão do dia abre um **calendário** para ir direto a qualquer data, inclusive dias **sem dados nas guias** (os campos ficam vazios para preencher à mão).
- **Todos os campos são editáveis.** O valor inicial vem só das guias de dados (as guias Report T1/T3/All **não** são usadas).
  Campos sem informação ficam vazios com um ***** ao lado do nome. O que foi digitado fica salvo por dia.
  O que é digitado fica salvo por dia, só no aparelho.
- **Ponto verde** antes do título do report: aquele report do dia já foi salvo e não há alteração pendente.
- **Salvar / Atualizar:** editar não grava nada — as alterações ficam como rascunho no aparelho ("● N alterações não salvas").
  **Salvar** envia tudo de uma vez para a planilha-base (uma requisição); o **Atualizar** do topo busca o que os outros salvaram
  (o rascunho de quem está editando continua por cima).
- **"* N sem valor"** leva ao primeiro campo vazio; **Fontes** mostra de onde veio cada valor; **Limpar edições** volta
  tudo às guias (também só vale depois de Salvar).
- O **Report Geral** reaproveita o que foi preenchido nos fechamentos: atestado soma T1 + T3,
  Carregamento T1/T3 vêm de cada fechamento e o Carregamento médio é calculado. Nos fechamentos, **Carregamento XPT · Planejados** já vem com **4** (editável). O **Macro Aging** é só o do T1 (o título fica só "Macro Aging").
- No computador o report é ajustado para caber na tela. No celular ele vira uma **coluna única com rolagem**,
  com campos grandes e o botão **Salvar** fixo no rodapé quando há alterações.

## Planilha-base compartilhada (reports e Audit de todos os usuários)

O que é digitado nos reports e os relatórios Audit importados ficam numa **planilha-base** do Google
(`BASE_SHEET_URL` em `js/config.js`), para qualquer pessoa com o app ver e continuar o trabalho dos outros.

- **Compartilhe a planilha-base como EDITOR** com as contas de quem usa o app
  (as planilhas mensais continuam só como Leitor).
- Na primeira vez que o app abre com alguém logado, ele cria as guias sozinho:
  - **Reports**: **uma linha por salvamento** (data, report, usuário, data/hora, aparelho, quantidade de campos e
    as alterações em JSON, ex.: `{"atestado":"2","rotas":"41"}`; `null` = voltou ao valor das guias).
    **Vale a gravação mais recente** de cada campo.
  - **Audit**: uma linha por relatório importado, só com o resumo calculado — ATs, pedidos, missing, % missing,
    missorted, ATs com missing, tempo médio, ATs acima da meta, janela, operadores e o resumo em JSON (o app lê daqui).
    As linhas do CSV não são gravadas.
- **Quem preencheu:** o app pede o nome uma vez (dá para trocar em **Conectar planilhas → Seu nome**).
  Ao passar o mouse num campo digitado aparece "Digitado por … em …".
- **Sem internet:** as gravações ficam numa fila no aparelho ("⏳ Envio pendente") e são enviadas quando a conexão voltar.
- Os dados que já estavam salvos só no aparelho são enviados para a planilha-base na primeira sincronização.
- No **modo demonstração** nada é gravado na planilha-base.

> O app pede o escopo de planilhas da conta, mas só grava na planilha-base (e só se a conta for Editor dela).

## App mobile (Android e iOS)

O mesmo painel roda no celular com **Capacitor**: o código das telas é o mesmo do desktop
(`index.html`, `css/`, `js/`), e `js/mobile-api.js` faz no aparelho o que o Electron faz no computador:
lê a planilha pela API do Google (com o login Google da pessoa) e guarda os relatórios Audit na área privada do app.

Antes de gerar, confira `android.clientId` em `google-oauth.local.json`. O login abre numa aba do navegador (Custom Tab)
e volta para o app pelo esquema reverso do client id.

```bash
npm run mobile:build
```

Esse comando monta `mobile/www` (com o client id Android) e copia para os projetos `ios/` e `android/`.
Rode de novo sempre que mudar o código das telas.

### iOS (precisa de um Mac com Xcode)

```bash
npm run mobile:ios
```

O Xcode abre o projeto. Escolha um simulador ou o seu iPhone e clique em ▶.
Para instalar em iPhones da equipe é preciso uma conta **Apple Developer** (US$ 99/ano) e distribuir
pelo **TestFlight** ou como distribuição interna — a Apple não permite instalar `.ipa` livremente.

### Android (precisa do Android Studio)

1. Instale o [Android Studio](https://developer.android.com/studio) (ele traz o Java e o Android SDK).
2. Rode:

   ```bash
   npm run mobile:android
   ```

3. No Android Studio: **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
   O `.apk` pode ser enviado e instalado direto nos celulares (permitindo "fontes desconhecidas").

> O client OAuth Android precisa do **SHA-1** da chave que assina o APK (debug para testes, release para distribuir) e,
> em "Configurações avançadas" do client, do **esquema de URI personalizado** ativado. No iOS o login Google ainda
> não está configurado (não há client iOS).

## Como o app lê a planilha

- Procura as linhas **`DIA`** seguidas de datas `dd/mm/aaaa` e lê as métricas pelo **nome da linha**
  (`Recebimento AM`, `Packed XPT`, `0 dias`, `ON Hold`, `Rotas`, `DS D0`…).
- Usa o título acima do `DIA` para separar blocos com nomes repetidos (`HC AM`, `HC PM`, `HC TOTAL`, `MA T1`, `MA T3`).
- Entende números em formato brasileiro (`4.807`, `4,76%`) e ignora erros (`#DIV/0!`, `#REF!`).
- No **Report T3** e no **HSE**, encontra os campos pelo rótulo (emojis e acentos são ignorados).

Dá para acrescentar dias ou mudar blocos de lugar sem quebrar o app, desde que os **nomes das guias e das linhas**
continuem os mesmos. Se renomear uma guia, ajuste `SHEETS` em `js/config.js` e gere o app de novo.
As metas (ABS, DS, DS D0, aderência e missing) também ficam em `js/config.js`.

## Desenvolvimento

Requer Node.js 20+.

```bash
npm install
```

```bash
npm start
```

Para gerar os instaladores (saída em `dist/`):

```bash
npm run dist
```

- `npm run dist:win`: gera só o do Windows.
- `npm run dist:linux`: gera só os do Linux.

```
electron/main.js      janela do app + leitura da planilha pela API do Google (conta de serviço)
electron/preload.js   ponte segura entre a tela e o processo principal
index.html            tela
css/style.css         visual (cores Shopee, tema claro/escuro, responsivo)
js/config.js          nomes das guias, metas, atualização automática
js/parser.js          leitura das guias (blocos DIA, rótulos, números pt-BR)
js/model.js           organiza os dados por área
js/charts.js          gráficos (Chart.js, embutido) e tabelas
js/app.js             telas, filtros, atualização, modo TV, configurações
js/sample-data.js     dados de demonstração fictícios
build/icon.*          ícone do app desktop
js/mobile-api.js      leitura da planilha e armazenamento no celular (Capacitor)
scripts/build-mobile.js monta mobile/www para o app mobile
capacitor.config.json configuração do app mobile
ios/, android/        projetos nativos gerados pelo Capacitor
assets/logo.png       fonte dos ícones e da tela de abertura do app mobile
```

## PHD (calculado)

O PHD não vem mais da planilha: **PHD = pacotes recebidos ÷ (pessoas presentes AM + PM + diaristas)**.
Meta **457** (`METAS.phd` em `js/config.js`):

| Situação | Cor |
|---|---|
| Na meta, sem diaristas | verde |
| Na meta, com diaristas | amarelo |
| Abaixo da meta, sem diaristas | amarelo |
| Abaixo da meta, com diaristas | vermelho |

## HC planejado × HC presente, e mês do HSE

- **HC planejado do dia** = linha **TOTAL do bloco HC TOTAL** da guia HC (linha 40). **HC planejado no período** = soma dos dias
  (no mês inteiro, bate com a célula "HC Planejado" da guia).
- **HC presente do dia** = TOTAL do **HC AM** (linha 17) + TOTAL do **HC PM** (linha 29). As linhas são achadas pelo rótulo, não pela posição.
- **HSE**: cada planilha mensal tem a sua guia HSE. A tela tem um seletor de **Mês** (abre no mês atual) e não segue o filtro de período.

## Parcel: histórico por operador (planilha-base)

- Na sub-aba **Rastreio**, o botão **Salvar resultado** grava o resultado do dia na guia **Parcel** da planilha-base
  (uma linha por salvamento, com os pacotes em JSON; salvar de novo o mesmo dia substitui). O dia é o do campo "Dia" do report.
- A sub-aba **Histórico (operadores)** mostra, para o período do filtro do app, os pacotes por **operador do missing**
  (quantidade, dias, situação), para o líder dar o feedback, e a lista de pacotes com filtros. Funciona também no mobile.

## Parcel: AT do dia e report diário

- A **AT** de um pacote só vale se for **a partir das 21:00 do dia anterior ao missing** (horário de Brasília) e antes do missing
  (hora configurável em `PARCEL.atFromHour`).
- **Avaria:** vale quando algum evento do rastreio traz **"Avaria de Produto"** ou **"Avaria Externa – SOC/LH/XPT"**
  (outros textos com a palavra "avaria" não contam), **a partir das 21:00 do dia anterior ao missing** — a mesma janela das ATs.
  O pacote é marcado como **Avaria**: o app não procura a AT nem consulta o detalhe da AT. Há um filtro só para as avarias.
- O resultado tem indicadores, gráficos por motorista, gaiola e operador, e filtros por situação, motorista, gaiola e operador —
  todos aceitam **mais de um valor ao mesmo tempo**.
- **Destino pelo Sort Code:** o último trecho do Sort Code é o destino do pacote
  (`SOC-GO2--HUB-LGO-03--XPT-JRU-01` → `XPT-JRU-01`; `SOC-GO2--HUB-LGO-03` → hub). O app cria a coluna **Destino**,
  usada nos filtros, no dashboard e no report. Destino diferente de `PARCEL.hubCode` = pacote de outro XPT/estação.
- Só conta **AT feita no hub de Anápolis**. Se a AT do pacote é de outra estação (ex.: `XPT_GO_Crixás`),
  o pacote **não é do hub**: fica marcado como **"Outro XPT"** com o nome da estação.
- **Report do dia**: texto pronto com o botão **Copiar report**. Pacotes com AT do hub no dia saem como
  "- Anápolis (Aguardando retorno do Driver)"; os de outro XPT saem com o nome da estação (ou a sigla definida em
  `PARCEL.xptLabels`, ex.: `{ 'XPT_GO_Crixás': 'XPT-CRX-01' }`); os do hub sem AT saem como "Sem AT no dia".
- O identificador entre colchetes dos operadores (`[ops123]`) não é mostrado, e colunas só com Y/N ficam ocultas.

## Mapa de piso e Erros de piso (grupo Piso)

- **Mapa de piso** tem duas sub-abas: **Mapa do turno** e **Dashboard** (mapas salvos no período do filtro do topo: turnos,
  pessoas, rodízio, polivalência, diaristas, intervalos, pessoas por função/turno, cobertura das vagas, movimentos por letra e a
  matriz pessoa × função). O quadro do 2º Sorting/Auditoria e as listas antigas por letra abrem recolhidos ao entrar na tela.
- **Erros de piso** tem duas sub-abas: **Registro do turno** (formulário e lista do turno) e **Análise do período** (filtros por
  tipo; erros por dia, turno e hora; taxa por mil pacotes recebidos; letra, bancada, gaiola, pessoas, operadores SPX e origem).


- **Mapa de piso**: quem está em cada função por **dia e turno (AM / PM1 / PM2)** — mesas (indução, postos de
  recebimento/etiquetagem com 2 pessoas, sorting), 2º sorting e auditoria por letra, descarga e 5S.
  - **Mudanças no turno** — chave de modo na barra:
    - **✏️ Corrigir**: arruma a mudança aberta (montagem do início, nome errado) sem registrar horário. A correção passa para
      as mudanças seguintes que ainda tinham o mesmo nome na vaga (para na primeira troca feita de propósito; o intervalo não para).
    - **⏱ Troca de função às HH:MM** (em branco = agora; um horário escolhido volta para "agora" após 10 min sem uso): cada
      alteração usa a mudança daquele horário ou cria uma nova a partir do mapa que valia ali, e vale daí em diante. A tela
      mostra o mapa do horário da troca. Os movimentos do quadro do 2º Sorting/Auditoria usam o mesmo horário.
    - O primeiro salvamento do mapa de hoje passa para **Troca de função**; mapa novo ou de outro dia começa em **Corrigir**.
    - **Linha do tempo do turno**: cada mudança com o que mudou ("Mesa 1 · Indução: ANA → BIA") e os movimentos do quadro;
      clicar abre a mudança em modo Corrigir (dá para mudar o horário ou excluir). **Desfazer** volta todas as mudanças.
  - **Rodízio** (últimos 10 dias): com o mapa vazio, preenche com quem trabalhou no turno nos últimos 10 dias, cada um
    numa função diferente das que fez; com o mapa preenchido, redistribui as mesmas pessoas. 🔒 fixa uma vaga; **Desfazer** volta.
  - Colocar numa vaga alguém que já está em outra função abre um aviso: **Retirar de lá**, **Manter nas duas** ou **Cancelar**.
  - **Intervalo**: informa quantos estão em função, você diz quantos vão, e o app sugere quem (1ª leva: volumoso, descarga
    e 1º sorting; 2ª leva: recebimento/etiquetagem; uma vez por dia por pessoa). Vira uma mudança "☕ Intervalo HH:MM",
    com a volta criada automaticamente.
  - **XPT**: uma linha por colaborador, com **quantos XPTs ele fizer** na frente do nome ("+ XPT"; × tira; dá para colar
    vários separados por vírgula). O XPT vale pelo **começo do nome** (XPT-SMD vale para XPT-SMD-01, XPT-SMD-01-X…).
    "+ Colaborador no XPT" abre mais uma linha.
    Erros de piso tem o tipo **Erro de XPT** (responsáveis = todos que fizeram aquele XPT no turno), também no modo tela cheia; no Parcel,
    pacote de outro XPT mostra "🗺 Mapa de piso DD/MM: NOME" — quem estava na vaga daquele XPT no **dia do relatório**
    (a data mais antiga da coluna Scanned Time do relatório de contagem) — e isso sai no CSV.
  - **Descartar alterações** volta ao mapa salvo na planilha; **Versões salvas** lista todos os salvamentos do dia/turno:
    **Restaurar** volta a um deles e **Juntar com o mapa em edição** completa o mapa com o que só existe naquele salvamento
    (vagas vazias e mudanças que faltam). Confirme com Salvar mapa.
  - **Duas pessoas no mesmo mapa**: ao salvar, o app busca o que outra pessoa salvou nesse meio-tempo e junta vaga a vaga
    (o que você mudou fica; o resto vem do outro salvamento) em vez de apagar. Se os dois mudaram a mesma vaga, fica a de quem salvou por último.
  - **Rodízio e sexo**: Descarga, Indução e a mesa de volumoso só recebem homens. O app presume o sexo pelo primeiro nome e,
    ao clicar em Rodízio, mostra a lista para revisar (Homem / Mulher / Não sei). Correções ficam lembradas no aparelho;
    "Não sei" não entra nessas vagas.
  - No quadro do 2º Sorting/Auditoria, a coluna **Disponíveis** já mostra (tracejados) todos que têm alguma função no mapa do dia;
    "+ Adicionar pessoas" fica para quem estiver de fora.
  - **2º Sorting e Auditoria em quadro (kanban)**: colunas "Disponíveis" e uma por letra; cada pessoa é um cartão.
    Arraste entre as colunas (ou clique para selecionar e "Mover aqui"); **Mover todos ▸** passa a coluna inteira para outra letra.
    Vários grupos podem estar em letras diferentes. Cada movimento grava o horário (o da troca de função, ou agora) e aparece
    na linha do tempo — não precisa criar mudança. Mapas antigos com listas por letra continuam aparecendo como "formato anterior".
  - **Rotas do turno** (no quadro do 2º Sorting e Auditoria): primeira e última rota do turno, ex.: AM **A-1 até E-6**
    (86 rotas), PM1 **E-7 até H-2**. As colunas de letras saem dessa faixa (não ficam mais no layout). Também ali: **Rotas por
    letra** (padrão 20) e **Exceções** (ex.: `C=18`). O "de" sugere a rota seguinte à última do turno anterior do mesmo dia.
    A coluna **Disponíveis** fica fixa à esquerda ao rolar as letras.
  - **Auditoria por rota**: cada rota é auditada por **uma pessoa só**. O app divide as rotas da letra **dentro das rotas do
    turno** igualmente entre quem está auditando a letra, na ordem de chegada (PM1, letra E com 2 pessoas: E-7–E-13 e
    E-14–E-20) e mostra a faixa no cartão. **Ajustar rotas** muda as faixas
    (avisa rota sem auditor ou com dois); o ajuste vale enquanto o grupo da letra for o mesmo — se alguém entra ou sai,
    volta a divisão igual.
  - Recebimento/etiquetagem por **bancada**, numeradas em sequência entre as mesas (Bancada 1 a 8 no layout padrão).
  - **DIARISTA** pode ser escolhido em quantas vagas forem precisas (não conta como "em duas funções" nem entra no rodízio).
  - **Layout** editável pelo líder (mesas, postos, letras, vagas); o mapa novo usa o layout do último salvo.
  - Nomes sugeridos pela guia HSE do mês atual, mas gravados como texto (o histórico não depende do HSE).
  - Grava na guia **MapaPiso** da planilha-base (vale o salvamento mais recente do dia/turno); rascunho fica no aparelho.
- **Erros de piso**: registro durante a operação, guia **ErrosPiso**.
  - **Sorting** (gaiola errada): rota certa do pacote com o número (ex.: C-12) e horário → responsável = **quem auditava
    aquela rota** naquele horário (faixas de rotas da Auditoria). "Recalcular" refaz os erros antigos com essa regra.
  - **Etiquetagem**: quem recebeu (busca no SPX pelo BR — evento "Pedido chegou ao Last Mile Hub", só no PC — ou digitado)
    → responsável = quem está na vaga **Etiqueta** da bancada desse operador, no horário em que o pacote foi bipado.
  - Análise do período (filtro do topo): por pessoa, por dia e por letra. **Recalcular responsáveis** refaz os registros do período com as regras atuais.
  - **Janela do recebimento por turno** (etiquetagem, `RECEB_JANELAS` em `js/config.js`): **AM** 22:00 da véspera às 05:30;
    **PM1** 09:00 às 11:15 (bipado antes das 05:30 = backlog; entre 05:30 e 09:00 = não recebido); **PM2** sem janela (o erro de
    etiquetagem fica sem etiquetador, sem consultar o SPX). Bipado antes da janela = **Backlog**; depois ou nunca = **Não recebido**.
  - Tabela do turno: Hora, Tipo, Pacote, **Gaiola**, **Operador SPX**, **Etiquetador**. A análise tem filtros por tipo
    (Sorting, Etiquetagem, Backlog, Não recebido).
  - **Buscar responsáveis** (Erros do turno): busca de uma vez o responsável de todos os erros do turno que estão sem responsável.
  - **Modo registro (tela cheia)**: para os colaboradores. Bipa o pacote, escolhe o tipo de erro e, se for sorting, a gaiola
    certa. Os responsáveis **não** aparecem — são calculados e gravados por trás. Sem Sessão SPX, o erro de etiquetagem
    fica sem responsável e o líder clica em **Buscar responsável** na lista do turno. Sair pede a senha do líder
    (`KIOSK_PASSWORD` em `js/config.js`; fica no código do app, então evita a saída por engano, mas não é uma trava de segurança).

## Recebimento por hora (grupo Piso)

- **Atualizar do SPX** (só no PC, com a Sessão SPX da tela Parcel) chama o painel de produtividade do SPX
  (`POST /api/wfm/admin/dashboard/list`, todas as páginas): pacotes recebidos por operador em cada hora (últimas 12 h).
- **Pacotes a receber** (meta do turno) e **Início** do turno: o app calcula recebido no turno, falta, ritmo
  (média das 2 últimas horas completas) e **previsão de término**. Turno da noite consultado de madrugada usa o dia em que começou.
- A meta é gravada assim que é digitada; o resultado, ao **Salvar**, ao atualizar à mão e, na atualização automática
  (a cada 10 min com a tela aberta), no máximo 1 vez por hora — guia **RecebimentoHora** da planilha-base.
- Sub-abas **Turno** (consulta e previsão) e **Dashboard** (turnos salvos no período do filtro do topo, com filtro por turno):
  turnos, recebido, % de meta atingida, ritmo médio, produtividade da equipe; **produtividade por colaborador** (pacotes por hora
  ativa, comparação com a média da equipe, total, turnos, dias, média por turno, horas ativas, melhor hora, % do recebido; busca,
  ordenação e opção de incluir os e-mails @shopee); recebido por dia, perfil por hora do dia e recebido × a receber por turno.
