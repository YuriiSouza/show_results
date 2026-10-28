// Aba "Parcel": importa o relatório de contagem do hub (TSV/CSV/XLSX), filtra por coluna e consulta o
// rastreio de cada código no SPX (operador do missing, AT anterior e motorista). Relatório, resultados e sessão
// do SPX ficam só na memória, até fechar o app; o resultado só vai para a planilha-base quando o usuário clica em
// "Salvar resultado" (sub-aba Histórico: consolidado por operador, para o feedback do líder).
window.Parcel = (() => {
  const C = window.ParcelCore;
  const H = window.Charts;
  const esc = H.esc;
  const api = () => window.hubApi || null;
  const canTrack = () => !!(api() && api().parcelTrack);
  const MAX_ROWS = 300;       // linhas desenhadas na tabela (o filtro e a consulta valem para todas)
  const MAX_DISTINCT = 300;   // colunas com mais valores distintos que isso não ganham filtro
  const CONCURRENCY = 2;     // consultas ao mesmo tempo (o SPX recusa quando são muitas seguidas)
  const TZ = 'America/Sao_Paulo';

  const st = { file: '', demo: false, headers: [], rows: [], codeCol: 0, distinct: [], hidden: new Set(), filters: {}, search: '', view: [],
    selected: new Set(), session: false, out: new Map(), ats: new Map(), results: [], run: null,
    tab: 'rel',                                                          // sub-aba: rel (relatório) · req (requisição/rastreio) · hist (histórico salvo)
    hf: { q: '', status: new Set(), op: new Set() },                     // filtros do histórico
    rf: { q: '', status: new Set(), driver: new Set(), cage: new Set(), op: new Set() },   // filtros da tabela de resultado (vários por vez)
    rep: { date: '', empty: 0, col: -1, text: '', manual: false } };     // report diário
  let ui = null, bound = false;
  const $ = id => document.getElementById(id);
  const cfg = () => (window.APP_CONFIG && window.APP_CONFIG.PARCEL) || {};

  // ---------- Filtros salvos (ficam no aparelho; os dados do relatório e do rastreio não são gravados) ----------
  // Os filtros do relatório são guardados pelo nome da coluna, para valerem no próximo arquivo importado.
  const SAVE_KEY = 'hub.parcel';
  const RF_SETS = ['status', 'driver', 'cage', 'op'];
  const saved = (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; } })();
  if (['req', 'rel', 'hist'].includes(saved.tab)) st.tab = saved.tab;
  if (saved.hf) { st.hf.q = String(saved.hf.q || ''); ['status', 'op'].forEach(k => { st.hf[k] = new Set(Array.isArray(saved.hf[k]) ? saved.hf[k] : []); }); }
  if (saved.rf) { st.rf.q = String(saved.rf.q || ''); RF_SETS.forEach(k => { st.rf[k] = new Set(Array.isArray(saved.rf[k]) ? saved.rf[k] : []); }); }
  function persist() {
    if (st.headers.length && !st.demo) {
      saved.search = st.search;
      saved.filters = {};
      Object.entries(st.filters).forEach(([c, set]) => { if (set.size) saved.filters[st.headers[c]] = [...set]; });
    }
    saved.tab = st.tab;
    saved.rf = { q: st.rf.q, ...Object.fromEntries(RF_SETS.map(k => [k, [...st.rf[k]]])) };
    saved.hf = { q: st.hf.q, status: [...st.hf.status], op: [...st.hf.op] };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved)); } catch (e) { /* sem armazenamento: os filtros valem só nesta sessão */ }
  }

  // ---------- Leitura do arquivo ----------
  // .xlsx mínimo (1ª guia): o arquivo é um zip com XML dentro. Os valores vêm como texto, sem conversão.
  async function xlsxGrid(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), td = new TextDecoder();
    let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Arquivo .xlsx inválido.');
    const files = {};
    for (let i = 0, p = dv.getUint32(e + 16, true), n = dv.getUint16(e + 10, true); i < n; i++) {
      const nameLen = dv.getUint16(p + 28, true);
      files[td.decode(u8.subarray(p + 46, p + 46 + nameLen))] = { method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true) };
      p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    const read = async name => {
      const f = files[name];
      if (!f) return '';
      const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
      const raw = u8.subarray(start, start + f.size);
      if (f.method === 0) return td.decode(raw);
      return new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    };
    const xml = async name => new DOMParser().parseFromString(await read(name), 'application/xml');
    const text = node => [...node.getElementsByTagName('t')].filter(t => t.parentNode.nodeName !== 'rPh').map(t => t.textContent).join('');
    const shared = files['xl/sharedStrings.xml'] ? [...(await xml('xl/sharedStrings.xml')).getElementsByTagName('si')].map(text) : [];
    const sheet = Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    if (!sheet) throw new Error('O .xlsx não tem nenhuma guia.');
    const col = ref => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return [...(await xml(sheet)).getElementsByTagName('row')].map(row => {
      const out = [];
      [...row.getElementsByTagName('c')].forEach((c, i) => {
        const v = c.getElementsByTagName('v')[0], t = c.getAttribute('t'), r = c.getAttribute('r');
        const val = t === 's' ? shared[+(v && v.textContent)] : t === 'inlineStr' ? text(c) : v ? v.textContent : '';
        out[r ? col(r) : i] = String(val == null ? '' : val).trim();
      });
      return Array.from(out, x => x || '');
    }).filter(r => r.some(Boolean));
  }

  async function loadFile(file) {
    try {
      if (/\.xls$/i.test(file.name)) throw new Error('Arquivo .xls antigo: salve como .xlsx ou .csv e importe de novo.');
      const grid = /\.xlsx$/i.test(file.name) ? await xlsxGrid(await file.arrayBuffer()) : C.parseTable(await file.text());
      if (grid.length < 2) throw new Error('O arquivo não tem linhas de dados.');
      setData(file.name, grid, false);
      ui.toast(`${st.rows.length} linhas importadas`);
    } catch (err) {
      ui.toast(String(err.message || err), true);
    }
  }

  function setData(name, grid, demo) {
    // Coluna "Destino", tirada do Sort Code (último trecho): mostra se o pacote é do hub, de um XPT ou de outra estação.
    const sc = grid[0].findIndex(h => /^sort code$/i.test(String(h).trim()));
    if (sc >= 0 && !grid[0].some(h => /^destino$/i.test(String(h).trim()))) {
      grid = grid.map((r, i) => { const row = r.slice(); row.splice(sc + 1, 0, i ? C.destOf(r[sc]) : 'Destino'); return row; });
    }
    const width = Math.max(...grid.map(r => r.length));
    st.file = name; st.demo = demo;
    st.headers = Array.from({ length: width }, (_, i) => grid[0][i] || `Coluna ${i + 1}`);
    const k = st.headers.findIndex(h => /spx tracking number/i.test(h));
    st.codeCol = k >= 0 ? k : 0;
    // "[ops123]FULANO" vira "FULANO" (o identificador entre colchetes não é mostrado).
    st.rows = grid.slice(1).map(r => Array.from({ length: width }, (_, i) => (i === st.codeCol ? r[i] || '' : C.stripId(r[i]))));
    // Colunas só de marcação (Y / N) ficam fora da tela, para a tabela ter menos colunas.
    st.hidden = new Set(st.headers.map((_, i) => i).filter(i => {
      if (i === st.codeCol) return false;
      const vals = st.rows.map(r => r[i]).filter(Boolean);
      return vals.length > 0 && vals.every(v => /^(y|n|yes|no)$/i.test(v));
    }));
    st.distinct = st.headers.map((_, i) => {
      if (i === st.codeCol || st.hidden.has(i)) return null;
      const m = new Map();
      for (const r of st.rows) { m.set(r[i], (m.get(r[i]) || 0) + 1); if (m.size > MAX_DISTINCT) return null; }
      return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR', { numeric: true }));
    });
    // Filtros salvos: voltam os que ainda existem neste arquivo (mesma coluna e mesmo valor).
    st.filters = {}; st.search = demo ? '' : String(saved.search || '');
    if (!demo) Object.entries(saved.filters || {}).forEach(([name, vals]) => {
      const c = st.headers.indexOf(name);
      if (c < 0 || !st.distinct[c] || !Array.isArray(vals)) return;
      const keep = vals.filter(v => st.distinct[c].some(([x]) => x === v));
      if (keep.length) st.filters[c] = new Set(keep);
    });
    st.selected = new Set(); st.results = [];
    st.rep = { date: '', empty: 0, col: -1, text: '', manual: false };
    applyFilters();
    if (ui.isActive()) draw();
  }

  // ---------- Filtros e seleção ----------
  function applyFilters() {
    const q = st.search.trim().toLowerCase();
    const active = Object.entries(st.filters).filter(([, s]) => s.size);
    st.view = [];
    st.rows.forEach((r, i) => {
      if (q && !r[st.codeCol].toLowerCase().includes(q)) return;
      if (active.every(([c, s]) => s.has(r[c]))) st.view.push(i);
    });
    const inView = new Set(st.view);
    st.selected.forEach(i => { if (!inView.has(i)) st.selected.delete(i); });
  }
  // Códigos da consulta: as linhas selecionadas ou, sem seleção, todas as filtradas (sem repetição).
  const targets = () => [...new Set((st.selected.size ? st.view.filter(i => st.selected.has(i)) : st.view)
    .map(i => st.rows[i][st.codeCol].trim().toUpperCase()).filter(Boolean))];
  // Atalho do filtro mais usado: Count Type = Missing.
  function missingShortcut() {
    const c = st.headers.findIndex(h => /^count type$/i.test(h));
    const v = c >= 0 && st.distinct[c] && (st.distinct[c].find(([x]) => /^missing$/i.test(x)) || [])[0];
    return v ? { c, v } : null;
  }

  // ---------- Tela ----------
  async function render(ctx) {
    ui = ctx;
    bindOnce();
    draw();
    if (canTrack()) { st.session = await window.SpxSession.has(); if (ui.isActive()) drawBar(); }
  }

  function draw() {
    const m = ui.main;
    const tabs = `<div class="pc-tabs" role="tablist">${[['rel', 'Relatório de contagem'], ['req', 'Rastreio (requisição)<span id="pcTabN"></span>'], ['hist', 'Histórico (operadores)']].map(([k, l]) =>
      `<button role="tab" aria-selected="${st.tab === k}" class="${st.tab === k ? 'active' : ''}" data-pc-tab="${k}">${l}</button>`).join('')}</div>`;
    if (st.tab === 'hist') {
      m.innerHTML = ui.head('Parcel', 'Relatório de contagem · rastreio no SPX') + tabs + '<div id="pcHist"></div>';
      drawHist();
      const B = window.Base;
      if (B && B.enabled()) B.load().then(() => { if (ui.isActive() && st.tab === 'hist') drawHist(); });
      return;
    }
    if (!st.rows.length) {
      m.innerHTML = ui.head('Parcel', 'Relatório de contagem · rastreio no SPX') + tabs + `
        <div class="au-empty">
          <div class="au-empty-icon">📦</div>
          <h2>Nenhum relatório importado</h2>
          <p class="muted">Importe o relatório de contagem do hub (<b>.tsv</b>, <b>.csv</b> ou <b>.xlsx</b>), filtre por coluna e consulte o rastreio
          dos códigos para ver o <b>operador do missing</b>, a <b>AT anterior</b> e o <b>motorista</b>. Nada fica salvo: o relatório some ao fechar o app.</p>
          <div class="au-empty-actions">
            <button class="btn-primary solid" data-pc="import">Importar relatório</button>
            <button class="btn-ghost" data-pc="demo">Ver com dados de exemplo</button>
          </div>
          <p class="muted small">Dica: você também pode arrastar o arquivo para esta tela.</p>
        </div>`;
      return;
    }
    m.innerHTML = ui.head('Parcel', 'Relatório de contagem · rastreio no SPX') + `
      ${st.demo ? '<div class="au-demo">Exemplo com dados fictícios. <button class="link" data-pc="import">Importar um relatório</button></div>' : ''}
      <div class="au-bar" id="pcBar"></div>
      ${tabs}
      ${st.tab === 'req' ? '<div class="pc-results" id="pcResults"></div>' : `
      <div class="kpis" id="pcKpis"></div>
      <div class="grid" id="pcDash"></div>
      <div class="grid pc-data">
        <section class="card w12">
          <div class="card-head"><div><div class="card-title">Linhas do relatório</div><div class="card-sub">Os filtros valem para os gráficos acima e para a consulta de rastreio</div></div></div>
          <div class="pc-filters" id="pcFilters"></div><div id="pcTable"></div>
        </section>
      </div>`}`;
    drawBar(); drawFilters(); drawTable(); drawDash(); drawResults();
  }
  function setTab(tab) { st.tab = tab; persist(); draw(); }

  function drawBar() {
    const el = $('pcBar');
    if (!el) return;
    const n = targets().length, run = st.run;
    const errors = st.results.filter(c => st.out.has(c) && !st.out.get(c).ok).length;
    el.innerHTML = `
      <span class="au-period">📄 ${esc(st.file)}<span class="muted"> · ${st.rows.length} linhas</span></span>
      <button class="tool" data-pc="import" ${run ? 'disabled' : ''}>Trocar arquivo</button>
      ${run ? `<div class="pc-progress">
          <div class="progress"><span style="width:${Math.round(100 * run.done / run.total)}%"></span></div>
          <span><b>${run.done}</b> de ${run.total}${errors ? ` · ${errors} erro(s)` : ''}${Date.now() - run.lastAt > 7000 ? ' · <span class="pc-wait">SPX segurando as consultas, tentando de novo…</span>' : ''}</span>
          <button class="tool danger" data-pc="cancel" ${run.cancel ? 'disabled' : ''}>${run.cancel ? 'Cancelando…' : 'Cancelar'}</button>
        </div>` : `<div class="au-bar-right pc-actions">
          <button class="btn-primary solid" data-pc="run" ${n && canTrack() ? '' : 'disabled'}
            title="${canTrack() ? 'Consulta o rastreio dos códigos selecionados ou, sem seleção, de todos os filtrados' : 'A consulta de rastreio só funciona no aplicativo desktop'}">
            Consultar rastreio (${n} ${st.selected.size ? 'selecionado(s)' : 'filtrado(s)'})</button>
        </div>`}
      ${canTrack() ? '' : '<span class="muted small pc-note">A consulta de rastreio só funciona no aplicativo desktop (Windows/Linux).</span>'}`;
  }

  const summaryHtml = c => { const n = (st.filters[c] || new Set()).size; return `${esc(st.headers[c])}${n ? ` <b>${n}</b>` : ''}`; };
  function drawFilters() {
    const el = $('pcFilters');
    if (!el) return;
    const mk = missingShortcut();
    const onlyMissing = mk && st.filters[mk.c] && st.filters[mk.c].size === 1 && st.filters[mk.c].has(mk.v);
    el.innerHTML = `
      <input class="search" id="pcSearch" type="search" placeholder="Buscar em ${esc(st.headers[st.codeCol])}…" value="${esc(st.search)}">
      ${mk ? `<button class="chip ${onlyMissing ? 'active' : ''}" data-pc="only-missing">Count Type = ${esc(mk.v)}</button>` : ''}
      ${st.headers.map((h, c) => {
        const vals = st.distinct[c];
        if (!vals) return '';
        const sel = st.filters[c] || new Set();
        return `<details class="pc-filter ${sel.size ? 'active' : ''}" data-col="${c}"><summary>${summaryHtml(c)}</summary>
          <div class="pc-pop">
            ${vals.length > 10 ? '<input type="search" class="pc-pop-search" placeholder="Buscar valor…">' : ''}
            <div class="pc-pop-list">${vals.map(([v, n]) => `<label><input type="checkbox" data-pc-val="${esc(v)}" ${sel.has(v) ? 'checked' : ''}>
              <span class="pc-val">${v ? esc(v) : '<i>(vazio)</i>'}</span><span class="muted">${n}</span></label>`).join('')}</div>
            <div class="pc-pop-foot"><button class="tool" data-pc-none="${c}">Limpar</button></div>
          </div></details>`;
      }).join('')}
      <button class="tool" data-pc="clear">Limpar filtros</button>`;
  }

  const countHtml = () => `<b>${st.view.length}</b> de ${st.rows.length} linhas${st.selected.size ? ` · <b>${st.selected.size}</b> selecionada(s)` : ''}` +
    (st.view.length > MAX_ROWS ? ` · mostrando as primeiras ${MAX_ROWS} (o filtro e a consulta valem para todas)` : '');
  function drawTable() {
    const el = $('pcTable');
    if (!el) return;
    el.innerHTML = `<div class="pc-count" id="pcCount">${countHtml()}</div>
      <div class="table-wrap"><table class="pc-table"><thead><tr>
        <th><input type="checkbox" id="pcAll" title="Selecionar todas as linhas filtradas" aria-label="Selecionar todas as linhas filtradas"></th>
        ${st.headers.map((h, c) => (st.hidden.has(c) ? '' : `<th class="left">${esc(h)}</th>`)).join('')}</tr></thead><tbody>
        ${st.view.slice(0, MAX_ROWS).map(i => `<tr><td><input type="checkbox" data-pc-row="${i}" aria-label="Selecionar linha" ${st.selected.has(i) ? 'checked' : ''}></td>
          ${st.rows[i].map((v, c) => (st.hidden.has(c) ? '' : `<td class="left${c === st.codeCol ? ' pc-code' : ''}">${esc(v)}</td>`)).join('')}</tr>`).join('')}
      </tbody></table></div>
      ${st.view.length ? '' : ui.empty('Nenhuma linha com esses filtros.')}`;
    syncAll();
  }
  function syncAll() {
    const all = $('pcAll');
    if (!all) return;
    all.checked = st.view.length > 0 && st.selected.size === st.view.length;
    all.indeterminate = st.selected.size > 0 && st.selected.size < st.view.length;
  }
  function refreshSelection() { const c = $('pcCount'); if (c) c.innerHTML = countHtml(); syncAll(); drawBar(); }

  // ---------- Dashboard do relatório importado (segue os filtros) ----------
  const DASH_PREF = [/count type/i, /^destino$/i, /final status/i, /^operator$/i, /next step/i, /scanned status/i];
  function dashCols() {
    // Colunas de data/hora ou quase sem repetição não servem como categoria de gráfico.
    const isTime = c => { const v = st.distinct[c].slice(0, 20).map(x => x[0]).filter(Boolean); return v.length > 0 && v.filter(x => /\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}|\d{1,2}:\d{2}/.test(x)).length >= v.length * 0.6; };
    const ok = c => st.distinct[c] && st.distinct[c].length > 1 && !isTime(c) && st.distinct[c].length <= Math.max(2, st.rows.length * 0.7);
    const out = [];
    DASH_PREF.forEach(re => { const c = st.headers.findIndex((h, i) => re.test(h) && ok(i) && !out.includes(i)); if (c >= 0) out.push(c); });
    st.headers.forEach((_, c) => { if (out.length < 4 && ok(c) && !out.includes(c) && st.distinct[c].length <= 30) out.push(c); });
    return out.slice(0, 4);
  }
  const countBy = (idxs, c) => {
    const m = new Map();
    idxs.forEach(i => { const v = st.rows[i][c] || '(vazio)'; m.set(v, (m.get(v) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  // Top 10 + "Outros", para o gráfico de barras deitadas.
  const top = list => {
    const head = list.slice(0, 10), rest = list.slice(10).reduce((s, [, n]) => s + n, 0);
    return rest ? [...head, ['Outros', rest]] : head;
  };
  function drawDash() {
    const k = $('pcKpis'), d = $('pcDash');
    if (!k || !d) return;
    const cols = dashCols();
    const main = cols[0];
    const byMain = main != null ? countBy(st.view, main) : [];
    k.innerHTML = [
      ui.kpi('Linhas', H.fmt.int(st.view.length), [`<span>de ${H.fmt.int(st.rows.length)} no arquivo</span>`]),
      ...(byMain.length > 8 ? [] : byMain).slice(0, 5).map(([v, n]) => ui.kpi(esc(`${st.headers[main]}: ${v}`), H.fmt.int(n), [`<span>${H.fmt.pct(st.view.length ? n / st.view.length : null, 0)} das linhas filtradas</span>`])),
    ].join('');
    d.innerHTML = cols.map((c, i) => ui.card('pcCh' + i, esc(st.headers[c]), 'Linhas filtradas por valor', { w: cols.length === 1 ? 12 : cols.length === 3 ? 4 : 6 })).join('');
    cols.forEach((c, i) => {
      const data = top(countBy(st.view, c));
      H.render('pcCh' + i, { labels: data.map(x => x[0]), horizontal: true, legend: false, datasets: [H.bar('Linhas', data.map(x => x[1]), H.color(i % 2 ? 2 : 1))] });
    });
  }

  // ---------- Resultado ----------
  const RESULT_COLS = [
    ['Código', r => r.code],
    ['Operador do missing', r => r.missingOperator],
    ['AT anterior', r => r.atBefore],
    ['Gaiola', r => r.cage],
    ['ID do motorista', r => r.driverId],
    ['Nome do motorista', r => r.driverName],
    ['Avaria', r => r.damage],
    ['XPT bipado por (Mapa de piso)', () => ''],
    ['Observação/erro', r => r.note],
  ];
  const resultCells = code => {
    const o = st.out.get(code);
    const blank = Array(RESULT_COLS.length - 2).fill('');
    if (!o) return [code, ...blank, st.run ? 'Na fila…' : 'Não consultado'];
    if (!o.ok) return [code, ...blank, 'Erro: ' + o.error];
    // Pacote de outro XPT: a coluna "AT anterior" leva o XPT (ex.: XPT-CRX-01) no lugar da AT.
    const xpt = situ(code) === 'xpt' ? xptLabel({ code, row: o.row }) : '';
    const by = xpt ? xptBy({ code, row: o.row }) : '';
    return RESULT_COLS.map(([h, get]) => (xpt && h === 'AT anterior' ? xpt : h === 'XPT bipado por (Mapa de piso)' ? by : get(o.row) || ''));
  };

  // Situação de um código consultado: avaria · ok (AT do hub no dia) · xpt (pacote de outro XPT) · noat (sem AT no dia) · nomiss · err · wait
  const situ = code => {
    const o = st.out.get(code);
    if (!o) return 'wait';
    if (!o.ok) return 'err';
    // Avaria vem antes de tudo: não tem AT nem motorista para procurar.
    if (o.row.damage) return 'avaria';
    // O destino vem primeiro: pacote de outro XPT/estação não é do hub, mesmo que tenha AT.
    return otherDest(code, o.row) ? 'xpt' : o.row.atBefore ? 'ok' : o.row.noAt ? 'noat' : 'nomiss';
  };
  // Destino pelo relatório (coluna Destino = último trecho do Sort Code).
  const destCol = () => st.headers.findIndex(h => /^destino$/i.test(h));
  const destOfCode = code => { const c = destCol(); if (c < 0) return ''; const r = st.rows.find(x => x[st.codeCol].trim().toUpperCase() === code); return r ? r[c] : ''; };
  // Pacote que não é do hub: o destino do Sort Code é outro (ex.: XPT-CRX-01) ou, sem Sort Code, a AT é de outra estação.
  // Devolve o texto para a tela e o report (a sigla do Sort Code tem prioridade sobre o nome da estação).
  const otherDest = (code, row) => {
    const d = destOfCode(code), hub = cfg().hubCode || 'HUB-LGO-03';
    if (d && d !== hub) return d;
    return !d && row && !row.atBefore && row.xpt ? row.xpt : '';
  };
  const xptLabel = x => otherDest(x.code, x.row);
  // Pacote de outro XPT: quem estava na vaga daquele XPT no mapa de piso do dia do missing (responsável pelo bipe).
  // Dia do relatório: a data mais antiga da coluna "Scanned Time" (quando a contagem começou).
  // Sem essa coluna, o dia do missing do próprio pacote.
  function reportDay() {
    if (st.reportDayKey === st.file + st.rows.length) return st.reportDay;
    const c = st.headers.findIndex(h => /^scanned time$/i.test(String(h).trim()));
    let best = '';
    if (c >= 0) st.rows.forEach(r => {
      const v = String(r[c] || '');
      const m = v.match(/(\d{4})-(\d{2})-(\d{2})/) || v.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (!m) return;
      const iso = m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
      if (!best || iso < best) best = iso;
    });
    st.reportDay = best; st.reportDayKey = st.file + st.rows.length;
    return best;
  }
  // Quem fez o XPT do pacote no dia do relatório, pelo Mapa de piso (vaga XPT com aquele destino).
  const xptByInfo = x => {
    const P = window.Piso && window.Piso.helpers;
    if (!P || !P.xptWho || !x.row) return { names: '', day: '' };
    const day = reportDay() || (x.row.missingTs ? new Date(x.row.missingTs * 1000).toLocaleDateString('sv-SE', { timeZone: TZ }) : '');
    return { names: day ? P.xptWho(day, xptLabel(x)).join(', ') : '', day };
  };
  const xptBy = x => xptByInfo(x).names;
  const SITU = { avaria: ['warn', 'Avaria'], ok: ['good', 'AT no dia'], xpt: ['info', 'Outro XPT'], noat: ['bad', 'Sem AT no dia'], nomiss: ['neutral', 'Sem missing'], err: ['warn', 'Erro'], wait: ['neutral', 'Na fila'] };
  const hm = ts => (ts ? new Date(ts * 1000).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const rowsDone = () => st.results.map(code => ({ code, s: situ(code), row: (st.out.get(code) || {}).row || null, o: st.out.get(code) }));

  function drawResults() {
    const el = $('pcResults'), tn = $('pcTabN');
    if (tn) tn.innerHTML = st.results.length ? ` <b>${st.results.length}</b>` : '';
    if (!el) return;
    if (!st.results.length) {
      el.innerHTML = `<div class="au-empty"><div class="au-empty-icon">🔎</div><h2>Nenhuma consulta ainda</h2>
        <p class="muted">Em <b>Relatório de contagem</b>, filtre as linhas (ex.: Count Type = Missing) e clique em <b>Consultar rastreio</b>.
        O resultado da requisição aparece aqui.</p>
        <div class="au-empty-actions"><button class="btn-ghost" data-pc-tab="rel">Ir para o relatório</button></div></div>`;
      return;
    }
    const all = rowsDone();
    const n = k => all.filter(x => x.s === k).length;
    const done = all.filter(x => x.s !== 'wait').length;
    el.innerHTML = `
      <div class="kpis">${[
        ui.kpi('Códigos consultados', `${done}/${all.length}`, [st.run ? '<span>consultando…</span>' : '']),
        ui.kpi('Com AT no dia', H.fmt.int(n('ok')), ['<span class="pill good">✓ saiu com motorista</span>']),
        ui.kpi('De outro XPT / estação', H.fmt.int(n('xpt')), ['<span>destino do Sort Code não é o hub</span>']),
        ui.kpi('Sem AT no dia', H.fmt.int(n('noat')), [n('noat') ? '<span class="pill bad">⚠ sem AT desde 21:00 da véspera</span>' : '<span class="pill good">✓ nenhum</span>']),
        ui.kpi('Avarias', H.fmt.int(n('avaria')), ['<span>sem busca de AT</span>']),
        ui.kpi('Sem missing / erro', `${n('nomiss')} / ${n('err')}`, ['<span>no rastreio</span>']),
      ].join('')}</div>
      <div class="grid">
        ${st.run ? '' : ui.card('pcR1', 'Por motorista', 'Pacotes com AT no dia', { w: 4 })}
        ${st.run ? '' : ui.card('pcR2', 'Por gaiola', 'Pacotes com AT no dia', { w: 4 })}
        ${st.run ? '' : ui.card('pcR3', 'Por operador do missing', 'Quem marcou o missing', { w: 4 })}
        ${st.run || !n('xpt') ? '' : ui.card('pcR4', 'Pacotes de outro XPT / estação', 'Destino pelo Sort Code', { w: 12, h: 'short' })}
        ${st.run ? '' : reportCard()}
        <section class="card w12">
          <div class="card-head"><div><div class="card-title">Pacotes consultados</div><div class="card-sub" id="pcRCount"></div></div>
            <div class="card-tools"><button class="tool" data-pc="export" ${done ? '' : 'disabled'}>Exportar CSV</button>
              <button class="btn-primary solid pc-copy" data-pc="save" ${saveBlock(done) ? 'disabled' : ''}
                title="${esc(saveBlock(done) || 'Grava o resultado deste dia na planilha-base, para o histórico por operador')}">Salvar resultado</button></div></div>
          ${saveBlock(done) ? `<div class="pc-save-why">💾 ${esc(saveBlock(done))}</div>` : ''}
          <div class="pc-filters" id="pcRFilters"></div>
          <div id="pcRTable"></div>
        </section>
      </div>`;
    drawResultFilters(); drawResultTable();
    if (!st.run) {
      const okRows = all.filter(x => x.s === 'ok');
      const cnt = (list, get) => { const m = new Map(); list.forEach(x => { const v = get(x) || '(não informado)'; m.set(v, (m.get(v) || 0) + 1); }); return top([...m.entries()].sort((a, b) => b[1] - a[1])); };
      const bar = (id, data, color) => H.render(id, { labels: data.map(x => x[0]), horizontal: true, legend: false, datasets: [H.bar('Pacotes', data.map(x => x[1]), color)] });
      bar('pcR1', cnt(okRows, x => x.row.driverName), H.color(1));
      bar('pcR2', cnt(okRows, x => x.row.cage), H.color(2));
      bar('pcR3', cnt(all.filter(x => x.row && x.row.missingOperator), x => x.row.missingOperator), H.color(3));
      if (n('xpt')) bar('pcR4', cnt(all.filter(x => x.s === 'xpt'), x => xptLabel(x)), H.color(5));
      syncReport();
    }
  }

  // Filtros da tabela de resultado: todos aceitam mais de um valor ao mesmo tempo.
  const RSTATUS = [['ok', 'Com AT no dia'], ['xpt', 'Outro XPT'], ['noat', 'Sem AT no dia'], ['avaria', 'Avaria'], ['nomiss', 'Sem missing'], ['err', 'Erro']];
  const RF = { driver: ['Motorista', r => r.driverName], cage: ['Gaiola', r => r.cage], op: ['Operador do missing', r => r.missingOperator] };
  const rfVals = k => [...new Set(rowsDone().filter(x => x.row).map(x => RF[k][1](x.row)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  // Valor salvo que não existe no resultado atual não filtra nada (não esconde a tabela inteira).
  const rfActive = (k, vals = rfVals(k)) => vals.filter(v => st.rf[k].has(v));
  const rfSummary = (k, vals) => { const n = rfActive(k, vals).length; return `${RF[k][0]}${n ? ` <b>${n}</b>` : ''}`; };
  function drawResultFilters() {
    const el = $('pcRFilters');
    if (!el) return;
    el.innerHTML = `
      <input class="search" id="pcRSearch" type="search" placeholder="Buscar código, AT, motorista…" value="${esc(st.rf.q)}">
      <button class="chip ${st.rf.status.size ? '' : 'active'}" data-pc-rs="all">Todos</button>
      ${RSTATUS.map(([k, l]) => `<button class="chip ${st.rf.status.has(k) ? 'active' : ''}" data-pc-rs="${k}" aria-pressed="${st.rf.status.has(k)}">${l}</button>`).join('')}
      ${Object.keys(RF).map(k => {
        const vals = rfVals(k);
        if (!vals.length) return '';
        return `<details class="pc-filter ${rfActive(k, vals).length ? 'active' : ''}" data-rf="${k}"><summary>${rfSummary(k, vals)}</summary>
          <div class="pc-pop">
            ${vals.length > 10 ? '<input type="search" class="pc-pop-search" placeholder="Buscar valor…">' : ''}
            <div class="pc-pop-list">${vals.map(v => `<label><input type="checkbox" data-pc-rval="${esc(v)}" ${st.rf[k].has(v) ? 'checked' : ''}>
              <span class="pc-val">${esc(v)}</span></label>`).join('')}</div>
            <div class="pc-pop-foot"><button class="tool" data-pc-rnone="${k}">Limpar</button></div>
          </div></details>`;
      }).join('')}
      <button class="tool" data-pc="rclear">Limpar filtros</button>`;
  }

  function drawResultTable() {
    const el = $('pcRTable');
    if (!el) return;
    const q = st.rf.q.trim().toLowerCase();
    const act = Object.fromEntries(Object.keys(RF).map(k => [k, new Set(rfActive(k))]));
    const order = ['noat', 'err', 'avaria', 'xpt', 'nomiss', 'ok', 'wait'];
    const list = rowsDone().filter(x => {
      if (st.rf.status.size && !st.rf.status.has(x.s)) return false;
      const r = x.row || {};
      if (Object.keys(RF).some(k => act[k].size && !act[k].has(RF[k][1](r)))) return false;
      return !q || [x.code, r.atBefore, r.driverName, r.driverId, r.cage, r.missingOperator, r.damage].join(' ').toLowerCase().includes(q);
    }).sort((a, b) => order.indexOf(a.s) - order.indexOf(b.s));
    const c = $('pcRCount');
    if (c) c.textContent = `${list.length} de ${st.results.length} código(s) · os sem AT no dia aparecem primeiro`;
    const dash = '<span class="muted">—</span>';
    el.innerHTML = `<div class="table-wrap"><table class="pc-table"><thead><tr><th class="left">Código</th><th class="left">Situação</th><th class="left">Missing em</th>
        <th class="left">Operador do missing</th><th class="left">AT do dia / XPT</th><th class="left">Gaiola</th><th class="left">Motorista</th><th class="left">Observação</th><th></th></tr></thead><tbody>
      ${list.map(x => {
        const r = x.row || {}, [cls, label] = SITU[x.s];
        const note = x.s === 'err' ? 'Erro: ' + x.o.error : x.s === 'wait' ? (st.run ? 'Na fila…' : 'Não consultado') : r.note;
        return `<tr class="${x.s === 'noat' ? 'hl' : ''}"><td class="left pc-code">${esc(x.code)}</td>
          <td class="left"><span class="pill ${cls}">${label}</span></td>
          <td class="left">${hm(r.missingTs) || dash}</td><td class="left">${esc(r.missingOperator || '') || dash}</td>
          <td class="left">${x.s === 'avaria' ? '<b>Avaria</b>' : x.s === 'xpt' ? `<b>${esc(xptLabel(x))}</b>${(i => (i.names ? `<div class="small pc-xpt-by" title="Do Mapa de piso de ${esc(i.day.split('-').reverse().join('/'))}: quem estava na vaga desse XPT">🗺 Mapa de piso ${esc(i.day.split('-').reverse().slice(0, 2).join('/'))}: ${esc(i.names)}</div>` : i.day ? `<div class="small muted">Sem ninguém nesse XPT no Mapa de piso de ${esc(i.day.split('-').reverse().slice(0, 2).join('/'))}</div>` : ''))(xptByInfo(x))}` : r.atBefore ? esc(r.atBefore) : x.s === 'noat' ? '<b class="bad">Sem AT</b>' : dash}</td>
          <td class="left">${esc(r.cage || '') || dash}</td>
          <td class="left">${r.driverName ? `${esc(r.driverName)}${r.driverId ? ` <span class="muted">· ${esc(r.driverId)}</span>` : ''}` : dash}</td>
          <td class="left pc-obs">${note ? esc(note) : dash}</td>
          <td>${x.o && x.o.raw ? `<button class="tool" data-pc-json="${esc(x.code)}" title="Copiar as respostas do SPX para este código (JSON, sem cookies)">JSON</button>` : ''}</td></tr>`;
      }).join('')}
      </tbody></table></div>${list.length ? '' : ui.empty('Nenhum código com esses filtros.')}`;
  }

  // ---------- Histórico: resultados salvos na planilha-base, consolidados por operador do missing ----------
  const baseOn = () => !!(window.Base && window.Base.enabled());
  // Por que o "Salvar resultado" está desativado (vazio = pode salvar).
  function saveBlock(done) {
    const B = window.Base;
    if (!B) return 'Planilha-base indisponível.';
    if (!B.isSignedIn()) return 'Para salvar, entre com a conta Google (⚙ Conectar planilhas → Entrar com Google).';
    if (!B.enabled()) return 'Para salvar, o app precisa estar com as planilhas reais (está em dados de exemplo): ⚙ Conectar planilhas.';
    if (st.run) return 'Aguarde a consulta terminar para salvar.';
    if (!done) return 'Consulte o rastreio para ter o que salvar.';
    return '';
  }
  const brDay = iso => iso.split('-').reverse().slice(0, 2).join('/');
  // Operador que aparece como e-mail @shopee.com não é do time do hub: o pacote é salvo, mas sem operador
  // (não entra na lista de operadores para feedback).
  const skipOp = op => /@shopee\.com\s*$/i.test(String(op || ''));
  async function saveResult() {
    if (st.run || !baseOn()) return;
    const B = window.Base;
    const iso = st.rep.date || defaultDate();
    const items = rowsDone().filter(x => x.s !== 'wait' && x.s !== 'err').map(x => {
      const r = x.row || {};
      return { c: x.code, s: x.s, op: skipOp(r.missingOperator) ? '' : r.missingOperator || '', mt: r.missingTs || null, at: r.atBefore || '', cage: r.cage || '',
        dn: r.driverName || '', di: r.driverId || '', dest: x.s === 'xpt' ? xptLabel(x) : '', dmg: r.damage || '' };
    });
    if (!items.length) return ui.toast('Não há pacotes consultados para salvar.', true);
    const cur = B.parcelGet(iso);
    if (cur && !(await uiConfirm(`Já existe um resultado salvo para ${brDay(iso)} (${cur.items.length} pacotes, por ${cur.user}). Substituir pelo resultado atual (${items.length} pacotes)?`, { ok: 'Substituir' }))) return;
    try {
      await B.parcelSave(iso, items);
      const ign = rowsDone().filter(x => x.row && x.s !== 'err' && skipOp(x.row.missingOperator)).length;
      ui.toast(`Resultado de ${brDay(iso)} salvo (${items.length} pacotes${ign ? ` · ${ign} sem operador: e-mail @shopee.com ignorado` : ''})`);
    } catch (e) { ui.toast(String(e.message || e), true); }
  }
  // Registros do período escolhido no filtro do app, achatados: um item por pacote, com o dia.
  function histItems() {
    const B = window.Base, r = ui.range ? ui.range() : null;
    const days = (B ? B.parcelList() : []).filter(p => !r || (p.date >= r.from && p.date <= r.to));
    return { days, items: days.flatMap(p => p.items.map(x => ({ ...x, date: p.date, by: p.user }))) };
  }
  const HSTATUS = [['ok', 'Com AT no dia'], ['noat', 'Sem AT no dia'], ['avaria', 'Avaria'], ['xpt', 'Outro XPT'], ['nomiss', 'Sem missing']];
  const hfOps = items => [...new Set(items.map(x => x.op).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  function drawHist() {
    const el = $('pcHist');
    if (!el) return;
    if (!baseOn()) {
      el.innerHTML = `<div class="au-empty"><div class="au-empty-icon">🗂️</div><h2>Histórico indisponível</h2>
        <p class="muted">O histórico fica na planilha-base compartilhada. Ele aparece quando o app está conectado às planilhas (fora do modo de exemplo).</p></div>`;
      return;
    }
    const { days, items } = histItems();
    const r = ui.range();
    const per = r.from === r.to ? brDay(r.from) : `${brDay(r.from)} a ${brDay(r.to)}`;
    if (!items.length) {
      el.innerHTML = `<div class="au-empty"><div class="au-empty-icon">🗂️</div><h2>Nenhum resultado salvo em ${per}</h2>
        <p class="muted">Depois de consultar o rastreio, clique em <b>Salvar resultado</b> na sub-aba Rastreio. O resultado do dia fica guardado aqui,
        para todos os usuários. Para ver outros dias, mude o <b>período</b> no filtro do topo.</p></div>`;
      return;
    }
    const withOp = items.filter(x => x.op);
    const byOp = new Map();
    withOp.forEach(x => {
      const o = byOp.get(x.op) || { op: x.op, n: 0, days: new Set(), ok: 0, noat: 0, avaria: 0, xpt: 0, nomiss: 0, last: '' };
      o.n++; o.days.add(x.date); if (o[x.s] != null) o[x.s]++; if (x.date > o.last) o.last = x.date;
      byOp.set(x.op, o);
    });
    const ops = [...byOp.values()].sort((a, b) => b.n - a.n || a.op.localeCompare(b.op, 'pt-BR'));
    const n = s => items.filter(x => x.s === s).length;
    el.innerHTML = `
      <div class="kpis">${[
        ui.kpi('Dias com resultado salvo', H.fmt.int(days.length), [`<span>${per}</span>`]),
        ui.kpi('Pacotes registrados', H.fmt.int(items.length), [`<span>${H.fmt.int(n('ok'))} com AT · ${H.fmt.int(n('noat'))} sem AT</span>`]),
        ui.kpi('Operadores envolvidos', H.fmt.int(ops.length), ['<span>operador do missing</span>']),
        ui.kpi('Operador com mais pacotes', ops[0] ? esc(ops[0].op) : '—', [ops[0] ? `<span>${ops[0].n} pacote(s) em ${ops[0].days.size} dia(s)</span>` : '']),
        ui.kpi('Avarias / outro XPT', `${n('avaria')} / ${n('xpt')}`, ['<span>no período</span>']),
      ].join('')}</div>
      <div class="grid">
        ${ui.card('pcH1', 'Pacotes por operador', 'Operador do missing · período do filtro', { w: 6, h: 'tall' })}
        ${ui.card('pcH2', 'Pacotes por dia', 'Resultados salvos no período', { w: 6, h: 'tall' })}
        ${ui.card('', 'Operadores para feedback', `${ops.length} operador(es) · clique em um nome para ver os pacotes dele`, { w: 12,
          tools: '<button class="tool" data-pc="hist-copy" title="Copia a lista de operadores e quantidades">Copiar lista</button>',
          body: `<div class="table-wrap"><table class="pc-table"><thead><tr><th class="left">Operador do missing</th><th>Pacotes</th><th>Dias</th><th>Com AT</th><th>Sem AT</th><th>Avaria</th><th>Outro XPT</th><th class="left">Último dia</th></tr></thead><tbody>
            ${ops.map(o => `<tr class="${st.hf.op.has(o.op) ? 'hl' : ''}"><td class="left"><button class="link" data-pc-hop="${esc(o.op)}">${esc(o.op)}</button></td>
              <td><b>${o.n}</b></td><td>${o.days.size}</td><td>${o.ok}</td><td>${o.noat}</td><td>${o.avaria}</td><td>${o.xpt}</td><td class="left">${brDay(o.last)}</td></tr>`).join('')}
            </tbody></table></div>` })}
        <section class="card w12">
          <div class="card-head"><div><div class="card-title">Pacotes registrados</div><div class="card-sub" id="pcHCount"></div></div></div>
          <div class="pc-filters" id="pcHFilters"></div>
          <div id="pcHTable"></div>
        </section>
      </div>`;
    const topOps = top(ops.map(o => [o.op, o.n]));
    H.render('pcH1', { labels: topOps.map(x => x[0]), horizontal: true, legend: false, datasets: [H.bar('Pacotes', topOps.map(x => x[1]), H.color(1))] });
    H.render('pcH2', { labels: days.map(d => H.dayLabel(d.date)), stacked: true, datasets: HSTATUS.slice(0, 4).map(([k, l], i) =>
      H.bar(l, days.map(d => d.items.filter(x => x.s === k).length || null), [H.css('--good'), H.css('--bad'), H.color(4), H.color(2)][i])) });
    drawHistFilters(items); drawHistTable(items);
  }
  function drawHistFilters(items = histItems().items) {
    const el = $('pcHFilters');
    if (!el) return;
    const vals = hfOps(items), act = vals.filter(v => st.hf.op.has(v));
    el.innerHTML = `
      <input class="search" id="pcHSearch" type="search" placeholder="Buscar código, operador, AT, motorista…" value="${esc(st.hf.q)}">
      <button class="chip ${st.hf.status.size ? '' : 'active'}" data-pc-hs="all">Todos</button>
      ${HSTATUS.map(([k, l]) => `<button class="chip ${st.hf.status.has(k) ? 'active' : ''}" data-pc-hs="${k}" aria-pressed="${st.hf.status.has(k)}">${l}</button>`).join('')}
      <details class="pc-filter ${act.length ? 'active' : ''}" data-hf="op"><summary>Operador${act.length ? ` <b>${act.length}</b>` : ''}</summary>
        <div class="pc-pop">
          ${vals.length > 10 ? '<input type="search" class="pc-pop-search" placeholder="Buscar valor…">' : ''}
          <div class="pc-pop-list">${vals.map(v => `<label><input type="checkbox" data-pc-hval="${esc(v)}" ${st.hf.op.has(v) ? 'checked' : ''}><span class="pc-val">${esc(v)}</span></label>`).join('')}</div>
          <div class="pc-pop-foot"><button class="tool" data-pc="hclear-op">Limpar</button></div>
        </div></details>
      <button class="tool" data-pc="hclear">Limpar filtros</button>`;
  }
  function drawHistTable(items = histItems().items) {
    const el = $('pcHTable');
    if (!el) return;
    const q = st.hf.q.trim().toLowerCase();
    const ops = new Set(hfOps(items).filter(v => st.hf.op.has(v)));   // valor salvo que não existe no período não filtra
    const list = items.filter(x => (!st.hf.status.size || st.hf.status.has(x.s)) && (!ops.size || ops.has(x.op))
      && (!q || [x.c, x.op, x.at, x.dn, x.di, x.cage, x.dest, x.dmg].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || a.op.localeCompare(b.op, 'pt-BR') || a.c.localeCompare(b.c));
    const c = $('pcHCount');
    if (c) c.textContent = `${list.length} de ${items.length} pacote(s)` + (list.length > MAX_ROWS ? ` · mostrando os primeiros ${MAX_ROWS}` : '');
    const dash = '<span class="muted">—</span>';
    el.innerHTML = `<div class="table-wrap"><table class="pc-table"><thead><tr><th class="left">Dia</th><th class="left">Código</th><th class="left">Situação</th><th class="left">Operador do missing</th>
        <th class="left">Missing em</th><th class="left">AT / destino</th><th class="left">Gaiola</th><th class="left">Motorista</th><th class="left">Salvo por</th></tr></thead><tbody>
      ${list.slice(0, MAX_ROWS).map(x => {
        const [cls, label] = SITU[x.s] || SITU.nomiss;
        return `<tr><td class="left">${brDay(x.date)}</td><td class="left pc-code">${esc(x.c)}</td><td class="left"><span class="pill ${cls}">${label}</span></td>
          <td class="left">${esc(x.op) || dash}</td><td class="left">${hm(x.mt) || dash}</td>
          <td class="left">${x.s === 'avaria' ? esc(x.dmg || 'Avaria') : x.s === 'xpt' ? esc(x.dest) : esc(x.at) || dash}</td>
          <td class="left">${esc(x.cage) || dash}</td><td class="left">${x.dn ? `${esc(x.dn)}${x.di ? ` <span class="muted">· ${esc(x.di)}</span>` : ''}` : dash}</td>
          <td class="left muted">${esc(x.by)}</td></tr>`;
      }).join('')}
      </tbody></table></div>${list.length ? '' : ui.empty('Nenhum pacote com esses filtros.')}`;
  }
  function copyHist() {
    const { items } = histItems(), r = ui.range();
    const m = new Map();
    items.filter(x => x.op).forEach(x => m.set(x.op, (m.get(x.op) || 0) + 1));
    const lines = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).map(([op, k]) => `${op}\t${k}`);
    copyText([`Pacotes voadores por operador — ${r.from === r.to ? brDay(r.from) : `${brDay(r.from)} a ${brDay(r.to)}`}`, '', ...lines].join('\n'), 'Lista copiada');
  }

  // ---------- Report diário (texto pronto para copiar) ----------
  const p2 = n => String(n).padStart(2, '0');
  const city = () => (window.APP_CONFIG && window.APP_CONFIG.HUB_CITY) || 'Hub';
  function defaultDate() {
    // Dia do missing mais frequente entre os consultados; sem isso, hoje.
    const m = new Map();
    rowsDone().forEach(x => { if (x.row && x.row.missingTs) { const d = new Date(x.row.missingTs * 1000).toLocaleDateString('sv-SE', { timeZone: TZ }); m.set(d, (m.get(d) || 0) + 1); } });
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
  }
  function reportText() {
    const date = st.rep.date || defaultDate();
    const [, mm, dd] = date.split('-');
    const col = st.rep.col;
    const byCode = new Map(st.rows.map(r => [r[st.codeCol].trim().toUpperCase(), r]));
    const list = rowsDone().filter(x => x.s !== 'wait');
    const textOf = x => {
      if (x.s === 'ok') return `- ${city()} (Aguardando retorno do Driver)`;
      if (x.s === 'avaria') return 'Avaria';
      // Consulta com erro não ganha destino: fica marcada para o analista conferir antes de enviar.
      if (x.s === 'err') return '(erro na consulta — conferir)';
      // Pacote de outro XPT: sai com o destino do Sort Code (ex.: XPT-CRX-01); sem Sort Code, com o nome
      // da estação da AT (ex.: XPT_GO_Crixás), não como pacote do hub.
      if (x.s === 'xpt') return xptLabel(x);
      const extra = col >= 0 && byCode.get(x.code) ? byCode.get(x.code)[col] : '';
      return extra || 'Sem AT no dia';
    };
    // Ordem do report: sem AT primeiro, depois as avarias, os do hub e por último os XPTs (em ordem, iguais juntos).
    const grp = x => (x.s === 'xpt' ? 3 : x.s === 'ok' ? 2 : x.s === 'avaria' ? 1 : 0);
    const lines = list.map(x => ({ g: grp(x), t: textOf(x), code: x.code }))
      .sort((p, q) => p.g - q.g || p.t.localeCompare(q.t, 'pt-BR', { numeric: true }) || p.code.localeCompare(q.code))
      .map(l => `${l.code}\t${l.t}`);
    const n = list.length, e = Number(st.rep.empty) || 0;
    return [
      `Resultado do Parcel dia ${dd}/${mm}`, '',
      n ? `Tivemos ${p2(n)} ${n === 1 ? 'pacote voador/não localizado' : 'pacotes voadores/não localizados'}.` : 'Não tivemos pacotes voadores/não localizados.',
      ...(n ? ['', ...lines] : []), '',
      e ? `Tivemos ${p2(e)} ${e === 1 ? 'pacote vazio recebido' : 'pacotes vazios recebidos'}.` : 'Não tivemos pacote vazio recebido.',
    ].join('\n');
  }
  function reportCard() {
    return ui.card('', 'Report do dia', 'Texto pronto para enviar · pode editar antes de copiar', { w: 12,
      tools: '<button class="tool" data-pc="rep-reset" title="Montar o texto de novo a partir dos dados">Refazer</button><button class="btn-primary solid pc-copy" data-pc="rep-copy">Copiar report</button>',
      body: `<div class="pc-rep-opts">
          <label>Dia <input type="date" id="pcRepDate" value="${esc(st.rep.date || defaultDate())}"></label>
          <label>Pacotes vazios recebidos <input type="number" id="pcRepEmpty" min="0" value="${Number(st.rep.empty) || 0}"></label>
          <label>Texto para os sem AT (do hub) <select id="pcRepCol"><option value="-1">"Sem AT no dia"</option>
            ${st.headers.map((h, c) => (c === st.codeCol || st.hidden.has(c) ? '' : `<option value="${c}" ${c === st.rep.col ? 'selected' : ''}>coluna ${esc(h)}</option>`)).join('')}</select></label>
        </div>
        <textarea id="pcRepText" class="pc-rep-text" rows="12" spellcheck="false"></textarea>` });
  }
  function syncReport() {
    const ta = $('pcRepText');
    if (!ta) return;
    if (!st.rep.manual) st.rep.text = reportText();
    ta.value = st.rep.text;
  }

  function exportCsv() {
    // Texto que começa com = + - @ ganha um apóstrofo, para o Excel não tratar como fórmula.
    const cell = v => { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const lines = [RESULT_COLS.map(([h]) => h), ...st.results.filter(c => st.out.has(c)).map(resultCells)];
    const blob = new Blob(['﻿' + lines.map(l => l.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `parcel-rastreio-${new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace(/[: ]/g, '-')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function copyText(text, msg = 'JSON copiado') {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    ui.toast(msg);
  }

  // ---------- Consulta (no máx. 3 ao mesmo tempo; um código com erro não derruba os outros) ----------
  async function run() {
    if (st.run || !canTrack()) return;
    if (!st.session) return window.SpxSession.open(() => { st.session = true; run(); });
    const codes = targets();
    if (!codes.length) return;
    if (codes.length > 200 && !(await uiConfirm(`Consultar o rastreio de ${codes.length} códigos? Pode levar alguns minutos.`, { ok: 'Consultar' }))) return;
    const job = st.run = { total: codes.length, done: 0, cancel: false, auth: '', lastAt: Date.now() };
    st.results = codes;
    const queue = codes.slice();
    const opts = { ...cfg() };
    // Detalhe de cada AT: uma consulta por AT, reaproveitada por todos os pedidos dela (cache da sessão).
    const atOf = at => {
      if (!st.ats.has(at)) st.ats.set(at, Promise.resolve().then(() => api().parcelAt(at)).catch(() => ({ ok: false, error: 'Falha na consulta' })));
      return st.ats.get(at);
    };
    // Progresso redesenhado no máximo 4 vezes por segundo (lotes grandes não travam a tela).
    let timer = null;
    const paint = () => { clearTimeout(timer); timer = null; if (ui.isActive()) { drawBar(); drawResults(); } };
    const tick = () => { if (!timer) timer = setTimeout(paint, 250); };
    const worker = async () => {
      while (queue.length && !job.cancel) {
        const code = queue.shift();
        // Cache da sessão: código já consultado com sucesso não é consultado de novo.
        if (!(st.out.get(code) || {}).ok) {
          let r;
          if (!C.CODE_RE.test(code)) r = { ok: false, error: 'Código inválido' };
          else { try { r = await api().parcelTrack(code); } catch (e) { r = { ok: false, error: 'Falha na consulta' }; } }
          if (r.ok) {
            try {
              const info = C.extract(r.data, opts);
              const at = info.atBefore && api().parcelAt ? await atOf(info.atBefore.code) : null;
              if (at && !at.ok) st.ats.delete(info.atBefore.code);   // erro não fica em cache
              if (at && at.auth) { job.cancel = true; job.auth = at.error; }
              else st.out.set(code, { ok: true, raw: { tracking_info: r.data, assignment_task: at && at.ok ? at.data : null },
                row: C.rowOf(code, info, at && at.ok ? at.data : null, at && !at.ok ? at.error : '') });
            } catch (e) { st.out.set(code, { ok: false, error: 'Resposta do SPX em formato inesperado' }); }
          } else if (r.auth) { job.cancel = true; job.auth = r.error; }   // sessão recusada: não adianta continuar
          else st.out.set(code, { ok: false, error: r.error || 'Falha na consulta' });
        }
        job.done++; job.lastAt = Date.now();
        tick();
      }
    };
    st.tab = 'req'; persist();
    if (ui.isActive()) draw();
    // Sem avanço por um tempo: o SPX está segurando as consultas e o app espera para tentar de novo (avisa na barra).
    const watch = setInterval(() => { if (ui.isActive()) drawBar(); }, 3000);
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, codes.length) }, worker));
    clearInterval(watch);
    st.run = null;
    if (job.auth) { st.session = false; window.SpxSession.clear(); ui.toast(job.auth, true); }
    else ui.toast(job.cancel ? 'Consulta cancelada' : 'Consulta concluída');
    paint();
  }

  // A Sessão do SPX fica no cabeçalho do app (js/spx-session.js).
  window.SpxSession.onChange(on => { st.session = on; if (ui && ui.isActive()) drawBar(); });

  // ---------- Exemplo (fictício) ----------
  function demoGrid() {
    const head = ['SPX Tracking Number', 'Scanned Status', 'Expedite Tag', 'Final Status', 'Sort Code', 'Next Step Action', 'OnHold Times', 'Count Type', 'Expected', 'Operator', 'Aging Time', 'Scanned Time'];
    const types = ['Missing', 'Scanned', 'Scanned', 'Missing', 'Extra', 'Scanned'], ops = ['ana.exemplo', 'bruno.exemplo', 'carla.exemplo'];
    return [head, ...Array.from({ length: 24 }, (_, i) => {
      const t = types[i % types.length];
      return [`BR00000000${String(1001 + i)}`, t === 'Missing' ? 'Not Scanned' : 'Scanned', i % 5 ? '' : 'Expedite', t === 'Missing' ? 'LMHub_Received' : 'LMHub_Assigned',
        `GO-${'ABC'[i % 3]}-${10 + (i % 4)}`, t === 'Missing' ? 'Investigate' : 'Deliver', String(i % 3), t, 'Yes', ops[i % 3], `${1 + (i % 4)}d`,
        t === 'Missing' ? '' : `2026-10-01 0${6 + (i % 3)}:${String(10 + i).padStart(2, '0')}:00`];
    })];
  }

  // ---------- Eventos ----------
  function bindOnce() {
    if (bound) return;
    bound = true;
    const main = ui.main;
    main.addEventListener('click', e => {
      if (!ui.isActive()) return;
      const t = e.target.closest('[data-pc],[data-pc-none],[data-pc-json],[data-pc-rs],[data-pc-rnone],[data-pc-tab],[data-pc-hs],[data-pc-hop]');
      if (!t) return;
      const d = t.dataset;
      if (d.pcTab) { setTab(d.pcTab); return; }
      if (d.pcHs) {
        if (d.pcHs === 'all') st.hf.status.clear();
        else if (!st.hf.status.delete(d.pcHs)) st.hf.status.add(d.pcHs);
        persist(); drawHistFilters(); drawHistTable(); return;
      }
      // Clique no nome do operador: liga/desliga o filtro dele na tabela de pacotes.
      if (d.pcHop) { if (!st.hf.op.delete(d.pcHop)) st.hf.op.add(d.pcHop); persist(); drawHist(); return; }
      if (d.pc === 'save') { saveResult(); return; }
      if (d.pc === 'hist-copy') { copyHist(); return; }
      if (d.pc === 'hclear-op') { st.hf.op.clear(); persist(); drawHist(); return; }
      if (d.pc === 'hclear') { st.hf.q = ''; st.hf.status.clear(); st.hf.op.clear(); persist(); drawHist(); return; }
      if (d.pcRs) {
        // "Todos" limpa; os demais ligam/desligam, e dá para deixar vários ligados.
        if (d.pcRs === 'all') st.rf.status.clear();
        else if (!st.rf.status.delete(d.pcRs)) st.rf.status.add(d.pcRs);
        persist(); drawResultFilters(); drawResultTable(); return;
      }
      if (d.pcRnone) { st.rf[d.pcRnone].clear(); persist(); drawResultFilters(); drawResultTable(); return; }
      if (d.pcJson) { copyText(JSON.stringify((st.out.get(d.pcJson) || {}).raw, null, 2)); return; }
      if (d.pcNone != null) { delete st.filters[d.pcNone]; persist(); applyFilters(); drawFilters(); drawTable(); drawBar(); drawDash(); }
      else if (d.pc === 'import') { $('pcFile').value = ''; $('pcFile').click(); }
      else if (d.pc === 'demo') setData('exemplo-contagem.tsv', demoGrid(), true);
      else if (d.pc === 'run') run();
      else if (d.pc === 'cancel') { if (st.run) { st.run.cancel = true; drawBar(); } }
      else if (d.pc === 'export') exportCsv();
      else if (d.pc === 'rclear') { st.rf.q = ''; RF_SETS.forEach(k => st.rf[k].clear()); persist(); drawResultFilters(); drawResultTable(); }
      else if (d.pc === 'rep-copy') { const ta = $('pcRepText'); if (ta) copyText(ta.value, 'Report copiado'); }
      else if (d.pc === 'rep-reset') { st.rep.manual = false; syncReport(); }
      else if (d.pc === 'clear') { st.filters = {}; st.search = ''; persist(); applyFilters(); drawFilters(); drawTable(); drawBar(); drawDash(); }
      else if (d.pc === 'only-missing') {
        const mk = missingShortcut(), cur = st.filters[mk.c];
        if (cur && cur.size === 1 && cur.has(mk.v)) delete st.filters[mk.c]; else st.filters[mk.c] = new Set([mk.v]);
        persist(); applyFilters(); drawFilters(); drawTable(); drawBar(); drawDash();
      }
    });
    main.addEventListener('change', e => {
      if (!ui.isActive()) return;
      const t = e.target, d = t.dataset;
      if (d.pcHval != null) {
        if (t.checked) st.hf.op.add(d.pcHval); else st.hf.op.delete(d.pcHval);
        const box = t.closest('.pc-filter'), k = hfOps(histItems().items).filter(v => st.hf.op.has(v)).length;
        box.classList.toggle('active', k > 0);
        box.querySelector('summary').innerHTML = `Operador${k ? ` <b>${k}</b>` : ''}`;
        persist(); drawHistTable(); return;
      }
      if (d.pcRval != null) {
        // O painel continua aberto: só a tabela e o contador do filtro são redesenhados.
        const box = t.closest('.pc-filter'), k = box.dataset.rf;
        if (t.checked) st.rf[k].add(d.pcRval); else st.rf[k].delete(d.pcRval);
        box.classList.toggle('active', rfActive(k).length > 0);
        box.querySelector('summary').innerHTML = rfSummary(k);
        persist(); drawResultTable(); return;
      }
      if (t.id === 'pcRepDate') { st.rep.date = t.value; st.rep.manual = false; syncReport(); return; }
      if (t.id === 'pcRepEmpty') { st.rep.empty = Math.max(0, parseInt(t.value, 10) || 0); st.rep.manual = false; syncReport(); return; }
      if (t.id === 'pcRepCol') { st.rep.col = +t.value; st.rep.manual = false; syncReport(); return; }
      if (t.id === 'pcAll') {
        st.selected = st.selected.size === st.view.length ? new Set() : new Set(st.view);
        drawTable(); drawBar();
      } else if (d.pcRow != null) {
        if (t.checked) st.selected.add(+d.pcRow); else st.selected.delete(+d.pcRow);
        refreshSelection();
      } else if (d.pcVal != null) {
        // O painel do filtro continua aberto: só a tabela e o contador são redesenhados.
        const box = t.closest('.pc-filter'), c = box.dataset.col;
        const set = st.filters[c] || (st.filters[c] = new Set());
        if (t.checked) set.add(d.pcVal); else set.delete(d.pcVal);
        box.classList.toggle('active', set.size > 0);
        box.querySelector('summary').innerHTML = summaryHtml(c);
        persist(); applyFilters(); drawTable(); drawBar(); drawDash();
      }
    });
    main.addEventListener('input', e => {
      if (!ui.isActive()) return;
      if (e.target.id === 'pcSearch') { st.search = e.target.value; persist(); applyFilters(); drawTable(); drawBar(); drawDash(); }
      else if (e.target.id === 'pcHSearch') { st.hf.q = e.target.value; persist(); drawHistTable(); }
      else if (e.target.id === 'pcRSearch') { st.rf.q = e.target.value; persist(); drawResultTable(); }
      else if (e.target.id === 'pcRepText') { st.rep.text = e.target.value; st.rep.manual = true; }
      else if (e.target.classList.contains('pc-pop-search')) {
        const q = e.target.value.trim().toLowerCase();
        e.target.parentNode.querySelectorAll('.pc-pop-list label').forEach(l => { l.hidden = !!q && !l.textContent.toLowerCase().includes(q); });
      }
    });
    // Só um painel de filtro aberto por vez; clicar fora fecha.
    main.addEventListener('toggle', e => {
      if (e.target.open && e.target.classList.contains('pc-filter'))
        main.querySelectorAll('.pc-filter[open]').forEach(x => { if (x !== e.target) x.open = false; });
    }, true);
    document.addEventListener('click', e => {
      main.querySelectorAll('.pc-filter[open]').forEach(x => { if (!x.contains(e.target)) x.open = false; });
    });
    // Arrastar e soltar o arquivo na tela
    main.addEventListener('dragover', e => { if (ui.isActive()) { e.preventDefault(); main.classList.add('dragging'); } });
    main.addEventListener('dragleave', e => { if (e.target === main) main.classList.remove('dragging'); });
    main.addEventListener('drop', e => {
      if (!ui.isActive()) return;
      main.classList.remove('dragging');
      e.preventDefault();
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && !st.run) loadFile(file);
    });

    $('pcFile').addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });
  }

  return { render };
})();
