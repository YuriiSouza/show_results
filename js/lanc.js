// Lançamentos do dia (multi-hub): substitui o preenchimento das planilhas mensais. Cada área tem os campos do dia; ao salvar,
// só os valores que mudaram vão para a guia Indicadores da planilha do hub (uma linha por dia e indicador, vale a mais
// recente). Totais que na planilha mensal eram fórmula (total recebido, HC presente, totais AM + PM, total do inventário)
// são calculados aqui e gravados junto, para o dashboard ler igual.
window.Lanc = (() => {
  const H = window.Charts;
  const esc = H.esc;
  const B = () => window.Base;
  const CT = () => window.Central;
  const TZ = 'America/Sao_Paulo';
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
  const $ = id => document.getElementById(id);
  let ui = null, bound = false;
  const st = { date: today(), draft: {}, saving: false };

  // Campos: [caminho, rótulo, tipo] — tipo: int (padrão), pct (digitado em %, gravado em fração), dec.
  const HCK = [['hc', 'HC'], ['dsr', 'DSR'], ['abs', 'ABS'], ['ferias', 'Férias'], ['desligado', 'Desligado'], ['afastamento', 'Afastamento']];
  const AREAS = [
    { id: 'rec', title: 'Recebimento', sub: 'Volume do dia', groups: [
      { fields: [['rec.am', 'Recebimento AM'], ['rec.pm', 'Recebimento PM'], ['rec.projetado', 'Volume projetado'], ['rec.packedXpt', 'Packed XPT'], ['rec.xptCarregado', 'XPT carregado']],
        calc: [['rec.total', 'Total recebido (AM + PM)']] },
    ] },
    { id: 'hc', title: 'HC', sub: 'Pessoas do dia por turno', groups: [
      { title: 'Turno AM', fields: [...HCK.map(([k, l]) => [`hc.am.${k}`, l]), ['hc.dwAM', 'Diaristas']], calc: [['hc.am.presente', 'Presentes AM']] },
      { title: 'Turno PM', fields: [...HCK.map(([k, l]) => [`hc.pm.${k}`, l]), ['hc.dwPM', 'Diaristas']], calc: [['hc.pm.presente', 'Presentes PM']] },
      { title: 'Total do dia', fields: [], calc: [...HCK.map(([k, l]) => [`hc.total.${k}`, l]), ['hc.total.diaristas', 'Diaristas'], ['hc.total.presente', 'Presentes']] },
    ] },
    { id: 'inv', title: 'Inventário', sub: 'Aging e MA do dia', groups: [
      { title: 'Aging', fields: window.AGING_NAMES.map((n, i) => [`inv.aging.${i}`, n]), calc: [['inv.total', 'Total']] },
      ...['T1', 'T3'].map(t => ({ title: `MA ${t}`, fields: [['total', 'Total'], ['backlog', 'Backlog'], ['emRota', 'Em rota'], ['enviadoSoc', 'Enviado ao SOC'], ['semRastreio', 'Sem rastreio'], ['lost', 'Lost confirmado']].map(([k, l]) => [`inv.ma.${t}.${k}`, l]) })),
    ] },
    { id: 'rev', title: 'Reversa', sub: 'Pacotes do dia', groups: [
      { fields: [['rev.onHold', 'On hold'], ['rev.avariaHub', 'Avaria HUB'], ['rev.avariaSoc', 'Avaria SOC'], ['rev.retornoSoc', 'Retorno SOC']] },
    ] },
    { id: 'tr', title: 'Transporte', sub: 'Rotas e entregas do dia', groups: [
      { fields: [['tr.rotas', 'Rotas'], ['tr.ats', 'ATs no piso'], ['tr.spr', 'SPR', 'dec'], ['tr.ds', '% DS', 'pct'], ['tr.dsD0', '% DS D0', 'pct']] },
    ] },
  ];
  const FIELDS = new Map();
  AREAS.forEach(a => a.groups.forEach(g => [...g.fields, ...(g.calc || [])].forEach(([p, l, t]) => FIELDS.set(p, { label: l, type: t || 'int', area: a.id }))));

  // ---------- Valores ----------
  const saved = path => { const x = B().indicadorGet(st.date, path); return x ? x.v : null; };
  // Valor atual do campo: o rascunho (digitado e não salvo) ou o salvo. Rascunho '' = apagar.
  const cur = path => (path in st.draft ? st.draft[path] : saved(path));
  const parse = (txt, type) => {
    const t = String(txt || '').trim();
    if (!t) return null;
    const n = window.Parser.num(t.replace(/%$/, ''));
    if (n == null) return undefined;
    return type === 'pct' ? Math.round(n * 1e4) / 1e6 : n;
  };
  const show = (v, type) => (v == null ? '' : type === 'pct' ? +(v * 100).toFixed(2) + '' : type === 'dec' ? String(+v.toFixed(2)) : String(Math.round(v)));
  const sumOr = (...vals) => (vals.every(v => v == null) ? null : vals.reduce((s, v) => s + (v || 0), 0));
  // Campos calculados a partir dos digitados (as mesmas fórmulas da planilha mensal).
  function calcs() {
    const v = cur, out = {};
    out['rec.total'] = sumOr(v('rec.am'), v('rec.pm'));
    ['am', 'pm'].forEach(t => {
      const hc = v(`hc.${t}.hc`);
      out[`hc.${t}.presente`] = hc == null ? null : hc - ['dsr', 'abs', 'ferias', 'desligado', 'afastamento'].reduce((s, k) => s + (v(`hc.${t}.${k}`) || 0), 0);
    });
    HCK.forEach(([k]) => { out[`hc.total.${k}`] = sumOr(v(`hc.am.${k}`), v(`hc.pm.${k}`)); });
    out['hc.total.presente'] = sumOr(out['hc.am.presente'], out['hc.pm.presente']);
    out['hc.total.diaristas'] = sumOr(v('hc.dwAM'), v('hc.dwPM'));
    out['inv.total'] = sumOr(...window.AGING_NAMES.map((_, i) => v(`inv.aging.${i}`)));
    return out;
  }
  const dirty = () => Object.keys(st.draft).filter(p => st.draft[p] === undefined || (st.draft[p] == null ? null : st.draft[p]) !== saved(p));

  // ---------- Tela ----------
  function render(ctx) {
    ui = ctx;
    if (!bound) { bound = true; bind(); }
    draw();
  }
  const brDate = iso => iso.split('-').reverse().join('/');
  const shift = (iso, d) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
  const when = at => (at ? new Date(at).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  // Último lançamento da área no dia (quem e quando).
  function lastOf(area) {
    let best = null;
    FIELDS.forEach((f, p) => { if (f.area !== area) return; const x = B().indicadorGet(st.date, p); if (x && (!best || x.at > best.at)) best = x; });
    return best;
  }

  function draw() {
    const ro = !B().enabled() || (CT() && CT().readOnly());
    const c = calcs(), d = dirty();
    const filled = a => [...FIELDS.entries()].filter(([p, f]) => f.area === a && cur(p) != null).length;
    const hub = CT() && CT().hub();
    ui.main.innerHTML = ui.head('Lançamentos do dia', `${hub ? esc(hub.nome || hub.id) + ' · ' : ''}grava na planilha de dados do hub`) + `
      <div class="lc-bar card">
        <button class="tool" data-lc="prev" title="Dia anterior">‹</button>
        <label class="lc-date">📅 <input type="date" id="lcDate" value="${st.date}" max="${today()}"></label>
        <button class="tool" data-lc="next" title="Próximo dia" ${st.date >= today() ? 'disabled' : ''}>›</button>
        ${st.date !== today() ? '<button class="tool" data-lc="today">Hoje</button>' : ''}
        <span class="lc-state">${d.length ? `<span class="pill warn">${d.length} alteração(ões) não salva(s)</span>` : '<span class="pill good">✓ tudo salvo</span>'}</span>
        <button class="btn-primary solid" id="lcSave" data-lc="save" ${d.length && !ro && !st.saving ? '' : 'disabled'}>${st.saving ? 'Salvando…' : 'Salvar lançamentos'}</button>
      </div>
      ${ro ? `<div class="au-demo">${B().enabled() ? 'Seu acesso é só de consulta: os valores aparecem, mas não podem ser alterados.' : 'Para lançar é preciso entrar com a conta Google e ter a planilha de dados do hub.'}</div>` : ''}
      <div class="grid lc-grid">${AREAS.map(a => {
        const last = lastOf(a.id);
        return `<section class="card w6 lc-card"><div class="card-head"><div><div class="card-title">${a.title}</div>
          <div class="card-sub">${a.sub} · ${filled(a.id)} campo(s) preenchido(s)</div></div>
          <div class="muted small lc-last">${last ? `último: ${esc(last.user)}<br>${esc(when(last.at))}` : 'nada lançado no dia'}</div></div>
          ${a.groups.map(g => `<div class="lc-group">${g.title ? `<div class="lc-gt">${g.title}</div>` : ''}
            <div class="lc-fields">${g.fields.map(([p, l, t]) => {
              const v = cur(p), ch = p in st.draft && (st.draft[p] == null ? null : st.draft[p]) !== saved(p);
              return `<label class="${ch ? 'lc-ch' : ''}">${esc(l)}${t === 'pct' ? ' <span class="muted">(%)</span>' : ''}
                <input type="text" inputmode="decimal" data-lc-f="${p}" value="${esc(show(v, t || 'int'))}" ${ro ? 'readonly' : ''} autocomplete="off"></label>`;
            }).join('')}
            ${(g.calc || []).map(([p, l]) => `<label class="lc-calc">${esc(l)}<output data-lc-c="${p}">${c[p] == null ? '—' : H.fmt.int(c[p])}</output></label>`).join('')}</div></div>`).join('')}
        </section>`;
      }).join('')}</div>
      <p class="muted small">Enter vai para o próximo campo. Os campos em cinza são calculados. Deixar um campo vazio e salvar apaga o valor do dia.
        O HSE do mês continua vindo da importação das planilhas mensais.</p>`;
  }
  // Atualiza só os calculados e a barra (sem redesenhar os campos enquanto a pessoa digita).
  function refreshCalc() {
    const c = calcs();
    ui.main.querySelectorAll('[data-lc-c]').forEach(o => { const v = c[o.dataset.lcC]; o.textContent = v == null ? '—' : H.fmt.int(v); });
    const d = dirty(), b = $('lcSave');
    if (b) b.disabled = !d.length || st.saving || (CT() && CT().readOnly());
    const s = ui.main.querySelector('.lc-state');
    if (s) s.innerHTML = d.length ? `<span class="pill warn">${d.length} alteração(ões) não salva(s)</span>` : '<span class="pill good">✓ tudo salvo</span>';
  }

  async function save() {
    const d = dirty();
    if (!d.length || st.saving) return;
    const bad = d.filter(p => st.draft[p] === undefined);
    if (bad.length) return ui.toast(`Valor inválido em: ${bad.map(p => FIELDS.get(p).label).join(', ')}`, true);
    const c = calcs();
    const items = [...d.map(p => ({ iso: st.date, path: p, v: st.draft[p] })),
      ...Object.entries(c).map(([p, v]) => ({ iso: st.date, path: p, v }))];
    st.saving = true; refreshCalc();
    try {
      const n = await B().indicadoresSave(items, 'Lançamento no app');
      st.draft = {};
      ui.toast(`${n} valor(es) salvo(s) para ${brDate(st.date)}`);
      if (ui.rebuild) ui.rebuild();
    } catch (e) { ui.toast(String(e.message || e), true); }
    finally { st.saving = false; if (ui.isActive()) draw(); }
  }
  async function goDate(iso) {
    if (!iso || iso === st.date) return;
    if (dirty().length && !(await window.uiConfirm(`Há ${dirty().length} alteração(ões) não salva(s) em ${brDate(st.date)}. Descartar?`, { ok: 'Descartar' }))) { draw(); return; }
    st.date = iso > today() ? today() : iso; st.draft = {}; draw();
  }

  function bind() {
    const main = ui.main;
    main.addEventListener('click', e => {
      if (!ui.isActive()) return;
      const t = e.target.closest('[data-lc]');
      if (!t) return;
      const a = t.dataset.lc;
      if (a === 'save') save();
      else if (a === 'prev') goDate(shift(st.date, -1));
      else if (a === 'next') goDate(shift(st.date, 1));
      else if (a === 'today') goDate(today());
    });
    main.addEventListener('input', e => {
      if (!ui.isActive() || !e.target.dataset.lcF) return;
      const p = e.target.dataset.lcF, f = FIELDS.get(p);
      st.draft[p] = parse(e.target.value, f.type);
      e.target.closest('label').classList.toggle('lc-ch', (st.draft[p] == null ? null : st.draft[p]) !== saved(p));
      e.target.classList.toggle('lc-bad', st.draft[p] === undefined);
      refreshCalc();
    });
    main.addEventListener('change', e => { if (ui.isActive() && e.target.id === 'lcDate') goDate(e.target.value); });
    main.addEventListener('keydown', e => {
      if (!ui.isActive() || e.key !== 'Enter' || !e.target.dataset.lcF) return;
      e.preventDefault();
      const all = [...main.querySelectorAll('[data-lc-f]:not([readonly])')], k = all.indexOf(e.target);
      if (all[k + 1]) { all[k + 1].focus(); all[k + 1].select(); } else if (!$('lcSave').disabled) save();
    });
  }

  const hasDraft = () => dirty().length > 0;
  return { render, hasDraft, _: { AREAS, FIELDS } };
})();
