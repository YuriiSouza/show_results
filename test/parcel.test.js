// Testes da aba "Parcel": leitura do relatório, extração do rastreio e leitura do cURL.
// Rodar com: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/parcel-core.js');
const { parseCurl, track, atDetail, _setSession } = require('../electron/parcel.js');
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
  assert.deepEqual(Core.rowOf('BR2698263380980', info), { code: 'BR2698263380980', missingOperator: 'natalia.lemos@shopee.com',
    atBefore: '', cage: '', driverId: '', driverName: '', note: 'Sem AT antes do missing' });
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
  assert.deepEqual(Core.rowOf('BR269015323946R', info, detail), { code: 'BR269015323946R', missingOperator: '[ops1]OPERADOR UM',
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

  const denied = await track('BR2698263380980', async () => res(403));
  assert.equal(denied.ok, false);
  assert.equal(denied.auth, true);

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
