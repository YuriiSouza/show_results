// Testes da aba "Parcel": leitura do relatório, extração do rastreio e leitura do cURL.
// Rodar com: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/parcel-core.js');
const { parseCurl, track, atDetail, _setSession, _setTiming } = require('../electron/parcel.js');
_setTiming({ authWaits: [0, 0, 0], gapMs: 0 });   // nos testes, sem esperar
const fixture = require('./fixtures/tracking-BR2698263380980.json');

// Horário de Brasília -> segundos Unix.
const sp = s => Math.floor(new Date(s + '-03:00').getTime() / 1000);
const HUB = { station_name: 'LM Hub_GO_Anápolis', station_id: 9657 };
const ev = (when, status, message, operator = '', station = HUB) => ({ timestamp: sp(when), status, message, operator, ...station });

test('parseTable: detecta tabulação e mantém os códigos como texto', () => {
  const g = Core.parseTable('SPX Tracking Number\tCount Type\tExpected\r\nBR2698263380980\tMissing\t1\r\n0012345678901\tScanned\t1\r\n\r\n');
  assert.deepEqual(g, [['SPX Tracking Number', 'Count Type', 'Expected'], ['BR2698263380980', 'Missing', '1'], ['0012345678901', 'Scanned', '1']]);
});

test('parseTable: ponto e vírgula, vírgula e aspas', () => {
  assert.deepEqual(Core.parseTable('a;b\n"x;1";"diz ""oi"""\n'), [['a', 'b'], ['x;1', 'diz "oi"']]);
  assert.deepEqual(Core.parseTable('﻿a,b\n1,"2,5"'), [['a', 'b'], ['1', '2,5']]);
});

test('flatten: achata children e event_children em ordem de horário', () => {
  const list = Core.flatten(fixture);
  assert.deepEqual(list.map(e => e.status), [658, 880, 10, 581, 418, 2, 420, 4]);
  assert.ok(list.every((e, i) => !i || e.ts >= list[i - 1].ts));
});

test('caso BR2698263380980: missing sem AT anterior (a AT depois do missing não entra)', () => {
  const info = Core.extract(fixture);
  assert.equal(info.arrival.ts, sp('2026-09-29T04:50:06'));
  assert.equal(info.arrival.status, 880);
  assert.equal(info.missing.ts, sp('2026-09-29T12:23:23'));
  assert.equal(info.missing.status, 581);
  assert.equal(info.missing.operator, 'natalia.lemos@shopee.com');
  assert.equal(info.atBefore, null);
  assert.equal(info.noAtToday, true);
  assert.deepEqual(Core.rowOf('BR2698263380980', info), { code: 'BR2698263380980', missingOperator: 'natalia.lemos@shopee.com',
    missingTs: sp('2026-09-29T12:23:23'), damage: '', damageOperator: '', noAt: true, xpt: 'XPT_GO_Jaraguá',
    atBefore: '', cage: '', driverId: '', driverName: '',
    note: 'Sem AT no dia (desde 21:00 do dia anterior); Pacote de outro XPT: XPT_GO_Jaraguá (AT AT20260930AH6FH em 30/09)' });
  assert.equal(info.otherAt.station, 'XPT_GO_Jaraguá');
});

test('AT anterior ao missing: usa a última antes do missing e o motorista em até 30 min', () => {
  const info = Core.extract({ tracking_list: [
    ev('2026-09-29T05:00:00', 880, 'chegou'),
    ev('2026-09-29T08:00:00', 418, 'Pedido adicionado à Assignment Task [AT20260929AAAAA]'),
    ev('2026-09-29T08:05:00', 2, 'Pedido em precesso de entrega. Motorista:[111] ANA SILVA; Contato: 0'),
    ev('2026-09-29T09:00:00', 418, 'Pedido adicionado à Assignment Task [AT20260929BBBBB]'),
    ev('2026-09-29T09:01:00', 417, 'Assignment Task [AT20260929BBBBB] em processamento'),
    ev('2026-09-29T09:10:00', 2, 'Pedido em precesso de entrega. Motorista:[222] BRUNO COSTA; Contato: 0'),
    ev('2026-09-29T10:00:00', 420, 'Pedido transferido para o motorista 3.641563e+06', '[3641563]RENATA MOREIRA'),
    ev('2026-09-29T12:00:00', 581, 'Parcel marked as missing', 'op@shopee.com'),
    ev('2026-09-30T08:00:00', 418, 'Pedido adicionado à Assignment Task [AT20260930CCCCC]'),
  ] });
  assert.equal(info.atBefore.code, 'AT20260929BBBBB');
  assert.equal(info.atBefore.ts, sp('2026-09-29T09:00:00'));
  assert.deepEqual([info.atBefore.driver.id, info.atBefore.driver.name], ['222', 'BRUNO COSTA']);
  // Transferência: ID lido de operator "[3641563]NOME", não da notação científica da mensagem.
  assert.deepEqual(info.atBefore.transfers.map(t => [t.id, t.name]), [['3641563', 'RENATA MOREIRA']]);
  const row = Core.rowOf('X', info);
  assert.deepEqual([row.atBefore, row.driverId, row.driverName], ['AT20260929BBBBB', '222', 'BRUNO COSTA']);
  assert.match(row.note, /proximidade de horário/);
  assert.match(row.note, /Transferido para \[3641563\] RENATA MOREIRA/);
});

test('BR269015323946R: AT reconhecida pelo texto "em processamento na Assignment Task" e gaiola', () => {
  assert.ok(Core.CODE_RE.test('BR269015323946R'));
  const mk = extra => Core.extract({ tracking_list: [
    ev('2026-09-29T05:00:00', 880, 'chegou'),
    // status em texto, como aparece na tela (LMHub_Atribuindo), e operador administrativo
    { ...ev('2026-09-29T08:00:00', 'LMHub_Atribuindo', 'Pedido em processamento na Assignment Task [AT20260929AF4WR]', 'Admin(Dynamic Routing)'), ...extra },
    ev('2026-09-29T08:04:00', 2, 'Pedido em precesso de entrega. Motorista:[111] ANA SILVA; Contato: 0'),
    ev('2026-09-29T12:00:00', 581, 'Parcel marked as missing', 'op@shopee.com'),
  ] });
  const a = mk({});
  assert.equal(a.atBefore.code, 'AT20260929AF4WR');
  assert.equal(a.atBefore.driver.id, '111');
  assert.equal(a.atBefore.cage, '');
  assert.equal(mk({ cage_code: 'A-13' }).atBefore.cage, 'A-13');
  assert.equal(mk({ message: 'Pedido em processamento na Assignment Task [AT20260929AF4WR], gaiola A-13' }).atBefore.cage, 'A-13');
  assert.equal(Core.rowOf('BR269015323946R', mk({ corridor: 'B-7' })).cage, 'B-7');
  // campo com outro nome cujo valor é a gaiola, e gaiola fora dos eventos (dados gerais do pedido)
  assert.equal(mk({ zone: 'D-4' }).atBefore.cage, 'D-4');
  const top = Core.extract({ data: { order: { sort_info: { cage_no: 'E-21' } }, tracking_list: mk({}).events ? [
    ev('2026-09-29T05:00:00', 880, 'chegou'),
    ev('2026-09-29T08:00:00', 417, 'Pedido em processamento na Assignment Task [AT20260929AF4WR]'),
    ev('2026-09-29T12:00:00', 581, 'Parcel marked as missing', 'op@shopee.com'),
  ] : [] } });
  assert.equal(top.atBefore.cage, '');
  const topRow = Core.rowOf('X', top);
  assert.equal(topRow.cage, 'E-21');
  // "removido da Assignment Task" não conta como AT; "GO-A-10" e "XPT-12" não são gaiola.
  const b = Core.extract({ tracking_list: [
    ev('2026-09-29T05:00:00', 880, 'chegou em GO-A-10'),
    ev('2026-09-29T08:00:00', 999, 'Pedido removido da Assignment Task [AT20260929ZZZZZ]'),
    ev('2026-09-29T12:00:00', 581, 'Parcel marked as missing', 'op@shopee.com'),
  ] });
  assert.equal(b.atBefore, null);
  assert.ok(Core.flatten({ tracking_list: [ev('2026-09-29T05:00:00', 1, 'rota GO-A-10 XPT-12')] }).every(e => !e.cage));
});

test('detalhe da AT: gaiola e motorista vêm de corridor_cage / driver_id / driver_name', () => {
  // eventos como na resposta real: AT com status 49 e "Order marked as missing"
  const info = Core.extract({ tracking_list: [
    ev('2026-09-28T19:49:30', 880, '[TO20260926372AU] arrived at [LM Hub_GO_Anápolis] via Linehaul Trip [LT0Q9S02HURO1]', 'system'),
    ev('2026-09-29T07:41:13', 49, 'Pedido em processamento na Assignment Task [AT20260929AFOV4]', 'Admin(Dynamic Routing)'),
    ev('2026-09-29T11:03:19', 581, 'Order marked as missing', '[ops1]OPERADOR UM'),
    ev('2026-09-29T12:23:23', 581, 'Order marked as missing', 'outro@shopee.com'),
    ev('2026-09-29T23:34:31', 49, 'Pedido em processamento na Assignment Task [AT20260930AGJYR]', 'Admin(Dynamic Routing)'),
    ev('2026-10-01T05:57:13', 50, 'Pedido adicionado à Assignment Task [AT20261001AI3R8]', 'spx@shopee.com'),
    ev('2026-10-01T05:58:00', 2, 'Pedido em precesso de entrega. Motorista:[999] MOTORISTA DA ENTREGA; Contato: 0', '', {}),
  ] });
  assert.equal(info.missing.operator, '[ops1]OPERADOR UM');
  assert.equal(info.atBefore.code, 'AT20260929AFOV4');
  assert.equal(info.atBefore.driver, null);
  const detail = { assignment_task_id: 'AT20260929AFOV4', driver_id: 613859, driver_name: 'MOTORISTA DA AT', corridor_cage: 'D-10' };
  assert.deepEqual(Core.rowOf('BR269015323946R', info, detail), { code: 'BR269015323946R', missingOperator: 'OPERADOR UM',
    missingTs: info.missing.ts, damage: '', damageOperator: '', noAt: false, xpt: '',
    atBefore: 'AT20260929AFOV4', cage: 'D-10', driverId: '613859', driverName: 'MOTORISTA DA AT', note: '' });
  assert.match(Core.rowOf('X', info, { driver_id: 0, driver_name: '', corridor_cage: '' }).note, /AT sem gaiola; AT sem motorista atribuído/);
  assert.match(Core.rowOf('X', info, null, 'SPX respondeu HTTP 500').note, /Detalhe da AT indisponível: SPX respondeu HTTP 500/);
});

test('motorista fora da janela de 30 min não é vinculado; status 658 é ignorado', () => {
  const info = Core.extract({ tracking_list: [
    ev('2026-09-29T05:00:00', 880, 'chegou'),
    ev('2026-09-29T08:00:00', 418, 'Pedido adicionado à Assignment Task [AT20260929AAAAA]'),
    ev('2026-09-29T08:02:00', 658, 'Parcel assigned to Driver. Motorista:[999] FIRST MILE'),
    ev('2026-09-29T08:45:00', 2, 'Pedido em precesso de entrega. Motorista:[111] ANA SILVA; Contato: 0'),
    ev('2026-09-29T12:00:00', 581, 'Parcel marked as missing', 'op@shopee.com'),
  ] });
  assert.equal(info.atBefore.code, 'AT20260929AAAAA');
  assert.equal(info.atBefore.driver, null);
  assert.match(Core.rowOf('X', info).note, /Motorista da AT não encontrado/);
});

test('missing anterior à chegada no hub não conta; sem passagem pelo hub é avisado', () => {
  const other = { station_name: 'SoC_GO', station_id: 1 };
  const a = Core.extract({ tracking_list: [
    ev('2026-09-28T10:00:00', 581, 'Parcel marked as missing', 'x@shopee.com', other),
    ev('2026-09-29T05:00:00', 880, 'chegou'),
  ] });
  assert.equal(a.missing, null);
  assert.deepEqual(a.notes, ['Sem missing após a chegada']);
  const b = Core.extract({ data: { tracking_list: [ev('2026-09-28T10:00:00', 1, 'criado', '', other)] } });
  assert.equal(b.arrival, null);
  assert.match(b.notes[0], /Sem passagem pelo LM Hub_GO_Anápolis/);
  assert.deepEqual(Core.extract({}).notes, ['Rastreio sem eventos']);
});

test('parseCurl (bash): aproveita só os cabeçalhos permitidos e descarta x-sap-*', () => {
  const h = parseCurl(`curl 'https://spx.shopee.com.br/api/fleet_order/order/detail/tracking_info?shipment_id=BR1' \\
    -H 'accept: application/json' \\
    -H 'app: FMS Portal' \\
    -b 'fms_user_id=1; token=abc%3D' \\
    -H 'device-id: dev-1' \\
    -H 'x-csrftoken: csrf-1' \\
    -H 'x-sap-ri: aaa' -H 'x-sap-sec: bbb' \\
    -H 'sec-ch-ua: "Chromium";v="140"' \\
    -H 'referer: https://spx.shopee.com.br/' \\
    -H 'user-agent: Mozilla/5.0 (X11)'`);
  assert.deepEqual(h, { accept: 'application/json', app: 'FMS Portal', cookie: 'fms_user_id=1; token=abc%3D', 'device-id': 'dev-1',
    'x-csrftoken': 'csrf-1', referer: 'https://spx.shopee.com.br/', 'user-agent': 'Mozilla/5.0 (X11)' });
});

test('parseCurl (cmd do Windows) e cookie em -H', () => {
  const h = parseCurl('curl ^"https://spx.shopee.com.br/api/x?shipment_id=BR1^" ^\r\n  -H ^"app: FMS Portal^" ^\r\n  -H ^"cookie: a=1; b=^%^3D^" ^\r\n  -H ^"sec-ch-ua: ^\\^"Chromium^\\^";v=^\\^"140^\\^"^"');
  assert.deepEqual(h, { app: 'FMS Portal', cookie: 'a=1; b=%3D' });
  assert.deepEqual(parseCurl('texto qualquer'), {});
});

test('track: tenta de novo em 5xx, para em 403 e valida o código', async () => {
  _setSession({ cookie: 'a=1' });
  const res = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => '0.01' }, json: async () => body });
  let calls = 0;
  const ok = await track('br2698263380980', async (url, opts) => {
    calls++;
    assert.equal(url, 'https://spx.shopee.com.br/api/fleet_order/order/detail/tracking_info?shipment_id=BR2698263380980');
    assert.deepEqual(opts.headers, { cookie: 'a=1' });
    return calls === 1 ? res(503) : res(200, { retcode: 0, data: { tracking_list: [] } });
  });
  assert.equal(calls, 2);
  assert.deepEqual(ok, { ok: true, data: { tracking_list: [] } });

  // 403: tenta de novo (3 esperas) antes de dar a sessão como expirada.
  let n403 = 0;
  const denied = await track('BR2698263380980', async () => { n403++; return res(403); });
  assert.equal(n403, 4);
  assert.equal(denied.ok, false);
  assert.equal(denied.auth, true);
  // Recusa passageira (403 e depois resposta normal): a consulta continua, sem pedir sessão nova.
  let nT = 0;
  const back = await track('BR2698263380980', async () => (++nT < 3 ? res(403) : res(200, { retcode: 0, data: { tracking_list: [1] } })));
  assert.equal(nT, 3);
  assert.deepEqual(back, { ok: true, data: { tracking_list: [1] } });
  // Resposta que não é JSON (página de login/bloqueio) também é repetida.
  let nH = 0;
  const html = await track('BR2698263380980', async () => (++nH < 2 ? { status: 200, ok: true, headers: { get: () => null }, json: async () => { throw new Error('html'); } } : res(200, { retcode: 0, data: {} })));
  assert.equal(html.ok, true);

  assert.deepEqual(await track('../etc', async () => { throw new Error('não deveria chamar'); }), { ok: false, error: 'Código inválido' });
  const at = await atDetail('at20260929afov4', async url => {
    assert.equal(url, 'https://spx.shopee.com.br/spx_delivery/admin/assignment/assignment_task/detail?assignment_task_id=AT20260929AFOV4');
    return res(200, { retcode: 0, data: { corridor_cage: 'D-10' } });
  });
  assert.deepEqual(at, { ok: true, data: { corridor_cage: 'D-10' } });
  assert.deepEqual(await atDetail('BR123', async () => { throw new Error('não deveria chamar'); }), { ok: false, error: 'AT inválida' });
  _setSession(null);
  assert.equal((await track('BR2698263380980')).auth, true);
  assert.equal((await atDetail('AT20260929AFOV4')).auth, true);
});

test('AT só vale a partir das 21:00 da véspera do missing (horário de Brasília)', () => {
  const mk = atWhen => Core.extract({ tracking_list: [
    ev('2026-09-28T20:00:00', 880, 'chegou'),
    ev(atWhen, 418, 'Pedido adicionado à Assignment Task [AT20260928ZZZZZ]'),
    ev('2026-09-29T06:00:00', 581, 'Parcel marked as missing', '[ops123]FULANO DE TAL'),
  ] });
  // AT da véspera às 20:59: não entra, e a linha fica marcada como sem AT no dia.
  const antes = mk('2026-09-28T20:59:00');
  assert.equal(antes.atBefore, null);
  assert.equal(antes.noAtToday, true);
  assert.equal(antes.lastOldAt.code, 'AT20260928ZZZZZ');
  const row = Core.rowOf('X', antes);
  assert.equal(row.noAt, true);
  assert.equal(row.note, 'Sem AT no dia (desde 21:00 do dia anterior) · última AT: AT20260928ZZZZZ em 28/09');
  assert.equal(row.missingOperator, 'FULANO DE TAL');   // sem o "[ops123]"
  // AT da véspera às 21:00 em ponto e às 23:59: entram.
  for (const when of ['2026-09-28T21:00:00', '2026-09-28T23:59:00', '2026-09-29T00:00:00']) {
    const ok = mk(when);
    assert.equal(ok.atBefore.code, 'AT20260928ZZZZZ');
    assert.equal(ok.noAtToday, false);
  }
});

test('avaria: não procura AT nem motorista, só devolve que é avaria', () => {
  const info = Core.extract({ tracking_list: [
    ev('2026-09-28T22:00:00', 880, 'chegou'),
    ev('2026-09-29T05:00:00', 418, 'Pedido adicionado à Assignment Task [AT20260929AAAAA]'),
    ev('2026-09-29T05:10:00', 2, 'Motorista:[123] FULANO; saiu'),
    { ...ev('2026-09-29T07:00:00', 700, 'Avaria Externa – SOC/LH/XPT/Driver', '[Ops36477]NATALIA CARDOSO DE LEMOS'), status_name: 'Exception_Reason_Added' },
    ev('2026-09-29T08:00:00', 581, 'Parcel marked as missing', 'op@shopee.com'),
  ] });
  assert.equal(info.damage.reason, 'Avaria Externa – SOC/LH/XPT/Driver');
  assert.equal(info.atBefore, null);
  const row = Core.rowOf('X', info);
  assert.equal(row.damage, 'Avaria Externa – SOC/LH/XPT/Driver');
  assert.equal(row.damageOperator, 'NATALIA CARDOSO DE LEMOS');
  assert.equal(row.atBefore, '');
  assert.equal(row.driverName, '');
  assert.equal(row.noAt, false);
  assert.match(row.note, /^Avaria: Avaria Externa/);
  // "Avaria de Produto" também conta, mesmo em outro campo do evento e sem missing.
  const produto = Core.extract({ tracking_list: [
    ev('2026-09-28T22:00:00', 880, 'chegou'),
    { ...ev('2026-09-29T07:00:00', 700, 'Exception_Reason_Added'), reason: 'AVARIA DE PRODUTO' },
  ] });
  assert.equal(produto.damage.reason, 'AVARIA DE PRODUTO');
  // Outros textos com a palavra "avaria" não contam.
  const mk = (when, msg) => Core.extract({ tracking_list: [
    ev('2026-09-27T10:00:00', 880, 'chegou'),
    ev(when, 700, msg),
    ev('2026-09-29T08:00:00', 581, 'Parcel marked as missing', 'op@shopee.com'),
  ] });
  assert.equal(mk('2026-09-29T07:00:00', 'Avaria interna').damage, null);
  assert.equal(mk('2026-09-29T07:00:00', 'Avaria Externa - SOC/LH/XPT').damage.reason, 'Avaria Externa - SOC/LH/XPT');
  // Só vale a partir das 21:00 da véspera do missing (mesma janela das ATs).
  assert.equal(mk('2026-09-28T20:59:00', 'Avaria de Produto').damage, null);
  assert.equal(mk('2026-09-28T21:00:00', 'Avaria de Produto').damage.reason, 'Avaria de Produto');
  assert.equal(mk('2026-09-29T09:00:00', 'Avaria de Produto').damage.reason, 'Avaria de Produto');   // depois do missing também conta
});

test('AT de outra estação não conta como AT do hub: o pacote é marcado como de outro XPT', () => {
  const CRX = { station_name: 'XPT_GO_Crixás', station_id: 20002 };
  const info = Core.extract({ tracking_list: [
    ev('2026-09-28T22:35:30', 880, 'chegou'),
    // AT no mesmo dia e antes do missing, mas feita em Crixás: não é AT de Anápolis.
    ev('2026-09-29T08:00:00', 418, 'Pedido adicionado à Assignment Task [AT20260929CRX01]', '', CRX),
    ev('2026-09-29T12:23:23', 581, 'Parcel marked as missing', 'op@shopee.com'),
  ] });
  assert.equal(info.atBefore, null);
  const row = Core.rowOf('X', info);
  assert.equal(row.xpt, 'XPT_GO_Crixás');
  assert.equal(row.noAt, true);
  assert.match(row.note, /Pacote de outro XPT: XPT_GO_Crixás/);
});

test('destOf: destino do pacote é o último trecho do Sort Code', () => {
  assert.equal(Core.destOf('SOC-GO2--HUB-LGO-03--XPT-JRU-01'), 'XPT-JRU-01');
  assert.equal(Core.destOf('SOC-GO2--HUB-LGO-03'), 'HUB-LGO-03');
  assert.equal(Core.destOf('SOC-SP8--HUB-LSP-64'), 'HUB-LSP-64');
  assert.equal(Core.destOf('SOC-GO2'), '');
  assert.equal(Core.destOf(''), '');
});

test('receiver: quem recebeu no hub é o operador (pessoa) do evento "Pedido chegou ao Last Mile Hub"', () => {
  const info = Core.receiver({ tracking_list: [
    ev('2026-10-16T05:00:00', 880, 'Pedido em transferência para o Last Mile Hub', 'ops.anapolis@shopee.com'),
    ev('2026-10-16T05:10:00', 10, 'Pedido chegou ao Last Mile Hub', 'ops.anapolis@shopee.com'),
    ev('2026-10-16T05:12:00', 10, 'Pedido chegou ao Last Mile Hub para entrega', '[Ops177146]KARLA APARECIDA RODRIGUES DA SILVA'),
    ev('2026-10-16T09:00:00', 581, 'Parcel marked as missing', 'op@shopee.com'),
  ] });
  assert.equal(info.name, 'KARLA APARECIDA RODRIGUES DA SILVA');
  assert.equal(info.ts, sp('2026-10-16T05:12:00'));
  // Só e-mail (sistema): sem recebedor.
  assert.equal(Core.receiver({ tracking_list: [ev('2026-10-16T05:10:00', 10, 'Pedido chegou ao Last Mile Hub', 'ops.anapolis@shopee.com')] }), null);
});

test('mapa de piso: nomes, vagas, letras e mudança que vale no horário', () => {
  global.window = { Charts: { esc: x => x }, ParcelCore: Core };
  require('../js/piso.js');
  const P = global.window.Piso._;
  assert.ok(P.sameName('[Ops177146]KARLA APARECIDA RODRIGUES DA SILVA', 'Karla Aparecida Rodrigues da Silva SPXBR32329'));
  assert.ok(P.sameName('ANTÔNIA MARIA DE MOURA', 'ANTONIA MARIA DE MOURA GN44539'));
  assert.ok(!P.sameName('ANA CLARA DA SILVA', 'ANA PAULA CUNHA ALVES'));
  assert.deepEqual(P.parseLetras('a-e'), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(P.parseLetras('A, B, M'), ['A', 'B', 'M']);
  const slots = P.slotsOf(P.DEFAULT_LAYOUT);
  assert.equal(slots.filter(s => s.func === 'rec').length, 4 * 2 * 2);       // 4 mesas × 2 postos × 2 pessoas
  assert.equal(slots.filter(s => s.func === 's2' && s.letra === 'C').length, 2);
  const map = { versions: [{ from: '', slots: {} }, { from: '09:30', slots: {} }, { from: '07:00', slots: {} }] };
  assert.equal(P.versionAt(map, '06:10').from, '');
  assert.equal(P.versionAt(map, '08:00').from, '07:00');
  assert.equal(P.versionAt(map, '10:00').from, '09:30');
});

test('recebimento por hora: horas, operadores e previsão de término', () => {
  global.window = { Charts: { esc: x => x } };
  require('../js/receb.js');
  const R = global.window.Receb._;
  const T = 1792818000; // 24/10/2026 02:00 (Brasília)
  const data = { time_list: [{ timestamp: T, total: 911 }, { timestamp: T - 3600, total: 6217 }, { timestamp: T - 7200, total: 3851 }, { timestamp: T - 10800, total: 0 }],
    efficiency_list: [
      { operator: '[ops177146]KARLA APARECIDA RODRIGUES DA SILVA', efficiency: [227, 1489, 976, 0] },
      { operator: 'pablo.silva@shopee.com', efficiency: [0, 0, 0, 0] },
    ] };
  const p = R.parse(data);
  assert.deepEqual(p.hours.map(h => h.total), [0, 3851, 6217, 911]);                // hora mais antiga primeiro
  assert.deepEqual(p.ops[0].hours, [0, 976, 1489, 227]);
  assert.equal(p.ops[0].name, 'KARLA APARECIDA RODRIGUES DA SILVA');
  assert.equal(p.ops[1].person, false);
  // Turno desde 23/10 22:00; agora 02:30; meta 15.000.
  const from = R.startTs('2026-10-23', '22:00'), now = T + 1800;
  assert.equal(from, T - 4 * 3600);
  const f = R.forecast(p, from, 15000, now);
  assert.equal(f.recebido, 911 + 6217 + 3851);
  assert.equal(f.ritmo, (3851 + 6217) / 2);                                          // 2 últimas horas completas
  assert.equal(f.falta, 15000 - 10979);
  assert.equal(f.eta, now + Math.round(4021 / 5034 * 3600));
  assert.equal(f.ops.length, 1);                                                     // quem não recebeu nada sai da lista
  assert.equal(R.forecast(p, from, 10000, now).done, true);
});

test('wfm: POST com JSON no painel de produtividade e junta as páginas', async () => {
  const { wfm } = require('../electron/parcel.js');
  _setSession({ cookie: 'a=1' });
  const bodies = [];
  const r = await wfm(async (url, opts) => {
    assert.equal(url, 'https://spx.shopee.com.br/api/wfm/admin/dashboard/list');
    assert.equal(opts.method, 'POST');
    assert.equal(opts.headers.cookie, 'a=1');
    const b = JSON.parse(opts.body); bodies.push(b.pageno);
    const page = b.pageno === 1 ? [{ operator: 'A' }, { operator: 'B' }] : [{ operator: 'C' }];
    return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ retcode: 0, data: { total: 3, efficiency_list: page, time_list: [{ timestamp: 1, total: 1 }] } }) };
  });
  assert.deepEqual(bodies, [1, 2]);
  assert.deepEqual(r.data.efficiency_list.map(x => x.operator), ['A', 'B', 'C']);
});

test('mapa de piso: função XPT e descrição das vagas', () => {
  global.window = { Charts: { esc: x => x }, ParcelCore: Core };
  delete require.cache[require.resolve('../js/piso.js')];
  require('../js/piso.js');
  const P = global.window.Piso._;
  const slots = P.slotsOf(P.DEFAULT_LAYOUT);
  assert.equal(slots.filter(s => s.func === 'xpt').length, 2);
  const L = P.DEFAULT_LAYOUT;
  assert.equal(P.slotDesc('m4.ind.0', L), 'Mesa 4 (Volumoso) · Indução');
  assert.equal(P.slotDesc('m1.rec.1.1', L), 'Mesa 1 · Bancada 2 (etiqueta)');
  assert.equal(P.slotDesc('m2.rec.0.0', L), 'Mesa 2 · Bancada 3 (recebe)');            // bancadas numeradas em sequência
  assert.equal(P.bancadaNo(L, 'm4', 1), 8);
  assert.ok(P.isDw('diarista') && !P.isDw('DIANA SILVA'));
  assert.equal(P.slotDesc('s2.C.0', L), '2º Sorting letra C');
  assert.equal(P.slotDesc('xpt.1', L), 'XPT');
  assert.equal(P.slotDesc('int.0', L), 'Intervalo');
});

test('janela de recebimento: dentro = etiquetagem, antes = backlog, depois = não recebido', () => {
  const W = { inicio: '22:00', fim: '05:30' };
  const mk = when => ({ tracking_list: [ev(when, 10, 'Pedido chegou ao Last Mile Hub para entrega', '[Ops1]FULANA DE TAL')] });
  assert.equal(Core.receiverInWindow(mk('2026-10-15T23:10:00'), '2026-10-16', W).classe, 'etiq');
  assert.equal(Core.receiverInWindow(mk('2026-10-16T05:30:00'), '2026-10-16', W).name, 'FULANA DE TAL');
  assert.equal(Core.receiverInWindow(mk('2026-10-15T21:59:00'), '2026-10-16', W).classe, 'backlog');
  assert.equal(Core.receiverInWindow(mk('2026-10-16T05:31:00'), '2026-10-16', W).classe, 'naorec');
  assert.equal(Core.receiverInWindow({ tracking_list: [] }, '2026-10-16', W).classe, 'naorec');
  // Janela do PM1 (09:00–11:15 do mesmo dia; backlog só antes das 05:30; entre 05:30 e 09:00 = não recebido).
  const P1 = { inicio: '09:00', fim: '11:15', backlogAntes: '05:30' };
  assert.equal(Core.receiverInWindow(mk('2026-10-16T10:00:00'), '2026-10-16', P1).classe, 'etiq');
  assert.equal(Core.receiverInWindow(mk('2026-10-16T07:00:00'), '2026-10-16', P1).classe, 'naorec');
  assert.equal(Core.receiverInWindow(mk('2026-10-16T04:00:00'), '2026-10-16', P1).classe, 'backlog');
  assert.equal(Core.receiverInWindow(mk('2026-10-16T11:16:00'), '2026-10-16', P1).classe, 'naorec');
});

test('módulo da planilha-base carrega e expõe as funções principais', () => {
  global.window = { APP_CONFIG: { BASE_SHEET_URL: 'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz/edit', METAS: {} }, hubApi: null };
  global.localStorage = { getItem: () => null, setItem() {} };
  delete require.cache[require.resolve('../js/base.js')];
  require('../js/base.js');
  ['load', 'mapaList', 'mapaGet', 'mapaSave', 'mapaHistory', 'erroList', 'erroSave', 'recebList', 'parcelList', 'auditList']
    .forEach(f => assert.equal(typeof global.window.Base[f], 'function', f));
});

test('mapa de piso: correção passa para as mudanças seguintes e resumo do que mudou', () => {
  global.window = { Charts: { esc: x => x }, ParcelCore: Core };
  delete require.cache[require.resolve('../js/piso.js')];
  require('../js/piso.js');
  const P = global.window.Piso._;
  const map = { versions: [
    { from: '', slots: { 'desc.0': 'ANA', 'desc.1': 'BIA' } },
    { from: '12:00', tipo: 'intervalo', slots: { 'desc.1': 'BIA', 'int.0': 'ANA' } },
    { from: '13:00', tipo: 'volta', slots: { 'desc.0': 'ANA', 'desc.1': 'BIA' } },
    { from: '14:00', slots: { 'desc.0': 'CAIO', 'desc.1': 'BIA' } },
    { from: '15:00', slots: { 'desc.0': 'ANA', 'desc.1': 'BIA' } },
  ] };
  // Corrige ANA → DORA no início: passa pelo intervalo (vaga vazia nele), corrige a Volta e para na troca das 14:00.
  const before = { ...map.versions[0].slots };
  map.versions[0].slots['desc.0'] = 'DORA';
  P.propagate(map, map.versions[0], before);
  assert.deepEqual(map.versions.map(v => v.slots['desc.0'] || ''), ['DORA', '', 'DORA', 'CAIO', 'ANA']);
  assert.equal(map.versions[1].slots['int.0'], 'ANA');
  const L = P.DEFAULT_LAYOUT;
  assert.deepEqual(P.verDiff(map.versions[2], map.versions[3], L), ['Descarga: DORA → CAIO']);
  assert.deepEqual(P.verDiff({ slots: { 'desc.0': 'ANA' } }, { slots: { 'xpt.0': 'ANA' } }, L), ['ANA: Descarga → XPT']);
});

test('XPT: vale pelo começo do nome (XPT-SMD responde por XPT-SMD-01, XPT-SMD-01-X…)', () => {
  const P = global.window.Piso._;
  assert.equal(P.xptBase('XPT-SMD-01'), 'XPT-SMD');
  assert.equal(P.xptBase('xpt_smd-01-x'), 'XPT-SMD');
  assert.equal(P.xptBase('SOC-GO2--HUB-LGO-03--XPT-JRU-01'.split('--').pop()), 'XPT-JRU');
  assert.equal(P.xptBase('smd'), 'XPT-SMD');
  assert.ok(P.sameXpt('XPT-SMD', 'XPT-SMD-01-X') && P.sameXpt('XPT-SMD-02', 'XPT-SMD-01'));
  assert.ok(!P.sameXpt('XPT-SMD-01', 'XPT-JRU-01') && !P.sameXpt('', 'XPT-SMD'));
  // Vários XPTs na mesma vaga (lista) e mapas antigos com um texto só.
  const map = { xptDest: { 'xpt.0': ['XPT-SMD-01', 'xpt-smd-02', 'XPT-JRU'], 'xpt.1': 'XPT-CRX-01' } };
  assert.deepEqual(P.destsOf(map, 'xpt.0'), ['XPT-SMD', 'XPT-JRU']);
  assert.deepEqual(P.destsOf(map, 'xpt.1'), ['XPT-CRX']);
  assert.deepEqual(P.destsOf(map, 'xpt.2'), []);
});

test('mapa de piso: duas pessoas salvando partes diferentes ao mesmo tempo — junta em vez de apagar', () => {
  const P = global.window.Piso._;
  const L = P.DEFAULT_LAYOUT;
  // Mapa novo (sem base): um montou Mesa 1 e Descarga, o outro Mesa 2 e Mesa 4; o segundo salvou primeiro.
  const a = { layout: L, versions: [{ from: '', slots: { 'm1.ind.0': 'ANA', 'desc.0': 'BIA' } }] };
  const b = { layout: L, versions: [{ from: '', slots: { 'm2.ind.0': 'CAIO', 'm4.ind.0': 'DANI' } }] };
  const m = P.mergeMaps(null, a, b);
  assert.deepEqual(m.versions[0].slots, { 'm1.ind.0': 'ANA', 'desc.0': 'BIA', 'm2.ind.0': 'CAIO', 'm4.ind.0': 'DANI' });
  // Com base: o que eu tirei sai (mesmo que o outro não tenha mexido); o que o outro mudou fica; troca nova de um lado entra.
  const base = { layout: L, versions: [{ from: '', slots: { 'm1.ind.0': 'ANA', 'desc.0': 'BIA' } }] };
  const ours = { layout: L, versions: [{ from: '', slots: { 'm1.ind.0': 'ANA' } }, { from: '10:00', slots: { 'm1.ind.0': 'EVA' } }] };
  const theirs = { layout: L, versions: [{ from: '', slots: { 'm1.ind.0': 'ANA', 'desc.0': 'BIA', 'm2.ind.0': 'CAIO' } }],
    board: { s2: [{ t: '09:00', n: 'FABIO', to: 'C' }], aud: [] } };
  const r = P.mergeMaps(base, ours, theirs);
  assert.deepEqual(r.versions.map(v => v.from), ['', '10:00']);
  assert.deepEqual(r.versions[0].slots, { 'm1.ind.0': 'ANA', 'm2.ind.0': 'CAIO' });
  assert.equal(r.board.s2.length, 1);
  // Mudança que existia na base e o outro excluiu: sai.
  const base2 = { layout: L, versions: [{ from: '', slots: {} }, { from: '11:00', slots: { 'desc.0': 'X' } }] };
  const r2 = P.mergeMaps(base2, base2, { layout: L, versions: [{ from: '', slots: {} }] });
  assert.deepEqual(r2.versions.map(v => v.from), ['']);
});
