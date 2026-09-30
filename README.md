# Dashboard HUB LGO 03 — aplicativo desktop

Aplicativo para **Windows e Linux** que lê a planilha Google Sheets do HUB e mostra os dados em dashboards (cores Shopee/SPX).
A planilha continua sendo **só para digitação**; o app apenas lê. Clique em **Atualizar** ou ligue a atualização automática.

**Privacidade:** não existe site nem link público. O app fala direto com a API do Google usando uma chave que fica
**só no computador** onde foi configurado. A planilha continua privada: só é lida por quem estiver compartilhado nela.

Menu lateral retrátil (☰ no topo ou **Recolher** no rodapé do menu) com as seções:
**Visão geral · Recebimento · HC & PHD · Inventário · Reversa · Transporte · Audit de gestão · Missing (planilha) · HSE · Report T3**,
com filtro de período, dia de referência, metas (✓/⚠), botão **Tabela** em cada gráfico, **Modo TV** e tema claro/escuro.

## Audit de gestão (relatórios LMHub)

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

## Chave de acesso embutida

A chave da conta de serviço vai **dentro do instalador**, então ninguém precisa configurar chave.
Antes de gerar o instalador, coloque a chave em:

```
electron/credentials/service-account.json
```

Essa pasta está no `.gitignore` (a chave nunca vai para o git). O `npm run dist` se recusa a gerar o
instalador se o arquivo não estiver lá.

> **Atenção:** quem tiver o instalador consegue extrair a chave de dentro dele. Distribua o instalador só
> para a equipe. A chave só lê as planilhas compartilhadas com o e-mail dela; se o instalador vazar, remova
> esse e-mail do compartilhamento da planilha e gere uma chave nova no Google Cloud.

## Conectar as planilhas (uma por mês)

Cada mês tem a sua planilha. A conexão fica sempre disponível no botão **Conectar planilhas**, no rodapé
do menu lateral (bolinha verde = tudo ok, amarela = dados de exemplo, vermelha = algum mês com erro),
ou pela engrenagem ⚙ no topo.

1. Em **cada** planilha do mês, clique em **Compartilhar** e adicione, como **Leitor**, o e-mail:

   ```
   sheets-convocation@shopee-convocation-control.iam.gserviceaccount.com
   ```

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
Se você trocar a chave embutida por outra conta de serviço, atualize `SERVICE_ACCOUNT_EMAIL` em `js/config.js`.

Sem link configurado, o app abre em **modo demonstração**, com dados fictícios.

## Reports de turno

No menu **Reports** há cinco telas: **Parcial T1**, **Fechamento T1**, **Parcial T3**, **Fechamento T3** e **Report Geral**.
T1 usa as colunas **PM** das guias e T3 as colunas **AM**; o Report Geral é o **acumulado do dia**.

- **Dia do report:** último dia com dados do filtro de período; as setas ‹ › trocam o dia.
- **Todos os campos são editáveis.** O valor inicial vem só das guias de dados (as guias Report T1/T3/All **não** são usadas).
  Campos sem informação ficam vazios com um ***** ao lado do nome. O que foi digitado fica salvo por dia.
  O que é digitado fica salvo por dia, só no aparelho.
- **Salvar / Atualizar:** editar não grava nada — as alterações ficam como rascunho no aparelho ("● N alterações não salvas").
  **Salvar** envia tudo de uma vez para a planilha-base (uma requisição); **↻ Atualizar** busca o que os outros salvaram
  (o rascunho de quem está editando continua por cima).
- **"* N sem valor"** leva ao primeiro campo vazio; **Fontes** mostra de onde veio cada valor; **Limpar edições** volta
  tudo às guias (também só vale depois de Salvar).
- O **Report Geral** reaproveita o que foi preenchido nos fechamentos: atestado soma T1 + T3,
  Carregamento T1/T3 vêm de cada fechamento e o Carregamento médio é calculado.
- Cada report é ajustado para caber na tela; **Ampliar** encaixa pela largura (útil para digitar no celular).

## Planilha-base compartilhada (reports e Audit de todos os usuários)

O que é digitado nos reports e os relatórios Audit importados ficam numa **planilha-base** do Google
(`BASE_SHEET_URL` em `js/config.js`), para qualquer pessoa com o app ver e continuar o trabalho dos outros.

- **Compartilhe a planilha-base como EDITOR** com `sheets-convocation@shopee-convocation-control.iam.gserviceaccount.com`
  (as planilhas mensais continuam só como Leitor).
- Na primeira vez que o app abre com a chave, ele cria as guias sozinho:
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

> Atenção: a chave embutida passou a ter permissão de escrita. Ela só consegue alterar planilhas compartilhadas
> como Editor com o e-mail acima — no caso, só a planilha-base.

## App mobile (Android e iOS)

O mesmo painel roda no celular com **Capacitor**: o código das telas é o mesmo do desktop
(`index.html`, `css/`, `js/`), e `js/mobile-api.js` faz no aparelho o que o Electron faz no computador:
lê a planilha pela API do Google (com a chave embutida) e guarda os relatórios Audit na área privada do app.

Antes de gerar, coloque a chave em `electron/credentials/service-account.json` (a mesma do desktop).
Sem ela, o app mobile abre só em modo demonstração.

```bash
npm run mobile:build
```

Esse comando monta `mobile/www` (com a chave) e copia para os projetos `ios/` e `android/`.
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

> **Não publique na Play Store / App Store abertas:** a chave de acesso vai dentro do app e poderia ser
> extraída. Distribua só para a equipe (APK interno, TestFlight ou loja privada da empresa).

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
