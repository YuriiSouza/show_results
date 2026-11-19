// Modelo do dashboard: planilha mensal -> linhas da guia Indicadores -> modelo de novo (multi-hub).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { window: {}, console }; ctx.window.window = ctx.window; vm.createContext(ctx);
for (const f of ['js/config.js', 'js/parser.js', 'js/sample-data.js', 'js/model.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
const W = ctx.window;

test('indicadores: ida e volta da planilha mensal dá o mesmo modelo', () => {
  const m = W.buildModel(W.SAMPLE_DATA);
  const rows = W.modelRows(m);
  assert.ok(rows.length > 100);
  const iso = d => d.split('/').reverse().join('-');
  const m2 = W.modelFromRows(rows, { from: iso(m.dates[0]), to: iso(m.dates[m.dates.length - 1]) });
  assert.deepEqual([...m2.dates], [...m.dates]);
  for (const k of ['rec', 'hc', 'phd', 'inv', 'rev', 'tr']) assert.deepEqual(JSON.parse(JSON.stringify(m2[k])), JSON.parse(JSON.stringify(m[k])), k);
});

test('indicadores: dias sem lançamento ficam vazios e os calculados são refeitos', () => {
  const m = W.modelFromRows([{ iso: '2026-11-02', path: 'rec.total', v: 1000 }, { iso: '2026-11-02', path: 'hc.am.presente', v: 2 }], { from: '2026-11-01', to: '2026-11-03' });
  assert.deepEqual([...m.dates], ['01/11/2026', '02/11/2026', '03/11/2026']);
  assert.deepEqual([...m.rec.total], [null, 1000, null]);
  assert.equal(m.phd.phd[1], 500);
});
