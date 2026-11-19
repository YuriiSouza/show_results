// Lançamentos do dia (multi-hub): substitui o preenchimento das planilhas mensais. Uma área por vez (Recebimento, HC,
// Inventário, Reversa, Transporte); ao salvar, só os valores que mudaram (de todas as áreas) vão para a guia Indicadores da
// planilha do hub (uma linha por dia e indicador, vale a mais recente). Totais que na planilha mensal eram fórmula (total
// recebido, presentes, totais AM + PM, total do inventário) são calculados aqui e gravados junto, para o dashboard ler igual.
window.Lanc = (() => {
  const H = window.Charts;
  const esc = H.esc;
  const B = () => window.Base;
  const CT = () => window.Central;
  const TZ = 'America/Sao_Paulo';
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
  const $ = id => document.getElementById(id);
  let ui = null, bound = false;
  const st = { date: today(), draft: {}, saving: false, area: 'rec', sug: {}, sugBusy: '', fromSug: new Set() };

  // Seções: lista (rótulo | dia anterior | valor) ou tabela (linhas × colunas, ex.: HC por turno).
  // Campo: [caminho, rótulo, tipo] — tipo: int (padrão), pct (digitado em %, gravado em fração), dec. calc = calculado.
  const HCK = [['hc', 'HC'], ['dsr', 'DSR'], ['abs', 'ABS'], ['ferias', 'Férias'], ['desligado', 'Desligado'], ['afastamento', 'Afastamento']];
  const MAK = [['total', 'Total'], ['backlog', 'Backlog'], ['emRota', 'Em rota'], ['enviadoSoc', 'Enviado ao SOC'], ['semRastreio', 'Sem rastreio'], ['lost', 'Lost confirmado']];
  const AREAS = [
    { id: 'rec', title: 'Recebimento', desc: 'Volume recebido no dia e o projetado.', sections: [
      { kind: 'list', rows: [['rec.am', 'Recebimento AM'], ['rec.pm', 'Recebimento PM'], ['rec.total', 'Total recebido', 'int', true],
        ['rec.projetado', 'Volume projetado'], ['rec.packedXpt', 'Packed XPT'], ['rec.xptCarregado', 'XPT carregado']] },
    ] },
    { id: 'hc', title: 'HC', desc: 'Quadro de pessoas do dia por turno. Presentes = HC − DSR − ABS − Férias − Desligado − Afastamento.', sections: [
      { kind: 'matrix', cols: ['AM', 'PM', 'Total'], rows: [
        ...HCK.map(([k, l]) => ({ label: l, cells: [[`hc.am.${k}`], [`hc.pm.${k}`], [`hc.total.${k}`, true]] })),
        { label: 'Diaristas', cells: [['hc.dwAM'], ['hc.dwPM'], ['hc.total.diaristas', true]] },
        { label: 'Presentes', strong: true, cells: [['hc.am.presente', true], ['hc.pm.presente', true], ['hc.total.presente', true]] },
      ] },
    ] },
    { id: 'inv', title: 'Inventário', desc: 'Aging dos pacotes no hub e a situação do MA por turno.', sections: [
      { kind: 'list', title: 'Aging', rows: [...window.AGING_NAMES.map((n, i) => [`inv.aging.${i}`, n]), ['inv.total', 'Total do inventário', 'int', true]] },
      { kind: 'matrix', title: 'MA', cols: ['T1', 'T3'], rows: MAK.map(([k, l]) => ({ label: l, cells: [[`inv.ma.T1.${k}`], [`inv.ma.T3.${k}`]] })) },
    ] },
    { id: 'rev', title: 'Reversa', desc: 'Pacotes da reversa no dia.', sections: [
      { kind: 'list', rows: [['rev.onHold', 'On hold'], ['rev.avariaHub', 'Avaria HUB'], ['rev.avariaSoc', 'Avaria SOC'], ['rev.avariaXpt', 'Avaria XPT'], ['rev.retornoSoc', 'Retorno SOC']] },
    ] },
    { id: 'tr', title: 'Transporte', desc: 'Rotas, ATs e indicadores de entrega do dia.', sections: [
      { kind: 'list', rows: [['tr.rotas', 'Rotas'], ['tr.ats', 'ATs no piso'], ['tr.spr', 'SPR', 'dec'], ['tr.ds', 'DS', 'pct'], ['tr.dsD0', 'DS D0', 'pct']] },
    ] },
  ];
  const FIELDS = new Map();
  AREAS.forEach(a => a.sections.forEach(s => {
    if (s.kind === 'list') s.rows.forEach(([p, l, t, calc]) => FIELDS.set(p, { label: l, type: t || 'int', area: a.id, calc: !!calc }));
    else s.rows.forEach(r => r.cells.forEach(([p, calc], i) => FIELDS.set(p, { label: `${r.label} ${s.cols[i]}`, type: 'int', area: a.id, calc: !!calc })));
  }));
  const inputsOf = area => [...FIELDS.entries()].filter(([, f]) => f.area === area && !f.calc).map(([p]) => p);

  // ---------- Valores ----------
  const savedAt = (iso, path) => { const x = B().indicadorGet(iso, path); return x ? x.v : null; };
  const saved = path => savedAt(st.date, path);
  // Valor atual do campo: o rascunho (digitado e não salvo) ou o salvo. Rascunho null = apagar; undefined = inválido.
  const cur = path => (path in st.draft ? st.draft[path] : saved(path));
  const parse = (txt, type) => {
    const t = String(txt || '').trim();
    if (!t) return null;
    const n = window.Parser.num(t.replace(/%$/, ''));
    if (n == null) return undefined;
    return type === 'pct' ? Math.round(n * 1e4) / 1e6 : n;
  };
  const show = (v, type) => (v == null ? '' : type === 'pct' ? String(+(v * 100).toFixed(2)).replace('.', ',') : type === 'dec' ? String(+v.toFixed(2)).replace('.', ',') : String(Math.round(v)));
  const fmtv = (v, type) => (v == null ? '—' : type === 'pct' ? H.fmt.pct(v, 2) : type === 'dec' ? H.fmt.dec(v, 2) : H.fmt.int(v));
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
  const isDirty = p => st.draft[p] === undefined && p in st.draft || (p in st.draft && (st.draft[p] == null ? null : st.draft[p]) !== saved(p));
  const dirty = () => Object.keys(st.draft).filter(isDirty);
  // Só o que a pessoa digitou (sugestões preenchidas pelo app não contam para "descartar alterações?").
  const typed = () => dirty().filter(p => !st.fromSug.has(p));
  const readOnly = () => !B().enabled() || !!(CT() && CT().readOnly());

  // ---------- Sugestões (de outras telas do app) ----------
  // Recebimento AM/PM: Recebimento por hora, separado pela janela do AM (ex.: das 22:00 da véspera até 05:30); o resto do dia
  // (de 05:30 até o início do AM seguinte) é PM. A hora vale pelo horário de início (05:00–06:00 entra no AM se o fim é 05:30).
  // Avaria HUB/SOC: tela Avarias do dia, pela origem. Transporte: Audit de gestão do dia (rotas, SPR e noshow validado).
  const OFF_H = 3;   // fuso do hub (UTC−3)
  const tsAt = (iso, hhmm, plusDays = 0) => { const [y, m, d] = iso.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number); return Date.UTC(y, m - 1, d + plusDays, h + OFF_H, mi) / 1000; };
  const hhmm = ts => new Date((ts - OFF_H * 3600) * 1000).toISOString().slice(11, 16);
  function recebSug(iso) {
    const J = ((window.APP_CONFIG || {}).RECEB_JANELAS || {}).AM;
    if (!J || !J.inicio || !J.fim || !B().recebList) return {};
    const buckets = new Map();   // hora -> { total, at } (vale o salvamento mais recente que tem a hora)
    B().recebList().forEach(x => ((x.res && x.res.hours) || []).forEach(h => { const cur = buckets.get(h.ts); if (!cur || x.at > cur.at) buckets.set(h.ts, { total: Number(h.total) || 0, at: x.at }); }));
    const amFrom = tsAt(iso, J.inicio, J.inicio > J.fim ? -1 : 0), amTo = tsAt(iso, J.fim);
    const pmTo = J.inicio > J.fim ? tsAt(iso, J.inicio) : tsAt(iso, '00:00', 1);
    const sum = (a, b) => { const hs = [...buckets.entries()].filter(([ts]) => ts >= a && ts < b); return hs.length ? { v: hs.reduce((n, [, h]) => n + h.total, 0), n: hs.length } : null; };
    const am = sum(amFrom, amTo), pm = sum(amTo, pmTo), out = {};
    const d0 = iso => brDate(iso).slice(0, 5);
    if (am) out['rec.am'] = { v: am.v, how: `Recebimento por hora · ${am.n} h entre ${J.inicio} de ${d0(shift(iso, J.inicio > J.fim ? -1 : 0))} e ${J.fim}` };
    if (pm) out['rec.pm'] = { v: pm.v, how: `Recebimento por hora · ${pm.n} h de ${J.fim} até ${hhmm(pmTo)}` };
    return out;
  }
  function avariaSug(iso) {
    if (!B().avariaList) return {};
    const list = B().avariaList().filter(a => a.date === iso);
    const n = o => list.filter(a => a.origem === o).length;
    const how = o => (n(o) ? `Avarias do dia com origem ${o}` : 'Nenhuma avaria registrada no dia com essa origem');
    return { 'rev.avariaHub': { v: n('Hub'), how: how('Hub') }, 'rev.avariaSoc': { v: n('SOC'), how: how('SOC') }, 'rev.avariaXpt': { v: n('XPT'), how: how('XPT') } };
  }
  async function auditSug(iso) {
    const A = window.Audit;
    if (!A || !A.daySummary) return {};
    const all = await A.daySummary(iso, ['AM', 'PM1', 'PM2']);
    if (!all || !all.ats) return {};
    const per = [];
    for (const sh of all.shifts) { const x = await A.daySummary(iso, [sh]); if (x) per.push([sh, x]); }
    const by = f => per.map(([sh, x]) => `${sh} ${f(x)}`).join(' · ');
    const out = {
      'tr.rotas': { v: all.ats, how: `Audit de gestão · ATs do dia (${by(x => x.ats)})` },
      'tr.spr': { v: Math.round(all.initial / all.ats * 100) / 100, how: `Audit de gestão · pedidos iniciais ÷ rotas (${by(x => (x.initial / x.ats).toFixed(1).replace('.', ','))})` },
    };
    if (all.noshow != null) out['tr.ats'] = { v: all.noshow, how: `Audit de gestão · rotas noshow, sem as marcadas como erro (${by(x => x.noshow == null ? '—' : x.noshow)})${all.noshowList.some(x => !x.val) ? ` · ${all.noshowList.filter(x => !x.val).length} ainda a validar` : ''}` };
    return out;
  }
  // Calcula as sugestões do dia (o Audit é assíncrono) e redesenha quando chegam.
  async function loadSug(iso) {
    if (st.sugBusy === iso) return;
    st.sugBusy = iso;
    let out = {};
    try { out = { ...recebSug(iso), ...avariaSug(iso), ...(await auditSug(iso)) }; } catch (e) { out = {}; }
    st.sugBusy = '';
    const changed = JSON.stringify(out) !== JSON.stringify(st.sug[iso] || null);
    st.sug[iso] = out;
    if (st.date === iso) applySug();
    if (changed && ui.isActive() && st.date === iso && st.area !== 'hse') draw();
  }
  const sugOf = p => (st.sug[st.date] || {})[p] || null;
  // Como no report: campo ainda sem valor salvo (e não digitado) já vem preenchido com a sugestão, marcado em verde.
  // Ao salvar, a sugestão é gravada como os outros valores; digitar no campo tira a marca.
  function applySug() {
    if (readOnly()) return;
    Object.entries(st.sug[st.date] || {}).forEach(([p, x]) => {
      if (x.v == null || p in st.draft || saved(p) != null) return;
      st.draft[p] = x.v; st.fromSug.add(p);
    });
  }

  // ---------- Tela ----------
  function render(ctx) {
    ui = ctx;
    if (!bound) { bound = true; bind(); }
    HS().attach(ui, hseChanged);
    st.sug = {};   // relê as sugestões (as outras telas podem ter mudado)
    [...st.fromSug].forEach(p => delete st.draft[p]); st.fromSug.clear();
    draw();
  }
  const brDate = iso => iso.split('-').reverse().join('/');
  const shift = (iso, d) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
  const when = at => (at ? new Date(at).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const weekday = iso => { const w = new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' }); return w.charAt(0).toUpperCase() + w.slice(1); };
  function lastOf(area) {
    let best = null;
    FIELDS.forEach((f, p) => { if (f.area !== area) return; const x = B().indicadorGet(st.date, p); if (x && (!best || x.at > best.at)) best = x; });
    return best;
  }
  // Situação da área: quantos campos digitáveis têm valor e se há alteração não salva.
  function progress(area) {
    const ins = inputsOf(area);
    return { done: ins.filter(p => cur(p) != null).length, total: ins.length, changed: [...FIELDS.entries()].some(([p, f]) => f.area === area && isDirty(p)) };
  }

  function navHtml() {
    const isToday = st.date === today();
    return `<aside class="lc-nav">
      <div class="lc-day">
        <div class="lc-day-row"><button class="lc-arrow" data-lc="prev" title="Dia anterior" aria-label="Dia anterior">‹</button>
          <label class="lc-day-pick" title="Escolher o dia"><span class="lc-day-d">${brDate(st.date).slice(0, 5)}</span><span class="lc-day-y">${st.date.slice(0, 4)}</span>
            <input type="date" id="lcDate" value="${st.date}" max="${today()}" aria-label="Dia do lançamento"></label>
          <button class="lc-arrow" data-lc="next" title="Próximo dia" aria-label="Próximo dia" ${isToday ? 'disabled' : ''}>›</button></div>
        <div class="lc-day-w">${isToday ? 'Hoje · ' + weekday(st.date).toLowerCase() : weekday(st.date)}</div>
        ${isToday ? '' : '<button class="lc-today" data-lc="today">Voltar para hoje</button>'}
      </div>
      <nav class="lc-areas">${AREAS.map(a => {
        const p = progress(a.id), cls = p.changed ? 'ch' : p.done === p.total ? 'full' : p.done ? 'part' : '';
        return `<button class="lc-area ${a.id === st.area ? 'on' : ''}" data-lc-area="${a.id}"><span class="lc-dot ${cls}"></span><span class="lc-area-t">${a.title}</span><span class="lc-area-n">${p.done}/${p.total}</span></button>`;
      }).join('')}
        <div class="lc-sep">Do mês</div>
        <button class="lc-area ${st.area === 'hse' ? 'on' : ''}" data-lc-area="hse"><span class="lc-dot ${HS().dirty() ? 'ch' : B().hseGet(st.date.slice(0, 7)) ? 'full' : ''}" id="lcHseDot"></span><span class="lc-area-t">HSE</span><span class="lc-area-n">${HS().monthName(st.date.slice(0, 7)).slice(0, 3).toLowerCase()}</span></button></nav>
    </aside>`;
  }
  const inputHtml = (p, type, ro) => `<input class="lc-in" type="text" inputmode="decimal" data-lc-f="${p}" value="${esc(show(cur(p), type))}" ${ro ? 'readonly' : ''} autocomplete="off" aria-label="${esc(FIELDS.get(p).label)}" ${st.fromSug.has(p) && sugOf(p) ? `title="Sugerido pelo app: ${esc(sugOf(p).how)}. Confira antes de salvar."` : ''}>${type === 'pct' ? '<span class="lc-unit">%</span>' : ''}`;
  function sectionHtml(s, ro, c) {
    const prev = shift(st.date, -1);
    if (s.kind === 'list') {
      return `<div class="lc-sec">${s.title ? `<div class="lc-sec-t">${s.title}</div>` : ''}
        <div class="lc-list"><div class="lc-lh"><span></span><span>Dia anterior</span><span>${brDate(st.date).slice(0, 5)}</span></div>
        ${s.rows.map(([p, l, t, calc]) => {
          const type = t || 'int', pv = savedAt(prev, p);
          const sg = !calc && st.fromSug.has(p) && sugOf(p);
          return `<div class="lc-row ${calc ? 'calc' : ''} ${sg ? 'sug' : !calc && isDirty(p) ? 'ch' : ''}" data-lc-row="${p}"><span class="lc-lbl">${esc(l)}${sg ? `<span class="lc-sug" title="${esc(sg.how)}">sugerido · ${esc(sg.how.split(' · ')[0])}</span>` : ''}</span>
            <span class="lc-prev">${fmtv(pv, type)}</span>
            <span class="lc-val">${calc ? `<output data-lc-c="${p}">${fmtv(c[p], type)}</output>` : inputHtml(p, type, ro)}</span></div>`;
        }).join('')}</div></div>`;
    }
    return `<div class="lc-sec">${s.title ? `<div class="lc-sec-t">${s.title}</div>` : ''}
      <table class="lc-mx"><thead><tr><th></th>${s.cols.map(cn => `<th>${cn}</th>`).join('')}</tr></thead><tbody>
      ${s.rows.map(r => `<tr class="${r.strong ? 'strong' : ''}"><th>${esc(r.label)}</th>${r.cells.map(([p, calc]) => `<td class="${calc ? 'calc' : ''} ${!calc && isDirty(p) ? 'ch' : ''}" data-lc-row="${p}">${calc ? `<output data-lc-c="${p}">${fmtv(c[p], 'int')}</output>` : inputHtml(p, 'int', ro)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`;
  }

  const HS = () => window.HseLanc;
  const hseState = () => (HS().dirty() ? '<b>Alterações no HSE</b> não salvas' : '<span class="lc-ok">✓ HSE salvo</span>');
  function drawHse(ro) {
    const hub = CT() && CT().hub(), last = AREAS[AREAS.length - 1];
    ui.main.innerHTML = ui.head('Lançar indicadores', `${hub ? esc(hub.nome || hub.id) + ' · ' : ''}grava na planilha de dados do hub`) +
      (ro ? `<div class="au-demo">${B().enabled() ? 'Seu acesso é só de consulta.' : 'Para lançar é preciso entrar com a conta Google e ter a planilha de dados do hub.'}</div>` : '') + `
      <div class="lc">${navHtml()}
        <section class="lc-main">${HS().panel(st.date.slice(0, 7), ro)}
          <footer class="lc-foot"><div class="lc-foot-l"><button class="btn-ghost" data-lc-area="${last.id}">‹ ${last.title}</button></div>
            <span class="lc-state">${dirty().length ? stateTxt(dirty()) + ' · ' : ''}${hseState()}</span>
            <button class="btn-primary solid" id="lcSave" data-lc="save" ${(HS().dirty() || dirty().length) && !ro && !st.saving ? '' : 'disabled'}>${st.saving ? 'Salvando…' : 'Salvar'}</button></footer>
        </section></div>`;
  }
  // Mudança no HSE: redesenha (estrutura mudou) ou só atualiza a barra e o ponto do menu.
  function hseChanged(full) {
    if (!ui.isActive() || st.area !== 'hse') return;
    if (full) { const y = window.scrollY, sc = document.querySelector('.content'), sy = sc && sc.scrollTop; draw(); window.scrollTo(0, y); if (sc) sc.scrollTop = sy; return; }
    const s = ui.main.querySelector('.lc-state'), b = $('lcSave'), dot = $('lcHseDot');
    if (s) s.innerHTML = (dirty().length ? stateTxt(dirty()) + ' · ' : '') + hseState();
    if (b) b.disabled = !(HS().dirty() || dirty().length) || st.saving || readOnly();
    if (dot) dot.className = `lc-dot ${HS().dirty() ? 'ch' : 'full'}`;
  }
  function draw() {
    if (!(st.date in st.sug)) { st.sug[st.date] = {}; loadSug(st.date); }
    if (st.area === 'hse') return drawHse(readOnly());
    const ro = readOnly(), c = calcs(), d = dirty(), hub = CT() && CT().hub();
    const a = AREAS.find(x => x.id === st.area) || AREAS[0], last = lastOf(a.id), k = AREAS.indexOf(a);
    ui.main.innerHTML = ui.head('Lançar indicadores', `${hub ? esc(hub.nome || hub.id) + ' · ' : ''}grava na planilha de dados do hub`) +
      (ro ? `<div class="au-demo">${B().enabled() ? 'Seu acesso é só de consulta: os valores aparecem, mas não podem ser alterados.' : 'Para lançar é preciso entrar com a conta Google e ter a planilha de dados do hub.'}</div>` : '') + `
      <div class="lc">
        ${navHtml()}
        <section class="lc-main">
          <header class="lc-mh"><div><h2>${a.title}</h2><p>${esc(a.desc)}</p></div>
            <div class="lc-last">${last ? `Último lançamento<br><b>${esc(last.user)}</b> · ${esc(when(last.at))}` : 'Nada lançado neste dia'}</div></header>
          ${(() => { const n = [...st.fromSug].filter(p => FIELDS.get(p).area === a.id).length; return n ? `<div class="lc-sugbar"><span class="lc-sw"></span>${n} campo(s) preenchido(s) com sugestão de outras telas do app (borda verde). Confira e salve; digitar no campo substitui.</div>` : ''; })()}
          ${a.sections.map(s => sectionHtml(s, ro, c)).join('')}
          <footer class="lc-foot">
            <div class="lc-foot-l">${k > 0 ? `<button class="btn-ghost" data-lc-area="${AREAS[k - 1].id}">‹ ${AREAS[k - 1].title}</button>` : ''}
              ${k < AREAS.length - 1 ? `<button class="btn-ghost" data-lc-area="${AREAS[k + 1].id}">${AREAS[k + 1].title} ›</button>` : '<button class="btn-ghost" data-lc-area="hse">HSE do mês ›</button>'}</div>
            <span class="lc-state">${stateTxt(d)}</span>
            <button class="btn-primary solid" id="lcSave" data-lc="save" ${d.length && !ro && !st.saving ? '' : 'disabled'}>${st.saving ? 'Salvando…' : 'Salvar'}</button>
          </footer>
        </section>
      </div>`;
  }
  const stateTxt = d => (d.length ? `<b>${d.length}</b> alteração(ões) não salva(s)${st.fromSug.size ? ` · ${[...st.fromSug].filter(p => d.includes(p)).length} sugerida(s)` : ''}` : '<span class="lc-ok">✓ Tudo salvo</span>');
  // Enquanto digita: atualiza só os calculados, a barra e o menu das áreas (sem redesenhar os campos).
  function refreshLive() {
    const c = calcs(), d = dirty();
    ui.main.querySelectorAll('[data-lc-c]').forEach(o => { const f = FIELDS.get(o.dataset.lcC); o.textContent = fmtv(c[o.dataset.lcC], f.type); });
    const b = $('lcSave');
    if (b) b.disabled = !d.length || st.saving || readOnly();
    const s = ui.main.querySelector('.lc-state');
    if (s) s.innerHTML = stateTxt(d);
    const bar = ui.main.querySelector('.lc-sugbar'), nSug = [...st.fromSug].filter(p => FIELDS.get(p).area === st.area).length;
    if (bar) { if (!nSug) bar.remove(); else bar.innerHTML = `<span class="lc-sw"></span>${nSug} campo(s) preenchido(s) com sugestão de outras telas do app (borda verde). Confira e salve; digitar no campo substitui.`; }
    const nav = ui.main.querySelector('.lc-areas');
    if (nav) AREAS.forEach(a => {
      const btn = nav.querySelector(`[data-lc-area="${a.id}"]`), p = progress(a.id);
      if (!btn) return;
      btn.querySelector('.lc-dot').className = `lc-dot ${p.changed ? 'ch' : p.done === p.total ? 'full' : p.done ? 'part' : ''}`;
      btn.querySelector('.lc-area-n').textContent = `${p.done}/${p.total}`;
    });
  }

  async function save() {
    const d = dirty();
    if (st.saving) return;
    // HSE do mês (e os indicadores do dia, se houver alteração também).
    if (HS().dirty()) {
      st.saving = true; hseChanged(false);
      try { await HS().save(); ui.toast(`HSE de ${HS().monthName(st.date.slice(0, 7)).toLowerCase()} salvo`); if (!d.length && ui.rebuild) ui.rebuild(); }
      catch (e) { ui.toast(String(e.message || e), true); st.saving = false; if (ui.isActive()) draw(); return; }
      st.saving = false;
      if (!d.length) { if (ui.isActive()) draw(); return; }
    }
    if (!d.length) return;
    const bad = d.filter(p => st.draft[p] === undefined);
    if (bad.length) return ui.toast(`Valor inválido em: ${bad.map(p => FIELDS.get(p).label).join(', ')}`, true);
    const c = calcs();
    const items = [...d.map(p => ({ iso: st.date, path: p, v: st.draft[p] })), ...Object.entries(c).map(([p, v]) => ({ iso: st.date, path: p, v }))];
    st.saving = true; refreshLive();
    try {
      const n = await B().indicadoresSave(items, 'Lançamento no app');
      st.draft = {}; st.fromSug.clear();
      ui.toast(`${n} valor(es) salvo(s) para ${brDate(st.date)}`);
      if (ui.rebuild) ui.rebuild();
    } catch (e) { ui.toast(String(e.message || e), true); }
    finally { st.saving = false; if (ui.isActive()) draw(); }
  }
  async function goDate(iso) {
    if (!iso || iso === st.date) return;
    iso = iso > today() ? today() : iso;
    const hseLost = HS().dirty() && iso.slice(0, 7) !== st.date.slice(0, 7);
    if ((typed().length || hseLost) && !(await window.uiConfirm(`Há alterações não salvas${typed().length ? ` em ${brDate(st.date)}` : ''}${hseLost ? ' no HSE do mês' : ''}. Descartar?`, { ok: 'Descartar' }))) { draw(); return; }
    if (hseLost) HS().reset();
    st.date = iso; st.draft = {}; st.fromSug.clear(); applySug(); draw();
  }
  function goArea(id) {
    st.area = id; draw();
    const f = ui.main.querySelector('.lc-main [data-lc-f]:not([readonly])');
    if (f) f.focus();
  }

  function bind() {
    const main = ui.main;
    main.addEventListener('click', e => {
      if (!ui.isActive()) return;
      const ar = e.target.closest('[data-lc-area]');
      if (ar) { goArea(ar.dataset.lcArea); return; }
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
      const row = main.querySelector(`[data-lc-row="${p}"]`);
      if (st.fromSug.delete(p) && row) { row.classList.remove('sug'); const t = row.querySelector('.lc-sug'); if (t) t.remove(); e.target.removeAttribute('title'); }
      if (row) row.classList.toggle('ch', isDirty(p));
      e.target.classList.toggle('bad', st.draft[p] === undefined);
      refreshLive();
    });
    main.addEventListener('focusin', e => { if (ui.isActive() && e.target.dataset && e.target.dataset.lcF && !e.target.readOnly) e.target.select(); });
    main.addEventListener('change', e => { if (ui.isActive() && e.target.id === 'lcDate') goDate(e.target.value); });
    main.addEventListener('keydown', e => {
      if (!ui.isActive() || e.key !== 'Enter' || !e.target.dataset.lcF) return;
      e.preventDefault();
      // Enter: próximo campo da área (na tabela, desce na coluna); no último, vai para a próxima área.
      const all = [...main.querySelectorAll('.lc-main [data-lc-f]:not([readonly])')];
      const td = e.target.closest('td');
      let next = null;
      if (td) {
        const col = td.cellIndex, tr = td.parentElement;
        for (let r = tr.nextElementSibling; r && !next; r = r.nextElementSibling) next = r.cells[col] && r.cells[col].querySelector('[data-lc-f]');
        if (!next) { const top = tr.parentElement.rows[0], c2 = top && top.cells[col + 1]; next = c2 && c2.querySelector('[data-lc-f]'); }
      }
      next = next || all[all.indexOf(e.target) + 1];
      if (next) { next.focus(); return; }
      const k = AREAS.findIndex(x => x.id === st.area);
      if (k < AREAS.length - 1) goArea(AREAS[k + 1].id); else if (!$('lcSave').disabled) save();
    });
  }

  const hasDraft = () => typed().length > 0 || HS().dirty();
  return { render, hasDraft, _: { AREAS, FIELDS } };
})();
