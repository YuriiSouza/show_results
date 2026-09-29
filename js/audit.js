// Aba "Audit": importa os relatórios LMHub Audit (.csv), um por dia e turno (AM, PM1, PM2),
// e analisa o período escolhido no filtro (um dia = visão diária; vários dias = acumulado + tendência). As linhas do CSV NÃO são guardadas: de cada importação
// fica só o resumo calculado (indicadores, totais por operador/corredor, tempos e ATs de atenção).
window.Audit = (() => {
  const P = window.Parser;
  const H = window.Charts;
  const f = H.fmt;
  const esc = H.esc;
  const api = window.hubApi || null;
  const SHIFTS = ['AM', 'PM1', 'PM2'];
  const SHIFT_COLOR = { AM: 2, PM1: 1, PM2: 3 };
  const REQUIRED = ['AT/TO', 'Corridor/Cage', 'Total Initial Orders Inside AT/TO', 'Missing Orders', 'Missorted Orders'];

  const st = { loaded: false, loading: null, reports: [], day: null, shift: 'ALL', search: '', demo: false };
  let ui = null;          // funções de interface vindas do app.js
  let pending = null;     // relatório lido no diálogo, antes de salvar
  let bound = false;

  // ---------- Armazenamento (app: pasta do usuário; navegador: localStorage) ----------
  const LS_KEY = 'hub.audit';
  const lsRead = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; } };
  const lsWrite = all => { try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch (e) { /* sem espaço */ } };
  // Planilha-base compartilhada (js/base.js) quando disponível; senão, só neste aparelho.
  const shared = () => window.Base && window.Base.enabled();
  const store = {
    async list() {
      if (shared()) { await window.Base.load(); return window.Base.auditList(); }
      return api ? api.auditList() : lsRead();
    },
    async save(rep) {
      if (shared()) return window.Base.auditSave(rep);
      if (api) return api.auditSave(rep);
      const data = { ...rep, importedAt: new Date().toISOString() };
      lsWrite([...lsRead().filter(r => !(r.date === rep.date && r.shift === rep.shift)), data]);
      return data;
    },
    async del(date, shift) {
      if (shared()) return window.Base.auditDelete(date, shift);
      if (api) return api.auditDelete(date, shift);
      lsWrite(lsRead().filter(r => !(r.date === date && r.shift === shift)));
    },
  };

  // Resumo calculado de um relatório (é só isto que é guardado).
  function summarize(rows) {
    const T = TMAX();
    const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
    const timed = rows.filter(r => r.minutes != null);
    const starts = rows.map(r => r.start).filter(Boolean), ends = rows.map(r => r.end).filter(Boolean);
    const ops = {}, corr = {}, hours = {};
    rows.forEach(r => {
      const o = ops[r.operator || '—'] = ops[r.operator || '—'] || { ats: 0, pedidos: 0, missing: 0, missorted: 0, atsMissing: 0, mins: [], pedidosTimed: 0 };
      o.ats++; o.pedidos += r.initial; o.missing += r.missing; o.missorted += r.missorted;
      if (r.missing > 0) o.atsMissing++;
      if (r.minutes != null) { o.mins.push(+r.minutes.toFixed(4)); o.pedidosTimed += r.initial; }
      const c = corr[r.corridor || '—'] = corr[r.corridor || '—'] || [0, 0];
      c[0] += r.missing; c[1] += r.missorted;
      if (r.start) hours[r.start.getHours()] = (hours[r.start.getHours()] || 0) + 1;
    });
    return {
      v: 1, ats: rows.length, initial: sum('initial'), scanned: sum('scanned'), missing: sum('missing'), missorted: sum('missorted'),
      atsMissing: rows.filter(r => r.missing > 0).length, atsDiv: rows.filter(r => r.missing > 0 || r.missorted > 0).length,
      revalidated: rows.filter(r => r.revalidated > 0).length,
      notValidated: rows.filter(r => r.status && !/^validated$/i.test(r.status)).length,
      mins: timed.map(r => +r.minutes.toFixed(4)), pedidosTimed: timed.reduce((s, r) => s + r.initial, 0),
      t0: starts.length ? new Date(Math.min(...starts)).toISOString() : null, t1: ends.length ? new Date(Math.max(...ends)).toISOString() : null,
      ops, corr, hours,
      // ATs de atenção: com missing, missorted ou acima da meta de tempo.
      attention: rows.filter(r => r.missing > 0 || r.missorted > 0 || (r.minutes != null && r.minutes > T)).map(r => ({
        at: r.at, corridor: r.corridor, operator: r.operator, initial: r.initial, final: r.final, scanned: r.scanned,
        missing: r.missing, missorted: r.missorted, minutes: r.minutes == null ? null : +r.minutes.toFixed(4),
        start: r.start ? r.start.toISOString() : null, end: r.end ? r.end.toISOString() : null, status: r.status,
      })),
    };
  }
  const rowsOf = (header, rows) => P.auditRows(P.table([header, ...rows], 'AT/TO'));
  const hydrate = r => ({ ...r, id: `${r.date}_${r.shift}`, s: r.summary || (r.rows ? summarize(rowsOf(r.header, r.rows)) : null) });
  const sortReports = arr => arr.sort((a, b) => b.date.localeCompare(a.date) || SHIFTS.indexOf(a.shift) - SHIFTS.indexOf(b.shift));

  async function load() {
    st.reports = sortReports((await store.list()).map(hydrate).filter(r => r.s));
    st.demo = false;
    st.loaded = true;
    fixSelection();
  }
  function fixSelection() {
    if (st.shift !== 'ALL' && !periodReports().some(r => r.shift === st.shift)) st.shift = 'ALL';
  }

  // ---------- Cálculos ----------
  // Período = filtro de Período do app (o mesmo das outras telas).
  const period = () => (ui && ui.range ? ui.range() : { from: '0000-00-00', to: '9999-12-31' });
  const inRange = (r, p) => r.date >= p.from && r.date <= p.to;
  const periodReports = (p = period()) => st.reports.filter(r => inRange(r, p));
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const spanDays = p => Math.round((new Date(p.to + 'T12:00:00') - new Date(p.from + 'T12:00:00')) / 86400000) + 1;
  const periodLabel = p => (p.from === p.to ? fmtDay(p.from) : `${fmtDay(p.from)} a ${fmtDay(p.to)}`);
  const fmtDay = d => d ? d.split('-').reverse().join('/') : '';
  const hhmm = d => d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
  const ratio = (a, b) => (b ? a / b : null);
  const TMAX = () => (ui && ui.meta.tempoConferenciaMin) || 6;
  // Minutos -> "mm:ss" (ou "h:mm:ss" acima de 1 hora), no mesmo formato da meta 00:06:00.
  function fmtDur(min) {
    if (min == null) return '—';
    const t = Math.round(min * 60), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    const p2 = n => String(n).padStart(2, '0');
    return h ? `${h}:${p2(m)}:${p2(sec)}` : `${p2(m)}:${p2(sec)}`;
  }
  const toD = x => (x ? new Date(x) : null);

  // Soma os resumos de vários relatórios (ex.: todos os turnos do dia).
  function agg(reps) {
    const T = TMAX();
    const sum = k => reps.reduce((s, r) => s + (r.s[k] || 0), 0);
    const mins = reps.flatMap(r => r.s.mins);
    const t0s = reps.map(r => r.s.t0).filter(Boolean).sort(), t1s = reps.map(r => r.s.t1).filter(Boolean).sort();
    const minSum = mins.reduce((a, b) => a + b, 0);
    return {
      ats: sum('ats'), initial: sum('initial'), scanned: sum('scanned'), missing: sum('missing'), missorted: sum('missorted'),
      atsMissing: sum('atsMissing'), atsDiv: sum('atsDiv'), revalidated: sum('revalidated'), notValidated: sum('notValidated'),
      avgMin: mins.length ? minSum / mins.length : null, maxMin: mins.length ? Math.max(...mins) : null, timed: mins.length,
      over: mins.filter(v => v > T).length, excess: mins.reduce((x, v) => x + Math.max(0, v - T), 0),
      secPerOrder: sum('pedidosTimed') ? minSum * 60 / sum('pedidosTimed') : null,
      t0: toD(t0s[0]), t1: toD(t1s[t1s.length - 1]),
      ops: new Set(reps.flatMap(r => Object.keys(r.s.ops))).size,
    };
  }

  function byOperator(reps) {
    const T = TMAX();
    const map = new Map();
    reps.forEach(r => Object.entries(r.s.ops).forEach(([k, x]) => {
      const o = map.get(k) || { nome: k, ats: 0, pedidos: 0, missing: 0, missorted: 0, atsMissing: 0, min: 0, nMin: 0,
        over: 0, excess: 0, maxMin: 0, pedidosTimed: 0, shifts: new Set(), reports: new Set() };
      o.ats += x.ats; o.pedidos += x.pedidos; o.missing += x.missing; o.missorted += x.missorted; o.atsMissing += x.atsMissing;
      o.pedidosTimed += x.pedidosTimed;
      x.mins.forEach(v => { o.min += v; o.nMin++; o.maxMin = Math.max(o.maxMin, v); if (v > T) { o.over++; o.excess += v - T; } });
      o.shifts.add(r.shift); o.reports.add(r.date + r.shift);
      map.set(k, o);
    }));
    return [...map.values()].sort((a, b) => b.missing - a.missing || b.missorted - a.missorted || b.ats - a.ats);
  }
  // Missing/missorted por corredor (ou por rua, com a letra do corredor).
  function byCorridor(reps, keyFn = k => k) {
    const map = new Map();
    reps.forEach(r => Object.entries(r.s.corr).forEach(([c, [mi, mo]]) => {
      const k = keyFn(c), o = map.get(k) || { missing: 0, missorted: 0 };
      o.missing += mi; o.missorted += mo; map.set(k, o);
    }));
    return map;
  }
  const attentionOf = reps => reps.flatMap(r => r.s.attention.map(x => ({ ...x, start: toD(x.start), end: toD(x.end), shift: r.shift, date: r.date })));

  // Relatório anterior para comparação (mesmo turno; ou dia anterior inteiro em "Todos").
  function previous() {
    // Período anterior com o mesmo número de dias (um dia -> o dia anterior).
    const p = period(), n = spanDays(p);
    const pp = { from: addDays(p.from, -n), to: addDays(p.from, -1) };
    const reps = periodReports(pp).filter(r => st.shift === 'ALL' || r.shift === st.shift);
    return reps.length ? { label: periodLabel(pp), reps } : null;
  }

  // ---------- Tela ----------
  async function render(ctx) {
    ui = ctx;
    bindOnce();
    if (st.loaded && shared() && !st.demo) { await load(); if (!ui.isActive()) return; }
    if (!st.loaded) {
      ui.main.innerHTML = ui.head('Audit de gestão') + ui.empty('Carregando relatórios…');
      if (!st.loading) st.loading = load().finally(() => { st.loading = null; });
      await st.loading;
      if (!ui.isActive()) return;
    }
    draw();
  }

  function draw() {
    const m = ui.main;
    if (!st.reports.length) {
      m.innerHTML = ui.head('Audit de gestão', 'Relatórios LMHub Audit por dia e turno') + `
        <div class="au-empty">
          <div class="au-empty-icon">📋</div>
          <h2>Nenhum relatório importado</h2>
          <p class="muted">Todo dia são gerados três relatórios de Audit (AM, PM1 e PM2). Importe o arquivo <b>.csv</b> do LMHub,
          informe o dia e o turno, e o painel monta a análise. Fica guardado só o <b>resumo calculado</b> — as linhas do CSV não são salvas.</p>
          <div class="au-empty-actions">
            <button class="btn-primary solid" data-au="import">Importar relatório</button>
            <button class="btn-ghost" data-au="demo">Ver com dados de exemplo</button>
          </div>
          <p class="muted small">Dica: você também pode arrastar o arquivo .csv para esta tela.</p>
        </div>`;
      return;
    }

    const per = period();
    const inPeriod = periodReports(per);
    if (!inPeriod.length) {
      m.innerHTML = ui.head('Audit de gestão', 'Relatórios LMHub Audit por dia e turno') + `
        <div class="au-empty">
          <div class="au-empty-icon">📅</div>
          <h2>Nenhum relatório no período ${esc(periodLabel(per))}</h2>
          <p class="muted">Escolha outro período no filtro acima ou importe o relatório do dia.</p>
          <div class="au-empty-actions"><button class="btn-primary solid" data-au="import">Importar relatório</button></div>
        </div>`;
      return;
    }
    const reps = st.shift === 'ALL' ? inPeriod : inPeriod.filter(r => r.shift === st.shift);
    const days = [...new Set(inPeriod.map(r => r.date))].sort();
    const a = agg(reps);
    const prev = previous();
    const pa = prev ? agg(prev.reps) : null;
    const meta = ui.meta.missingMax;
    const pctMiss = ratio(a.missing, a.initial);
    const avail = new Set(inPeriod.map(r => r.shift));
    const scope = `${periodLabel(per)} · ${reps.length} relatório(s) em ${days.length} dia(s) · ${st.shift === 'ALL' ? `todos os turnos (${[...avail].join(', ') || '—'})` : `turno ${st.shift}`}`;

    const deltaTxt = (cur, old, pct = false) => {
      if (old == null || cur == null) return '';
      const d = cur - old;
      if (Math.abs(d) < (pct ? 0.00005 : 0.5)) return `<span class="muted">= ${prev.label}</span>`;
      return `<span class="delta ${d > 0 ? 'up' : 'down'}">${pct ? f.pct(Math.abs(d), 2).replace('%', ' p.p.') : f.int(Math.abs(d))}</span><span class="muted">vs ${esc(prev.label)}</span>`;
    };

    const shiftChips = ['ALL', ...SHIFTS].map(s => {
      const has = s === 'ALL' || avail.has(s);
      return `<button class="chip ${st.shift === s ? 'active' : ''}" data-au-shift="${s}" ${has ? '' : 'disabled title="Sem relatório deste turno no período"'}>
        ${s === 'ALL' ? 'Todos' : s}${s !== 'ALL' ? `<span class="dot-shift ${has ? 'on' : ''}"></span>` : ''}</button>`;
    }).join('');

    const ops = byOperator(reps);
    const corr = byCorridor(reps);
    const corrKeys = [...corr.keys()].sort((x, y) => x.localeCompare(y, 'pt-BR', { numeric: true }));
    const rua = byCorridor(reps, c => (c.split('-')[0] || '—').trim());
    const ruaKeys = [...rua.keys()].sort();

    const attention = attentionOf(reps);
    const q = st.search.toLowerCase();
    const atRows = attention.filter(r => !q || [r.at, r.corridor, r.operator, r.shift].join(' ').toLowerCase().includes(q))
      .sort((x, y) => y.missing - x.missing || y.missorted - x.missorted || (y.minutes || 0) - (x.minutes || 0));

    // Tendência por dia e corredores reincidentes (só quando o período tem mais de um dia com relatório).
    const multi = days.length > 1;
    const corrHist = new Map();
    reps.forEach(r => Object.entries(r.s.corr).forEach(([corridor, [missing]]) => {
      if (!missing) return;
      const c = corrHist.get(corridor) || { corridor, reports: new Set(), missing: 0, last: '' };
      c.reports.add(r.id); c.missing += missing;
      if (r.date + r.shift > c.last) c.last = r.date + ' ' + r.shift;
      corrHist.set(corridor, c);
    }));
    const recurrent = [...corrHist.values()].filter(c => c.reports.size >= 2)
      .sort((x, y) => y.reports.size - x.reports.size || y.missing - x.missing).slice(0, 20);

    const cmpTable = st.shift === 'ALL' && avail.size > 1 ? ui.card('', 'Comparativo dos turnos', periodLabel(per), { w: 12, body: `
      <div class="table-wrap full"><table><thead><tr><th>Turno</th><th>ATs</th><th>Pedidos</th><th>Missing</th><th>% Missing</th>
        <th>Missorted</th><th>% Missorted</th><th>ATs c/ missing</th><th>Tempo médio</th><th>&gt; ${fmtDur(TMAX())}</th><th>Janela</th><th>Operadores</th></tr></thead><tbody>
        ${SHIFTS.filter(s => avail.has(s)).map(s => {
          const x = agg(inPeriod.filter(r => r.shift === s));
          const p = ratio(x.missing, x.initial);
          return `<tr><td><span class="shift-tag s-${s}">${s}</span></td><td>${x.ats}</td><td>${f.int(x.initial)}</td><td><b>${x.missing}</b></td>
            <td>${statusPill(p, meta)}</td><td>${x.missorted}</td><td>${f.pct(ratio(x.missorted, x.initial), 2)}</td><td>${x.atsMissing}</td>
            <td>${timePill(x.avgMin)}</td><td>${x.over} <span class="muted">(${f.pct(ratio(x.over, x.timed), 0)})</span></td><td>${hhmm(x.t0)} → ${hhmm(x.t1)}</td><td>${x.ops}</td></tr>`;
        }).join('')}
      </tbody></table></div>` }) : '';

    const overRows = attention.filter(r => r.minutes != null && r.minutes > TMAX()).sort((x, y) => y.minutes - x.minutes);
    const slowest = overRows[0];
    const opsTime = ops.filter(o => o.nMin).sort((x, y) => y.over - x.over || y.excess - x.excess);
    const topCorr = corrKeys.map(k => ({ k, v: corr.get(k).missing })).sort((x, y) => y.v - x.v)[0];
    const insights = [
      pctMiss != null ? `${pctMiss <= meta ? '✓' : '⚠'} Missing em <b>${f.pct(pctMiss, 2)}</b> dos pedidos (meta ≤ ${f.pct(meta, 1)}).` : '',
      pa ? `${a.missing > pa.missing ? '▲' : a.missing < pa.missing ? '▼' : '='} ${f.int(a.missing)} missing contra ${f.int(pa.missing)} em ${esc(prev.label)}.` : '',
      topCorr && topCorr.v ? `Corredor com mais missing: <b>${esc(topCorr.k)}</b> (${topCorr.v}).` : '',
      ops[0] && ops[0].missing ? `Operador com mais missing: <b>${esc(ops[0].nome)}</b> (${ops[0].missing} em ${ops[0].ats} ATs).` : '',
      a.timed ? `${a.over ? '⏱' : '✓'} <b>${a.over}</b> de ${a.timed} ATs (${f.pct(ratio(a.over, a.timed), 0)}) passaram da meta de conferência de <b>${fmtDur(TMAX())}</b>` +
        (slowest ? ` · mais lenta: <b>${esc(slowest.at)}</b> (${esc(slowest.corridor)}) com <b>${fmtDur(slowest.minutes)}</b>, ${esc(slowest.operator)}.` : '.') : '',
      opsTime[0] && opsTime[0].over ? `Maior ofensor de tempo: <b>${esc(opsTime[0].nome)}</b> (${opsTime[0].over} de ${opsTime[0].nMin} ATs acima de ${fmtDur(TMAX())}, média ${fmtDur(opsTime[0].min / opsTime[0].nMin)}).` : '',
      a.notValidated ? `⚠ <b>${a.notValidated}</b> AT(s) com status diferente de “Validated”.` : '',
    ].filter(Boolean);

    m.innerHTML = ui.head('Audit de gestão', 'Relatórios LMHub Audit por dia e turno') + `
      ${st.demo ? `<div class="au-demo">Exemplo com dados fictícios — nada foi salvo. <button class="link" data-au="exit-demo">Sair do exemplo</button></div>` : ''}
      <div class="au-bar">
        <span class="au-period">📅 ${esc(periodLabel(per))}<span class="muted"> · use o filtro de Período acima</span></span>
        <div class="chips">${shiftChips}</div>
        <div class="au-bar-right">
          <button class="btn-primary solid" data-au="import"><span>＋</span> Importar relatório</button>
        </div>
      </div>
      <div class="section-sub">Resumo · ${scope}${reps.length === 1 && reps[0].user ? ` · importado por ${esc(reps[0].user)}` : ''}</div>
      <div class="kpis au-kpis">${[
        ui.kpi('ATs validadas', f.int(a.ats), [deltaTxt(a.ats, pa && pa.ats), `<span>${hhmm(a.t0)} → ${hhmm(a.t1)}</span>`]),
        ui.kpi('Pedidos (inicial)', f.int(a.initial), [`<span>${f.int(a.scanned)} escaneados</span>`]),
        ui.kpi('Missing', f.int(a.missing), [statusPill(pctMiss, meta), deltaTxt(a.missing, pa && pa.missing)]),
        ui.kpi('Missorted', f.int(a.missorted), [`<span>${f.pct(ratio(a.missorted, a.initial), 2)} dos pedidos</span>`, deltaTxt(a.missorted, pa && pa.missorted)]),
        ui.kpi('ATs com divergência', f.int(a.atsDiv), [`<span>${f.pct(ratio(a.atsDiv, a.ats), 0)} das ATs · ${a.atsMissing} com missing</span>`]),
        ui.kpi('Tempo médio / AT', fmtDur(a.avgMin), [timePill(a.avgMin, true), `<span>${a.ops} operadores</span>`]),
        ui.kpi(`ATs acima de ${fmtDur(TMAX())}`, f.int(a.over), [a.timed ? `<span class="pill ${a.over ? 'bad' : 'good'}">${a.over ? '⚠' : '✓'} ${f.pct(ratio(a.over, a.timed), 0)} das ATs</span>` : '',
          `<span>+${fmtDur(a.excess)} acima da meta</span>`]),
      ].join('')}${insights.length ? `<div class="au-insights">${insights.map(t => `<div>${t}</div>`).join('')}</div>` : ''}</div>
      <div class="grid">
        ${cmpTable}
        ${multi ? ui.card('auTrendPct', '% de missing por dia', `Por turno · tracejado = meta ${f.pct(meta, 1)}`, { w: 6 }) : ''}
        ${multi ? ui.card('auTrendOver', `% de ATs acima de ${fmtDur(TMAX())} por dia`, 'Por turno', { w: 6 }) : ''}
        ${ui.card('auCorr', 'Missing e missorted por corredor', st.shift === 'ALL' ? 'Soma dos turnos do dia' : 'Cada barra = um corredor/gaiola', { w: 12 })}
        ${ui.card('auRua', 'Por rua', 'Letra do corredor', { w: 4 })}
        ${ui.card('auHour', 'ATs validadas por hora', 'Hora de início da validação', { w: 4 })}
        ${ui.card('auTime', 'Tempo de conferência', `ATs por faixa · meta ${fmtDur(TMAX())}`, { w: 4 })}
        ${ui.card('', `Ofensores do tempo de conferência (meta ${fmtDur(TMAX())})`, 'Operadores ordenados por ATs acima da meta e tempo excedente', { w: 12, body: timeOpsTable(opsTime, st.shift === 'ALL') })}
        ${ui.card('', `ATs acima de ${fmtDur(TMAX())}`, `${overRows.length} AT(s) · da mais lenta para a mais rápida`, { w: 12, body: overRows.length ? `
          <div class="table-wrap"><table><thead><tr><th>AT/TO</th><th class="left">Corredor</th><th>Pedidos</th><th>Duração</th><th>Excesso</th><th class="left">Operador</th></tr></thead><tbody>
          ${overRows.map(r => `<tr><td>${esc(r.at)}${st.shift === 'ALL' ? ` <span class="shift-tag s-${r.shift}">${r.shift}</span>` : ''}</td><td class="left">${esc(r.corridor)}</td><td>${r.initial}</td>
            <td class="over"><b>${fmtDur(r.minutes)}</b></td><td class="over">+${fmtDur(r.minutes - TMAX())}</td><td class="left">${esc(r.operator)}</td></tr>`).join('')}
          </tbody></table></div>` : ui.empty(`Nenhuma AT acima de ${fmtDur(TMAX())}. ✓`) })}
        ${ui.card('', 'Operadores', 'Ordenado por missing', { w: multi ? 7 : 12, body: opsTable(ops, st.shift === 'ALL') })}
        ${multi ? ui.card('', 'Corredores reincidentes', 'Com missing em 2 ou mais relatórios do período', { w: 5, body: recurrent.length ? `
          <div class="table-wrap"><table><thead><tr><th>Corredor</th><th>Relatórios</th><th>Missing</th><th>Último</th></tr></thead><tbody>
          ${recurrent.map(c => `<tr><td>${esc(c.corridor)}</td><td>${c.reports.size}</td><td><b>${c.missing}</b></td><td>${esc(fmtDay(c.last.slice(0, 10)) + c.last.slice(10))}</td></tr>`).join('')}
          </tbody></table></div>` : ui.empty('Nenhum corredor com missing repetido no período.') }) : ''}
        ${ui.card('', 'ATs de atenção', `${atRows.length} de ${a.ats} ATs · com missing, missorted ou acima de ${fmtDur(TMAX())} (as demais não são guardadas)`, { w: 12, body: `
          <input class="search" id="auSearch" type="search" placeholder="Buscar AT, corredor, operador…" value="${esc(st.search)}">
          <div class="table-wrap"><table><thead><tr><th>AT/TO</th>${st.shift === 'ALL' ? '<th class="left">Turno</th>' : ''}<th class="left">Corredor</th>
            <th>Inicial</th><th>Final</th><th>Escaneado</th><th>Missorted</th><th>Missing</th><th>Início</th><th>Fim</th><th>Duração</th>
            <th class="left">Operador</th><th class="left">Status</th></tr></thead><tbody>
            ${atRows.map(r => `<tr class="${r.missing ? 'hl' : ''}"><td>${esc(r.at)}</td>${st.shift === 'ALL' ? `<td class="left"><span class="shift-tag s-${r.shift}">${r.shift}</span></td>` : ''}
              <td class="left">${esc(r.corridor)}</td><td>${r.initial}</td><td>${r.final}</td><td>${r.scanned}</td><td>${r.missorted}</td><td><b>${r.missing}</b></td>
              <td>${hhmm(r.start)}</td><td>${hhmm(r.end)}</td><td class="${r.minutes > TMAX() ? 'over' : ''}">${fmtDur(r.minutes)}</td>
              <td class="left">${esc(r.operator)}</td><td class="left">${esc(r.status)}</td></tr>`).join('')}
          </tbody></table></div>` })}
      </div>

      <div class="grid au-imported">
        ${ui.card('', 'Relatórios importados', `${inPeriod.length} no período · ${st.reports.length} no total`, { w: 12, body: `
          <div class="table-wrap"><table><thead><tr><th>Dia</th><th class="left">Turno</th><th class="left">Arquivo</th><th>ATs</th><th>Missing</th><th>% Missing</th><th>Importado em</th><th class="left">Por</th><th></th></tr></thead><tbody>
          ${inPeriod.map(r => { const x = agg([r]); return `<tr><td>${fmtDay(r.date)}</td><td class="left"><span class="shift-tag s-${r.shift}">${r.shift}</span></td>
            <td class="left file-cell" title="${esc(r.fileName)}">${esc(r.fileName || '—')}</td><td>${x.ats}</td><td>${x.missing}</td><td>${f.pct(ratio(x.missing, x.initial), 2)}</td>
            <td>${r.importedAt ? new Date(r.importedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
            <td class="left">${esc(r.user || '—')}</td>
            <td><button class="tool" data-au-open="${r.id}">Abrir</button> ${st.demo ? '' : `<button class="tool danger" data-au-del="${r.id}">Excluir</button>`}</td></tr>`; }).join('')}
          </tbody></table></div>` })}
      </div>`;

    // Gráficos do dia/turno
    const shiftSets = st.shift === 'ALL' ? SHIFTS.filter(s => avail.has(s)) : [st.shift];
    H.render('auCorr', { labels: corrKeys, stacked: true, datasets: [
      H.bar('Missing', corrKeys.map(k => corr.get(k).missing), H.color(1)),
      H.bar('Missorted', corrKeys.map(k => corr.get(k).missorted), H.color(2)),
    ] });
    H.render('auRua', { labels: ruaKeys, datasets: [
      H.bar('Missing', ruaKeys.map(k => rua.get(k).missing), H.color(1)),
      H.bar('Missorted', ruaKeys.map(k => rua.get(k).missorted), H.color(2)),
    ] });
    const hours = [...new Set(reps.flatMap(r => Object.keys(r.s.hours).map(Number)))].sort((x, y) => x - y);
    H.render('auHour', { labels: hours.map(h => `${String(h).padStart(2, '0')}h`), stacked: true, totals: shiftSets.length > 1,
      datasets: shiftSets.map(s => H.bar(s, hours.map(h => reps.filter(r => r.shift === s).reduce((n, r) => n + (r.s.hours[h] || 0), 0) || null), H.color(SHIFT_COLOR[s]))) });
    const T = TMAX();
    const buckets = [['até 3', 0, 3], [`3–${T}`, 3, T], [`${T}–8`, T, 8], ['8–10', 8, 10], ['10+', 10, Infinity]];
    const allMins = reps.flatMap(r => r.s.mins);
    const inB = ([, lo, hi]) => allMins.filter(v => (lo === T ? v > lo : v >= lo) && (hi === T ? v <= hi : v < hi)).length;
    H.render('auTime', { labels: buckets.map(b => b[0] + ' min'), stacked: true, datasets: [
      H.bar('Dentro da meta', buckets.map(b => (b[2] <= T ? inB(b) : null) || null), H.color(3)),
      H.bar('Acima da meta', buckets.map(b => (b[1] >= T ? inB(b) : null) || null), H.css('--bad')),
    ] });

    // Tendência por dia (período com mais de um dia)
    if (multi) {
      const lbl = days.map(d => `${d.slice(8, 10)}/${d.slice(5, 7)}`);
      const one = (d, sh) => { const r = inPeriod.find(x => x.date === d && x.shift === sh); return r ? agg([r]) : null; };
      H.render('auTrendPct', { labels: lbl, yFormat: v => f.pct(v, 1), tooltipFormat: v => f.pct(v, 2), datasets: [
        ...shiftSets.map(sh => H.line(sh, days.map(d => { const x = one(d, sh); return x ? ratio(x.missing, x.initial) : null; }), H.color(SHIFT_COLOR[sh]), { spanGaps: true })),
        H.ref(`Meta ${f.pct(meta, 1)}`, meta, lbl.length, H.css('--bad')),
      ] });
      H.render('auTrendOver', { labels: lbl, yFormat: v => f.pct(v, 0), datasets:
        shiftSets.map(sh => H.line(sh, days.map(d => { const x = one(d, sh); return x && x.timed ? x.over / x.timed : null; }), H.color(SHIFT_COLOR[sh]), { spanGaps: true })) });
    }

  }

  function statusPill(p, meta) {
    if (p == null) return '<span class="muted">—</span>';
    return `<span class="pill ${p <= meta ? 'good' : 'bad'}">${p <= meta ? '✓' : '⚠'} ${f.pct(p, 2)}</span>`;
  }
  function timePill(min, withMeta = false) {
    if (min == null) return '<span class="muted">—</span>';
    const ok = min <= TMAX();
    return `<span class="pill ${ok ? 'good' : 'bad'}">${ok ? '✓' : '⚠'} ${withMeta ? 'meta ' + fmtDur(TMAX()) : fmtDur(min)}</span>`;
  }
  function timeOpsTable(list, showShift) {
    if (!list.length) return ui.empty('Sem dados de tempo.');
    return `<div class="table-wrap"><table><thead><tr><th>#</th><th class="left">Operador</th>${showShift ? '<th class="left">Turno</th>' : ''}
      <th>ATs</th><th>&gt; ${fmtDur(TMAX())}</th><th>% acima</th><th>Tempo médio</th><th>Maior tempo</th><th>Excesso total</th><th>Seg/pedido</th></tr></thead><tbody>
      ${list.map((o, i) => `<tr class="${o.over ? '' : 'ok-row'}"><td>${i + 1}</td><td class="left">${esc(o.nome)}</td>
        ${showShift ? `<td class="left">${[...o.shifts].map(s => `<span class="shift-tag s-${s}">${s}</span>`).join(' ')}</td>` : ''}
        <td>${o.nMin}</td><td><b>${o.over}</b></td><td>${f.pct(ratio(o.over, o.nMin), 0)}</td><td>${timePill(o.min / o.nMin)}</td>
        <td class="${o.maxMin > TMAX() ? 'over' : ''}">${fmtDur(o.maxMin)}</td><td>${o.excess ? '+' + fmtDur(o.excess) : '—'}</td>
        <td>${o.pedidosTimed ? f.dec(o.min * 60 / o.pedidosTimed, 1) : '—'}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  function opsTable(list, showShift, compact = false) {
    if (!list.length) return ui.empty('Sem dados.');
    return `<div class="table-wrap"><table><thead><tr><th>#</th><th class="left">Operador</th>${showShift ? '<th class="left">Turno</th>' : ''}
      <th>ATs</th><th>Pedidos</th><th>Missing</th><th>% Missing</th><th>Missorted</th>${compact ? '' : '<th>ATs c/ missing</th>'}<th>Tempo médio</th></tr></thead><tbody>
      ${list.map((o, i) => `<tr><td>${i + 1}</td><td class="left">${esc(o.nome)}</td>${showShift ? `<td class="left">${[...o.shifts].map(s => `<span class="shift-tag s-${s}">${s}</span>`).join(' ')}</td>` : ''}
        <td>${o.ats}</td><td>${f.int(o.pedidos)}</td><td><b>${o.missing}</b></td><td>${f.pct(ratio(o.missing, o.pedidos), 2)}</td><td>${o.missorted}</td>
        ${compact ? '' : `<td>${o.atsMissing}</td>`}<td>${o.nMin ? fmtDur(o.min / o.nMin) : '—'}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  // ---------- Importação ----------
  const $ = id => document.getElementById(id);

  function openImport(file) {
    pending = null;
    $('auFile').value = '';
    $('auDate').value = '';
    document.querySelectorAll('input[name="auShift"]').forEach(r => { r.checked = false; });
    $('auPreview').innerHTML = '';
    auMsg('');
    $('auditDlg').showModal();
    if (file) readFile(file);
  }
  const auMsg = (t, ok) => { $('auMsg').textContent = t; $('auMsg').className = 'settings-msg ' + (t ? (ok ? 'ok' : 'err') : ''); };

  async function readFile(file) {
    pending = null; $('auPreview').innerHTML = '';
    if (!/\.csv$/i.test(file.name)) return auMsg('Escolha o arquivo .csv exportado do LMHub Audit.', false);
    const grid = P.csv(await file.text());
    const h = grid.findIndex(r => r.some(c => P.norm(c) === 'at/to'));
    const header = h >= 0 ? grid[h].map(P.txt) : [];
    const missingCols = REQUIRED.filter(c => !header.includes(c));
    if (h < 0 || missingCols.length) return auMsg(`Este arquivo não parece um relatório LMHub Audit (faltam colunas: ${missingCols.join(', ') || 'AT/TO'}).`, false);
    const rows = grid.slice(h + 1).filter(r => P.txt(r[0]));
    const data = P.auditRows(P.table([header, ...rows], 'AT/TO'));
    if (!data.length) return auMsg('O relatório não tem nenhuma AT.', false);
    // Só o resumo calculado segue adiante; as linhas do CSV ficam apenas na memória.
    const summary = summarize(data);
    pending = { fileName: file.name, summary };
    const a = agg([{ s: summary }]);
    // Sugestão de dia: data das validações; senão, a data no nome do arquivo.
    const fromRows = a.t0 ? `${a.t0.getFullYear()}-${String(a.t0.getMonth() + 1).padStart(2, '0')}-${String(a.t0.getDate()).padStart(2, '0')}` : '';
    const fromName = (file.name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
    $('auDate').value = fromRows || fromName;
    $('auPreview').innerHTML = `<b>${esc(file.name)}</b><br>${a.ats} ATs · ${f.int(a.initial)} pedidos · <b>${a.missing}</b> missing · ${a.missorted} missorted ·
      validações de ${hhmm(a.t0)} a ${hhmm(a.t1)}${a.t0 ? ` em ${a.t0.toLocaleDateString('pt-BR')}` : ''}`;
    auMsg('Confira o dia e escolha o turno do relatório.', true);
    checkExisting();
  }

  function checkExisting() {
    const date = $('auDate').value, shift = (document.querySelector('input[name="auShift"]:checked') || {}).value;
    if (!pending) return;
    if (date && shift && st.reports.some(r => !st.demo && r.date === date && r.shift === shift))
      auMsg(`Já existe um relatório de ${fmtDay(date)} turno ${shift}. Ao importar, ele será substituído.`, false);
    else if (date && shift) auMsg(`Pronto para importar como ${fmtDay(date)} · turno ${shift}.`, true);
  }

  async function saveImport() {
    const date = $('auDate').value;
    const shift = (document.querySelector('input[name="auShift"]:checked') || {}).value;
    if (!pending) return auMsg('Escolha o arquivo .csv do relatório.', false);
    if (!date) return auMsg('Informe o dia do relatório.', false);
    if (!shift) return auMsg('Escolha o turno: AM, PM1 ou PM2.', false);
    try {
      await store.save({ date, shift, ...pending });
      savedCache = null;
      $('auditDlg').close();
      await load();
      st.shift = shift;
      if (ui.setDayIso) ui.setDayIso(date);
      ui.rerender();
      ui.toast(`Relatório ${fmtDay(date)} ${shift} importado`);
    } catch (err) {
      auMsg(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), false);
    }
  }

  // ---------- Exemplo (fictício, em memória) ----------
  function demoReports() {
    const grid = (window.SAMPLE_DATA.sheets || {})['Missing T3'] || [];
    const [header, ...base] = grid;
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const out = [];
    const last = new Date('2026-09-29T12:00:00');
    for (let d = 6; d >= 0; d--) {
      const day = new Date(last - d * 86400000).toISOString().slice(0, 10);
      SHIFTS.forEach((shift, si) => {
        const rows = base.map(r => {
          const c = r.slice();
          const miss = rnd() < 0.55 ? 0 : Math.floor(rnd() * 4.2);
          const mis = rnd() < 0.6 ? 0 : Math.floor(rnd() * 3);
          c[3] = String(Math.max(0, +c[2] - miss)); c[4] = String(Math.max(0, +c[2] - miss + mis)); c[5] = String(mis); c[6] = String(miss);
          [7, 8].forEach(k => {
            const t = new Date(c[k].replace(' ', 'T'));
            t.setDate(t.getDate() - d); t.setHours(t.getHours() + si * 8);
            const pad = n => String(n).padStart(2, '0');
            c[k] = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
          });
          return c;
        });
        out.push({ date: day, shift, fileName: `exemplo_${day}_${shift}.csv`, importedAt: new Date().toISOString(), header, rows });
      });
    }
    return sortReports(out.map(hydrate));
  }

  // ---------- Eventos ----------
  function bindOnce() {
    if (bound) return;
    bound = true;
    const main = ui.main;
    main.addEventListener('click', async e => {
      if (!ui.isActive()) return;
      const t = e.target.closest('[data-au],[data-au-shift],[data-au-open],[data-au-del]');
      if (!t) return;
      const d = t.dataset;
      if (d.au === 'import') openImport();
      else if (d.au === 'demo') {
        st.reports = demoReports(); st.demo = true; st.shift = 'ALL';
        const ds = st.reports.map(r => r.date).sort();
        if (ui.setPeriodIso) ui.setPeriodIso(ds[0], ds[ds.length - 1]); else ui.rerender();
      }
      else if (d.au === 'exit-demo') { await load(); ui.rerender(); }
      else if (d.auShift) { st.shift = d.auShift; ui.rerender(); }
      else if (d.auOpen) { const [date, shift] = d.auOpen.split('_'); st.shift = shift; if (ui.setDayIso) ui.setDayIso(date); else ui.rerender(); document.querySelector('.content').scrollTo({ top: 0, behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else if (d.auDel) {
        const [date, shift] = d.auDel.split('_');
        if (!confirm(`Excluir o relatório de ${fmtDay(date)} turno ${shift} deste computador?`)) return;
        await store.del(date, shift); savedCache = null; await load(); ui.rerender(); ui.toast('Relatório excluído');
      }
    });
    main.addEventListener('change', e => {
    });
    main.addEventListener('input', e => {
      if (e.target.id !== 'auSearch' || !ui.isActive()) return;
      st.search = e.target.value;
      const pos = e.target.selectionStart;
      ui.rerender();
      const n = $('auSearch'); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
    });
    // Arrastar e soltar o .csv na tela
    main.addEventListener('dragover', e => { if (ui.isActive()) { e.preventDefault(); main.classList.add('dragging'); } });
    main.addEventListener('dragleave', e => { if (e.target === main) main.classList.remove('dragging'); });
    main.addEventListener('drop', e => {
      main.classList.remove('dragging');
      if (!ui.isActive()) return;
      e.preventDefault();
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) openImport(file);
    });

    $('auFile').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); });
    $('auDate').addEventListener('change', checkExisting);
    document.querySelectorAll('input[name="auShift"]').forEach(r => r.addEventListener('change', checkExisting));
    $('auSave').addEventListener('click', saveImport);
    const drop = $('auDrop');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    drop.addEventListener('click', () => $('auFile').click());
  }

  // Relatório salvo de um dia/turno (usado pelos reports de turno). Ignora o modo exemplo.
  let savedCache = null;
  async function getSaved(date, shift) {
    if (!savedCache || shared()) savedCache = (await store.list()).map(hydrate);
    return savedCache.find(r => r.date === date && r.shift === shift) || null;
  }
  const invalidate = () => { savedCache = null; };

  return { render, openImport, getSaved, invalidate, summarize: (header, rows) => summarize(rowsOf(header, rows)) };
})();
