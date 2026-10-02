// Aba "Parcel": importa o relatório de contagem do hub (TSV/CSV/XLSX), filtra por coluna e consulta o
// rastreio de cada código no SPX (operador do missing, AT anterior e motorista). Nada é gravado:
// relatório, resultados e sessão do SPX ficam só na memória, até fechar o app.
window.Parcel = (() => {
  const C = window.ParcelCore;
  const esc = window.Charts.esc;
  const api = () => window.hubApi || null;
  const canTrack = () => !!(api() && api().parcelTrack);
  const MAX_ROWS = 300;       // linhas desenhadas na tabela (o filtro e a consulta valem para todas)
  const MAX_DISTINCT = 300;   // colunas com mais valores distintos que isso não ganham filtro
  const CONCURRENCY = 3;
  const TZ = 'America/Sao_Paulo';

  const st = { file: '', demo: false, headers: [], rows: [], codeCol: 0, distinct: [], filters: {}, search: '', view: [],
    selected: new Set(), session: false, out: new Map(), ats: new Map(), results: [], run: null };
  let ui = null, bound = false;
  const $ = id => document.getElementById(id);
  const cfg = () => (window.APP_CONFIG && window.APP_CONFIG.PARCEL) || {};

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
    const width = Math.max(...grid.map(r => r.length));
    st.file = name; st.demo = demo;
    st.headers = Array.from({ length: width }, (_, i) => grid[0][i] || `Coluna ${i + 1}`);
    st.rows = grid.slice(1).map(r => Array.from({ length: width }, (_, i) => r[i] || ''));
    const k = st.headers.findIndex(h => /spx tracking number/i.test(h));
    st.codeCol = k >= 0 ? k : 0;
    st.distinct = st.headers.map((_, i) => {
      if (i === st.codeCol) return null;
      const m = new Map();
      for (const r of st.rows) { m.set(r[i], (m.get(r[i]) || 0) + 1); if (m.size > MAX_DISTINCT) return null; }
      return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR', { numeric: true }));
    });
    st.filters = {}; st.search = ''; st.selected = new Set(); st.results = [];
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
    if (canTrack()) { st.session = await api().parcelHasSession(); if (ui.isActive()) drawBar(); }
  }

  function draw() {
    const m = ui.main;
    if (!st.rows.length) {
      m.innerHTML = ui.head('Parcel', 'Relatório de contagem · rastreio no SPX') + `
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
      <div class="grid">
        <section class="card w12"><div class="pc-filters" id="pcFilters"></div><div id="pcTable"></div></section>
        <div class="pc-results" id="pcResults"></div>
      </div>`;
    drawBar(); drawFilters(); drawTable(); drawResults();
  }

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
          <span><b>${run.done}</b> de ${run.total}${errors ? ` · ${errors} erro(s)` : ''}</span>
          <button class="tool danger" data-pc="cancel" ${run.cancel ? 'disabled' : ''}>${run.cancel ? 'Cancelando…' : 'Cancelar'}</button>
        </div>` : `<div class="au-bar-right pc-actions">
          ${canTrack() ? `<button class="btn-ghost pc-session" data-pc="session" title="Sessão do SPX usada na consulta (fica só na memória)">
            <span class="conn-dot ${st.session ? 'ok' : ''}"></span>Sessão SPX: ${st.session ? 'ativa' : 'não informada'}</button>` : ''}
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
        ${st.headers.map(h => `<th class="left">${esc(h)}</th>`).join('')}</tr></thead><tbody>
        ${st.view.slice(0, MAX_ROWS).map(i => `<tr><td><input type="checkbox" data-pc-row="${i}" aria-label="Selecionar linha" ${st.selected.has(i) ? 'checked' : ''}></td>
          ${st.rows[i].map((v, c) => `<td class="left${c === st.codeCol ? ' pc-code' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}
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

  // ---------- Resultado ----------
  const RESULT_COLS = [
    ['Código', r => r.code],
    ['Operador do missing', r => r.missingOperator],
    ['AT anterior', r => r.atBefore],
    ['Gaiola', r => r.cage],
    ['ID do motorista', r => r.driverId],
    ['Nome do motorista', r => r.driverName],
    ['Observação/erro', r => r.note],
  ];
  const resultCells = code => {
    const o = st.out.get(code);
    const blank = Array(RESULT_COLS.length - 2).fill('');
    if (!o) return [code, ...blank, st.run ? 'Na fila…' : 'Não consultado'];
    if (!o.ok) return [code, ...blank, 'Erro: ' + o.error];
    return RESULT_COLS.map(([, get]) => get(o.row) || '');
  };

  function drawResults() {
    const el = $('pcResults');
    if (!el) return;
    if (!st.results.length) { el.innerHTML = ''; return; }
    const done = st.results.filter(c => st.out.has(c));
    const errors = done.filter(c => !st.out.get(c).ok).length;
    el.innerHTML = ui.card('', 'Resultado do rastreio', `${st.results.length} código(s) · ${done.length - errors} consultado(s) · ${errors} erro(s)`, {
      w: 12, tools: `<button class="tool" data-pc="export" ${done.length ? '' : 'disabled'}>Exportar CSV</button>`,
      body: `<div class="table-wrap"><table class="pc-table"><thead><tr>${RESULT_COLS.map(([h]) => `<th class="left">${esc(h)}</th>`).join('')}<th></th></tr></thead><tbody>
        ${st.results.map(code => {
          const o = st.out.get(code), cells = resultCells(code);
          return `<tr class="${o && !o.ok ? 'hl' : ''}">${cells.map((v, i) => `<td class="left${i === 0 ? ' pc-code' : ''}${i === cells.length - 1 ? ' pc-obs' : ''}">${v ? esc(v) : '<span class="muted">—</span>'}</td>`).join('')}
            <td>${o && o.raw ? `<button class="tool" data-pc-json="${esc(code)}" title="Copiar as respostas do SPX para este código: rastreio e detalhe da AT (JSON, sem cookies)">Copiar JSON</button>` : ''}</td></tr>`;
        }).join('')}
      </tbody></table></div>` });
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

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    ui.toast('JSON copiado');
  }

  // ---------- Consulta (no máx. 3 ao mesmo tempo; um código com erro não derruba os outros) ----------
  async function run() {
    if (st.run || !canTrack()) return;
    if (!st.session) return openSession(true);
    const codes = targets();
    if (!codes.length) return;
    if (codes.length > 200 && !confirm(`Consultar o rastreio de ${codes.length} códigos? Pode levar alguns minutos.`)) return;
    const job = st.run = { total: codes.length, done: 0, cancel: false, auth: '' };
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
        job.done++;
        tick();
      }
    };
    paint();
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, codes.length) }, worker));
    st.run = null;
    if (job.auth) { st.session = false; api().parcelClearSession(); ui.toast(job.auth, true); }
    else ui.toast(job.cancel ? 'Consulta cancelada' : 'Consulta concluída');
    paint();
  }

  // ---------- Sessão do SPX (cURL colado pelo usuário; fica só na memória do app) ----------
  let runAfterSession = false;
  const pcMsg = (t, ok) => { $('pcMsg').textContent = t; $('pcMsg').className = 'settings-msg ' + (t ? (ok ? 'ok' : 'err') : ''); };
  function openSession(thenRun = false) {
    runAfterSession = thenRun;
    $('pcCurl').value = '';
    pcMsg(st.session ? 'Há uma sessão ativa. Cole um cURL novo para trocar.' : '', true);
    $('pcForget').hidden = !st.session;
    $('parcelDlg').showModal();
  }
  async function saveSession() {
    const text = $('pcCurl').value;
    if (!text.trim()) return pcMsg('Cole o cURL copiado do SPX.', false);
    const r = await api().parcelSetSession(text);
    $('pcCurl').value = '';
    if (!r.ok) return pcMsg(r.error, false);
    st.session = true;
    $('parcelDlg').close();
    ui.toast('Sessão do SPX ativa (só na memória)');
    drawBar();
    if (runAfterSession) run();
  }

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
      const t = e.target.closest('[data-pc],[data-pc-none],[data-pc-json]');
      if (!t) return;
      const d = t.dataset;
      if (d.pcJson) { copyText(JSON.stringify((st.out.get(d.pcJson) || {}).raw, null, 2)); return; }
      if (d.pcNone != null) { delete st.filters[d.pcNone]; applyFilters(); drawFilters(); drawTable(); drawBar(); }
      else if (d.pc === 'import') { $('pcFile').value = ''; $('pcFile').click(); }
      else if (d.pc === 'demo') setData('exemplo-contagem.tsv', demoGrid(), true);
      else if (d.pc === 'session') openSession();
      else if (d.pc === 'run') run();
      else if (d.pc === 'cancel') { if (st.run) { st.run.cancel = true; drawBar(); } }
      else if (d.pc === 'export') exportCsv();
      else if (d.pc === 'clear') { st.filters = {}; st.search = ''; applyFilters(); drawFilters(); drawTable(); drawBar(); }
      else if (d.pc === 'only-missing') {
        const mk = missingShortcut(), cur = st.filters[mk.c];
        if (cur && cur.size === 1 && cur.has(mk.v)) delete st.filters[mk.c]; else st.filters[mk.c] = new Set([mk.v]);
        applyFilters(); drawFilters(); drawTable(); drawBar();
      }
    });
    main.addEventListener('change', e => {
      if (!ui.isActive()) return;
      const t = e.target, d = t.dataset;
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
        applyFilters(); drawTable(); drawBar();
      }
    });
    main.addEventListener('input', e => {
      if (!ui.isActive()) return;
      if (e.target.id === 'pcSearch') { st.search = e.target.value; applyFilters(); drawTable(); drawBar(); }
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
    $('pcSaveSession').addEventListener('click', saveSession);
    $('pcForget').addEventListener('click', async () => {
      await api().parcelClearSession();
      st.session = false;
      $('parcelDlg').close();
      ui.toast('Sessão do SPX esquecida');
      drawBar();
    });
  }

  return { render };
})();
