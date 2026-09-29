(() => {
  const C = window.APP_CONFIG;
  const META = C.METAS;
  const H = window.Charts;
  const f = H.fmt;
  const esc = H.esc;

  const LS = {
    get(k, d) { try { const v = localStorage.getItem('hub.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hub.' + k, v); } catch (e) { /* armazenamento indisponível */ } },
  };

  const state = {
    model: null, sheetName: '', demo: false, updatedAt: null, loading: false,
    from: 0, to: 0, ref: 0,
    tab: LS.get('tab', 'overview'), maMode: 'T1', missMode: 'T3', hseSearch: '',
    timer: null, tvTimer: null,
  };

  const ICONS = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    recebimento: '<path d="M1 4h14v12H1zM15 9h4l3 3v4h-7z"/><circle cx="5.5" cy="18" r="2"/><circle cx="18.5" cy="18" r="2"/>',
    pessoas: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 21a7 7 0 0 0-4-6.3"/>',
    inventario: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
    reversa: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    transporte: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/>',
    audit: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 13l2 2 4-4"/>',
    qualidade: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.5"/>',
    hse: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    rpP1: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><circle cx="12" cy="15" r="3"/><path d="M12 13.5V15l1 .8"/>',
    rpF1: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 15l2 2 4-4"/>',
    rpAll: '<path d="M4 4h16v16H4z"/><path d="M4 10h16M10 10v10M15 10v10"/>',
    report: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>',
  };
  const TABS = [
    { id: 'overview', group: 'Operação', label: 'Visão geral', daily: true, render: renderOverview },
    { id: 'recebimento', group: 'Operação', label: 'Recebimento', daily: true, render: renderRecebimento },
    { id: 'pessoas', group: 'Operação', label: 'HC & PHD', daily: true, render: renderPessoas },
    { id: 'inventario', group: 'Operação', label: 'Inventário', daily: true, render: renderInventario },
    { id: 'reversa', group: 'Operação', label: 'Reversa', daily: true, render: renderReversa },
    { id: 'transporte', group: 'Operação', label: 'Transporte', daily: true, render: renderTransporte },
    { id: 'audit', group: 'Qualidade', label: 'Audit de gestão', daily: true, render: () => window.Audit.render(uiCtx) },
    { id: 'qualidade', group: 'Qualidade', label: 'Missing (planilha)', daily: false, render: renderQualidade },
    { id: 'hse', group: 'Segurança', label: 'HSE', daily: false, render: renderHSE },
    { id: 'rpP1', group: 'Reports', label: 'Parcial T1', daily: true, report: true, render: () => window.Reports.render('rpP1', rpCtx) },
    { id: 'rpF1', group: 'Reports', label: 'Fechamento T1', daily: true, report: true, render: () => window.Reports.render('rpF1', rpCtx) },
    { id: 'rpP3', group: 'Reports', label: 'Parcial T3', daily: true, report: true, render: () => window.Reports.render('rpP3', rpCtx) },
    { id: 'rpF3', group: 'Reports', label: 'Fechamento T3', daily: true, report: true, render: () => window.Reports.render('rpF3', rpCtx) },
    { id: 'rpAll', group: 'Reports', label: 'Report Geral', daily: true, report: true, render: () => window.Reports.render('rpAll', rpCtx) },
  ];


  const $ = id => document.getElementById(id);
  const main = $('main');

  // ================= Dados =================
  // No aplicativo desktop, window.hubApi (electron/preload.js) lê a planilha pela API do Google.
  // Fora do app (ex.: navegador), só o modo demonstração está disponível.
  const api = window.hubApi || null;
  const cleanErr = err => String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const monthName = key => { const [y, m] = key.split('-'); return `${MONTHS[+m - 1]} ${y}`; };
  const shortMonth = key => { const [y, m] = key.split('-'); return `${MONTHS[+m - 1].slice(0, 3).toLowerCase()}/${y.slice(2)}`; };

  // Links configurados ({ 'AAAA-MM': link }). Um link antigo (antes da lista de meses) vale para o mês atual.
  const configuredMonths = cfg => {
    const months = { ...(cfg.months || {}) };
    if (!Object.keys(months).length && cfg.spreadsheetUrl) months[ym(new Date())] = cfg.spreadsheetUrl;
    return months;
  };

  // Lê uma planilha (um mês).
  async function fetchOne(url) {
    try { return await api.fetchSheets(Object.values(C.SHEETS), { spreadsheetUrl: url }); }
    catch (err) { throw new Error(cleanErr(err)); }
  }

  // Lê todos os meses configurados. Mês atual e anterior sempre vêm da planilha;
  // os demais usam a cópia guardada, a menos que "full" (recarregar tudo) seja pedido.
  async function fetchData({ full = false } = {}) {
    if (!api || LS.get('demo', '') === '1') return { model: window.buildModel(window.SAMPLE_DATA), demo: true, sources: [] };
    const cfg = await api.getConfig();
    const months = configuredMonths(cfg);
    const keys = Object.keys(months).sort();
    if (!cfg.hasKey || !keys.length) return { model: window.buildModel(window.SAMPLE_DATA), demo: true, sources: [] };

    const now = new Date();
    const hot = new Set([ym(now), ym(new Date(now.getFullYear(), now.getMonth() - 1, 1))]);
    const sources = [];
    const models = [];
    for (const key of keys) {
      const src = { month: key, url: months[key], ok: false, cached: false, name: '', error: '' };
      let data = null;
      const cached = api.cacheGet ? await api.cacheGet(key) : null;
      const sameLink = cached && cached.url === months[key];
      if (!full && sameLink && !hot.has(key)) { data = cached.data; src.cached = true; }
      else {
        try {
          data = await fetchOne(months[key]);
          if (api.cacheSet) await api.cacheSet(key, { url: months[key], fetchedAt: new Date().toISOString(), data });
        } catch (err) {
          src.error = err.message;
          if (sameLink) { data = cached.data; src.cached = true; }
        }
      }
      if (data) {
        const m = window.buildModel(data);
        m.monthKey = key;
        src.ok = true; src.name = data.spreadsheet || ''; src.days = m.dates.length;
        if (m.dates.length) models.push(m);
      }
      sources.push(src);
    }
    if (!models.length) {
      const e = sources.find(x => x.error);
      throw new Error(e ? `${monthName(e.month)}: ${e.error}` : 'Nenhuma planilha com dados.');
    }
    return { model: window.mergeModels(models), demo: false, sources };
  }

  async function refresh({ silent = false, full = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    setStatus('loading', full ? 'Recarregando todos os meses…' : 'Atualizando…');
    $('btnRefresh').classList.add('loading');
    try {
      const { model, demo, sources } = await fetchData({ full });
      if (window.Base) { await window.Base.ready; window.Base.setActive(!demo); await window.Base.load(true); }
      state.model = model;
      state.demo = demo;
      state.sources = sources;
      state.updatedAt = new Date();
      initRange();
      $('demoBanner').hidden = !demo;
      const okMonths = sources.filter(x => x.ok);
      const bad = sources.filter(x => x.error);
      state.sheetName = demo ? '' : okMonths.length === 1 ? okMonths[0].name : `${okMonths.length} meses conectados`;
      setConn(demo ? 'demo' : bad.length ? 'err' : 'ok', demo ? 'Usando dados de exemplo'
        : bad.length ? `${okMonths.length} ok · ${bad.length} com erro` : state.sheetName);
      setStatus(bad.length ? 'err' : 'ok', (bad.length ? 'Atualizado com avisos às ' : 'Atualizado às ') + state.updatedAt.toLocaleTimeString('pt-BR'));
      const span = okMonths.length ? `${shortMonth(okMonths[0].month)} a ${shortMonth(okMonths[okMonths.length - 1].month)}` : '';
      $('footInfo').textContent = demo
        ? `Fonte: dados de exemplo · leitura em ${state.updatedAt.toLocaleString('pt-BR')}`
        : `Fonte: ${okMonths.length} planilha(s) (${span}) · ${state.model.dates.length} dias · leitura em ${state.updatedAt.toLocaleString('pt-BR')}`;
      const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#rpStage');
      if (!typing) renderAll();
      if (bad.length) toast(`${bad.length} mês(es) com erro: ${bad.map(x => `${monthName(x.month)} — ${x.error}`).join(' · ')}`, true);
      else if (!silent) toast(demo ? 'Dados de exemplo carregados' : full ? 'Todos os meses recarregados' : 'Dados atualizados da planilha');
    } catch (err) {
      console.error(err);
      setStatus('err', 'Falha ao atualizar');
      setConn('err', 'Erro ao ler a planilha');
      toast(err.message, true);
      if (!state.model) main.innerHTML = `<div class="empty">Não foi possível carregar os dados.<br>${esc(err.message)}<br><br>
        <button class="btn-primary solid" data-open-conn>Conectar planilhas</button></div>`;
    } finally {
      state.loading = false;
      $('btnRefresh').classList.remove('loading');
    }
  }

  // ================= Período =================
  const hasVal = v => v != null && v !== 0;
  // Último dia com dados dentro do intervalo (volume recebido define o "último dia fechado").
  function lastDataIdx(m, lo = 0, hi = m.dates.length - 1) {
    const i = dataIdx(m, lo, hi);
    return i >= 0 ? i : hi;
  }
  // Último dia com dados no intervalo, ou -1 se não houver nenhum.
  function dataIdx(m, lo = 0, hi = m.dates.length - 1) {
    for (const a of [m.rec.total, m.tr.rotas, m.inv.total, m.hc.total.presente])
      for (let i = hi; i >= lo; i--) if (hasVal(a[i])) return i;
    return -1;
  }
  const applyRef = () => { state.ref = lastDataIdx(state.model, state.from, state.to); };

  // O intervalo fica salvo (por data) para continuar igual ao trocar de tela ou reabrir o app.
  function saveRange() {
    const d = state.model.dates;
    LS.set('range', JSON.stringify({ from: d[state.from], to: d[state.to] }));
  }
  function initRange() {
    const d = state.model.dates, n = d.length;
    let saved = null;
    try { saved = JSON.parse(LS.get('range', 'null')); } catch (e) { saved = null; }
    const f = saved ? d.indexOf(saved.from) : -1, t = saved ? d.indexOf(saved.to) : -1;
    if (f >= 0 && t >= f) { state.from = f; state.to = t; }
    else {
      // Padrão: o mês do último dia com dados.
      const last = lastDataIdx(state.model), mY = d[last].slice(3);
      state.from = d.findIndex(x => x.slice(3) === mY);
      state.to = d.length - 1 - [...d].reverse().findIndex(x => x.slice(3) === mY);
    }
    applyRef();
    fillFilters();
  }
  function setRange(from, to) {
    state.from = Math.min(from, to); state.to = Math.max(from, to);
    applyRef(); saveRange(); fillFilters(); renderAll();
  }

  // ---- Seletor de intervalo (calendário) ----
  const range = { open: false, pick: null, hover: null, view: null };
  function fillFilters() {
    const d = state.model.dates;
    if (!d.length) return;
    const n = state.to - state.from + 1;
    $('rangeLabel').textContent = `${d[state.from]} – ${d[state.to]}`;
    $('rangeDays').textContent = `${n} ${n === 1 ? 'dia' : 'dias'}`;
    $('refInfo').innerHTML = dataIdx(state.model, state.from, state.to) < 0
      ? '<span class="bad">Sem dados lançados no período</span>'
      : `Indicadores do dia <b>${d[state.ref]}</b> <span class="muted">· último dia com dados no período</span>`;
    if (range.open) drawCalendar();
  }
  function drawCalendar() {
    const d = state.model.dates;
    const vol = state.model.rec.total;
    const index = new Map(d.map((x, i) => [x, i]));
    const months = [...new Set(d.map(x => x.slice(3)))];
    if (!months.includes(range.view)) range.view = d[state.to].slice(3);
    const vi = months.indexOf(range.view);
    const lo = range.pick != null ? Math.min(range.pick, range.hover ?? range.pick) : state.from;
    const hi = range.pick != null ? Math.max(range.pick, range.hover ?? range.pick) : state.to;
    const wk = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
    $('rangeCal').innerHTML = [range.view].map(mY => {
      const [mm, yy] = mY.split('/').map(Number);
      const first = new Date(yy, mm - 1, 1), days = new Date(yy, mm, 0).getDate();
      const cells = [];
      for (let k = 0; k < first.getDay(); k++) cells.push('<span></span>');
      for (let dd = 1; dd <= days; dd++) {
        const key = `${String(dd).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${yy}`;
        const i = index.get(key);
        if (i == null) { cells.push(`<span class="cd off">${dd}</span>`); continue; }
        const cls = ['cd', i >= lo && i <= hi ? 'in' : '', i === lo ? 'start' : '', i === hi ? 'end' : '', hasVal(vol[i]) ? 'data' : ''].join(' ');
        cells.push(`<button class="${cls}" data-day="${i}" title="${key}${hasVal(vol[i]) ? '' : ' · sem volume'}">${dd}</button>`);
      }
      const name = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase());
      return `<div class="cal-month"><div class="cal-nav">
          <button class="cal-arrow" data-cal-nav="-1" ${vi <= 0 ? 'disabled' : ''} aria-label="Mês anterior">‹</button>
          <div class="cal-title">${name}</div>
          <button class="cal-arrow" data-cal-nav="1" ${vi >= months.length - 1 ? 'disabled' : ''} aria-label="Próximo mês">›</button>
        </div><div class="cal-grid">${wk.map(w => `<span class="wd">${w}</span>`).join('')}${cells.join('')}</div></div>`;
    }).join('');
    $('rangeHint').innerHTML = range.pick != null
      ? `Início: <b>${d[range.pick]}</b> — agora clique no dia final.`
      : 'Clique no dia inicial e depois no dia final. <span class="dot-data"></span> = dia com volume.';
  }
  function openRange(on) {
    range.open = on; range.pick = null; range.hover = null; range.view = null;
    $('rangePop').hidden = !on;
    $('rangeBtn').setAttribute('aria-expanded', String(on));
    if (on) drawCalendar();
  }
  const idx = () => { const a = []; for (let i = state.from; i <= state.to; i++) a.push(i); return a; };
  const sl = arr => (arr || []).slice(state.from, state.to + 1);
  const labels = () => sl(state.model.dates).map(d => d.slice(0, 5));
  const vals = arr => sl(arr).filter(v => v != null);
  const sum = arr => vals(arr).reduce((s, v) => s + v, 0);
  const avgPos = arr => { const v = vals(arr).filter(x => x > 0); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const avg = arr => { const v = vals(arr); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const ratio = (a, b) => (b ? a / b : null);
  function prevIdx(arr, i) { for (let k = i - 1; k >= 0; k--) if (hasVal(arr[k])) return k; return -1; }
  const refLabel = () => state.model.dates[state.ref] || '';

  // ================= Componentes =================
  // Dia de referência da aba: último dia do período com dado na série principal dela
  // (ex.: o Inventário usa o último dia com inventário lançado), e atualiza o texto ao lado do filtro.
  function tabRef(arr) {
    let k = -1;
    for (let j = state.to; j >= state.from; j--) if (hasVal(arr[j])) { k = j; break; }
    const i = k >= 0 ? k : state.ref;
    if (dataIdx(state.model, state.from, state.to) >= 0)
      $('refInfo').innerHTML = k >= 0
        ? `Indicadores do dia <b>${state.model.dates[i]}</b> <span class="muted">· último dia com dados desta tela no período</span>`
        : '<span class="bad">Esta tela não tem dados lançados no período</span>';
    return i;
  }
  function delta(cur, arr, i) {
    const p = prevIdx(arr, i);
    if (!cur || p < 0 || !arr[p]) return '';
    const d = (cur - arr[p]) / arr[p];
    const cls = d > 0.0005 ? 'up' : d < -0.0005 ? 'down' : '';
    return `<span class="delta ${cls}" title="vs ${state.model.dates[p]}">${f.pct(Math.abs(d))}</span><span class="muted">vs ${state.model.dates[p].slice(0, 5)}</span>`;
  }
  function status(ok, text) {
    if (ok == null) return '';
    return `<span class="pill ${ok ? 'good' : 'bad'}">${ok ? '✓' : '⚠'} ${text}</span>`;
  }
  const kpi = (label, value, subs = []) =>
    `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value" title="${esc(value)}">${value}</div>
     <div class="kpi-sub">${subs.filter(Boolean).join('')}</div></div>`;
  const sub = t => `<span>${t}</span>`;

  function card(id, title, subtitle = '', { w = 6, h = '', tools = '', body = null } = {}) {
    const canvas = body == null
      ? `<div class="chart-box ${h}"><canvas id="${id}" role="img" aria-label="${esc(title)}"></canvas></div><div class="data-table" data-for="${id}"></div>`
      : body;
    const tbl = body == null ? `<button class="tool" data-table-toggle="${id}" title="Ver dados em tabela">Tabela</button>` : '';
    return `<section class="card w${w}"><div class="card-head"><div><div class="card-title">${title}</div>
      ${subtitle ? `<div class="card-sub">${subtitle}</div>` : ''}</div><div class="card-tools">${tools}${tbl}</div></div>${canvas}</section>`;
  }
  const head = (title, right = '') => `<div class="section-title"><h1>${title}</h1><div class="muted">${right}</div></div>`;
  const periodText = () => ''; // o período e o dia de referência já aparecem na barra do filtro
  const empty = msg => `<div class="empty">${msg}</div>`;

  // ================= Render =================
  function renderTabs() {
    const m = state.model;
    const miss = m && m.missing.T3 ? m.missing.T3.reduce((s, r) => s + r.missing, 0) : 0;
    let group = '';
    $('tabs').innerHTML = TABS.map(t => {
      const g = t.group !== group ? `<div class="nav-group">${t.group}</div>` : '';
      group = t.group;
      return `${g}<button class="nav-item" data-tab="${t.id}" aria-current="${t.id === state.tab ? 'page' : 'false'}" title="${t.label}">
        <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[t.id] || ICONS[{ rpP3: 'rpP1', rpF3: 'rpF1' }[t.id]]}</svg><span class="nav-label">${t.label}</span>
        ${t.id === 'qualidade' && miss ? `<span class="badge" title="Missing T3">${miss}</span>` : ''}</button>`;
    }).join('');
  }

  // Contexto usado pelos reports de turno (js/reports.js): o dia do report é o dia de referência do filtro.
  const rpCtx = {
    main, empty, model: () => state.model, dayIdx: () => state.ref,
    setDay: i => { const n = state.model.dates.length; const k = Math.max(0, Math.min(n - 1, i)); setRange(k, k); },
    isActive: id => state.tab === id,
    toast: (...a) => toast(...a),
  };

  // Contexto usado pela aba Audit (js/audit.js).
  const uiCtx = {
    main, kpi, card, head, sub, status, empty, esc, meta: META,
    toast: (...a) => toast(...a), rerender: () => renderAll(), isActive: () => state.tab === 'audit',
    // Período do filtro em AAAA-MM-DD, e atalhos para mudar o filtro a partir da aba Audit.
    range: () => { const d = state.model.dates, iso = x => x.split('/').reverse().join('-'); return { from: iso(d[state.from]), to: iso(d[state.to]) }; },
    setDayIso: iso => uiCtx.setPeriodIso(iso, iso),
    setPeriodIso: (a, b) => {
      const d = state.model.dates.map(x => x.split('/').reverse().join('-'));
      const i = d.findIndex(x => x >= a), j = d.length - 1 - [...d].reverse().findIndex(x => x <= b);
      if (i >= 0 && j >= i) setRange(i, j); else { toast('Esse dia está fora dos meses conectados.', true); renderAll(); }
    },
  };

  function renderAll() {
    if (!state.model) return;
    if (!TABS.some(t => t.id === state.tab)) state.tab = 'overview';
    renderTabs();
    const tab = TABS.find(t => t.id === state.tab);
    $('filters').classList.toggle('hidden', !tab.daily);
    document.body.classList.toggle('report-mode', !!tab.report);
    document.body.classList.toggle('audit-mode', tab.id === 'audit');
    H.destroyAll();
    H.applyDefaults();
    tab.render();
    // Período sem nenhum lançamento: avisa e oferece ir para o último dia com dados.
    if (tab.daily && !tab.report && tab.id !== 'audit' && dataIdx(state.model, state.from, state.to) < 0) {
      const last = dataIdx(state.model);
      main.insertAdjacentHTML('afterbegin', `<div class="no-data"><span>📭 Não há dados lançados nas guias entre <b>${state.model.dates[state.from]}</b> e <b>${state.model.dates[state.to]}</b>.</span>
        ${last >= 0 ? `<button class="btn-primary solid" data-goto-last="${last}">Ver o último dia com dados (${state.model.dates[last]})</button>` : ''}</div>`);
    }
  }

  // ---------- Visão geral ----------
  function renderOverview() {
    const m = state.model, i = tabRef(state.model.rec.total), n = idx().length;
    const r = m.rec, t = m.hc.total, tr = m.tr;
    const pctAbsDay = ratio(t.abs[i] || 0, t.presente[i]);
    const tdpAged = m.inv.total[i] ? m.inv.aging.slice(2).reduce((s, a) => s + (a.data[i] || 0), 0) / m.inv.total[i] : null;

    main.innerHTML = head('Visão geral', periodText()) +
      `<div class="kpis">${[
        kpi('Volume recebido', f.int(r.total[i]), [delta(r.total[i], r.total, i),
          r.aderencia[i] != null ? status(r.aderencia[i] >= META.aderenciaMin, `${f.pct(r.aderencia[i])} do projetado`) : '']),
        kpi('Volume no período', f.int(sum(r.total)), [sub(`Média ${f.int(avgPos(r.total))}/dia`)]),
        kpi('Packed XPT', f.int(r.packedXpt[i]), [sub(`${f.pct(r.pctXpt[i])} do volume`)]),
        kpi('HC presente', f.int(t.presente[i]), [sub(`AM ${f.int(m.hc.am.presente[i])} · PM ${f.int(m.hc.pm.presente[i])}`),
          pctAbsDay != null ? status(pctAbsDay <= META.absMax, `ABS ${f.pct(pctAbsDay)}`) : '']),
        kpi('PHD', f.int(m.phd.phd[i]), [delta(m.phd.phd[i], m.phd.phd, i), sub(`Média diária ${f.int(avgPos(m.phd.phd))}`)]),
        kpi('Rotas', f.int(tr.rotas[i]), [delta(tr.rotas[i], tr.rotas, i), sub(`SPR ${f.dec(tr.spr[i])}`)]),
        kpi('DS', f.pct(tr.ds[i], 2), [tr.ds[i] != null ? status(tr.ds[i] >= META.dsMin, `meta ${f.pct(META.dsMin, 0)}`) : '']),
        kpi('DS D0', f.pct(tr.dsD0[i], 2), [tr.dsD0[i] != null ? status(tr.dsD0[i] >= META.dsD0Min, `meta ${f.pct(META.dsD0Min, 0)}`) : '']),
        kpi('Inventário TDP', f.int(m.inv.total[i]), [sub(`${f.pct(tdpAged)} com 3+ dias`)]),
        kpi('Macro Aging T1', f.int(m.inv.ma.T1.total[i]), [sub(`Backlog ${f.int(m.inv.ma.T1.backlog[i])} · Lost ${f.int(m.inv.ma.T1.lost[i])}`)]),
        kpi('On Hold', f.int(m.rev.onHold[i]), [delta(m.rev.onHold[i], m.rev.onHold, i), sub(`Retorno SOC ${f.int(m.rev.retornoSoc[i])}`)]),
      ].join('')}</div>
      <div class="grid">
        ${card('ovVolume', 'Volume real × projetado', 'Recebimento total por dia', { w: 8 })}
        ${card('ovDs', 'DS e DS D0', 'Linhas tracejadas = metas', { w: 4 })}
        ${card('ovHc', 'HC presente por turno', 'Pessoas presentes (AM + PM)')}
        ${card('ovInv', 'Inventário TDP por aging', 'Mais escuro = mais antigo')}
        ${card('ovResumo', 'Resumo do período', 'Equivalente ao “Acumulado Mês” da guia Gerencial', { w: 12, body: resumoTable() })}
      </div>`;

    H.render('ovVolume', { labels: labels(), totals: false, datasets: [
      H.bar('Vol real', sl(r.total), H.color(1)),
      H.line('Vol projetado', sl(r.projetado), H.color(2)),
    ] });
    H.render('ovDs', { labels: labels(), yFormat: v => f.pct(v, 0), tooltipFormat: v => f.pct(v, 2), yMin: dsMin(), yMax: 1, datasets: [
      H.line('DS', sl(tr.ds), H.color(2)),
      H.line('DS D0', sl(tr.dsD0), H.color(1)),
      H.ref(`Meta DS ${f.pct(META.dsMin, 0)}`, META.dsMin, n, H.color(2)),
      H.ref(`Meta D0 ${f.pct(META.dsD0Min, 0)}`, META.dsD0Min, n, H.color(1)),
    ] });
    H.render('ovHc', { labels: labels(), stacked: true, totals: true, datasets: [
      H.bar('AM', sl(m.hc.am.presente), H.color(2)),
      H.bar('PM', sl(m.hc.pm.presente), H.color(1)),
    ] });
    renderAgingChart('ovInv');
  }
  function dsMin() {
    const v = [...vals(state.model.tr.ds), ...vals(state.model.tr.dsD0)];
    const lo = Math.min(...v, META.dsD0Min);
    return Math.max(0, Math.floor((lo - 0.02) * 50) / 50);
  }

  function resumoTable() {
    const m = state.model, i = state.ref, t = m.hc.total;
    const rows = [
      ['Volume', f.int(sum(m.rec.total)), f.int(m.rec.total[i])],
      ['Vol projetado', f.int(sum(m.rec.projetado)), f.int(m.rec.projetado[i])],
      ['Packed XPT', f.int(sum(m.rec.packedXpt)), f.int(m.rec.packedXpt[i])],
      ['% ABS', f.pct(ratio(sum(t.abs), sum(t.presente))), f.pct(ratio(t.abs[i] || 0, t.presente[i]))],
      ['ABS', f.int(sum(t.abs)), f.int(t.abs[i])],
      ['% DW', f.pct(ratio(sum(t.diaristas), sum(t.presente))), f.pct(ratio(t.diaristas[i] || 0, t.presente[i]))],
      ['DW', f.int(sum(t.diaristas)), f.int(t.diaristas[i])],
      ['PHD (média)', f.int(avgPos(m.phd.phd)), f.int(m.phd.phd[i])],
      ['ON Hold', f.int(sum(m.rev.onHold)), f.int(m.rev.onHold[i])],
      ['Avaria HUB', f.int(sum(m.rev.avariaHub)), f.int(m.rev.avariaHub[i])],
      ['Avaria SOC', f.int(sum(m.rev.avariaSoc)), f.int(m.rev.avariaSoc[i])],
      ['Retorno SOC', f.int(sum(m.rev.retornoSoc)), f.int(m.rev.retornoSoc[i])],
      ['Rotas', f.int(sum(m.tr.rotas)), f.int(m.tr.rotas[i])],
      ['ATs no piso', f.int(sum(m.tr.ats)), f.int(m.tr.ats[i])],
      ['SPR (média)', f.dec(avgPos(m.tr.spr)), f.dec(m.tr.spr[i])],
      ['DS (média)', f.pct(avg(m.tr.ds), 2), f.pct(m.tr.ds[i], 2)],
      ['DS D0 (média)', f.pct(avg(m.tr.dsD0), 2), f.pct(m.tr.dsD0[i], 2)],
    ];
    return `<div class="table-wrap full"><table><thead><tr><th>Indicador</th><th>Período</th><th>${refLabel()}</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderAgingChart(id) {
    const m = state.model;
    H.render(id, { labels: labels(), stacked: true, totals: true,
      datasets: m.inv.aging.map((a, k) => H.bar(a.name, sl(a.data), H.seq(k + 1))) });
  }

  // ---------- Recebimento ----------
  function renderRecebimento() {
    const m = state.model, r = m.rec, i = tabRef(m.rec.total), n = idx().length;
    const projDays = idx().filter(k => r.projetado[k]);
    const adPer = ratio(projDays.reduce((s, k) => s + (r.total[k] || 0), 0), projDays.reduce((s, k) => s + r.projetado[k], 0));
    main.innerHTML = head('Recebimento', periodText()) +
      `<div class="kpis">${[
        kpi(`Recebido em ${refLabel().slice(0, 5)}`, f.int(r.total[i]), [delta(r.total[i], r.total, i)]),
        kpi('AM / PM', `${f.compact(r.am[i])} / ${f.compact(r.pm[i])}`, [sub(`AM ${f.pct(ratio(r.am[i] || 0, r.total[i]))} do dia`)]),
        kpi('Total no período', f.int(sum(r.total)), [sub(`Média ${f.int(avgPos(r.total))}/dia`)]),
        kpi('Aderência à projeção', f.pct(adPer), [adPer != null ? status(adPer >= META.aderenciaMin, `meta ${f.pct(META.aderenciaMin, 0)}`) : '', sub(`${projDays.length} dias com projeção`)]),
        kpi('Packed XPT no período', f.int(sum(r.packedXpt)), [sub(`${f.pct(ratio(sum(r.packedXpt), sum(r.total)))} do volume`)]),
        kpi('XPT carregado', f.int(r.xptCarregado[i]), [sub(`em ${refLabel().slice(0, 5)}`)]),
      ].join('')}</div>
      <div class="grid">
        ${card('rcStack', 'Recebimento AM + PM', 'Volume por turno; número acima da barra = total do dia', { w: 12, h: 'tall' })}
        ${card('rcProj', 'Volume real × projetado')}
        ${card('rcAd', 'Aderência à projeção', `Vol real ÷ Vol projetado · meta ${f.pct(META.aderenciaMin, 0)}`)}
        ${card('rcXpt', 'Packed XPT', 'Pacotes XPT por dia')}
        ${card('rcXptPct', '% XPT D+1', 'Packed XPT ÷ volume recebido')}
      </div>`;
    H.render('rcStack', { labels: labels(), stacked: true, totals: true, datasets: [
      H.bar('Recebimento AM', sl(r.am), H.color(2)),
      H.bar('Recebimento PM', sl(r.pm), H.color(1)),
    ] });
    H.render('rcProj', { labels: labels(), datasets: [
      H.bar('Vol real', sl(r.total), H.color(1)),
      H.line('Vol projetado', sl(r.projetado), H.color(2)),
    ] });
    const ad = sl(r.aderencia);
    const low = v => v != null && v < META.aderenciaMin;
    H.render('rcAd', { labels: labels(), yFormat: v => f.pct(v, 0), stacked: true, datasets: [
      H.bar('Dentro da meta', ad.map(v => low(v) ? null : v), H.color(3)),
      H.bar('Abaixo da meta', ad.map(v => low(v) ? v : null), H.css('--bad')),
      H.ref('100%', 1, n),
      H.ref(`Meta ${f.pct(META.aderenciaMin, 0)}`, META.aderenciaMin, n, H.css('--bad')),
    ] });
    H.render('rcXpt', { labels: labels(), datasets: [H.bar('Packed XPT', sl(r.packedXpt), H.color(5))] });
    H.render('rcXptPct', { labels: labels(), yFormat: v => f.pct(v, 0), tooltipFormat: v => f.pct(v, 2),
      datasets: [H.line('% XPT D+1', sl(r.pctXpt), H.color(3)),
                 H.ref(`Média ${f.pct(ratio(sum(r.packedXpt), sum(r.total)))}`, ratio(sum(r.packedXpt), sum(r.total)), n)] });
  }

  // ---------- HC & PHD ----------
  function renderPessoas() {
    const m = state.model, t = m.hc.total, i = tabRef(m.hc.total.presente), n = idx().length;
    const absPer = ratio(sum(t.abs), sum(t.presente));
    const dwPer = ratio(sum(t.diaristas), sum(t.presente));
    main.innerHTML = head('HC & Produtividade', periodText()) +
      `<div class="kpis">${[
        kpi('HC planejado', f.int(m.hc.planejado), [sub('acumulado do mês (guia HC)')]),
        kpi('HC presente', f.int(t.presente[i]), [sub(`AM ${f.int(m.hc.am.presente[i])} · PM ${f.int(m.hc.pm.presente[i])}`), delta(t.presente[i], t.presente, i)]),
        kpi('% ABS no período', f.pct(absPer), [absPer != null ? status(absPer <= META.absMax, `meta ≤ ${f.pct(META.absMax, 0)}`) : '', sub(`${f.int(sum(t.abs))} ausências`)]),
        kpi('% DW no período', f.pct(dwPer), [sub(`${f.int(sum(t.diaristas))} diárias`)]),
        kpi('PHD', f.int(m.phd.phd[i]), [delta(m.phd.phd[i], m.phd.phd, i), sub(`Média diária ${f.int(avgPos(m.phd.phd))}`)]),
        kpi('Quadro (HC)', f.int(t.hc[i]), [sub(`Desligados ${f.int(t.desligado[i])} · Afast. ${f.int(t.afastamento[i])}`)]),
      ].join('')}</div>
      <div class="grid">
        ${card('hcTurno', 'HC presente por turno', 'AM × PM')}
        ${card('hcAbs', '% ABS diário', `Ausências ÷ HC presente · meta ≤ ${f.pct(META.absMax, 0)}`)}
        ${card('hcComp', 'Composição das ausências', 'HC TOTAL: quem do quadro não estava na operação', { w: 12 })}
        ${card('phd', 'PHD diário', 'Pacotes por hora/pessoa · tracejado = média', { w: 8 })}
        ${card('phdWeek', 'PHD semanal', 'Guia PHD', { w: 4 })}
        ${card('hcQuadro', 'Quadro × presentes', 'HC total do quadro e presentes no dia')}
        ${card('hcDw', 'Diaristas', 'Diaristas por turno')}
      </div>`;
    H.render('hcTurno', { labels: labels(), datasets: [
      H.line('AM', sl(m.hc.am.presente), H.color(2)), H.line('PM', sl(m.hc.pm.presente), H.color(1)),
    ] });
    const pa = sl(t.pctAbs);
    const high = v => v != null && v > META.absMax;
    H.render('hcAbs', { labels: labels(), yFormat: v => f.pct(v, 0), tooltipFormat: v => f.pct(v, 2), stacked: true, datasets: [
      H.bar('Dentro da meta', pa.map(v => high(v) ? null : v), H.color(3)),
      H.bar('Acima da meta', pa.map(v => high(v) ? v : null), H.css('--bad')),
      H.ref(`Meta ${f.pct(META.absMax, 0)}`, META.absMax, n, H.css('--bad')),
    ] });
    H.render('hcComp', { labels: labels(), stacked: true, totals: true, datasets: [
      H.bar('ABS', sl(t.abs), H.color(1)), H.bar('DSR', sl(t.dsr), H.color(2)), H.bar('Férias', sl(t.ferias), H.color(3)),
      H.bar('Desligado', sl(t.desligado), H.color(4)), H.bar('Afastamento', sl(t.afastamento), H.color(5)),
    ] });
    const media = avgPos(m.phd.phd);
    H.render('phd', { labels: labels(), datasets: [
      H.bar('PHD', sl(m.phd.phd), H.color(1)), H.ref(`Média ${f.int(media)}`, media, n),
    ] });
    const w = m.phd.semanas.filter(s => s.phd != null);
    const wb = document.getElementById('phdWeek').closest('.chart-box');
    if (w.length) H.render('phdWeek', { labels: w.map(s => s.semana), datasets: [H.bar('PHD', w.map(s => s.phd), H.color(1))] });
    else wb.innerHTML = empty('Sem PHD semanal preenchido');
    H.render('hcQuadro', { labels: labels(), datasets: [
      H.line('Quadro (HC)', sl(t.hc), H.color(2)), H.line('Presentes', sl(t.presente), H.color(1)),
    ] });
    H.render('hcDw', { labels: labels(), stacked: true, datasets: [
      H.bar('Diaristas AM', sl(m.hc.dwAM), H.color(2)), H.bar('Diaristas PM', sl(m.hc.dwPM), H.color(1)),
    ] });
  }

  // ---------- Inventário ----------
  function renderInventario() {
    const m = state.model, i = tabRef(m.inv.total), inv = m.inv, ma = inv.ma[state.maMode];
    const aged3 = inv.aging.slice(2).reduce((s, a) => s + (a.data[i] || 0), 0);
    const toggle = ['T1', 'T3'].map(k => `<button class="tool ${state.maMode === k ? 'active' : ''}" data-ma="${k}">${k}</button>`).join('');
    main.innerHTML = head('Inventário', periodText()) +
      `<div class="kpis">${[
        kpi('Inventário TDP', f.int(inv.total[i]), [delta(inv.total[i], inv.total, i)]),
        kpi('0 dias', f.int(inv.aging[0].data[i]), [sub(`${f.pct(ratio(inv.aging[0].data[i] || 0, inv.total[i]))} do total`)]),
        kpi('1 - 2 dias', f.int(inv.aging[1].data[i]), [sub(`${f.pct(ratio(inv.aging[1].data[i] || 0, inv.total[i]))} do total`)]),
        kpi('3+ dias', f.int(aged3), [inv.total[i] ? status(aged3 === 0, aged3 === 0 ? 'sem aging' : `${f.pct(ratio(aged3, inv.total[i]))} do total`) : '']),
        kpi(`Macro Aging ${state.maMode}`, f.int(ma.total[i]), [sub(`Backlog ${f.int(ma.backlog[i])} · Em rota ${f.int(ma.emRota[i])}`)]),
        kpi(`Lost confirmado ${state.maMode}`, f.int(ma.lost[i]), [sub(`Período: ${f.int(sum(ma.lost))}`)]),
      ].join('')}</div>
      <div class="grid">
        ${card('invAging', 'TDP inventário por aging', 'Pacotes no HUB por tempo parado · mais escuro = mais antigo', { w: 12, h: 'tall' })}
        ${card('invMa', `Abertura Macro Aging — ${state.maMode}`, 'Pacotes por status', { w: 12, tools: toggle })}
        ${card('invMaCmp', 'Macro Aging total: T1 × T3')}
        ${card('invAged', '% do inventário com 1+ dia', 'Quanto do TDP não saiu no mesmo dia')}
      </div>`;
    renderAgingChart('invAging');
    H.render('invMa', { labels: labels(), stacked: true, totals: true, datasets: [
      H.bar('Backlog', sl(ma.backlog), H.color(2)), H.bar('Em Rota', sl(ma.emRota), H.color(3)),
      H.bar('Enviado ao SOC', sl(ma.enviadoSoc), H.color(4)), H.bar('Sem Rastreio', sl(ma.semRastreio), H.color(5)),
      H.bar('Lost Confirmado', sl(ma.lost), H.color(6)),
    ] });
    H.render('invMaCmp', { labels: labels(), datasets: [
      H.line('MA T1', sl(inv.ma.T1.total), H.color(1)), H.line('MA T3', sl(inv.ma.T3.total), H.color(2)),
    ] });
    H.render('invAged', { labels: labels(), yFormat: v => f.pct(v, 0), datasets: [
      H.line('% com 1+ dia', sl(inv.total.map((tot, k) => tot ? (tot - (inv.aging[0].data[k] || 0)) / tot : null)), H.color(1)),
    ] });
  }

  // ---------- Reversa ----------
  function renderReversa() {
    const m = state.model, rv = m.rev, i = tabRef(m.rev.onHold), n = idx().length;
    main.innerHTML = head('Reversa', periodText()) +
      `<div class="kpis">${[
        kpi('On Hold', f.int(rv.onHold[i]), [delta(rv.onHold[i], rv.onHold, i), sub(`Período ${f.int(sum(rv.onHold))}`)]),
        kpi('Retorno SOC (período)', f.int(sum(rv.retornoSoc)), [sub(`${vals(rv.retornoSoc).filter(v => v > 0).length} envios`)]),
        kpi('Avaria HUB (período)', f.int(sum(rv.avariaHub)), [sub(`${f.int(rv.avariaHub[i])} em ${refLabel().slice(0, 5)}`)]),
        kpi('Avaria SOC (período)', f.int(sum(rv.avariaSoc)), [sub(`${f.int(rv.avariaSoc[i])} em ${refLabel().slice(0, 5)}`)]),
        kpi('Avarias por 10 mil recebidos', f.dec(ratio(sum(rv.avariaHub) + sum(rv.avariaSoc), sum(m.rec.total)) * 10000, 1), [sub('HUB + SOC ÷ volume')]),
      ].join('')}</div>
      <div class="grid">
        ${card('rvHold', 'On Hold', 'Pacotes em On Hold por dia · tracejado = média')}
        ${card('rvRet', 'Retorno SOC', 'Pacotes devolvidos ao SOC')}
        ${card('rvAv', 'Avarias: HUB × SOC', 'Quantidade por dia', { w: 12 })}
      </div>`;
    const mh = avgPos(rv.onHold);
    H.render('rvHold', { labels: labels(), datasets: [H.bar('ON Hold', sl(rv.onHold), H.color(2)), H.ref(`Média ${f.int(mh)}`, mh, n)] });
    H.render('rvRet', { labels: labels(), datasets: [H.bar('Retorno SOC', sl(rv.retornoSoc), H.color(1))] });
    H.render('rvAv', { labels: labels(), datasets: [
      H.bar('Avaria HUB', sl(rv.avariaHub), H.color(2)), H.bar('Avaria SOC', sl(rv.avariaSoc), H.color(1)),
    ] });
  }

  // ---------- Transporte ----------
  function renderTransporte() {
    const m = state.model, tr = m.tr, i = tabRef(m.tr.rotas), n = idx().length;
    const mr = avgPos(tr.rotas);
    main.innerHTML = head('Transporte', periodText()) +
      `<div class="kpis">${[
        kpi('Rotas', f.int(tr.rotas[i]), [delta(tr.rotas[i], tr.rotas, i)]),
        kpi('Rotas no período', f.int(sum(tr.rotas)), [sub(`Média ${f.int(mr)}/dia`)]),
        kpi('SPR', f.dec(tr.spr[i]), [sub(`Média ${f.dec(avgPos(tr.spr))}`)]),
        kpi('DS', f.pct(tr.ds[i], 2), [tr.ds[i] != null ? status(tr.ds[i] >= META.dsMin, `meta ${f.pct(META.dsMin, 0)}`) : '', sub(`Média ${f.pct(avg(tr.ds), 2)}`)]),
        kpi('DS D0', f.pct(tr.dsD0[i], 2), [tr.dsD0[i] != null ? status(tr.dsD0[i] >= META.dsD0Min, `meta ${f.pct(META.dsD0Min, 0)}`) : '', sub(`Média ${f.pct(avg(tr.dsD0), 2)}`)]),
        kpi('ATs no piso (período)', f.int(sum(tr.ats)), [sub(`${f.int(tr.ats[i])} em ${refLabel().slice(0, 5)}`)]),
      ].join('')}</div>
      <div class="grid">
        ${card('trRotas', 'Rotas por dia', 'Tracejado = média do período', { w: 8 })}
        ${card('trAts', 'ATs no piso', 'Quantidade por dia', { w: 4 })}
        ${card('trSpr', 'SPR', 'Pacotes por rota')}
        ${card('trDs', 'DS e DS D0', 'Linhas tracejadas = metas')}
      </div>`;
    H.render('trRotas', { labels: labels(), datasets: [H.bar('Rotas', sl(tr.rotas), H.color(2)), H.ref(`Média ${f.int(mr)}`, mr, n)] });
    H.render('trAts', { labels: labels(), datasets: [H.bar('ATs no piso', sl(tr.ats), H.color(1))] });
    H.render('trSpr', { labels: labels(), yFormat: v => f.dec(v, 0), tooltipFormat: v => f.dec(v, 1),
      yMin: Math.max(0, Math.floor((Math.min(...vals(tr.spr)) - 10) / 10) * 10),
      datasets: [H.line('SPR', sl(tr.spr), H.color(3))] });
    H.render('trDs', { labels: labels(), yFormat: v => f.pct(v, 0), tooltipFormat: v => f.pct(v, 2), yMin: dsMin(), yMax: 1, datasets: [
      H.line('DS', sl(tr.ds), H.color(2)), H.line('DS D0', sl(tr.dsD0), H.color(1)),
      H.ref(`Meta DS ${f.pct(META.dsMin, 0)}`, META.dsMin, n, H.color(2)),
      H.ref(`Meta D0 ${f.pct(META.dsD0Min, 0)}`, META.dsD0Min, n, H.color(1)),
    ] });
  }

  // ---------- Missing ----------
  function renderQualidade() {
    const rows = state.model.missing[state.missMode] || [];
    const toggle = ['T3', 'T1'].map(k => `<button class="chip ${state.missMode === k ? 'active' : ''}" data-miss="${k}">Missing ${k}</button>`).join('');
    if (!rows.length) { main.innerHTML = head('Missing', toggle) + empty(`Guia ${C.SHEETS['missing' + state.missMode]} sem dados.`); return; }
    const tot = k => rows.reduce((s, r) => s + r[k], 0);
    const initial = tot('initial'), missing = tot('missing'), missorted = tot('missorted');
    const pctMiss = ratio(missing, initial);
    const mins = rows.map(r => r.minutes).filter(v => v != null);
    const avgMin = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : null;
    const starts = rows.map(r => r.start).filter(Boolean), ends = rows.map(r => r.end).filter(Boolean);
    const t0 = starts.length ? new Date(Math.min(...starts)) : null, t1 = ends.length ? new Date(Math.max(...ends)) : null;
    const hhmm = d => d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
    const day = t0 ? t0.toLocaleDateString('pt-BR') : '';

    const byCorr = [...rows].sort((a, b) => a.corridor.localeCompare(b.corridor, 'pt-BR', { numeric: true }));
    const ops = new Map();
    rows.forEach(r => {
      const o = ops.get(r.operator) || { nome: r.operator, ats: 0, pedidos: 0, missing: 0, missorted: 0, min: 0, nMin: 0 };
      o.ats++; o.pedidos += r.initial; o.missing += r.missing; o.missorted += r.missorted;
      if (r.minutes != null) { o.min += r.minutes; o.nMin++; }
      ops.set(r.operator, o);
    });
    const opList = [...ops.values()].sort((a, b) => b.missing - a.missing || b.ats - a.ats);
    const byHour = new Map();
    rows.forEach(r => { if (!r.start) return; const h = r.start.getHours(); byHour.set(h, (byHour.get(h) || 0) + 1); });
    const hours = [...byHour.keys()].sort((a, b) => a - b);

    main.innerHTML = head(`Missing ${state.missMode}`, `<div class="chips">${toggle}</div>`) +
      `<div class="kpis">${[
        kpi('ATs validadas', f.int(rows.length), [sub(`${day} · ${hhmm(t0)} → ${hhmm(t1)}`)]),
        kpi('Pedidos (inicial)', f.int(initial), [sub(`${f.int(tot('scanned'))} escaneados`)]),
        kpi('Missing', f.int(missing), [status(pctMiss <= META.missingMax, `${f.pct(pctMiss, 2)} dos pedidos`)]),
        kpi('Missorted', f.int(missorted), [sub(`${f.pct(ratio(missorted, initial), 2)} dos pedidos`)]),
        kpi('ATs com missing', f.int(rows.filter(r => r.missing > 0).length), [sub(`de ${rows.length} ATs`)]),
        kpi('Tempo médio / AT', avgMin == null ? '—' : f.dec(avgMin, 1) + ' min', [sub(`${ops.size} operadores`)]),
      ].join('')}</div>
      <div class="grid">
        ${card('msCorr', 'Missing e missorted por corredor', 'Cada barra = uma AT/corredor', { w: 12 })}
        ${card('msOps', 'Operadores', 'Ordenado por missing', { w: 8, body: `<div class="table-wrap"><table><thead><tr>
          <th>Operador</th><th>ATs</th><th>Pedidos</th><th>Missing</th><th>Missorted</th><th>% Missing</th><th>Min/AT</th></tr></thead><tbody>
          ${opList.map(o => `<tr><td>${esc(o.nome)}</td><td>${o.ats}</td><td>${f.int(o.pedidos)}</td><td>${o.missing}</td><td>${o.missorted}</td>
          <td>${f.pct(ratio(o.missing, o.pedidos), 2)}</td><td>${o.nMin ? f.dec(o.min / o.nMin, 1) : '—'}</td></tr>`).join('')}
          </tbody></table></div>` })}
        ${card('msHour', 'ATs validadas por hora', 'Hora de início da validação', { w: 4 })}
        ${card('msList', 'Todas as ATs', 'Linhas destacadas têm missing', { w: 12, body: `<div class="table-wrap"><table><thead><tr>
          <th>AT/TO</th><th class="left">Corredor</th><th>Inicial</th><th>Final</th><th>Escaneado</th><th>Missorted</th><th>Missing</th>
          <th>Início</th><th>Fim</th><th>Min</th><th class="left">Operador</th><th class="left">Status</th></tr></thead><tbody>
          ${[...rows].sort((a, b) => b.missing - a.missing || (a.start || 0) - (b.start || 0)).map(r => `<tr class="${r.missing ? 'hl' : ''}">
            <td>${esc(r.at)}</td><td class="left">${esc(r.corridor)}</td><td>${r.initial}</td><td>${r.final}</td><td>${r.scanned}</td>
            <td>${r.missorted}</td><td><b>${r.missing}</b></td><td>${hhmm(r.start)}</td><td>${hhmm(r.end)}</td>
            <td>${r.minutes == null ? '—' : f.dec(r.minutes, 1)}</td><td class="left">${esc(r.operator)}</td><td class="left">${esc(r.status)}</td></tr>`).join('')}
          </tbody></table></div>` })}
      </div>`;
    H.render('msCorr', { labels: byCorr.map(r => r.corridor), stacked: true, datasets: [
      H.bar('Missing', byCorr.map(r => r.missing), H.color(1)), H.bar('Missorted', byCorr.map(r => r.missorted), H.color(2)),
    ] });
    H.render('msHour', { labels: hours.map(h => `${String(h).padStart(2, '0')}h`), datasets: [H.bar('ATs', hours.map(h => byHour.get(h)), H.color(1))] });
  }

  // ---------- HSE ----------
  function renderHSE() {
    const hse = state.model.hse;
    if (!hse) { main.innerHTML = head('HSE') + empty(`Guia ${C.SHEETS.hse} não encontrada.`); return; }
    const ppl = hse.people;
    const count = (arr, fn) => arr.reduce((m, x) => { const k = fn(x) || '—'; m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());
    const byLider = count(ppl, p => p.lider);
    const lideres = [...byLider.keys()].sort((a, b) => byLider.get(b) - byLider.get(a));
    const contratos = [...count(ppl, p => p.contrato).keys()];
    const isDone = s => /realizad|ok|conclu/i.test(s);
    const pend = ppl.filter(p => p.status && !isDone(p.status)).length;
    const sw = hse.checklists[0];
    const swDone = sw ? sw.items.filter(x => isDone(x.status)).length : 0;
    const pillFor = s => !s ? '<span class="pill neutral">—</span>' : isDone(s) ? `<span class="pill good">✓ ${esc(s)}</span>` : `<span class="pill warn">⏳ ${esc(s)}</span>`;

    const checklistCards = hse.checklists.map(cl => {
      const done = cl.items.filter(x => isDone(x.status)).length;
      const withStatus = cl.items.filter(x => x.status).length;
      const pct = withStatus ? done / withStatus : 0;
      return card('', esc(cl.title), withStatus ? `${done}/${withStatus} realizados` : `${cl.items.length} itens`, { w: 3, body:
        `${withStatus ? `<div class="progress"><span style="width:${pct * 100}%"></span></div>` : ''}
         <ul class="checklist">${cl.items.map(x => `<li><span class="name" title="${esc(x.nome)}">${esc(x.nome)}</span>${x.status ? pillFor(x.status) : ''}</li>`).join('')}</ul>` });
    }).join('');

    const gin = hse.ginastica.length ? `<div class="table-wrap"><table><thead><tr><th>Turno</th>${hse.ginastica[0].semanas.map(s => `<th>${esc(s.semana)}</th>`).join('')}</tr></thead>
      <tbody>${hse.ginastica.map(g => `<tr><td>${esc(g.turno)}</td>${g.semanas.map(s => `<td>${pillFor(s.status)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : empty('Sem dados');

    const dds = hse.dds.rows.length ? `<div class="cal" style="--n:${hse.dds.dates.length}"><div></div>${hse.dds.dates.map(d => `<div class="d">${d.slice(0, 2)}</div>`).join('')}
      ${hse.dds.rows.map(r => `<div>${esc(r.turno)}</div>${r.values.map((v, k) => `<div class="c ${!v ? '' : isDone(v) ? 'good' : 'warn'}" title="${esc(hse.dds.dates[k])}: ${esc(v || 'sem registro')}">${!v ? '' : isDone(v) ? '✓' : '!'}</div>`).join('')}`).join('')}
      </div><div class="card-sub" style="margin-top:8px">✓ realizado · ! pendente · vazio = sem registro · mês ${esc((hse.dds.dates[0] || '').slice(3))}</div>` : empty('Sem dados de DDS');

    const q = state.hseSearch.toLowerCase();
    const filtered = ppl.filter(p => !q || Object.values(p).join(' ').toLowerCase().includes(q));

    main.innerHTML = head('HSE — Saúde, Segurança e Meio Ambiente', `${ppl.length} colaboradores na guia ${C.SHEETS.hse}`) +
      `<div class="kpis">${[
        kpi('Colaboradores', f.int(ppl.length), [...count(ppl, p => p.bpo)].map(([k, v]) => sub(`${esc(k)} ${v}`))),
        ...[...count(ppl, p => p.contrato)].map(([k, v]) => kpi(esc(k), f.int(v), [sub(f.pct(v / ppl.length, 0) + ' do quadro')])),
        kpi('Líderes', f.int(lideres.length), [sub('com equipe na lista')]),
        kpi('Pendências individuais', f.int(pend), [status(pend === 0, pend === 0 ? 'tudo em dia' : 'status Pendente')]),
        sw ? kpi(esc(sw.title), `${swDone}/${sw.items.length}`, [status(swDone === sw.items.length, swDone === sw.items.length ? 'completo' : 'faltam ' + (sw.items.length - swDone))]) : '',
      ].join('')}</div>
      <div class="grid">
        ${card('hsLider', 'Equipe por líder', 'Colaboradores por contrato', { w: 6, h: 'tall' })}
        ${card('', 'Ginástica laboral', 'Por turno e semana', { w: 6, body: gin })}
        ${checklistCards}
        ${card('', 'DDS', 'Diálogo diário de segurança por turno', { w: 12, body: dds })}
        ${hse.links.length ? card('', 'Links importantes HSE', '', { w: 12, body: `<div class="links">${hse.links.map(l =>
          `<a href="${esc(l.url)}" target="_blank" rel="noopener">🔗 <span>${esc(l.label)}</span></a>`).join('')}</div>` }) : ''}
        ${card('', 'Colaboradores', `${filtered.length} de ${ppl.length}`, { w: 12, body:
          `<input class="search" id="hseSearch" type="search" placeholder="Buscar nome, código, líder…" value="${esc(state.hseSearch)}">
           <div class="table-wrap"><table><thead><tr><th>Nome</th><th class="left">Código</th><th class="left">BPO</th><th class="left">Contrato</th><th class="left">Líder</th><th class="left">Status</th></tr></thead>
           <tbody>${filtered.map(p => `<tr><td>${esc(p.nome)}</td><td class="left">${esc(p.codigo)}</td><td class="left">${esc(p.bpo)}</td>
             <td class="left">${esc(p.contrato)}</td><td class="left">${esc(p.lider)}</td><td class="left">${pillFor(p.status)}</td></tr>`).join('')}</tbody></table></div>` })}
      </div>`;
    H.render('hsLider', { labels: lideres, horizontal: true, stacked: true, totals: false,
      datasets: contratos.map((c, k) => H.bar(c, lideres.map(l => ppl.filter(p => p.lider === l && p.contrato === c).length || null), H.color([2, 1, 3, 5][k] || 4))) });
    const s = $('hseSearch');
    if (s) s.addEventListener('input', e => {
      state.hseSearch = e.target.value;
      const pos = e.target.selectionStart;
      renderHSE();
      const n = $('hseSearch'); n.focus(); n.setSelectionRange(pos, pos);
    });
  }

  // ================= UI =================
  // Status da conexão no rodapé do menu lateral.
  function setConn(kind, text) {
    $('connSub').textContent = text;
    $('connDot').className = 'conn-dot ' + kind;
    $('btnConn').title = kind === 'ok' ? `Conectada a “${text}” — clique para trocar a planilha` : 'Conectar ou trocar a planilha';
  }
  function setStatus(kind, text) { $('status').className = 'status ' + kind; $('statusText').textContent = text; }
  let toastTimer;
  function toast(msg, err = false) {
    const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, err ? 6000 : 2500);
  }

  function setAuto(min) {
    clearInterval(state.timer);
    min = Number(min) || 0;
    LS.set('auto', String(min));
    $('autoRefresh').value = String(min);
    if (min > 0) state.timer = setInterval(() => refresh({ silent: true }), min * 60000);
  }

  function selectTab(id) {
    state.tab = id; LS.set('tab', id);
    document.body.classList.remove('nav-open');
    renderAll();
    document.querySelector('.content').scrollTo({ top: 0 }); window.scrollTo({ top: 0 });
  }

  function toggleTV() {
    const on = !document.body.classList.contains('tv');
    document.body.classList.toggle('tv', on);
    clearInterval(state.tvTimer);
    if (on) {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
      if (!(Number($('autoRefresh').value) > 0)) setAuto(5);
      state.tvTimer = setInterval(() => {
        const k = TABS.findIndex(t => t.id === state.tab);
        selectTab(TABS[(k + 1) % TABS.length].id);
      }, (C.TV_ROTATE_SEC || 30) * 1000);
      toast('Modo TV ligado — Esc para sair');
    } else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setTimeout(renderAll, 300);
  }

  function isDark() {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function bind() {
    $('hubTitle').textContent = C.HUB_NAME;
    $('hubSub').textContent = `${C.HUB_CITY} · Painel operacional`;
    document.title = `Dashboard ${C.HUB_NAME}`;

    $('btnRefresh').addEventListener('click', () => refresh());
    $('autoRefresh').addEventListener('change', e => setAuto(e.target.value));
    $('btnTheme').addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      document.documentElement.dataset.theme = next; LS.set('theme', next);
      renderAll();
    });
    $('btnTV').addEventListener('click', toggleTV);
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && document.body.classList.contains('tv')) toggleTV();
    });

    $('tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) selectTab(b.dataset.tab); });

    // Menu lateral: recolhido (só ícones) no computador; gaveta sobreposta em telas estreitas.
    const mobile = () => matchMedia('(max-width: 900px)').matches;
    const setCollapsed = on => {
      document.body.classList.toggle('nav-collapsed', on);
      LS.set('nav', on ? 'collapsed' : 'open');
      $('btnMenu').setAttribute('aria-expanded', String(!on));
      setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
    };
    const setDrawer = on => { document.body.classList.toggle('nav-open', on); $('btnMenu').setAttribute('aria-expanded', String(on)); };
    setCollapsed(LS.get('nav', 'open') === 'collapsed');
    $('btnMenu').addEventListener('click', () => mobile() ? setDrawer(!document.body.classList.contains('nav-open'))
      : setCollapsed(!document.body.classList.contains('nav-collapsed')));
    $('btnCollapse').addEventListener('click', () => mobile() ? setDrawer(false) : setCollapsed(!document.body.classList.contains('nav-collapsed')));
    $('scrim').addEventListener('click', () => setDrawer(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setDrawer(false); });

    // Soltar arquivos fora da área de importação não deve abrir o arquivo na janela.
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => e.preventDefault());

    // Seletor de intervalo: um clique no início, outro no fim.
    $('rangeBtn').addEventListener('click', e => { e.stopPropagation(); openRange(!range.open); });
    $('rangePop').addEventListener('click', e => {
      e.stopPropagation();
      const day = e.target.closest('[data-day]');
      const pre = e.target.closest('[data-preset]');
      const nav = e.target.closest('[data-cal-nav]');
      if (nav) {
        const ms = [...new Set(state.model.dates.map(x => x.slice(3)))];
        range.view = ms[Math.min(ms.length - 1, Math.max(0, ms.indexOf(range.view) + (+nav.dataset.calNav)))];
        drawCalendar(); return;
      }
      if (pre) {
        const d = state.model.dates, n = d.length, last = lastDataIdx(state.model);
        const p = pre.dataset.preset;
        openRange(false);
        if (p === 'all') setRange(0, n - 1);
        else if (p === 'month' || p === 'prev') {
          let mY = d[last].slice(3);
          if (p === 'prev') { const ms = [...new Set(d.map(x => x.slice(3)))]; mY = ms[Math.max(0, ms.indexOf(mY) - 1)]; }
          setRange(d.findIndex(x => x.slice(3) === mY), n - 1 - [...d].reverse().findIndex(x => x.slice(3) === mY));
        } else setRange(Math.max(0, last - (+p) + 1), last);
      } else if (day) {
        const i = +day.dataset.day;
        if (range.pick == null) { range.pick = i; range.hover = i; drawCalendar(); }
        else { const a = range.pick; openRange(false); setRange(a, i); }
      }
    });
    $('rangePop').addEventListener('mouseover', e => {
      const day = e.target.closest('[data-day]');
      if (day && range.pick != null && range.hover !== +day.dataset.day) { range.hover = +day.dataset.day; drawCalendar(); }
    });
    document.addEventListener('click', () => { if (range.open) openRange(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && range.open) openRange(false); });

    main.addEventListener('click', e => {
      const tt = e.target.closest('[data-table-toggle]');
      if (tt) {
        const cardEl = tt.closest('.card');
        const on = cardEl.classList.toggle('show-table');
        tt.classList.toggle('active', on);
        if (on) cardEl.querySelector('.data-table').innerHTML = H.tableFor(tt.dataset.tableToggle);
      }
      const ma = e.target.closest('[data-ma]');
      if (ma) { state.maMode = ma.dataset.ma; renderAll(); }
      const ms = e.target.closest('[data-miss]');
      if (ms) { state.missMode = ms.dataset.miss; renderAll(); }
    });

    // Configurações
    const dlg = $('settings');
    const msg = (t, ok) => { $('cfgMsg').textContent = t; $('cfgMsg').className = 'settings-msg ' + (t ? (ok ? 'ok' : 'err') : ''); };
    const shareEmail = cfg => (cfg && cfg.clientEmail) || C.SERVICE_ACCOUNT_EMAIL || '';
    const showKey = cfg => {
      const embedded = cfg.keySource === 'embedded';
      $('cfgKeyInfo').textContent = embedded ? 'Chave embutida no aplicativo ✓' : cfg.hasKey ? 'Chave própria carregada ✓' : 'Nenhuma chave encontrada';
      $('cfgPickKey').textContent = cfg.hasKey ? 'Usar outra chave' : 'Selecionar .json';
      $('cfgRemoveKey').hidden = cfg.keySource !== 'custom';
      $('cfgRemoveKey').textContent = embedded || !cfg.hasKey ? 'Remover' : 'Voltar à chave embutida';
      $('cfgEmail').textContent = shareEmail(cfg);
      $('tutEmail').textContent = shareEmail(cfg);
      $('cfgWhere').textContent = cfg.dataDir ? `Configuração salva apenas neste computador, em: ${cfg.dataDir}` : '';
    };
    $('cfgEmail').textContent = shareEmail();
    $('tutEmail').textContent = shareEmail();
    // Links por mês: rascunho editável de todos os anos; a tela mostra um ano por vez.
    let draft = {};
    const statusOf = key => (state.sources || []).find(x => x.month === key);
    const monthStatus = (key, test) => {
      const src = test || statusOf(key);
      if (!draft[key]) return '';
      if (!src) return '<span class="m-st muted">não lido</span>';
      if (src.testing) return '<span class="m-st muted">testando…</span>';
      if (src.error && !src.ok) return `<span class="m-st bad" title="${esc(src.error)}">⚠ ${esc(src.error)}</span>`;
      const warn = src.warn ? ` <span class="bad">⚠ ${esc(src.warn)}</span>` : '';
      return `<span class="m-st good" title="${esc(src.name)}">✓ ${esc(src.name || 'ok')}${src.days != null ? ` · ${src.days} dias` : ''}${src.cached ? ' · cópia salva' : ''}${src.error ? ' · ⚠ falhou agora, usando cópia' : ''}</span>${warn}`;
    };
    const drawMonths = (tests = {}) => {
      const y = $('cfgYear').value;
      $('cfgMonths').innerHTML = MONTHS.map((name, i) => {
        const key = `${y}-${String(i + 1).padStart(2, '0')}`;
        return `<div class="month-row"><span class="m-name">${name}</span>
          <input type="url" data-month="${key}" value="${esc(draft[key] || '')}" placeholder="Link da planilha de ${name.toLowerCase()}" autocomplete="off">
          <div class="m-status" id="st-${key}">${monthStatus(key, tests[key])}</div></div>`;
      }).join('');
    };
    const fillYears = () => {
      const now = new Date().getFullYear();
      const years = new Set([now - 1, now, now + 1, ...Object.keys(draft).map(k => +k.slice(0, 4))]);
      const sel = $('cfgYear').value || String(now);
      $('cfgYear').innerHTML = [...years].sort().map(y => `<option ${String(y) === sel ? 'selected' : ''}>${y}</option>`).join('');
    };
    $('cfgYear').addEventListener('change', () => drawMonths());
    $('cfgMonths').addEventListener('input', e => {
      const k = e.target.dataset.month;
      if (!k) return;
      draft[k] = e.target.value.trim();
      if (!draft[k]) delete draft[k];
    });

    const baseInfo = () => {
      if (!window.Base) return;
      const st = window.Base.status;
      $('baseOpen').href = window.Base.sheetUrl() || '#';
      $('baseStatus').innerHTML = !window.Base.enabled() ? '<span class="muted">Disponível só no aplicativo (computador ou celular).</span>'
        : `<span class="${st.state === 'error' ? 'bad' : st.state === 'ok' ? 'good-txt' : 'muted'}">${esc({ ok: '✓ Conectada', sync: 'Sincronizando…', pending: 'Envio pendente', error: '⚠ ' + st.msg, off: 'Ainda não sincronizada' }[st.state] || '')}</span>`;
      $('cfgUser').value = window.Base.user();
    };
    if (window.Base) window.Base.onChange(baseInfo);
    $('cfgUser').addEventListener('change', e => { if (window.Base) window.Base.setUser(e.target.value); });
    const openSettings = async () => {
      msg('');
      baseInfo();
      $('cfgCurrent').hidden = !state.sheetName;
      $('cfgCurrent').innerHTML = state.sheetName ? `Conectado agora: <b>${esc(state.sheetName)}</b>.` : '';
      if (!api) {
        ['cfgYear', 'cfgPickKey', 'cfgTest', 'cfgSave', 'cfgReloadAll'].forEach(id => { $(id).disabled = true; });
        draft = {};
        fillYears(); drawMonths();
        $('cfgMonths').querySelectorAll('input').forEach(i => { i.disabled = true; });
        msg('A conexão com as planilhas funciona apenas no aplicativo (computador ou celular).', false);
      } else {
        const cfg = await api.getConfig();
        draft = configuredMonths(cfg);
        fillYears(); drawMonths();
        showKey(cfg);
      }
      dlg.showModal();
    };
    $('btnSettings').addEventListener('click', openSettings);
    $('btnConn').addEventListener('click', () => { document.body.classList.remove('nav-open'); openSettings(); });
    main.addEventListener('click', e => { if (e.target.closest('[data-open-conn]')) openSettings(); });
    main.addEventListener('click', e => {
      const b = e.target.closest('[data-goto-last]');
      if (!b) return;
      const i = +b.dataset.gotoLast, mY = state.model.dates[i].slice(3), d = state.model.dates;
      setRange(d.findIndex(x => x.slice(3) === mY), i);
    });
    const tut = $('tutorial');
    $('cfgHelp').addEventListener('click', () => tut.showModal());
    $('tutClose').addEventListener('click', () => tut.close());
    $('tutDone').addEventListener('click', () => tut.close());
    tut.addEventListener('click', e => { if (e.target === tut) tut.close(); });
    $('demoConfigure').addEventListener('click', openSettings);
    $('cfgPickKey').addEventListener('click', async () => {
      try { const cfg = await api.pickKey(); showKey(cfg); if (!cfg.canceled) msg('Chave salva. Agora compartilhe a planilha com o e-mail acima.', true); }
      catch (err) { msg(cleanErr(err), false); }
    });
    $('cfgRemoveKey').addEventListener('click', async () => { const cfg = await api.removeKey(); showKey(cfg); msg(cfg.hasKey ? 'Voltando a usar a chave embutida.' : 'Chave removida deste computador.', true); });
    $('cfgCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('cfgEmail').textContent); msg('E-mail copiado. Agora cole no “Compartilhar” da planilha.', true); }
      catch (e) { msg('Não foi possível copiar automaticamente — selecione o e-mail e use Ctrl+C.', false); }
    });
    $('cfgTest').addEventListener('click', async () => {
      const y = $('cfgYear').value;
      const keys = Object.keys(draft).filter(k => k.startsWith(y + '-')).sort();
      if (!keys.length) return msg(`Nenhum link preenchido em ${y}.`, false);
      const tests = {};
      keys.forEach(k => { tests[k] = { testing: true }; });
      drawMonths(tests);
      msg(`Testando ${keys.length} planilha(s)…`, true);
      let ok = 0;
      for (const k of keys) {
        try {
          const data = await fetchOne(draft[k]);
          const m = window.buildModel(data);
          const months = [...new Set(m.dates.map(d => d.slice(6) + '-' + d.slice(3, 5)))];
          const miss = data.missingSheets || [];
          tests[k] = { ok: true, name: data.spreadsheet, days: m.dates.length,
            warn: !m.dates.length ? 'nenhuma data encontrada' : !months.includes(k) ? `os dados são de ${months.map(monthName).join(', ')}`
              : miss.length ? `guias não encontradas: ${miss.join(', ')}` : '' };
          ok++;
        } catch (err) { tests[k] = { ok: false, error: err.message }; }
        $(`st-${k}`).innerHTML = monthStatus(k, tests[k]);
      }
      msg(`${ok} de ${keys.length} planilha(s) conectada(s)${ok < keys.length ? ' — veja os erros ao lado de cada mês.' : '. Clique em Salvar e atualizar.'}`, ok === keys.length);
    });
    $('cfgSave').addEventListener('click', async () => {
      if (!Object.keys(draft).length) return msg('Informe o link de pelo menos um mês.', false);
      await api.saveConfig({ months: draft });
      LS.set('demo', '');
      dlg.close(); refresh();
    });
    $('cfgReloadAll').addEventListener('click', async () => {
      if (api && Object.keys(draft).length) await api.saveConfig({ months: draft });
      if (api && api.cacheClear) await api.cacheClear();
      LS.set('demo', '');
      dlg.close(); refresh({ full: true });
    });
    $('cfgDemo').addEventListener('click', () => { LS.set('demo', '1'); dlg.close(); refresh(); });
  }

  // Nome de quem usa o app (pedido na primeira gravação na planilha-base).
  if (window.Base) {
    window.Base.setAskUser(() => new Promise(resolve => {
      const dlg = $('userDlg');
      $('userName').value = '';
      const done = () => { const v = $('userName').value.trim(); if (!v) return; dlg.close(); resolve(v); };
      $('userForm').onsubmit = e => { e.preventDefault(); done(); };
      dlg.oncancel = e => e.preventDefault();
      dlg.showModal();
      setTimeout(() => $('userName').focus(), 50);
    }));
  }

  bind();
  setAuto(LS.get('auto', String(C.AUTO_REFRESH_MIN || 0)));
  refresh({ silent: true });
})();
