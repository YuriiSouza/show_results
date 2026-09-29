// Dados de demonstração FICTÍCIOS (nomes, códigos e links trocados), no mesmo formato que a API devolve:
// cada guia é uma matriz de textos. Usados quando nenhuma URL está configurada.
window.SAMPLE_DATA = (() => {
  const R = s => s.split('|');
  const pad = n => String(n).padStart(2, '0');
  const days = (m, y, n) => Array.from({ length: n }, (_, i) => `${pad(i + 1)}/${pad(m)}/${y}`);
  const D = days(9, 2026, 30);
  const DIA = (pre = 0) => [...Array(pre).fill(''), 'DIA', ...D];
  const T = t => [t, ...Array(10).fill(''), t, ...Array(9).fill(''), t];
  const E = [];

  const volume = '6742|15362|21685|21455|22683|9402|17015|3560|11617|18988|15076|26693|16114|8252|14524|18802|23171|21542|20382|0|10494|12902|13269|28131|23937|20629|11819|10607|0|0|0';

  const recebimento = [
    T('Recebimento'), DIA(),
    R('Recebimento AM|6742|0|15610|15055|15349|9402|11420|3560|6998|13103|15076|17036|16114|8252|9062|5023|16768|14715|12186||7107|8354|0|17682|14072|10847|11819|7360||'),
    R('Recebimento PM|0|15362|6075|6400|7334|0|5595|0|4619|5885||9657|0||5462|13779|6403|6827|8196||3387|4548|13269|10449|9865|9782|0|3247||||Total'),
    R('Total|' + volume + '|444853'),
    E,
    T('XPT'), DIA(),
    R('Xpt carregado|4|4|4|4|4|4|4|4|4|4|4|4|4|4|4|4|4|4|4|4|4|4|4|4|4|4|0|4|4|4|4|Total'),
    R('Packed XPT|0|4.807|1.861|1.943|2.166|0|1.579|0|1.619|1.002||2.693|0|3.912|1.806|1.343|1.959|2.183|2.353||995|1.383|3.946|3.204|2.969|3.009|0|877||||47.609'),
    R('% XPT D+1|0,00%|31,29%|8,58%|9,06%|9,55%|0,00%|9,28%|0,00%|13,94%|5,28%|0,00%|10,09%|0,00%|47,41%|12,43%|7,14%|8,45%|10,13%|11,54%|#DIV/0!|9,48%|10,72%|29,74%|11,39%|12,40%|14,59%|0,00%|8,27%|#DIV/0!|#DIV/0!'),
    E,
    T('Projeção'), DIA(),
    R('Vol projetado|15000|15000|25000|25000|25000|13110|20000|0|15000|20000|0|30000|16000||16000|15000|28000||25000||16000||15000|26000|24000|20000||15000||'),
    R('Vol real|' + volume),
    R('%|44,95%|102,41%|86,74%|85,82%|90,73%|71,72%|85,08%|#DIV/0!|77,45%|94,94%|#DIV/0!|88,98%|100,71%|#DIV/0!|90,78%|125,35%|82,75%|#DIV/0!|81,53%|#DIV/0!|65,59%|#DIV/0!|88,46%|108,20%|99,74%|103,15%|#DIV/0!|70,71%|#DIV/0!|#DIV/0!'),
  ];

  const hc = [
    T('Diaristas'), DIA(),
    R('Diaristas AM|0|0|0|0|0|0|5|0|0|0|0|0|6|0|5|0|0|0|0||0|0|0|0|0|0|0|0||'),
    R('Diaristas PM|0|0|0|0|0|0|0|0|0|0|0|0|0|0|1|0|0|0|0||0|0|0|0|0|0|0|0||'),
    R('Total AM + PM|0|0|0|0|0|0|5|0|0|0|0|0|6|0|6|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0'),
    E,
    T('HC AM'), DIA(),
    R('HC AM|43|40|40|42|42|42|42|42|43|43|43|42|42|41|42|42|42|41|41||39|38|38|38|38|38|37|38|39|'),
    R('DSR|22|18|0|0|0|20|23|20|20|0|0|0|14|20|26|25|0|9|9||11|17|17|0|8|8|17|12|15|'),
    R('ABS|1|1|1|0|4|0|0|0|1|1|2|2|2|0|0|0|0|1|0||1|2|4|5|1|3|1|2|1|'),
    R('FERIAS|1|1|1|1|1|1|1|0|0|0|0|0|0|0|0|0|0|0|0||0|0|0|0|0|0|0|0|0|'),
    R('Desligado|0|0|0|0|1|1|1|1|1|1|1|1|1|1|1|1|1|3|3||3|3|3|3|3|3|3|3|3|'),
    R('Afastamento|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0||0|0|0|0|0|0|0|0|0|'),
    R('Promoção|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0||0|0|0|0|0|0|0|0|0|'),
    R('TOTAL|19|20|38|41|36|20|17|21|21|41|40|39|25|20|15|16|41|28|29|0|24|16|14|30|26|24|16|21|20|0|0'),
    E,
    T('HC PM'), DIA(),
    R('HC PM|26|26|26|27|27|25|25|25|25|25||25|0|0|25|25|25|25|25||26|27|26|27|26|26||26||'),
    R('DSR|0|0|0|0|0|21|7|0|0|0|0|0|0|0|11|10|0|0|0||0|11|9|0|0|0||0||'),
    R('ABS|1|1|1|2|1|0|0|1|1|2|0|1|0|0|1|0|0|0|0||0|0|0|0|0|0||1||'),
    R('FERIAS|1|1|1|1|1|1|1|1|0|0|0|0|0|0|0|0|0|0|0||0|0|0|0|0|0||0||'),
    R('Desligado|0|0|0|2|2|0|0|0|0|0|0|0|0|0|0|0|0|0|0||0|1|1|1|1|1||1||'),
    R('Afastamento|3|3|3|3|3|3|3|3|3|3|0|3|0|0|3|4|4|5|5||5|4|4|4|4|4||4||'),
    R('Promoção|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0||0|0|0|0|0|0||0||'),
    R('Transferido|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0||0|0|0|0|0|0||0||'),
    R('TOTAL|21|21|21|19|20|0|14|20|21|20|0|21|0|0|10|11|21|20|20|0|21|11|12|22|21|21|0|20|0|0|0'),
    E,
    T('HC TOTAL'), DIA(),
    R('HC|69|66|66|69|69|67|67|67|68|68|43|67|42|41|67|67|67|66|66|0|65|65|64|65|64|64|37|64|39|0|0'),
    R('ABS|2|2|2|2|5|0|0|1|2|3|2|3|2|0|1|0|0|1|0|0|1|2|4|5|1|3|1|3|1|0|0'),
    R('DSR|22|18|0|0|0|41|30|20|20|0|0|0|14|20|37|35|0|9|9|0|11|28|26|0|8|8|17|12|15|0|0'),
    R('FERIAS|2|2|2|2|2|2|2|1|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0'),
    R('DIARISTAS|0|0|0|0|0|0|5|0|0|0|0|0|6|0|6|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0'),
    R('Desligado|0|0|0|2|3|1|1|1|1|1|1|1|1|1|1|1|1|3|3|0|3|4|4|4|4|4|3|4|3|0|0'),
    R('Afastamento|3|3|3|3|3|3|3|3|3|3|0|3|0|0|3|4|4|5|5|0|5|4|4|4|4|4|0|4|0|0|0'),
    R('TOTAL|42|43|61|62|61|20|31|42|44|64|42|63|27|20|26|27|62|49|49|0|46|29|30|57|48|48|17|44|21|0|0'),
    R('% ABS|4,76%|4,65%|3,28%|3,23%|8,20%|0,00%|0,00%|2,38%|4,55%|4,69%|4,76%|4,76%|7,41%|0,00%|3,85%|0,00%|0,00%|2,04%|0,00%|#DIV/0!|2,17%|6,90%|13,33%|8,77%|2,08%|6,25%|5,88%|6,82%|4,76%|#DIV/0!|#DIV/0!'),
    R('% DW|0,00%|0,00%|0,00%|0,00%|0,00%|0,00%|16,13%|0,00%|0,00%|0,00%|0,00%|0,00%|20,69%|0,00%|22,22%|0,00%|0,00%|0,00%|0,00%|#DIV/0!|0,00%|0,00%|0,00%|0,00%|0,00%|0,00%|0,00%|0,00%|0,00%|#DIV/0!|#DIV/0!'),
    E,
    T('HC X TURNO'), DIA(),
    R('AM|19|20|38|41|36|20|17|21|21|41|40|39|25|20|15|16|41|28|29|0|24|16|14|30|26|24|16|21|20|0|0'),
    R('PM|21|21|21|19|20|0|14|20|21|20|0|21|0|0|10|11|21|20|20|0|21|11|12|22|21|21|0|20|0|0|0'),
    R('ABS|2|2|2|2|5|0|0|1|2|3|2|3|2|0|1|0|0|1|0|0|1|2|4|5|1|3|1|3|1|0|0'),
    E,
    R('|||||||HC Planejado|||ABS|DW'),
    R('|||||||1175||Total|49|17'),
    R('|||||||||Acumulado Mês|4,2%|1,4%'),
  ];

  const phd = [
    T('PHD'), DIA(),
    R('PHD|168|375|367|358|408|470|472|170|277|311|454|445|520|412|468|696|374|448|416||233|478|510|541|509|458|738|259||'),
    E, E, E,
    R('||||HC Presente|1143'),
    R('||||Média|389'),
    E,
    R('Cor|Legenda||||Semana|Phd'),
    R('|Sem diaristas||||W1|438'),
    R('|Com diaristas||||W2|311'),
    R('|PHD OK||||W3|'),
    R('|||||W4|'),
    R('|||||W5|'),
  ];

  const ma = (t, rows) => [T(t), R('Dia|' + D.join('|')).map((c, i) => i === 0 ? 'DIA' : c), ...rows.map(R)];
  const inventario = [
    T('Inventario'), DIA(),
    R('0 dias|125|227|414|379|868|838|1236|1034|322|329|0|1170|1998|1324|352|3432|373|442|1045||404|338|593|427|644|1267|1643|472||'),
    R('1 - 2 dias|34|10|36|85|32|888|1679|97|48|12|0|40|1084|42|44|48|46|18|27||69|33|31|22|57|118|1321|47||'),
    R('3 - 7 dias|3|1|2|3|5|14|17|43|17|5|0|2|3|1|1|2|3|0|0||6|7|3|6|11|14|36|11||'),
    R('8 - 14 dias|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0||0|0|0|0|0|0|2|0||'),
    R('Acima de 15 dias|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0||0|0|0|0|0|0|0|0||'),
    R('Total|162|238|452|467|905|1740|2932|1174|387|346|0|1212|3085|1367|397|3482|422|460|1072|0|479|378|627|455|712|1399|3002|530|0|0|0'),
    E, E,
    ...ma('MA T1', [
      'Total|37|74|34|43|50|0|84|73|70|93|0|47|0|116|65|75|92|51|54|0|43|59|98|79|51|49|0|56|0|0|0',
      'Backlog|3|28|6|12|5|0|49|21|17|16|0|5|0|16|30|29|62|16|24|0|9|14|28|53|23|25|0|20||',
      'Em Rota|11|19|0|2|16|0|2|15|24|45|0|8|0|63|4|13|2|3|4|0|0|19|42|0|3|0|0|0||',
      'Enviado ao SOC|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0||',
      'Sem Rastreio|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0||',
      'Lost Confirmado|23|27|28|29|29|0|33|37|29|34|0|34|0|37|31|33|28|32|26|0|34|26|28|26|25|24|0|36||',
    ]),
    E, E, E,
    ...ma('MA T3', [
      'Total|0|27|54|34|38|56|0|0|0|0|47|46|38|46|60|9|75|91|0|0|0|43|37|67|0|0|52|54||',
      'Backlog|0|2|18|5|8|12|0|0|0|0|13|8|6|9|24|9|29|61|0|0|0|11|12|24|0|0|28|20||',
      'Em Rota|0|2|9|1|1|9|0|0|0|0|2|1|0|0|0|9|13|2|0|0|0|0|0|15|0|0|0|0||',
      'Enviado ao SOC|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|9|0|0|0|0|0|0|0|0|0|0|0|0||',
      'Sem Rastreio|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|9|0|0|0|0|0|0|0|0|0|0|0|0||',
      'Lost Confirmado|0|23|27|28|29|35|0|0|0|0|32|37|32|37|36|9|33|28|0|0|0|32|25|28|0|0|24|34||',
    ]),
  ];

  const reversa = [
    [...DIA(), '', 'Total'],
    R('ON Hold|94|161|67|117|115|0|299|75|55|192|0|266|0|510|221|287|155|195|285||304|77|95|100|299|135|0|215||||4319'),
    R('Avaria HUB|0|0|0|0|0|0|0|0|0|1|0|0|0|0|0|0|1|0|11||0|9|1|4|0|9|0|0||||36'),
    R('Avaria SOC|5|0|12|0|0|0|0|0|9|5|0|0|0|0|0|0|2|0|7||0|10|5|5|0|8|0|0||||68'),
    R('Retorno SOC|0|94|0|0|0|0|295|0|92|0|0|0|0|0|0|335|0|0|0||360|0|297|0|0|0|0|369||||1842'),
  ];

  const transporte = [
    R('Dias|30'), E, E,
    [...DIA(), '', 'Total', 'Media'],
    R('Rotas|46|90|131|132|139|66|97|46|81|120|183|162|79|159|100|120|147|134|124|87|91|84|82|178|147|124|60|86||||3095|103'),
    R('ATs no piso|0|0|0|0|0|0|0|0|0|0|0|0|4|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0||4|0'),
    R('SPR|104.3|116.1|111.8|112.3|111.3|82.1|109.0|113.5|101.3|112.8|96.2|110.6|115.0|112.6|112.3|105.6|110.4|112.1|109.4|104.7|108.8|105.8|107.1|110.4|111.5|107.6|110.9|114.2||||0,0|0'),
    E, E, E,
    [...DIA(), '', 'Total', 'Media'],
    R('DS|99.52%|98.80%|98.67%|98.48%|97.74%|98.36%|98.40%|98.40%|96.72%|98.37%|97.82%|97.67%|98.98%|97.56%|97.44%|98.22%|98.35%|98.23%|98.05%|98.04%|98.94%|99.13%|98.80%|98.18%|99.30%|98.65%|97.65%|89.51%||||0,00%|0,00%'),
    R('DS D0|99.52%|92.45%|94.66%|91.98%|92.98%|95.04%|93.45%|97.09%|93.48%|94.51%|93.10%|91.78%|96.30%|88.42%|91.46%|80.31%|95.02%|94.24%|94.58%|95.90%|95.41%|93.22%|86.60%|92.88%|94.22%|90.79%|94.27%|89.51%||||0,00%|0,00%'),
  ];

  const gerencial = [
    R('Base de dados Gerencial HUB LGO 03'), E,
    ['', ...DIA()],
    R('PERFOMANCE|Volume|' + volume),
    R('|PHD|168|375|367|358|408|470|472|170|277|311|454|445|520|412|468|696|374|448|416|233|#REF!|478|510|541|509|458|738|259||'),
  ];

  const missing = (day, header, rows) => [header, ...rows.map(s => {
    const [at, cor, ini, fin, scan, mis, miss, st, en, op, name] = s.split('|');
    return [at, cor, ini, fin, scan, mis, miss, `${day} ${st}`, `${day} ${en}`, `[${op}]${name}`, '', '0', 'Validated', ''];
  })];
  const MH = R('AT/TO|Corridor/Cage|Total Initial Orders Inside AT/TO|Total Final Orders Inside AT/TO|Total Scanned Orders|Missorted Orders|Missing Orders|Validation Start Time|Validation End Time|Validation Operator|Revalidation Operator|Revalidated Count|AT/TO Validation Status|Remark');

  const missingT3 = missing('2026-09-29', MH, [
    'AT20260929AFCRZ|A-18|122|120|120|0|2|07:00:02|07:07:35|ops900|COLABORADOR 35',
    'AT20260929AFCKP|A-3|93|93|93|0|0|06:50:41|06:54:16|ops901|COLABORADOR 57',
    'AT20260929AF4K7|C-8|99|99|99|0|0|06:27:50|06:30:54|ops902|COLABORADOR 58',
    'AT20260929AF4CW|A-9|87|87|89|2|0|06:24:26|06:28:02|ops903|COLABORADOR 25',
    'AT20260929AEUB9|B-8|106|107|108|2|0|06:23:59|06:30:31|ops904|COLABORADOR 30',
    'AT20260929AF528|A-17|62|62|62|0|0|06:23:17|06:26:04|ops905|COLABORADOR 33',
    'AT20260929AF4W3|A-14|119|119|119|0|0|06:22:10|06:27:32|ops906|COLABORADOR 59',
    'AT20260929AEUAM|C-2|87|87|88|1|0|06:19:56|06:26:25|ops907|COLABORADOR 42',
    'AT20260929AF4U3|C-5|108|105|105|0|3|06:19:47|06:24:44|ops908|COLABORADOR 60',
    'AT20260929AEUQB|C-4|133|133|133|0|0|06:18:11|06:25:33|ops900|COLABORADOR 35',
    'AT20260929AFCQB|B-4|132|132|132|0|0|06:17:13|06:27:02|ops909|COLABORADOR 61',
    'AT20260929AF4Z8|C-7|84|84|85|1|0|06:16:44|06:21:44|ops910|COLABORADOR 62',
    'AT20260929AF51U|C-3|140|139|139|0|1|06:16:41|06:21:50|ops902|COLABORADOR 58',
    'AT20260929AF51N|B-1|97|97|98|1|0|06:13:05|06:18:52|ops905|COLABORADOR 33',
    'AT20260929AFCH7|B-6|116|115|116|1|1|06:12:52|06:18:00|ops911|COLABORADOR 17',
    'AT20260929AFC9Y|C-9|95|95|96|1|0|06:12:42|06:17:37|ops912|COLABORADOR 63',
    'AT20260929AFCOY|C-6|125|122|123|1|3|06:11:33|06:16:49|ops903|COLABORADOR 25',
    'AT20260929AF4M6|C-1|143|143|143|0|0|06:11:16|06:17:16|ops906|COLABORADOR 59',
    'AT20260929AF4WH|B-11|127|126|127|0|1|06:10:35|06:19:37|ops904|COLABORADOR 30',
    'AT20260929AFCHZ|B-19|133|131|131|0|2|06:09:56|06:18:31|ops913|COLABORADOR 43',
    'AT20260929AFCGF|B-20|108|107|107|0|1|06:08:44|06:15:13|ops907|COLABORADOR 42',
    'AT20260929AF4OL|B-2|100|100|103|3|0|06:08:38|06:15:03|ops908|COLABORADOR 60',
    'AT20260929AEUHT|B-18|93|92|92|0|1|06:07:35|06:11:25|ops910|COLABORADOR 62',
    'AT20260929AF4MT|B-7|116|116|117|1|0|06:04:11|06:09:39|ops905|COLABORADOR 33',
    'AT20260929AF4M5|B-15|136|135|135|0|1|06:04:10|06:16:41|ops914|COLABORADOR 18',
    'AT20260929AFCF8|B-13|142|141|142|1|1|06:03:51|06:12:23|ops900|COLABORADOR 35',
    'AT20260929AEU47|A-15|112|112|113|1|0|06:03:32|06:07:35|ops906|COLABORADOR 59',
    'AT20260929AEUP3|B-3|63|63|64|1|0|06:02:35|06:05:40|ops912|COLABORADOR 63',
    'AT20260929AFCJ3|B-17|144|140|140|0|4|06:02:19|06:07:14|ops911|COLABORADOR 17',
    'AT20260929AFCM6|B-10|60|60|60|0|0|06:02:15|06:06:26|ops902|COLABORADOR 58',
    'AT20260929AEUF0|B-12|131|131|133|1|0|05:58:30|06:06:38|ops903|COLABORADOR 25',
    'AT20260929AEUGN|B-14|99|96|97|1|3|05:56:34|05:59:58|ops906|COLABORADOR 59',
    'AT20260929AFCRA|A-12|59|58|58|0|1|05:53:35|05:56:38|ops902|COLABORADOR 58',
    'AT20260929AFCBX|B-16|147|144|144|0|3|05:50:57|06:00:24|ops905|COLABORADOR 33',
    'AT20260929AFCE4|A-11|145|144|144|0|1|05:50:33|06:00:35|ops904|COLABORADOR 30',
    'AT20260929AEUFW|B-5|131|130|131|1|1|05:49:38|05:56:53|ops911|COLABORADOR 17',
    'AT20260929AF4WA|B-9|97|96|97|1|1|05:49:12|05:56:53|ops914|COLABORADOR 18',
    'AT20260929AF4YK|A-8|89|88|88|0|1|05:47:52|05:54:45|ops912|COLABORADOR 63',
    'AT20260929AFCML|A-16|132|132|133|1|0|05:47:38|05:51:57|ops903|COLABORADOR 25',
    'AT20260929AEUN2|A-7|79|79|81|2|0|05:46:22|05:50:30|ops906|COLABORADOR 59',
    'AT20260929AEUEW|A-13|69|69|69|0|0|05:42:58|05:47:30|ops902|COLABORADOR 58',
    'AT20260929AFCLR|A-4|92|91|91|0|1|05:41:31|05:45:03|ops911|COLABORADOR 17',
    'AT20260929AFCRE|A-20|61|61|61|0|0|05:41:12|05:43:32|ops912|COLABORADOR 63',
    'AT20260929AF4MM|A-10|58|57|57|0|1|05:41:01|05:44:11|ops914|COLABORADOR 18',
    'AT20260929AF4WR|A-6|175|171|171|0|4|05:40:32|05:54:35|ops900|COLABORADOR 35',
    'AT20260929AEUNA|A-19|107|107|108|1|0|05:40:21|05:45:01|ops905|COLABORADOR 33',
    'AT20260929AEU45|A-5|91|90|91|1|1|05:39:15|05:44:16|ops904|COLABORADOR 30',
    'AT20260929AF4W2|A-2|100|99|99|0|1|05:38:44|05:42:32|ops906|COLABORADOR 59',
    'AT20260929AF4O8|A-1|95|95|96|1|0|05:38:33|05:41:29|ops903|COLABORADOR 25',
  ]);

  const missingT1 = missing('2026-09-28', MH, [
    'AT20260928AEG7V|D-11|99|99|100|1|0|12:32:47|12:38:14|ops915|COLABORADOR 34',
    'AT20260928AEI5G|D-6|155|153|153|0|2|12:20:14|12:26:12|ops916|COLABORADOR 64',
    'AT20260928AEHIM|E-5|91|91|91|0|0|12:10:22|12:15:50|ops915|COLABORADOR 34',
    'AT20260928AEH2L|D-8|86|85|85|0|1|12:08:34|12:13:19|ops916|COLABORADOR 64',
    'AT20260928AEHZW|D-15|137|137|141|4|0|12:01:59|12:11:07|ops908|COLABORADOR 60',
    'AT20260928AEH1N|D-18|69|66|66|0|3|11:53:31|11:56:33|ops917|COLABORADOR 21',
    'AT20260928AEHDU|E-4|127|122|122|0|5|11:50:13|12:00:13|ops907|COLABORADOR 42',
    'AT20260928AEHD3|E-1|81|81|82|1|0|11:48:11|11:53:21|ops918|COLABORADOR 65',
    'AT20260928AEI5N|E-3|153|152|152|0|1|11:40:05|11:48:14|ops919|COLABORADOR 14',
    'AT20260928AEGG8|D-17|75|75|76|0|0|11:35:54|11:40:26|ops907|COLABORADOR 42',
    'AT20260928AEH80|E-2|134|133|134|1|1|11:35:50|11:47:19|ops909|COLABORADOR 61',
    'AT20260928AEHD2|D-14|74|74|74|0|0|11:34:56|11:39:59|ops918|COLABORADOR 65',
    'AT20260928AEI7V|D-20|82|81|81|0|1|11:33:05|11:40:19|ops917|COLABORADOR 21',
    'AT20260928AEI7R|D-9|105|105|106|1|0|11:28:14|11:37:44|ops920|COLABORADOR 29',
    'AT20260928AEG0N|D-16|71|68|70|2|3|11:28:08|11:34:04|ops919|COLABORADOR 14',
    'AT20260928AEH4X|D-7|70|70|71|1|0|11:19:46|11:23:16|ops919|COLABORADOR 14',
    'AT20260928AEGYX|D-13|77|77|80|3|0|11:19:25|11:28:24|ops918|COLABORADOR 65',
    'AT20260928AEHII|D-10|99|99|99|0|0|11:19:01|11:27:58|ops907|COLABORADOR 42',
    'AT20260928AEI43|D-12|71|70|72|2|1|11:18:54|11:23:19|ops920|COLABORADOR 29',
    'AT20260928AEFYS|D-19|148|145|146|1|3|11:18:17|11:30:07|ops909|COLABORADOR 61',
    'AT20260928AEHFG|D-5|113|109|109|0|4|11:17:40|11:25:40|ops917|COLABORADOR 21',
  ]);

  const put = (grid, r, c, v) => { while (grid.length <= r) grid.push([]); grid[r][c] = String(v); };

  // HSE
  const people = [
    ['COLABORADOR 01 SPXBR10001', 'SPXBR10001', 'LÍDER A'], ['COLABORADOR 02 SPXBR10002', 'SPXBR10002', 'LÍDER A'],
    ['COLABORADOR 03 SPXBR10003', 'SPXBR10003', 'LÍDER A'], ['COLABORADOR 04 SPXBR10004', 'SPXBR10004', 'LÍDER A'],
    ['COLABORADOR 05 SPXBR10005', 'SPXBR10005', 'LÍDER A'], ['COLABORADOR 06 SPXBR10006', 'SPXBR10006', 'LÍDER A'],
    ['COLABORADOR 07 SPXBR10007', 'SPXBR10007', 'LÍDER A'], ['COLABORADOR 08 SPXBR10008', 'SPXBR10008', 'LÍDER A'],
    ['COLABORADOR 09 SPXBR10009', 'SPXBR10009', 'LÍDER A'], ['COLABORADOR 10 SPXBR10010', 'SPXBR10010', 'LÍDER A'],
    ['COLABORADOR 11 SPXBR10011', 'SPXBR10011', 'LÍDER A'], ['COLABORADOR 12 SPXBR10012', 'SPXBR10012', 'LÍDER A'],
    ['COLABORADOR 13 SPXBR10013', 'SPXBR10013', 'LÍDER A'], ['COLABORADOR 14 SPXBR10014', 'SPXBR10014', 'LÍDER A'],
    ['COLABORADOR 15 SPXBR10015', 'SPXBR10015', 'LÍDER B'], ['COLABORADOR 16 SPXBR10016', 'SPXBR10016', 'LÍDER B'],
    ['COLABORADOR 17 SPXBR10017', 'SPXBR10017', 'LÍDER B'], ['COLABORADOR 18 SPXBR10018', 'SPXBR10018', 'LÍDER B'],
    ['COLABORADOR 19 SPXBR10019', 'SPXBR10019', 'LÍDER B'], ['COLABORADOR 20 SPXBR10020', 'SPXBR10020', 'LÍDER B'],
    ['COLABORADOR 21 SPXBR10021', 'SPXBR10021', 'LÍDER B'], ['COLABORADOR 22 SPXBR10022', 'SPXBR10022', 'LÍDER B'],
    ['COLABORADOR 23 SPXBR10023', 'SPXBR10023', 'LÍDER B'], ['COLABORADOR 24 SPXBR10024', 'SPXBR10024', 'LÍDER B'],
    ['COLABORADOR 25 SPXBR10025', 'SPXBR10025', 'LÍDER B'], ['COLABORADOR 26 SPXBR10026', 'SPXBR10026', 'LÍDER B'],
    ['COLABORADOR 27 SPXBR10027', 'SPXBR10027', 'LÍDER B'], ['COLABORADOR 28 SPXBR10028', 'SPXBR10028', 'LÍDER C'],
    ['COLABORADOR 29 SPXBR10029', 'SPXBR10029', 'LÍDER C'], ['COLABORADOR 30 SPXBR10030', 'SPXBR10030', 'LÍDER C'],
    ['COLABORADOR 31 SPXBR10031', 'SPXBR10031', 'LÍDER C'],
    ['COLABORADOR 32 GN10032', 'GN10032', 'LÍDER C'], ['COLABORADOR 33 GN10033', 'GN10033', 'LÍDER C'],
    ['COLABORADOR 34 GN10034', 'GN10034', 'LÍDER C'], ['COLABORADOR 35 GN10035', 'GN10035', 'LÍDER C'],
    ['COLABORADOR 36 GN10036', 'GN10036', 'LÍDER C'], ['COLABORADOR 37 GN10037', 'GN10037', 'LÍDER C'],
    ['COLABORADOR 38 GN10038', 'GN10038', 'LÍDER C'], ['COLABORADOR 39 GN10039', 'GN10039', 'LÍDER C'],
    ['COLABORADOR 40 GN10040', 'GN10040', 'LÍDER C'], ['COLABORADOR 41 GN10041', 'GN10041', 'LÍDER C'],
    ['COLABORADOR 42 GN10042', 'GN10042', 'LÍDER C'], ['COLABORADOR 43 GN10043', 'GN10043', 'LÍDER C'],
    ['COLABORADOR 44 GN10044', 'GN10044', 'LÍDER C'],
    ['COLABORADOR 45', 'SPXBR10045', 'LÍDER D'], ['COLABORADOR 46', 'SPXBR10046', 'LÍDER E'],
    ['COLABORADOR 47', 'SPXBR10047', 'LÍDER E'], ['COLABORADOR 48', 'SPXBR10048', 'LÍDER E'],
    ['COLABORADOR 49', 'SPXBR10049', 'LÍDER C'], ['COLABORADOR 50', 'SPXBR10050', 'LÍDER A'],
    ['COLABORADOR 51', 'SPXBR10051', 'LÍDER A'],
  ];
  const MAY = days(5, 2026, 31);
  const hse = [];
  put(hse, 0, 0, 'Gestão LGO 03 Anápolis'); put(hse, 0, 8, 'Safety Walk - Realização HUB LGO 03 Anápolis');
  put(hse, 0, 11, 'Ginastica Laboral - HUB LGO 03'); put(hse, 0, 17, 'DDS');
  R('Nome do colaborador(a)|Station ID|Código|BPO|Contrato |Lider|||Lider|Status||Turno|Semana 1 |Semana 2 |Semana 3|Semana 4||DIA|' + MAY.join('|'))
    .forEach((v, c) => put(hse, 1, c, v));
  people.forEach(([name, code, lider], i) => {
    const gn = code.startsWith('GN');
    [name, '9657', code, gn ? 'GNX' : 'SPX', gn ? 'TEMPORÁRIO' : 'CLT', lider, 'Pendente'].forEach((v, c) => put(hse, 2 + i, c, v));
  });
  const side = [
    [0, 'COLABORADOR 45', 'Realizado'], [1, 'COLABORADOR 46', 'Realizado'], [2, 'COLABORADOR 47', 'Pendente'], [3, 'COLABORADOR 48', 'Realizado'],
    [6, 'Cuidado ativo W1 - Realização HUB LGO 03 Anápolis', ''], [7, 'Lider', 'Status'],
    [8, 'COLABORADOR 45', 'Realizado'], [9, 'COLABORADOR 46', 'Realizado'], [10, 'COLABORADOR 47', 'Pendente'], [11, 'COLABORADOR 48', 'Realizado'],
    [14, 'Parada de segurança - Realização HUB LGO 03 Anápolis', ''], [15, 'Turno', 'Status'],
    [16, 'Turno 1 - 6x1 07:00 as 15:20 ', 'Pendente'], [17, 'Turno 3 - 6x1 5x2 - 00:00 as 09:13', 'Pendente'],
    [19, 'Lider', 'Status'], [20, 'COLABORADOR 45', ''], [21, 'COLABORADOR 52', ''], [22, 'COLABORADOR 53', ''],
    [23, 'COLABORADOR 54', ''], [24, 'COLABORADOR 55', ''], [25, 'COLABORADOR 56', ''],
  ];
  side.forEach(([i, a, b]) => { put(hse, 2 + i, 8, a); if (b) put(hse, 2 + i, 9, b); });
  put(hse, 2, 11, '1º Turno'); [12, 13, 14, 15].forEach(c => put(hse, 2, c, 'Pendente'));
  put(hse, 3, 11, '3° Turno'); [12, 13, 14, 15].forEach(c => put(hse, 3, c, 'Pendente'));
  put(hse, 5, 11, 'Justificativa');
  put(hse, 2, 17, '1º Turno'); put(hse, 2, 21, 'Realizado'); put(hse, 2, 22, 'Realizado');
  put(hse, 3, 17, '3° Turno'); put(hse, 3, 21, 'Pendente'); put(hse, 3, 22, 'Realizado');
  let lr = 2 + people.length + 1;
  [
    'Links importantes HSE:', '',
    'Registro de Acidentes: https://example.com',
    'Registro de Quase Acidentes: https://example.com',
    'Registro de Casos Clínicos: https://example.com',
    'Consulta de liberação de fornecedores: https://example.com',
    'Indicador OPA: https://example.com',
    'Indicador DDS / G.L: https://example.com',
    'Permissão de Trabalho: https://example.com',
    'Segue o link para registro do Inventário de EPI’s:  🔗 Formulário de Registro - https://example.com',
    'Utilize o link abaixo para apoio na visualização do estoque:   🔗 Looker Studio - https://example.com',
    'Acompanhe as informações no Farol de Controle:  🔗 Planilha de Acompanhamento_FAROL - https://example.com',
  ].forEach(t => { put(hse, lr++, 0, t); });
  for (const row of hse) for (let i = 0; i < row.length; i++) if (row[i] == null) row[i] = '';

  return {
    updatedAt: new Date().toISOString(),
    spreadsheet: 'Demonstração (setembro/2026)',
    sheets: {
      Recebimento: recebimento, HC: hc, PHD: phd, Inventario: inventario, Reversa: reversa,
      Transporte: transporte, HSE: hse, Gerencial: gerencial,
      'Missing T3': missingT3, 'Missing T1': missingT1,
    },
  };
})();
