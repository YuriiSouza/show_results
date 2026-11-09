// Passo a passo guiado (tour): escurece a tela, destaca uma parte do sistema e explica o que ela faz.
// - Botão "?" no topo: abre o passo a passo da tela atual.
// - Na primeira vez que o app abre (por aparelho), mostra o passo a passo geral (menu, período, atualizar…).
// Os textos de cada tela ficam em STEPS, abaixo. Passo cujo elemento não está na tela é pulado sozinho.
window.Tour = (() => {
  const LS_SEEN = 'hub.tour.geral';
  const C = window.APP_CONFIG || {};
  const AUTO = Number(C.AUTO_REFRESH_MIN) || 30;
  const TV = Number(C.TV_ROTATE_SEC) || 30;

  // ---------- Como achar os elementos ----------
  const visible = el => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.right <= 0 || r.left >= innerWidth) return false;   // ex.: menu lateral fora da tela no celular
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  // Primeiro elemento visível entre os seletores (separados por vírgula, na ordem de preferência).
  const pick = sel => {
    for (const one of sel.split('|')) {
      const el = [...document.querySelectorAll(one.trim())].find(visible);
      if (el) return el;
    }
    return null;
  };
  // Card (section.card) cujo título começa com o texto.
  // Título exato tem preferência (ex.: "Pessoas" não pega "Pessoas com mais erros").
  const byLabel = (sel, labelSel, text) => {
    const list = [...document.querySelectorAll(sel)].filter(visible);
    const lab = x => ((x.querySelector(labelSel) || {}).textContent || '').replace(/\s*\?\s*$/, '').trim().toLowerCase();
    const t = text.toLowerCase();
    return list.find(x => lab(x) === t) || list.find(x => lab(x).startsWith(t)) || null;
  };
  const card = title => () => byLabel('#main .card', '.card-title', title);
  // Cartão de indicador (.kpi) cujo rótulo começa com o texto.
  const kpiEl = label => () => byLabel('#main .kpi', '.kpi-label', label);
  // Subtítulo de seção (.section-sub) com o texto, junto com o bloco que vem logo depois dele.
  const sectionEl = (text, nextSel) => () => {
    const sub = [...document.querySelectorAll('#main .section-sub')].find(s => visible(s) && s.textContent.includes(text));
    if (!sub) return null;
    const next = sub.nextElementSibling;
    return next && next.matches(nextSel) && visible(next) ? [sub, next] : sub;
  };
  const resolve = step => (typeof step.el === 'function' ? step.el() : step.el ? pick(step.el) : null);
  // Retângulo do elemento (ou da união de vários elementos, quando o passo destaca um grupo).
  const rectOf = el => {
    const rs = (Array.isArray(el) ? el : [el]).map(e => e.getBoundingClientRect());
    const top = Math.min(...rs.map(r => r.top)), left = Math.min(...rs.map(r => r.left));
    const bottom = Math.max(...rs.map(r => r.bottom)), right = Math.max(...rs.map(r => r.right));
    return { top, left, bottom, right, width: right - left, height: bottom - top };
  };

  // ---------- Roteiros ----------
  const kpis = (text = 'Os números do dia de referência. Cada cartão compara com o dia anterior e diz se está dentro da meta.') =>
    ({ el: '#main .kpis', title: 'Indicadores', text });
  const c = (title, text, name = title) => ({ el: card(title), title: name, text });
  const k = (label, text, name = label) => ({ el: kpiEl(label), title: name, text });
  const tabela = { el: '#main [data-table-toggle]', title: 'Gráfico ou tabela', text: 'O botão <b>Tabela</b> mostra os números do gráfico, para conferir ou copiar.' };
  const periodo = { el: '#rangeBtn', title: 'Período', text: 'Os gráficos mostram os dias deste período. O dia de referência dos cartões é o último dia com dados.' };

  const STEPS = {
    geral: [
      { title: 'Bem-vindo ao Dashboard', text: `Em menos de um minuto mostro onde fica cada coisa. Use <b>Próximo</b> ou as setas do teclado; <b>Pular</b> fecha a qualquer momento.` },
      { el: '#tabs|#btnMenu', title: 'Menu das telas', text: 'As telas ficam em grupos: <b>Operação</b>, <b>Qualidade</b>, <b>Piso</b>, <b>Segurança</b> e <b>Reports</b>.' },
      { el: '#rangeBtn', title: 'Período', text: 'Escolha os dias analisados: atalhos (últimos 7 ou 30 dias, mês atual…) ou um intervalo no calendário, mesmo cruzando meses.' },
      { el: '#status', title: 'Última atualização', text: `Os dados são relidos sozinhos a cada ${AUTO} minutos. Aqui aparece o horário da última leitura.` },
      { el: '#btnRefresh', title: 'Atualizar', text: 'Busca agora o que foi lançado nas planilhas e o que os outros usuários salvaram.' },
      { el: '#btnSpx', title: 'Sessão do SPX', text: 'Liga a consulta ao SPX (rastreio do Parcel, recebimento por hora, responsável da etiquetagem). Só no computador.' },
      { el: '#btnTV', title: 'Modo TV', text: `Tela cheia que troca de tela sozinha a cada ${TV} segundos, para deixar na TV do hub. <b>Esc</b> sai.` },
      { el: '#btnTheme', title: 'Tema claro ou escuro', text: 'Alterna as cores da tela. A escolha fica salva no aparelho.' },
      { el: '#btnConn|#btnSettings', title: 'Conectar planilhas', text: 'Login Google e planilha de cada mês. A bolinha fica verde quando está tudo certo.' },
      { el: '#btnTour', title: 'Passo a passo de cada tela', text: 'Em qualquer tela, clique aqui para ver o que cada parte faz.', end: true },
    ],
    overview: [
      { el: '#main .section-title', title: 'Visão geral', text: 'O resumo do hub: os principais números de todas as áreas numa tela só.' },
      kpis('Volume, Packed XPT, HC, PHD, rotas, DS, DS D0, inventário, Macro Aging e On Hold. Cada cartão compara com o dia anterior e mostra a meta (✓ dentro, ⚠ fora).'),
      c('Volume real', 'Barras = recebido no dia; linha = projeção. Mostra os dias abaixo do esperado.', 'Volume real × projetado'),
      c('DS e DS D0', 'As linhas tracejadas são as metas. Pontos abaixo delas pedem atenção.'),
      c('HC presente por turno', 'Pessoas presentes em cada dia, empilhadas em AM e PM; o número em cima é o total do dia.'),
      c('Inventário TDP por aging', 'Pacotes parados no hub por tempo: quanto mais escura a cor, mais antigo. Faixas escuras crescendo = backlog envelhecendo.'),
      c('Resumo do período', 'Tabela com os principais números somados no período e o valor do dia de referência, como o “Acumulado Mês” da guia Gerencial.'),
      tabela, periodo,
    ],
    recebimento: [
      { el: '#main .section-title', title: 'Recebimento', text: 'Quanto chegou no hub, por turno, e se bateu com a projeção.' },
      kpis('Recebido no dia, divisão AM / PM, total do período, aderência à projeção (com meta) e Packed XPT.'),
      c('Recebimento AM + PM', 'Cada barra é um dia, dividida em AM e PM; o número em cima é o total.', 'Recebimento por turno'),
      c('Volume real', 'Barras = recebido; linha = volume projetado para o dia.', 'Volume real × projetado'),
      c('Aderência', 'Volume real ÷ projetado, dia a dia, frente à meta.', 'Aderência à projeção'),
      c('Packed XPT', 'Pacotes separados para os XPTs em cada dia.'),
      c('% XPT D+1', 'Packed XPT ÷ volume recebido: quanto do que chegou seguiu para os XPTs.'),
      tabela, periodo,
    ],
    pessoas: [
      { el: '#main .section-title', title: 'HC & PHD', text: 'Pessoas planejadas × presentes, ausências, diaristas e produtividade.' },
      kpis('HC planejado e presente no dia e no período, % ABS (com meta), % de diaristas, PHD e quadro.'),
      c('HC presente por turno', 'Uma linha para o AM e outra para o PM: quantas pessoas estavam presentes em cada dia.'),
      c('% ABS', 'Ausências ÷ HC planejado, como na guia HC. Barras vermelhas passaram da meta; a linha tracejada é a meta.', '% ABS diário'),
      c('Composição das ausências', 'Quem do quadro não estava na operação, por motivo: ABS, DSR, férias, desligado e afastamento.'),
      c('PHD diário', 'Pacotes recebidos ÷ pessoas presentes (AM + PM + diaristas). Verde: na meta sem diaristas; amarelo: na meta com diaristas ou abaixo sem; vermelho: abaixo da meta mesmo com diaristas.', 'PHD'),
      c('PHD por semana', 'O mesmo cálculo somando a semana inteira: pacotes da semana ÷ pessoas da semana. Tira o efeito de um dia fora da curva.'),
      c('Quadro × planejado × presente', 'Compara o tamanho do quadro, quantos estavam planejados e quantos vieram (AM + PM), dia a dia.'),
      c('Diaristas', 'Quantos diaristas foram usados em cada turno. Diarista frequente indica falta de quadro.'),
      tabela, periodo,
    ],
    inventario: [
      { el: '#main .section-title', title: 'Inventário', text: 'O que está parado no hub e há quanto tempo.' },
      kpis('Inventário TDP e quanto dele tem 0, 1–2 e 3+ dias, Macro Aging e lost confirmado.'),
      c('TDP inventário', 'Quanto mais escura a cor, mais velho o pacote. O ideal é não ter faixa de 3+ dias.', 'Inventário por aging'),
      c('Abertura Macro Aging', 'Macro Aging do turno por status: backlog, em rota, enviado ao SOC, sem rastreio e lost confirmado.', 'Abertura Macro Aging'),
      { el: '#main [data-ma]', title: 'T1 ou T3', text: 'Troca a abertura do Macro Aging entre os turnos.' },
      c('Macro Aging total', 'Uma linha para o T1 e outra para o T3, para comparar a evolução do Macro Aging dos dois turnos.', 'Macro Aging total: T1 × T3'),
      c('% do inventário com 1+ dia', 'Quanto do inventário não saiu no mesmo dia em que chegou. Quanto menor, melhor.'),
      tabela,
    ],
    reversa: [
      { el: '#main .section-title', title: 'Reversa', text: 'On Hold, retornos ao SOC e avarias.' },
      kpis('On Hold do dia, retornos ao SOC, avarias do HUB e do SOC e avarias por 10 mil pacotes recebidos.'),
      c('On Hold', 'Pacotes em On Hold em cada dia. A linha tracejada é a média do período: barras acima dela pedem atenção.'),
      c('Retorno SOC', 'Pacotes devolvidos ao SOC em cada dia.'),
      c('Avarias', 'Separa as avarias que acontecem no hub das que já chegam do SOC.', 'Avarias: HUB × SOC'),
      tabela,
    ],
    transporte: [
      { el: '#main .section-title', title: 'Transporte', text: 'Rotas, SPR e qualidade da entrega.' },
      kpis('Rotas do dia e do período, SPR (pacotes por rota), DS e DS D0 frente às metas.'),
      c('Rotas por dia', 'Quantidade de rotas que saíram em cada dia; a linha tracejada é a média do período.'),
      c('ATs no piso', 'ATs (Assignment Tasks) no piso em cada dia.'),
      c('SPR', 'Pacotes por rota. SPR alto = rotas mais carregadas; muito baixo = rotas sobrando.'),
      c('DS e DS D0', 'Taxa de entrega (DS) e entrega no mesmo dia (DS D0). Linhas tracejadas = metas.'),
      tabela,
    ],
    audit: [
      { el: '#main .section-title', title: 'Audit de gestão', text: 'A conferência das rotas de cada turno, a partir dos relatórios Audit do LMHub (um por turno: AM, PM1 e PM2).' },
      { el: '#main [data-au="import"]', title: 'Importar relatório', text: 'Escolha (ou arraste) o <b>.csv</b> do LMHub, confirme o dia e o turno. Fica salvo só o resumo calculado, para todos verem. Importar de novo o mesmo dia e turno substitui.' },
      { el: '#main [data-au="demo"]', title: 'Ver um exemplo', text: 'Mostra a tela com dados fictícios, sem gravar nada.' },
      { el: '#main .au-period', title: 'Dias analisados', text: 'A tela segue o filtro de <b>Período</b> do topo. Um dia = visão do dia; vários dias = soma dos relatórios do período.' },
      { el: '#main .au-bar .chips', title: 'Turnos', text: '<b>Todos</b> soma os turnos; AM, PM1 e PM2 mostram só aquele turno. A bolinha indica que o turno tem relatório.' },
      k('ATs validadas', 'Quantas ATs (rotas) foram conferidas e a janela da primeira à última validação. A seta compara com o relatório anterior do mesmo turno.'),
      k('Pedidos', 'Total de pedidos das rotas no início da conferência e quantos foram escaneados.', 'Pedidos (inicial)'),
      k('Não bipados', 'Pacotes da rota que não foram bipados na conferência (<i>Missing Orders</i>). A etiqueta compara com a meta de % de não bipados.', 'Não bipados na conferência'),
      k('Pacotes de outra rota', 'Pacotes bipados na conferência de uma rota, mas que são de outra (<i>Missorted Orders</i>). É o número usado como Missing nos reports.'),
      k('ATs com divergência', 'Quantas ATs tiveram algum não bipado ou pacote de outra rota.'),
      k('Rotas noshow', 'Rotas com AT mas nenhum pacote escaneado: não foram conferidas. Entram no NoShow do Report Geral.'),
      k('Tempo médio', 'Tempo médio de conferência por AT, frente à meta, e quantos operadores conferiram.', 'Tempo médio por AT'),
      k('ATs acima', 'ATs que passaram da meta de tempo de conferência e o tempo excedente somado.', 'ATs acima da meta de tempo'),
      { el: '#main .au-insights', title: 'Destaques automáticos', text: 'Frases prontas com o que mais pesou: % de não bipados frente à meta, corredor e operador com mais não bipados, AT mais lenta e maior ofensor de tempo.' },
      c('Comparativo dos turnos', 'AM, PM1 e PM2 lado a lado: ATs, pedidos, não bipados, de outra rota, tempo médio e janela de cada turno.'),
      c('% de não bipados por dia', 'Com vários dias no período: a evolução do % de não bipados de cada turno; o tracejado é a meta.'),
      c('% de ATs acima', 'Com vários dias no período: quanto das ATs de cada turno passou da meta de tempo, dia a dia.', '% de ATs acima da meta por dia'),
      c('Rotas noshow', 'Lista das rotas sem nenhum pacote escaneado, com corredor e pedidos.'),
      c('Não bipados e pacotes de outra rota', 'Cada barra é um corredor (gaiola): mostra onde se concentram os não bipados e os pacotes de outra rota.', 'Por corredor'),
      c('Por rua', 'O mesmo agrupado pela letra do corredor (rua A, B, C…).'),
      c('ATs validadas por hora', 'Quantas conferências começaram em cada hora: mostra os picos e os buracos do turno.'),
      c('Tempo de conferência', 'ATs por faixa de duração, frente à meta.'),
      c('Ofensores do tempo', 'Operadores ordenados por ATs acima da meta e tempo excedente, com tempo médio, maior tempo e segundos por pedido.', 'Ofensores do tempo de conferência'),
      c('ATs acima de', 'Cada AT que passou da meta, da mais lenta para a mais rápida, com corredor, duração, excesso e operador.', 'ATs acima da meta'),
      c('Operadores', 'Ranking de quem conferiu, ordenado por não bipados: ATs, pedidos, % de não bipados, de outra rota e tempo médio. Base para o feedback.'),
      c('Corredores reincidentes', 'Com vários dias no período: corredores com não bipados em 2 ou mais relatórios.'),
      c('ATs de atenção', 'Rotas com não bipados, de outra rota ou acima da meta de tempo, com pedidos inicial, final e escaneado.'),
      { el: '#auSearch', title: 'Buscar AT', text: 'Procure por AT, corredor ou operador na lista.' },
      c('Relatórios importados', 'Todos os relatórios já importados, com quem importou: <b>Abrir</b> mostra o dia e turno; também dá para excluir.'),
    ],
    parcel: [
      { el: '#main .section-title', title: 'Parcel', text: 'Do relatório de contagem até o responsável de cada pacote missing.' },
      { el: '#main [data-pc="import"]', title: '1. Importar a contagem', text: 'Arquivo <b>.tsv</b>, <b>.csv</b> ou <b>.xlsx</b> da contagem do hub (também dá para arrastar).' },
      { el: '#main [data-pc="demo"]', title: 'Ver um exemplo', text: 'Mostra a tela com dados fictícios.' },
      { el: '#main .pc-tabs', title: 'Três partes', text: '<b>Relatório de contagem</b> (o arquivo), <b>Rastreio</b> (o resultado do SPX) e <b>Histórico</b> por operador.' },
      { el: '#main [data-pc="only-missing"]', title: '2. Filtrar os Missing', text: 'Atalho para ficar só com os pacotes missing. Cada coluna também tem filtro.' },
      { el: '#main [data-pc="run"]', title: '3. Consultar rastreio', text: 'O app consulta o SPX e traz <b>operador do missing</b>, AT anterior, gaiola e motorista. Só no computador, com a Sessão SPX.' },
      { el: '#main [data-pc-tab="hist"]', title: 'Histórico por operador', text: 'Depois de <b>Salvar resultado</b>, mostra quantos pacotes cada operador teve no período, para o feedback.' },
    ],
    'parcel:req': [
      { el: '#main .pc-tabs', title: 'Rastreio (requisição)', text: 'O resultado da consulta ao SPX para os pacotes escolhidos no relatório.' },
      { el: '#main [data-pc-tab="rel"]', title: 'Nada consultado ainda', text: 'Volte ao relatório, filtre os Missing e clique em <b>Consultar rastreio</b>.' },
      k('Códigos consultados', 'Quantos pacotes já foram consultados do total. Durante a consulta, a barra mostra o andamento e as pausas do SPX.'),
      k('Com AT no dia', 'Pacotes que saíram numa AT do hub depois das 21:00 da véspera: têm motorista e gaiola.'),
      k('De outro XPT', 'O destino do Sort Code não é o hub: o pacote é de outro XPT ou estação.', 'De outro XPT / estação'),
      k('Sem AT no dia', 'Pacotes do hub sem AT desde as 21:00 da véspera: precisam de atenção.'),
      k('Avarias', 'Pacotes com evento de avaria: o app não procura AT para eles.'),
      k('Sem missing / erro', 'Pacotes sem marcação de missing no rastreio / consultas que falharam (Consultar de novo tenta só esses).'),
      c('Por motorista', 'Pacotes com AT no dia por motorista.'),
      c('Por gaiola', 'Pacotes com AT no dia por gaiola.'),
      c('Por operador do missing', 'Quem marcou o missing de cada pacote.'),
      c('Pacotes de outro XPT', 'Pacotes de outros destinos, pelo Sort Code.', 'Pacotes de outro XPT / estação'),
      c('Report do dia', 'Texto pronto para enviar, montado com o resultado. Dá para editar antes de <b>Copiar report</b>; <b>Refazer</b> monta de novo.'),
      c('Pacotes consultados', 'Uma linha por pacote: operador do missing, AT anterior, gaiola, motorista e observações. Filtros por situação, motorista, gaiola e operador; <b>Copiar JSON</b> mostra a resposta do SPX.'),
      { el: '#main [data-pc="export"]', title: 'Exportar CSV', text: 'Baixa o resultado em planilha.' },
      { el: '#main [data-pc="save"]', title: 'Salvar resultado', text: 'Grava o resultado do dia na planilha-base. É isso que alimenta o <b>Histórico</b> por operador.' },
    ],
    'parcel:hist': [
      { el: '#main .pc-tabs', title: 'Histórico (operadores)', text: 'Os resultados salvos no período do filtro do topo, para o líder dar o feedback.' },
      k('Dias com resultado salvo', 'Quantos dias têm resultado do Parcel salvo no período.'),
      k('Pacotes registrados', 'Total de pacotes nos resultados salvos, com e sem AT.'),
      k('Operadores envolvidos', 'Quantos operadores aparecem como operador do missing.'),
      k('Operador com mais pacotes', 'Quem mais teve pacotes missing no período, e em quantos dias.'),
      k('Avarias / outro XPT', 'Pacotes que não são falha do hub: avarias e pacotes de outros destinos.'),
      c('Pacotes por operador', 'Ranking dos operadores do missing no período.'),
      c('Pacotes por dia', 'Quantos pacotes entraram nos resultados salvos de cada dia.'),
      c('Operadores para feedback', 'Tabela por operador: pacotes, dias, com e sem AT, avarias, outro XPT e último dia. Clique num nome para ver só os pacotes dele.'),
      { el: '#main [data-pc="hist-copy"]', title: 'Copiar lista', text: 'Copia a lista de operadores e quantidades.' },
      c('Pacotes registrados', 'Todos os pacotes salvos no período, com filtros.'),
    ],
    mapa: [
      { el: '#main .section-title', title: 'Mapa de piso', text: 'Quem está em cada função, por dia e turno. É a base para achar o responsável pelos erros de piso.' },
      { el: '#main .pz-bar', title: 'Dia e turno', text: 'Escolha o dia e o turno (AM, PM1, PM2). <b>Copiar último mapa</b> traz o mapa anterior; <b>Salvar mapa</b> grava para todos.' },
      { el: '#main .pz-mode', title: 'Corrigir ou Troca de função', text: '<b>Corrigir</b> arruma a montagem sem registrar horário. <b>Troca de função</b> registra a mudança com o horário, que vale daí em diante.' },
      { el: '#main [data-pz="rodizio"]', title: 'Rodízio', text: 'Sugere as vagas para cada pessoa em funções diferentes das que fez nos últimos 10 dias. 🔒 fixa uma vaga.' },
      { el: '#main [data-pz="intervalo"]', title: 'Intervalo', text: 'Diga quantos vão sair e o app sugere quem, já criando a volta.' },
      { el: '#main [data-pz="prev"]', title: 'Início de ontem', text: 'Mostra em cinza quem começou em cada vaga no turno anterior.' },
      { el: '#main .pz-tline', title: 'Linha do tempo', text: 'Cada mudança do turno com o horário e o que mudou. Clique para corrigir ou excluir.' },
      { el: '#main .pz-mesas', title: 'Mesas e bancadas', text: 'Digite o nome em cada vaga: indução, recebimento/etiquetagem por bancada e sorting.' },
      { el: '#main .pz-board', title: '2º Sorting e Auditoria', text: 'Quadro por letra: arraste as pessoas entre as colunas. Cada auditor recebe uma faixa de rotas.' },
      { el: '#main .pz-side', title: 'Resumo do turno', text: 'Quantas pessoas em cada função e quem ainda está sem função.' },
      { el: '#main [data-pz-view="dash"]', title: 'Dashboard', text: 'Rodízio, polivalência, diaristas e cobertura das vagas no período. Abra e clique em <b>?</b> para o passo a passo dele.' },
    ],
    'mapa:dash': [
      { el: '#main .pc-tabs', title: 'Dashboard do mapa de piso', text: 'Junta os mapas salvos no período do filtro do topo: quem trabalhou, em quê e quanto houve de rodízio.' },
      { el: '#main .pd-filters', title: 'Filtros', text: 'Escolha os turnos e as funções analisados. Sem nada marcado, vale tudo. O número ao lado do turno é quantos mapas existem.' },
      k('Turnos com mapa', 'Quantos mapas (dia + turno) foram salvos no período.'),
      k('Pessoas diferentes', 'Quantas pessoas apareceram nos mapas e a média por turno.'),
      k('Rodízio', '% das pessoas que começaram o turno numa função diferente da do mesmo turno no dia anterior. Quanto maior, mais rodízio.'),
      k('Polivalência', 'Média de funções diferentes que cada pessoa fez no período.'),
      k('Diaristas', 'Vagas preenchidas por diaristas no período e a média por turno.'),
      k('Intervalos registrados', 'Quantos intervalos foram lançados no mapa e o % das pessoas que tiveram intervalo registrado.'),
      c('Pessoas por função por dia', 'Quantas pessoas ficaram em cada função em cada dia.'),
      c('Pessoas por turno', 'Tamanho da equipe de cada turno ao longo do período.'),
      c('Cobertura das vagas', 'Quanto das vagas do layout foi preenchido. Vaga vazia = função descoberta.'),
      c('Movimentos no quadro por letra', 'Quantas vezes o pessoal do 2º Sorting e da Auditoria foi movido para cada letra.'),
      c('Pessoas × funções', 'Matriz de quem fez o quê: em quantos turnos cada pessoa ficou em cada função. Mostra quem nunca rodou.'),
    ],
    rechora: [
      { el: '#main .section-title', title: 'Recebimento por hora', text: 'Ritmo do recebimento no turno e previsão de término.' },
      { el: '#main .pz-bar', title: 'Meta do turno', text: 'Informe o dia, o turno, o início e os <b>pacotes a receber</b>. O app calcula quanto falta e quando termina.' },
      { el: '#main [data-rh="refresh"]', title: 'Atualizar do SPX', text: 'Busca no SPX os pacotes recebidos por operador em cada hora. Atualiza sozinho a cada 10 minutos com a tela aberta.' },
      { el: '#main .rh-status', title: 'Origem do resultado', text: 'Diz se é a consulta ao vivo ou o último resultado salvo, de quando e por quem.' },
      k('Recebido no turno', 'Pacotes recebidos desde o início do turno.'),
      k('A receber', 'A meta informada e quanto dela já foi recebido.'),
      k('Falta', 'Quanto falta para a meta, com a barra de progresso.'),
      k('Ritmo', 'Pacotes por hora, pela média das 2 últimas horas completas.'),
      k('Previsão de término', 'Hora em que a meta termina se o ritmo atual continuar.'),
      { el: sectionEl('Bancadas de recebimento', '.rh-mesas, .empty'), title: 'Bancadas de recebimento', text: 'Quem está em <b>Recebe</b> em cada bancada, pelo mapa de piso do início do turno, com o total no turno. O <b>delta</b> compara a última hora completa com a anterior (ex.: 07:00 × 06:00): ▲ subiu, ▼ caiu.' },
      { el: '#main .rh-fora', title: 'Fora das bancadas', text: 'Operadores que receberam no SPX mas não estão numa bancada do mapa de piso.' },
      c('Recebido por hora', 'Pacotes recebidos em cada hora do turno: mostra as horas fracas.'),
      c('Acumulado e previsão', 'Linha cheia = recebido acumulado; tracejada = projeção no ritmo atual até a meta.'),
      c('Por operador', 'Pacotes de cada operador em cada hora, total, média por hora e % do recebido. Linhas apagadas são contas sem nome de pessoa.'),
      { el: '#main [data-rh-view="dash"]', title: 'Dashboard', text: 'Turnos salvos no período: % da meta, ritmo médio e produtividade por colaborador. Abra e clique em <b>?</b> para o passo a passo dele.' },
    ],
    'rechora:dash': [
      { el: '#main .pc-tabs', title: 'Dashboard do recebimento', text: 'Junta os turnos salvos no período do filtro do topo.' },
      { el: '#main .pc-filters, #main [data-rh-t], #main .chips', title: 'Filtro por turno', text: 'Mostra só os turnos escolhidos (AM, PM1, PM2).' },
      k('Turnos salvos', 'Quantos turnos têm resultado salvo no período e em quantos dias.'),
      k('Recebido no período', 'Soma do recebido nos turnos salvos e a média por turno.'),
      k('Meta atingida', '% dos turnos com “a receber” informado que bateram a meta.'),
      k('Ritmo médio', 'Média de pacotes por hora, considerando o turno inteiro.'),
      k('Produtividade da equipe', 'Pacotes por hora ativa de cada colaborador, na média da equipe.'),
      k('Colaboradores', 'Quantas pessoas receberam no período e quem foi o mais produtivo.'),
      { el: () => [...document.querySelectorAll('#main .card')].filter(x => visible(x) && /Produtividade por colaborador/.test((x.querySelector('.card-title') || {}).textContent || '')), title: 'Produtividade por colaborador', text: 'Gráfico e tabela com os pacotes por hora ativa de cada pessoa, comparados com a média da equipe (▲ acima, ▼ abaixo), total, turnos, dias, melhor hora e % do recebido. A tabela tem busca e ordenação.' },
      c('Recebido por dia', 'Recebido em cada dia, por turno.'),
      c('Perfil por hora do dia', 'Média de pacotes recebidos em cada hora: mostra o padrão do turno.'),
      c('Recebido × a receber', 'Para cada turno salvo, o recebido frente à meta.', 'Recebido × a receber por turno'),
      c('Turnos salvos', 'Lista de cada turno salvo: recebido, meta, ritmo e quem salvou.'),
    ],
    erros: [
      { el: '#main .section-title', title: 'Erros de piso', text: 'Registro dos erros durante a operação, com o responsável calculado pelo mapa de piso.' },
      { el: '#main [data-pe="kiosk"]', title: 'Modo registro', text: 'Tela cheia para os colaboradores: bipa o pacote e escolhe o tipo do erro. Os responsáveis não aparecem para eles.' },
      { el: card('Registrar erro'), title: 'Registrar erro', text: '<b>Sorting</b>: gaiola onde o pacote estava → quem auditava aquela rota. <b>Etiquetagem</b>: quem etiquetava na bancada do operador que bipou.' },
      { el: card('Erros do turno'), title: 'Erros do turno', text: 'Lista do turno com gaiola, operador SPX e etiquetador. <b>Buscar responsáveis</b> completa os que ficaram sem.' },
      { el: '#main [data-pe-view="ana"]', title: 'Análise do período', text: 'Erros por dia, turno, hora, letra e pessoa, e a taxa por mil pacotes recebidos. Abra e clique em <b>?</b> para o passo a passo dela.' },
    ],
    'erros:ana': [
      { el: '#main .pc-tabs', title: 'Análise do período', text: 'Todos os erros registrados no período do filtro do topo.' },
      { el: '#main .pe-cats', title: 'Tipos de erro', text: 'Filtra por tipo: Sorting, Etiquetagem, XPT, Backlog e Não recebido. Dá para marcar mais de um.' },
      k('Erros no período', 'Total de erros e a média por dia.'),
      k('Por mil pacotes', 'Erros a cada mil pacotes recebidos nos dias com erro: compara dias de volume diferente.'),
      k('Sorting / Etiquetagem', 'Gaiola errada / etiqueta errada.'),
      k('Backlog / Não recebido', 'Pacotes bipados fora da janela de recebimento do turno: antes (backlog) ou depois / nunca (não recebido).'),
      k('Com responsável', '% dos erros que já têm responsável calculado. Os pendentes podem ser completados com <b>Buscar responsáveis</b>.'),
      k('Pessoas envolvidas', 'Quantas pessoas aparecem como responsáveis e a mais citada.'),
      c('Erros por dia', 'Erros de cada dia, separados por tipo.'),
      c('Por turno', 'Erros de cada turno (AM, PM1, PM2).'),
      c('Por hora', 'Horário do erro (sorting) ou do bipe (etiquetagem): mostra os horários críticos.'),
      c('Taxa por dia', 'Erros por mil pacotes recebidos, dia a dia.'),
      c('Sorting por letra', 'Letra da gaiola onde o pacote errado estava.'),
      c('Etiquetagem por bancada', 'Bancada de quem bipou o pacote com etiqueta errada.'),
      c('Pessoas com mais erros', 'Ranking por pessoa, separado em sorting, etiquetagem e XPT.'),
      c('Gaiolas com mais erros', 'As gaiolas onde mais apareceram pacotes errados.', 'Gaiolas com mais erros de sorting'),
      c('Operadores SPX', 'Quem bipou os pacotes com erro de etiquetagem, backlog ou não recebido.', 'Operadores SPX dos pacotes com erro'),
      c('Origem dos registros', 'Quem registrou os erros (líder ou modo registro).'),
      c('Pessoas', 'Tabela por pessoa com sorting, etiquetagem, XPT, total, dias e turnos. Base para o feedback.'),
      { el: '#main [data-pe="recalc"]', title: 'Recalcular responsáveis', text: 'Refaz os responsáveis de todos os erros do período com as regras atuais (ex.: depois de corrigir um mapa de piso).' },
      { el: '#main [data-pe="copy"]', title: 'Copiar lista', text: 'Copia a tabela de pessoas para colar no WhatsApp ou numa planilha.' },
    ],
    avarias: [
      { el: '#main .section-title', title: 'Avarias', text: 'Registro das avarias de pacotes, com o responsável puxado do rastreio: quem <b>recebeu o pacote pela primeira vez no hub</b> (ele deveria ter visto a avaria antes de receber).' },
      { el: '#main .pc-tabs', title: 'Sub-telas', text: '<b>Registrar</b>, <b>Histórico</b> (tratativa de cada ocorrência) e <b>Dashboard</b>. Em cada uma, clique em <b>?</b> para o passo a passo dela.' },
      { el: '#avDate', title: 'Data da ocorrência', text: 'Vem com o dia de hoje; mude só para lançamento retroativo.' },
      { el: '#avBr', title: 'BR', text: 'Bipe (leitor) ou digite a BR e tecle Enter: o app busca no SPX quem recebeu o pacote no hub. No celular, ou sem Sessão SPX, o responsável fica pendente.' },
      { el: '#main .av-chips', title: 'Origem, tipo e setor', text: 'Obrigatórios: origem (Hub, XPT, SOC), tipo (Líquida, Cortante, Outra) e o setor onde a avaria foi vista.' },
      { el: '#main [data-av="save"]', title: 'Salvar ocorrência', text: 'Salva na planilha-base. BR já registrada no mesmo dia pede confirmação. Pacote que nunca passou pelo hub (avaria vista antes de receber) fica no nome de quem enviou.' },
      { el: card('Avarias do dia'), title: 'Avarias do dia', text: 'O que foi registrado no dia. <b>Buscar responsáveis</b> completa as pendentes (no computador, com a Sessão SPX).' },
    ],
    'avarias:hist': [
      { el: '#main .av-filters', title: 'Filtros', text: 'Busca por BR ou colaborador, origem, tipo, setor e tratativa. O período é o do filtro do topo.' },
      { el: '#main [data-av="export"]', title: 'Exportar', text: 'Baixa as ocorrências filtradas em CSV (abre no Excel).' },
      { el: '#main [data-av-open]', title: 'Detalhes e tratativa', text: 'Abre a ocorrência para mudar a tratativa (Aberto, Em análise, Concluído), registrar a ação tomada e a evidência.' },
    ],
    'avarias:dash': [
      { el: '#main .av-filters', title: 'Filtros', text: 'Origem, tipo, setor e colaborador. O período é o do filtro do topo.' },
      k('Total de avarias', 'Avarias no período e a média por dia com avaria.'),
      k('Tratativas em aberto', 'Avarias ainda sem tratativa concluída.'),
      c('Evolução diária', 'Avarias de cada dia, por origem.'),
      c('Responsáveis com mais avarias', 'Quem recebeu no hub os pacotes avariados, ou a estação que enviou avariado: base para o feedback.'),
    ],
    hse: [
      { el: '#main .section-title', title: 'HSE', text: 'Saúde, segurança e meio ambiente do mês, da guia HSE da planilha.' },
      { el: '#hseMonth', title: 'Mês', text: 'Cada planilha mensal tem a sua guia HSE. Abre no mês atual; esta tela não segue o filtro de período.' },
      k('Colaboradores', 'Total de pessoas na guia HSE, por empresa (BPO).'),
      { el: () => [...document.querySelectorAll('#main .kpis .kpi')].filter(x => visible(x) && /do quadro/.test(x.textContent)), title: 'Contratos', text: 'Quantas pessoas há em cada tipo de contrato e o % do quadro.' },
      k('Líderes', 'Quantos líderes têm equipe na lista.'),
      k('Pendências individuais', 'Pessoas com status pendente na guia HSE (treinamentos, documentos…).'),
      { el: () => { const ks = [...document.querySelectorAll('#main .kpis .kpi')].filter(visible); const x = ks[ks.length - 1]; return x && /\d+\/\d+/.test((x.querySelector('.kpi-value') || {}).textContent || '') ? x : null; }, title: el => `${(el.querySelector('.kpi-label') || {}).textContent || 'Checklist'}`, text: 'Quantos itens do primeiro checklist do mês já foram realizados.' },
      c('Equipe por líder', 'Quantas pessoas cada líder tem, por tipo de contrato.'),
      c('Ginástica laboral', 'Status da ginástica laboral de cada turno em cada semana: ✓ realizada, ⏳ pendente.'),
      ...[0, 1, 2, 3, 4, 5].map(i => ({
        el: () => [...document.querySelectorAll('#main .card')].filter(x => visible(x) && x.querySelector('.checklist'))[i] || null,
        title: el => (el.querySelector('.card-title') || {}).textContent || 'Checklist',
        text: 'Checklist da guia HSE: a barra mostra quanto já foi realizado e cada item tem o seu status (✓ realizado, ⏳ pendente).',
      })),
      c('DDS', 'Diálogo diário de segurança: um quadradinho por dia e turno. ✓ realizado, ! pendente, vazio = sem registro.'),
      c('Links importantes HSE', 'Atalhos para os formulários e documentos de HSE.'),
      c('Colaboradores', 'Lista completa com código, empresa, contrato, líder e status.'),
      { el: '#hseSearch', title: 'Buscar colaborador', text: 'Procure por nome, código ou líder.' },
    ],
    report: [
      { el: '#main .rp-day', title: 'Dia do report', text: 'Começa em hoje. As setas trocam o dia e o calendário vai direto a qualquer data.' },
      { el: '#main .rpx-head', title: 'O report', text: 'Os campos já vêm preenchidos com as guias da planilha. Todos podem ser editados.' },
      { el: '#main .rs', title: 'Campos', text: 'Campo com <b>*</b> está sem valor. Passe o mouse num campo digitado para ver quem preencheu e quando.' },
      { el: '#main [data-rp-next]', title: 'Campos sem valor', text: 'Leva direto ao primeiro campo que falta preencher.' },
      { el: '#main [data-rp-sources]', title: 'Fontes', text: 'Mostra de onde veio cada valor.' },
      { el: '#rpSave|#main [data-rp-save]', title: 'Salvar', text: 'Editar não grava nada: as alterações ficam como rascunho. <b>Salvar</b> envia tudo de uma vez para a planilha-base, e os outros veem ao atualizar.' },
    ],
  };
  // O Report Geral explica também o que vem do Audit.
  STEPS.rpAll = [STEPS.report[0], { el: '#main .rpx-head', title: 'Report geral do dia', text: 'Acumulado do dia: T1 (PM) + T3 (AM). Reaproveita o que foi preenchido nos fechamentos.' },
    { el: () => [...document.querySelectorAll('#main .rs')].find(s => visible(s) && /confer/i.test(s.textContent)) || null, title: 'Vem do Audit', text: '<b>Conferência</b>, <b>Missing</b> e <b>Expedição</b> são calculados com os relatórios do Audit de gestão do dia.' },
    ...STEPS.report.slice(3)];
  ['rpP1', 'rpF1', 'rpP3', 'rpF3'].forEach(id => { STEPS[id] = STEPS.report; });

  // ---------- Tela do tour ----------
  let st = null;   // { steps, i, el, onEnd }
  let layer, spot, pop;

  function build() {
    if (layer) return;
    layer = document.createElement('div'); layer.className = 'tour-layer';
    spot = document.createElement('div'); spot.className = 'tour-spot';
    pop = document.createElement('div'); pop.className = 'tour-pop';
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-live', 'polite');
    layer.append(spot, pop);
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-tour]');
      if (!b) return;
      const a = b.dataset.tour;
      if (a === 'next') go(1); else if (a === 'prev') go(-1); else if (a === 'close') stop();
      else if (a === 'screen') { const tab = currentTab(); stop(); start(tab); }
    });
  }

  const currentTab = () => (document.querySelector('.nav-item[aria-current="page"]') || {}).dataset?.tab || 'overview';

  function onKey(e) {
    if (!st) return;
    if (e.key === 'Escape') { e.preventDefault(); stop(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  }
  let raf = 0;
  const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };

  // Abre o roteiro (id de STEPS). Passos sem elemento na tela são pulados.
  // Sub-aba aberta na tela (ex.: Dashboard, Análise do período, Histórico): usa o roteiro dela quando existe.
  const subView = () => {
    const b = document.querySelector('#main .pc-tabs button.active');
    if (!b) return '';
    const d = b.dataset;
    return d.pzView || d.rhView || d.peView || d.pcTab || d.avView || '';
  };
  function start(id = currentTab()) {
    const sub = subView();
    if (sub && STEPS[`${id}:${sub}`]) id = `${id}:${sub}`;
    const list = STEPS[id];
    if (!list || !list.length) return false;
    stop(true);
    build();
    const steps = list.filter(s => !s.el || resolve(s));
    if (!steps.length) return false;
    st = { id, steps, i: -1 };
    document.body.appendChild(layer);
    document.body.classList.add('tour-on');
    document.addEventListener('keydown', onKey, true);
    addEventListener('resize', onMove);
    document.addEventListener('scroll', onMove, true);
    go(1);
    return true;
  }

  function stop(silent) {
    if (!st) return;
    st = null;
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onMove);
    document.removeEventListener('scroll', onMove, true);
    document.body.classList.remove('tour-on');
    if (layer) layer.remove();
    if (!silent) try { localStorage.setItem(LS_SEEN, '1'); } catch (e) { /* sem armazenamento */ }
  }

  function go(dir) {
    if (!st) return;
    let i = st.i + dir;
    // Pula passos cujo elemento sumiu (ex.: a tela foi redesenhada).
    while (i >= 0 && i < st.steps.length && st.steps[i].el && !resolve(st.steps[i])) i += dir;
    if (i < 0) return;
    if (i >= st.steps.length) return stop();
    st.i = i;
    const step = st.steps[i];
    const el = step.el ? resolve(step) : null;
    if (el) {
      const r = rectOf(el);
      const fits = r.top >= 70 && r.bottom <= innerHeight - 20;
      if (!fits) (Array.isArray(el) ? el[0] : el).scrollIntoView({ block: r.height > innerHeight * 0.6 ? 'start' : 'center', behavior: 'instant' });
    }
    render(step, el);
    place();
  }

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function render(step, el) {
    const title = typeof step.title === 'function' ? step.title(Array.isArray(el) ? el[0] : el) : step.title;
    const n = st.steps.length, i = st.i, last = i === n - 1;
    const screen = step.end && st.id === 'geral' && STEPS[currentTab()];
    pop.innerHTML = `
      <div class="tour-count">${i + 1} de ${n}</div>
      <h3 class="tour-title">${esc(title)}</h3>
      <p class="tour-text">${step.text}</p>
      <div class="tour-dots">${st.steps.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>
      <div class="tour-actions">
        ${last ? '' : '<button type="button" class="link tour-skip" data-tour="close">Pular</button>'}
        <span class="tour-gap"></span>
        ${i > 0 ? '<button type="button" class="btn-ghost" data-tour="prev">Voltar</button>' : ''}
        ${screen ? '<button type="button" class="btn-ghost" data-tour="screen">Ver esta tela</button>' : ''}
        <button type="button" class="btn-primary solid" data-tour="${last ? 'close' : 'next'}">${last ? 'Concluir' : 'Próximo'}</button>
      </div>`;
    pop.setAttribute('aria-label', title);
    setTimeout(() => { const b = pop.querySelector('[data-tour="next"],[data-tour="close"]:not(.tour-skip)'); if (b) b.focus({ preventScroll: true }); }, 0);
  }

  // Posiciona o destaque sobre o elemento e o balão ao lado (embaixo, em cima, à direita ou à esquerda — onde couber).
  function place() {
    if (!st) return;
    const step = st.steps[st.i];
    const el = step.el ? resolve(step) : null;
    const vw = innerWidth, vh = innerHeight, m = 12, pad = 6;
    const pw = Math.min(380, vw - 2 * m);
    pop.style.width = pw + 'px';
    const ph = pop.offsetHeight;
    if (!el) {   // passo sem elemento: balão no centro, tela toda escurecida
      spot.className = 'tour-spot none';
      Object.assign(spot.style, { left: vw / 2 + 'px', top: vh / 2 + 'px', width: '0px', height: '0px' });
      Object.assign(pop.style, { left: (vw - pw) / 2 + 'px', top: Math.max(m, (vh - ph) / 2) + 'px' });
      return;
    }
    spot.className = 'tour-spot';
    const r = rectOf(el);
    // O destaque fica dentro da tela, mesmo para elementos maiores que ela.
    const x1 = Math.max(4, r.left - pad), y1 = Math.max(4, r.top - pad);
    const x2 = Math.min(vw - 4, r.right + pad), y2 = Math.min(vh - 4, r.bottom + pad);
    Object.assign(spot.style, { left: x1 + 'px', top: y1 + 'px', width: Math.max(0, x2 - x1) + 'px', height: Math.max(0, y2 - y1) + 'px' });
    const clampX = x => Math.min(Math.max(m, x), vw - pw - m);
    const clampY = y => Math.min(Math.max(m, y), vh - ph - m);
    let left, top;
    if (y2 + m + ph <= vh - m) { top = y2 + m; left = clampX(x1); }
    else if (y1 - m - ph >= m) { top = y1 - m - ph; left = clampX(x1); }
    else if (x2 + m + pw <= vw - m) { left = x2 + m; top = clampY(y1); }
    else if (x1 - m - pw >= m) { left = x1 - m - pw; top = clampY(y1); }
    else { left = clampX(vw - pw - m); top = vh - ph - m; }   // elemento ocupa a tela: balão no canto de baixo
    Object.assign(pop.style, { left: left + 'px', top: top + 'px' });
  }

  // Primeira vez no aparelho: passo a passo geral, assim que não houver nenhuma janela (login, nome…) aberta.
  function autoStart() {
    let seen = '1';
    try { seen = localStorage.getItem(LS_SEEN); } catch (e) { /* sem armazenamento */ }
    if (seen) return;
    const t0 = Date.now();
    const tryNow = () => {
      if (st) return;
      const busy = document.querySelector('dialog[open], .kiosk') || document.body.classList.contains('tv');
      if (!busy) { start('geral'); return; }
      if (Date.now() - t0 < 10 * 60000) setTimeout(tryNow, 1000);
    };
    setTimeout(tryNow, 800);
  }

  return { start, stop, autoStart, has: id => !!STEPS[id], active: () => !!st };
})();
