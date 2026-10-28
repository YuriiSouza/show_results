// Recebimento por hora: pacotes recebidos por operador e por hora (painel de produtividade do SPX),
// com a meta do turno (pacotes a receber) e a previsão de término. Meta e resultados ficam na planilha-base
// (guia RecebimentoHora), para análise depois. A consulta ao SPX só funciona no app do computador.
window.Receb = (() => {
  const H = window.Charts;
  const esc = H.esc;
  const TZ = 'America/Sao_Paulo', OFF = -3 * 3600; // Brasília (sem horário de verão)
  const TURNOS = ['AM', 'PM1', 'PM2'];
  const INICIO = { AM: '06:00', PM1: '14:00', PM2: '22:00' }; // início padrão de cada turno (o líder ajusta)
  const AUTO_MIN = 10;              // atualização automática enquanto a tela está aberta
  const AUTOSAVE_MIN = 60;          // grava o resultado sozinho no máximo uma vez por hora
  const $ = id => document.getElementById(id);
  const api = () => window.hubApi || null;
  const B = () => window.Base;
  const baseOn = () => !!(B() && B().enabled());
  const canSpx = () => !!(api() && api().spxWfm);
  const stripId = v => String(v || '').replace(/^\s*\[[^\]]*\]\s*/, '').trim();
  const LSK = 'hub.receb';
  const ls = (() => { try { return JSON.parse(localStorage.getItem(LSK)) || {}; } catch (e) { return {}; } })();
  const lsSave = () => { try { localStorage.setItem(LSK, JSON.stringify(ls)); } catch (e) { /* sem armazenamento */ } };
  const hm = ts => new Date(ts * 1000).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const dm = ts => new Date(ts * 1000).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
  const isoOf = ts => new Date(ts * 1000).toLocaleDateString('sv-SE', { timeZone: TZ });
  const brShort = iso => iso.split('-').reverse().slice(0, 2).join('/');
  const nowTs = () => Math.floor(Date.now() / 1000);

  // ---------- Lógica (pura) ----------
  // Resposta do SPX -> horas em ordem crescente e operadores com o recebido em cada hora.
  // efficiency[i] de cada operador corresponde a time_list[i] (a lista vem da hora mais recente para a mais antiga).
  function parse(data) {
    const times = (data && data.time_list) || [];
    const order = times.map((t, i) => ({ ts: Number(t.timestamp), total: Number(t.total) || 0, i })).filter(t => t.ts > 0).sort((a, b) => a.ts - b.ts);
    const ops = ((data && data.efficiency_list) || []).map(o => {
      const eff = o.efficiency || [];
      return { op: String(o.operator || ''), name: stripId(o.operator), person: !/@/.test(String(o.operator || '')), hours: order.map(t => Number(eff[t.i]) || 0) };
    });
    return { hours: order.map(t => ({ ts: t.ts, total: t.total })), ops };
  }
  // Início do turno (HH:MM) no dia do turno -> segundos Unix.
  const startTs = (iso, hhmm) => { const [y, m, d] = iso.split('-').map(Number), [h, mi] = (hhmm || '00:00').split(':').map(Number); return Date.UTC(y, m - 1, d, h, mi) / 1000 - OFF; };
  // Recebido no turno, ritmo e previsão de término.
  // Ritmo: média das 2 últimas horas completas com recebimento; sem hora completa, a hora em andamento proporcional.
  function forecast(parsed, from, meta, now) {
    const hours = parsed.hours.filter(h => h.ts + 3600 > from && h.ts <= now);
    const recebido = hours.reduce((s, h) => s + h.total, 0);
    const full = hours.filter(h => h.ts + 3600 <= now && h.total > 0).slice(-2);
    const part = hours.find(h => h.ts <= now && now < h.ts + 3600);
    let ritmo = null, base = '';
    if (full.length) { ritmo = full.reduce((s, h) => s + h.total, 0) / full.length; base = full.length === 2 ? `média de ${hm(full[0].ts)} e ${hm(full[1].ts)}` : `hora de ${hm(full[0].ts)}`; }
    else if (part && part.total) { ritmo = part.total / Math.max(0.25, (now - part.ts) / 3600); base = 'hora em andamento'; }
    const falta = meta != null ? Math.max(0, meta - recebido) : null;
    const eta = meta == null ? null : falta === 0 ? now : ritmo ? now + Math.round(falta / ritmo * 3600) : null;
    const ops = parsed.ops.map(o => {
      const hs = parsed.hours.map((h, i) => ({ ts: h.ts, n: o.hours[i] })).filter(h => h.ts + 3600 > from && h.ts <= now);
      const total = hs.reduce((s, h) => s + h.n, 0);
      const active = hs.filter(h => h.n > 0);
      return { op: o.op, name: o.name, person: o.person, total, hours: hs.map(h => h.n), perHour: active.length ? total / active.length : 0 };
    }).filter(o => o.total > 0).sort((a, b) => b.total - a.total);
    return { hours, recebido, ritmo, base, falta, eta, ops, done: meta != null && falta === 0 };
  }

  // ---------- Tela ----------
  const st = { date: new Date().toLocaleDateString('sv-SE', { timeZone: TZ }), turno: TURNOS.includes(ls.turno) ? ls.turno : 'AM', live: null, busy: false, msg: '', timer: null, lastAuto: 0 };
  let ui = null, bound = false;
  const inicio = () => (ls.inicio && ls.inicio[st.turno]) || INICIO[st.turno];
  // Dia do turno: o dia em que ele começou. Turno da noite (início a partir das 18:00) consultado de madrugada
  // ainda é o turno de ontem.
  function turnoDay() {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
    if (+inicio().split(':')[0] < 18 || startTs(today, inicio()) <= nowTs()) return today;
    return isoOf(startTs(today, inicio()) - 86400);
  }
  const saved = () => (baseOn() ? B().recebGet(st.date, st.turno) : null);
  const metaOf = () => { const s = saved(); const d = (ls.meta || {})[`${st.date}|${st.turno}`]; return d != null ? d : s && s.meta != null && !isNaN(s.meta) ? s.meta : null; };

  function render(ctx) {
    ui = ctx;
    if (!bound) { bound = true; bind(); st.date = turnoDay(); }
    draw();
    if (baseOn()) B().load().then(() => { if (ui.isActive()) draw(); });
    clearInterval(st.timer);
    st.timer = setInterval(() => { if (ui.isActive() && st.live && !st.busy) refresh(true); else if (!ui.isActive()) clearInterval(st.timer); }, AUTO_MIN * 60000);
  }

  // Resultado mostrado: o da consulta ao vivo (quando é deste dia/turno) ou o último salvo.
  function current() {
    const meta = metaOf(), from = startTs(st.date, inicio());
    if (st.live && st.live.key === `${st.date}|${st.turno}`) return { ...forecast(st.live.parsed, from, meta, st.live.at), at: st.live.at, live: true, meta, from };
    const s = saved();
    if (s && s.res) return { ...s.res, meta, at: s.res.fetchedAt, live: false, from, done: meta != null && s.res.recebido >= meta, falta: meta != null ? Math.max(0, meta - s.res.recebido) : null };
    return { meta, from, empty: true };
  }

  const tabsHtml = () => `<div class="pc-tabs" role="tablist">${[['turno', 'Turno'], ['dash', 'Dashboard']].map(([k, l]) =>
    `<button role="tab" class="${(ls.view === 'dash' ? 'dash' : 'turno') === k ? 'active' : ''}" data-rh-view="${k}">${l}</button>`).join('')}</div>`;
  function draw() {
    const m = ui.main;
    if (ls.view === 'dash') {
      m.innerHTML = ui.head('Recebimento por hora', 'Turnos salvos · período do filtro do topo') + tabsHtml() + '<div id="rhDash"></div>';
      drawDash();
      return;
    }
    const r = current();
    const s = saved();
    m.innerHTML = ui.head('Recebimento por hora', 'Pacotes recebidos por operador · previsão de término') + tabsHtml() + `
      ${canSpx() ? '' : '<div class="au-demo">A consulta ao SPX só funciona no app do computador. Aqui aparecem a meta e o último resultado salvo.</div>'}
      <div class="au-bar pz-bar">
        <label>Dia <input type="date" id="rhDate" value="${st.date}"></label>
        <label>Turno <select id="rhTurno">${TURNOS.map(t => `<option ${t === st.turno ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Início <input type="time" id="rhInicio" value="${inicio()}"></label>
        <label>Pacotes a receber <input type="number" id="rhMeta" min="0" step="1" value="${r.meta != null ? r.meta : ''}" placeholder="ex.: 12000" class="rh-meta"></label>
        <div class="au-bar-right pz-actions">
          ${st.msg ? `<span class="muted small">${esc(st.msg)}</span>` : ''}
          ${canSpx() ? `<button class="btn-ghost" data-rh="refresh" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Consultando…' : 'Atualizar do SPX'}</button>` : ''}
          <button class="btn-primary solid" data-rh="save" ${baseOn() ? '' : 'disabled title="Salvar precisa do login Google e da planilha-base"'}>Salvar</button>
        </div>
      </div>
      <div class="muted small rh-status">${r.empty ? 'Sem resultado ainda: clique em Atualizar do SPX (usa a Sessão SPX do cabeçalho).'
        : `${r.live ? 'Consulta ao vivo' : 'Último resultado salvo'} · ${dm(r.at)} às ${hm(r.at)}${s ? ` · salvo por ${esc(s.user)} às ${new Date(s.at).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}` : ''}${r.live ? ` · atualiza sozinho a cada ${AUTO_MIN} min` : ''}`}</div>
      ${r.empty ? '' : body(r)}`;
    if (!r.empty) charts(r);
  }

  function body(r) {
    const pct = r.meta ? Math.min(1, r.recebido / r.meta) : null;
    const etaTxt = r.done ? 'Concluído' : r.eta ? hm(r.eta) : '—';
    const etaSub = r.done ? '<span class="pill good">✓ meta atingida</span>' : r.meta == null ? '<span>informe os pacotes a receber</span>'
      : r.eta ? `<span>${isoOf(r.eta) !== isoOf(r.at) ? dm(r.eta) + ' · ' : ''}faltam ${Math.max(0, Math.round((r.eta - r.at) / 60))} min no ritmo atual</span>` : '<span>sem ritmo para calcular</span>';
    const hrs = r.hours;
    return `<div class="kpis">${[
        ui.kpi('Recebido no turno', H.fmt.int(r.recebido), [`<span>desde ${inicio()}</span>`]),
        ui.kpi('A receber', r.meta != null ? H.fmt.int(r.meta) : '—', [pct != null ? `<span>${H.fmt.pct(pct, 0)} recebido</span>` : '']),
        ui.kpi('Falta', r.falta != null ? H.fmt.int(r.falta) : '—', [pct != null ? `<div class="progress"><span style="width:${pct * 100}%"></span></div>` : '']),
        ui.kpi('Ritmo', r.ritmo ? `${H.fmt.int(r.ritmo)}/h` : '—', [r.base ? `<span>${esc(r.base)}</span>` : '']),
        ui.kpi('Previsão de término', etaTxt, [etaSub]),
        ui.kpi('Operadores', H.fmt.int(r.ops.filter(o => o.person).length), [`<span>com recebimento no turno</span>`]),
      ].join('')}</div>
      ${mesasHtml(r)}
      <div class="grid">
        ${ui.card('rhCh1', 'Recebido por hora', 'Pacotes recebidos em cada hora do turno', { w: 6 })}
        ${ui.card('rhCh2', 'Acumulado e previsão', r.meta != null ? 'Linha tracejada: projeção no ritmo atual até a meta' : 'Informe os pacotes a receber para ver a projeção', { w: 6 })}
        ${ui.card('', 'Por operador', `${r.ops.length} operador(es) · pacotes por hora`, { w: 12, body: `<div class="table-wrap"><table class="pc-table"><thead><tr>
          <th class="left">Operador</th>${hrs.map(h => `<th>${hm(h.ts)}</th>`).join('')}<th>Total</th><th>Média/h</th><th>% do total</th></tr></thead><tbody>
          ${r.ops.map(o => `<tr${o.person ? '' : ' class="muted"'}><td class="left">${esc(o.name)}</td>${o.hours.map(n => `<td>${n ? H.fmt.int(n) : '<span class="muted">·</span>'}</td>`).join('')}
            <td><b>${H.fmt.int(o.total)}</b></td><td>${H.fmt.int(o.perHour)}</td><td>${H.fmt.pct(r.recebido ? o.total / r.recebido : null, 0)}</td></tr>`).join('')}
          </tbody></table></div>` })}
      </div>`;
  }

  // ---------- Bancadas do mapa de piso ----------
  // Quem está em "Recebe" em cada bancada no início do mapa de piso deste dia/turno, com o recebido no turno,
  // a última hora completa e a diferença (delta) para a hora anterior.
  function mesasHtml(r) {
    const P = window.Piso && window.Piso.helpers;
    const rec = baseOn() ? B().mapaGet(st.date, st.turno) : null;
    if (!P || !rec) return `<div class="section-sub pc-sec">Bancadas de recebimento</div>${ui.empty(`Sem mapa de piso salvo para ${brShort(st.date)} · ${st.turno}. Monte o mapa em <b>Mapa de piso</b> para ver aqui quem está recebendo em cada bancada.`)}`;
    const L = rec.map.layout, v = rec.map.versions[0], slots = P.slotsOf(L);
    const iFull = r.hours.map((h, i) => (h.ts + 3600 <= r.at ? i : -1)).filter(i => i >= 0).pop();
    const iNow = r.hours.findIndex(h => h.ts <= r.at && r.at < h.ts + 3600);
    const opOf = name => (name && !P.isDw(name) ? r.ops.find(o => P.sameName(o.name, name)) : null);
    const used = new Set();
    const cell = (mesa, s) => {
      const recebe = v.slots[`${mesa.id}.rec.${s}.0`] || '', etiqueta = v.slots[`${mesa.id}.rec.${s}.1`] || '';
      const o = opOf(recebe);
      if (o) used.add(o.op);
      const tot = o ? o.total : 0;
      const last = o && iFull != null ? o.hours[iFull] : null, prev = o && iFull > 0 ? o.hours[iFull - 1] : null;
      const now = o && iNow >= 0 ? o.hours[iNow] : null;
      const d = last != null && prev != null ? last - prev : null;
      const dTxt = d == null ? '' : `<span class="rh-delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${H.fmt.int(Math.abs(d))}${prev ? ` (${d >= 0 ? '+' : '−'}${H.fmt.pct(Math.abs(d) / prev, 0)})` : ''}</span>`;
      return `<div class="rh-banc ${!recebe ? 'empty' : tot ? 'on' : 'off'}">
        <div class="rh-banc-top"><span>Bancada ${P.bancadaNo(L, mesa.id, s)}</span>${recebe ? (tot ? '<span class="pill good">✓ recebendo</span>' : '<span class="pill neutral">sem recebimento</span>') : ''}</div>
        <div class="rh-banc-name" title="${esc(recebe)}">${recebe ? esc(recebe) : '<span class="muted">Ninguém em Recebe</span>'}</div>
        ${etiqueta ? `<div class="muted small" title="${esc(etiqueta)}">Etiqueta: ${esc(etiqueta)}</div>` : ''}
        ${recebe && !P.isDw(recebe) ? `<div class="rh-banc-num">${H.fmt.int(tot)}<small> no turno</small></div>
          <div class="rh-banc-hours">${!o ? '<span class="muted">ainda não aparece no SPX</span>' : last != null ? `<span>${hm(r.hours[iFull].ts)}: <b>${H.fmt.int(last)}</b></span> ${dTxt}` : '<span class="muted">sem hora completa</span>'}</div>
          ${now != null ? `<div class="muted small">agora (${hm(r.hours[iNow].ts)}): ${H.fmt.int(now)}</div>` : ''}` : recebe ? '<div class="muted small">Diarista: não aparece no painel do SPX pelo nome</div>' : ''}
      </div>`;
    };
    const mesas = L.mesas.filter(m => m.rec > 0).map(m => `<section class="card rh-mesa"><div class="pz-title">${esc(m.nome)}</div>
      <div class="rh-bancs">${Array.from({ length: m.rec }, (_, s) => cell(m, s)).join('')}</div></section>`).join('');
    const fora = r.ops.filter(o => o.person && o.total && !used.has(o.op));
    return `<div class="section-sub pc-sec">Bancadas de recebimento <span class="muted small">· mapa de piso, início do turno${iFull != null ? ` · delta: ${hm(r.hours[iFull].ts)} × ${iFull > 0 ? hm(r.hours[iFull - 1].ts) : '—'}` : ''}</span></div>
      <div class="rh-mesas">${mesas}</div>
      ${fora.length ? `<div class="rh-fora"><b>Recebendo fora das bancadas do mapa:</b> ${fora.map(o => `${esc(o.name)} (${H.fmt.int(o.total)})`).join(' · ')}</div>` : ''}`;
  }

  function charts(r) {
    const lab = r.hours.map(h => hm(h.ts));
    H.render('rhCh1', { labels: lab, legend: false, datasets: [H.bar('Recebido', r.hours.map(h => h.total || null), H.color(1))] });
    // Acumulado real + projeção por hora até a meta (no máximo 24 h à frente).
    let acc = 0;
    const real = r.hours.map(h => (acc += h.total));
    const labels = lab.slice(), proj = real.map(() => null);
    if (r.meta != null && r.ritmo && !r.done && r.hours.length) {
      proj[proj.length - 1] = real[real.length - 1];
      let t = r.hours[r.hours.length - 1].ts, v = real[real.length - 1];
      for (let k = 0; k < 24 && v < r.meta; k++) { t += 3600; v = Math.min(r.meta, v + r.ritmo); labels.push(hm(t)); proj.push(Math.round(v)); }
    }
    H.render('rhCh2', { labels, datasets: [
      H.line('Recebido (acumulado)', real.concat(Array(labels.length - real.length).fill(null)), H.color(2)),
      ...(proj.some(v => v != null) ? [H.line('Projeção', proj, H.color(1), { borderDash: [6, 4], pointRadius: 2 })] : []),
      ...(r.meta != null ? [H.ref(`Meta ${H.fmt.int(r.meta)}`, r.meta, labels.length, H.css('--good'))] : []),
    ] });
  }

  // ---------- Dashboard dos turnos salvos ----------
  const shortName = n => { const t = String(n || '').trim().split(/\s+/).filter(w => !/^(d[aeo]s?|e)$/i.test(w)); return t.length > 2 ? `${t[0]} ${t[t.length - 1]}` : t.join(' '); };
  const okey = n => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  function drawDash() {
    const el = $('rhDash');
    if (!el) return;
    if (!baseOn()) { el.innerHTML = ui.empty('O dashboard usa os turnos salvos na planilha-base: entre com a conta Google.'); return; }
    const rg = ui.range();
    const per = rg.from === rg.to ? brShort(rg.from) : `${brShort(rg.from)} a ${brShort(rg.to)}`;
    const inPer = B().recebList().filter(x => x.date >= rg.from && x.date <= rg.to && x.res);
    const fT = new Set(Array.isArray(ls.dTurnos) ? ls.dTurnos : []);
    const chip = (k, l, on, n) => `<button class="chip ${on ? 'active' : ''}" data-rh-t="${k}">${l}${n != null ? ` <b>${n}</b>` : ''}</button>`;
    const filtros = `<div class="pc-filters pd-filters"><span class="pd-flabel">Turno</span>${chip('all', 'Todos', !fT.size)}${TURNOS.map(t => chip(t, t, fT.has(t), inPer.filter(x => x.turno === t).length)).join('')}
      <label class="pd-flabel rh-mails"><input type="checkbox" id="rhMails" ${ls.mails ? 'checked' : ''}> incluir e-mails (@shopee)</label></div>`;
    const list = inPer.filter(x => !fT.size || fT.has(x.turno)).sort((a, b) => (a.date + a.turno).localeCompare(b.date + b.turno));
    if (!list.length) { el.innerHTML = filtros + ui.empty(inPer.length ? 'Nenhum turno salvo para os turnos escolhidos.' : `Nenhum turno salvo em ${per}. Mude o período no filtro do topo.`); return; }

    // Produtividade por colaborador: pacotes por hora ativa (horas em que recebeu algo), somando todos os turnos do período.
    const ops = new Map();
    list.forEach(x => (x.res.ops || []).forEach(o => {
      if (!o.person && !ls.mails) return;
      const k = okey(o.name || o.op), hs = (o.hours || []).filter(n => n > 0);
      const a = ops.get(k) || { nome: o.name || o.op, person: o.person, turnos: 0, dias: new Set(), total: 0, horas: 0, melhor: 0, porTurno: [] };
      a.turnos++; a.dias.add(x.date); a.total += o.total || 0; a.horas += hs.length || (o.total ? 1 : 0); a.melhor = Math.max(a.melhor, ...hs, 0);
      a.porTurno.push(o.total || 0);
      ops.set(k, a);
    }));
    const rows = [...ops.values()].map(a => ({ ...a, pph: a.horas ? a.total / a.horas : 0, media: a.total / a.turnos }));
    const teamPph = rows.reduce((s2, a) => s2 + a.total, 0) / Math.max(1, rows.reduce((s2, a) => s2 + a.horas, 0));
    const sortBy = ls.sortBy || 'pph';
    rows.sort((a, b) => (b[sortBy] - a[sortBy]) || a.nome.localeCompare(b.nome, 'pt-BR'));

    const total = list.reduce((s2, x) => s2 + (x.res.recebido || 0), 0);
    const comMeta = list.filter(x => x.meta != null && !isNaN(x.meta) && x.meta > 0);
    const bateu = comMeta.filter(x => x.res.recebido >= x.meta).length;
    const ritmos = list.map(x => x.res.ritmo).filter(Boolean);
    const dias = [...new Set(list.map(x => x.date))].sort();
    // Perfil por hora do dia: média de pacotes em cada hora (horário de Brasília) nos turnos salvos.
    const hourAgg = new Map();
    list.forEach(x => (x.res.hours || []).forEach(h => { const k = hm(h.ts).slice(0, 2); const a = hourAgg.get(k) || [0, 0]; a[0] += h.total || 0; a[1]++; hourAgg.set(k, a); }));
    const horas = [...hourAgg.keys()].sort();
    const top = rows.slice(0, 15);
    el.innerHTML = filtros + `<div class="kpis">${[
        ui.kpi('Turnos salvos', H.fmt.int(list.length), [`<span>${dias.length} dia(s) · ${per}</span>`]),
        ui.kpi('Recebido no período', H.fmt.int(total), [`<span>média de ${H.fmt.int(total / list.length)} por turno</span>`]),
        ui.kpi('Meta atingida', comMeta.length ? H.fmt.pct(bateu / comMeta.length, 0) : '—', [comMeta.length ? `<span>${bateu} de ${comMeta.length} turno(s) com meta</span>` : '<span>nenhum turno com "a receber"</span>']),
        ui.kpi('Ritmo médio', ritmos.length ? `${H.fmt.int(ritmos.reduce((a, b) => a + b, 0) / ritmos.length)}/h` : '—', ['<span>do turno inteiro</span>']),
        ui.kpi('Produtividade da equipe', `${H.fmt.int(teamPph)}/h`, ['<span>pacotes por hora ativa, por colaborador</span>']),
        ui.kpi('Colaboradores', H.fmt.int(rows.length), [rows[0] ? `<span>mais produtivo: ${esc(shortName(rows.slice().sort((a, b) => b.pph - a.pph)[0].nome))}</span>` : '']),
      ].join('')}</div>
      <div class="grid">
        ${ui.card('rdCh4', 'Produtividade por colaborador', `Pacotes por hora ativa · top ${top.length} · linha = média da equipe`, { w: 12, h: 'tall' })}
        ${ui.card('', 'Produtividade por colaborador', `${rows.length} colaborador(es) · horas ativas = horas em que recebeu pacotes`, { w: 12,
          tools: `<input class="search" id="rhQ" type="search" placeholder="Buscar…"><select id="rhSort" aria-label="Ordenar por">${[['pph', 'Pacotes/hora'], ['total', 'Total recebido'], ['media', 'Média por turno'], ['turnos', 'Turnos']].map(([k, l]) => `<option value="${k}" ${k === sortBy ? 'selected' : ''}>Ordenar: ${l}</option>`).join('')}</select>`,
          body: `<div class="table-wrap"><table class="pc-table rd-prod"><thead><tr><th class="left">Colaborador</th><th>Pacotes/hora</th><th>vs equipe</th><th>Total</th><th>Turnos</th><th>Dias</th><th>Média/turno</th><th>Horas ativas</th><th>Melhor hora</th><th>% do recebido</th></tr></thead><tbody>
            ${rows.map(a => { const idx = teamPph ? a.pph / teamPph : null; return `<tr data-rhrow="${esc(okey(a.nome))}"${a.person ? '' : ' class="muted"'}><td class="left">${esc(a.nome)}</td>
              <td><b>${H.fmt.int(a.pph)}</b></td><td><span class="rh-delta ${idx >= 1.1 ? 'up' : idx <= 0.9 ? 'down' : ''}">${idx != null ? H.fmt.pct(idx, 0) : '—'}</span></td>
              <td>${H.fmt.int(a.total)}</td><td>${a.turnos}</td><td>${a.dias.size}</td><td>${H.fmt.int(a.media)}</td><td>${a.horas}</td><td>${H.fmt.int(a.melhor)}</td><td>${H.fmt.pct(total ? a.total / total : null, 1)}</td></tr>`; }).join('')}
          </tbody></table></div>` })}
        ${ui.card('rdCh1', 'Recebido por dia', 'Por turno', { w: 6 })}
        ${ui.card('rdCh3', 'Perfil por hora do dia', 'Média de pacotes recebidos em cada hora', { w: 6 })}
        ${ui.card('rdCh2', 'Recebido × a receber por turno', 'Turnos salvos', { w: 12 })}
        ${ui.card('', 'Turnos salvos', '', { w: 12, body: `<div class="table-wrap"><table class="pc-table"><thead><tr><th class="left">Dia</th><th class="left">Turno</th><th class="left">Início</th>
          <th>A receber</th><th>Recebido</th><th>%</th><th>Ritmo</th><th class="left">Previsão</th><th>Operadores</th><th class="left">Salvo por</th></tr></thead><tbody>
          ${list.slice().reverse().map(x => { const res = x.res || {}; return `<tr><td class="left">${brShort(x.date)}</td><td class="left">${esc(x.turno)}</td><td class="left">${esc(x.inicio)}</td>
            <td>${x.meta != null && !isNaN(x.meta) ? H.fmt.int(x.meta) : '—'}</td><td>${res.recebido != null ? H.fmt.int(res.recebido) : '—'}</td>
            <td>${x.meta && res.recebido != null ? H.fmt.pct(res.recebido / x.meta, 0) : '—'}</td><td>${res.ritmo ? H.fmt.int(res.ritmo) + '/h' : '—'}</td>
            <td class="left">${res.recebido != null && x.meta && res.recebido >= x.meta ? 'Concluído' : res.eta ? `${dm(res.eta)} ${hm(res.eta)}` : '—'}</td>
            <td>${res.ops ? res.ops.filter(o => o.person).length : '—'}</td><td class="left muted">${esc(x.user)}</td></tr>`; }).join('')}
        </tbody></table></div>` })}
      </div>`;
    const byPph = rows.slice().sort((a, b) => b.pph - a.pph).slice(0, 15);
    H.render('rdCh4', { labels: byPph.map(a => shortName(a.nome)), horizontal: true, legend: false, datasets: [
      H.bar('Pacotes/hora', byPph.map(a => Math.round(a.pph)), H.color(1)), H.ref(`Média da equipe ${H.fmt.int(teamPph)}`, Math.round(teamPph), byPph.length, H.css('--good')) ] });
    const tt = TURNOS.filter(t => list.some(x => x.turno === t));
    H.render('rdCh1', { labels: dias.map(H.dayLabel), stacked: true, totals: true, datasets: tt.map((t, i) =>
      H.bar(t, dias.map(d => list.filter(x => x.date === d && x.turno === t).reduce((a, x) => a + (x.res.recebido || 0), 0) || null), H.color(i + 1))) });
    H.render('rdCh3', { labels: horas.map(h => `${h}h`), legend: false, datasets: [H.bar('Média', horas.map(h => Math.round(hourAgg.get(h)[0] / hourAgg.get(h)[1])), H.color(2))] });
    H.render('rdCh2', { labels: list.map(x => [brShort(x.date), x.turno]), datasets: [
      H.bar('Recebido', list.map(x => x.res.recebido || null), H.color(1)),
      H.bar('A receber', list.map(x => (x.meta != null && !isNaN(x.meta) ? x.meta : null)), H.color(3)),
    ] });
    const q = $('rhQ');
    if (q) q.addEventListener('input', e => { const k = okey(e.target.value); document.querySelectorAll('[data-rhrow]').forEach(tr => { tr.hidden = !!k && !tr.dataset.rhrow.includes(k); }); });
  }

  // ---------- Ações ----------
  async function refresh(auto = false) {
    if (!canSpx() || st.busy) return;
    if (!(await window.SpxSession.has())) { if (auto) return; return window.SpxSession.open(() => refresh()); }
    st.busy = true; st.msg = ''; if (!auto) draw();
    try {
      const r = await api().spxWfm();
      if (!r.ok) st.msg = r.error || 'Falha na consulta.';
      else {
        st.live = { key: `${st.date}|${st.turno}`, parsed: parse(r.data), at: nowTs() };
        if (baseOn() && (!auto || Date.now() - st.lastAuto > AUTOSAVE_MIN * 60000)) { st.lastAuto = Date.now(); await save(true); }
      }
    } catch (e) { st.msg = 'Falha na consulta.'; }
    st.busy = false;
    if (ui.isActive()) draw();
  }
  // Grava a meta e o resultado mostrado (ao vivo ou o último salvo) na planilha-base.
  async function save(quiet = false) {
    if (!baseOn()) return;
    const r = current();
    const res = r.empty ? null : { recebido: r.recebido, ritmo: r.ritmo, base: r.base, eta: r.eta, fetchedAt: r.at, hours: r.hours,
      ops: r.ops.map(o => ({ op: o.op, name: o.name, person: o.person, total: o.total, hours: o.hours, perHour: Math.round(o.perHour) })) };
    try {
      await B().recebSave(st.date, st.turno, { inicio: inicio(), meta: r.meta, res });
      if (ls.meta) { delete ls.meta[`${st.date}|${st.turno}`]; lsSave(); }
      if (!quiet) ui.toast(`Recebimento de ${brShort(st.date)} · ${st.turno} salvo`);
    } catch (e) { ui.toast(String(e.message || e), true); }
    if (ui.isActive()) draw();
  }

  function bind() {
    const main = ui.main;
    main.addEventListener('click', e => {
      if (!ui.isActive()) return;
      const v = e.target.closest('[data-rh-view],[data-rh-t]');
      if (v && v.dataset.rhView) { ls.view = v.dataset.rhView; lsSave(); draw(); return; }
      if (v && v.dataset.rhT) {
        const set = new Set(Array.isArray(ls.dTurnos) ? ls.dTurnos : []);
        if (v.dataset.rhT === 'all') set.clear(); else if (!set.delete(v.dataset.rhT)) set.add(v.dataset.rhT);
        ls.dTurnos = [...set]; lsSave(); drawDash(); return;
      }
      const t = e.target.closest('[data-rh]');
      if (!t) return;
      if (t.dataset.rh === 'refresh') refresh();
      else if (t.dataset.rh === 'save') save();
    });
    main.addEventListener('change', e => {
      if (!ui.isActive()) return;
      const t = e.target;
      if (t.id === 'rhSort') { ls.sortBy = t.value; lsSave(); drawDash(); return; }
      if (t.id === 'rhMails') { ls.mails = t.checked; lsSave(); drawDash(); return; }
      if (t.id === 'rhDate' && t.value) { st.date = t.value; draw(); }
      else if (t.id === 'rhTurno') { st.turno = t.value; ls.turno = t.value; lsSave(); st.date = turnoDay(); draw(); }
      else if (t.id === 'rhInicio' && t.value) { ls.inicio = { ...(ls.inicio || {}), [st.turno]: t.value }; lsSave(); st.date = turnoDay(); draw(); }
      else if (t.id === 'rhMeta') {
        // A meta digitada fica guardada no aparelho e vai para a planilha-base na hora.
        const v = t.value === '' ? null : Math.max(0, Math.round(Number(t.value)));
        ls.meta = { ...(ls.meta || {}), [`${st.date}|${st.turno}`]: v }; lsSave();
        if (baseOn()) save(true); else draw();
      }
    });
  }

  return { render, _: { parse, forecast, startTs } };
})();
