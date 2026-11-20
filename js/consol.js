// Consolidado dos hubs (multi-hub): para quem acompanha vários hubs (Admin, Gerente, Qualidade), os principais números
// de cada hub no período do filtro, lidos da planilha de dados de cada hub (só leitura). Cada hub só aparece se a conta
// tiver acesso à planilha dele no Google Drive.
window.Consol = (() => {
  const H = window.Charts;
  const esc = H.esc, f = H.fmt;
  const CT = () => window.Central;
  const api = () => window.hubApi || null;
  const TTL = 3 * 60e3;
  const cache = new Map();   // fileId -> { at, data | error }
  let ui = null, busy = false;

  async function read(file, force) {
    const c = cache.get(file.id);
    if (!force && c && Date.now() - c.at < TTL) return c;
    try { const data = await api().baseRead(file.id); const v = { at: Date.now(), data }; cache.set(file.id, v); return v; }
    catch (e) { const v = { at: Date.now(), error: String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }; cache.set(file.id, v); return v; }
  }

  // Última linha de cada chave (coluna k) com a data de gravação na coluna atCol.
  const latest = (rows, key, atCol) => {
    const m = new Map();
    (rows || []).forEach(r => { const k = key(r); if (!k) return; const cur = m.get(k); if (!cur || String(r[atCol] || '') >= String(cur[atCol] || '')) m.set(k, r); });
    return [...m.values()];
  };
  const inR = (iso, rg) => iso >= rg.from && iso <= rg.to;

  // Números de um hub no período.
  function summarize(data, rg) {
    const B = window.Base, ex = B.parseExisting(data);
    const rows = [];
    ex.indic.forEach((x, k) => { if (x.v == null) return; const [iso, path] = k.split('|'); if (inR(iso, rg)) rows.push({ iso, path, v: x.v }); });
    const m = window.modelFromRows(rows, { from: rg.from, to: rg.to });
    const sum = a => a.reduce((s, v) => s + (v || 0), 0);
    const avg = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const days = m.rec.total.filter(v => v != null).length;
    const pres = sum(m.hc.total.presente), abs = sum(m.hc.total.abs);
    const av = latest(data.avarias, r => String(r[0] || ''), 14).filter(r => r[12] !== 'excluido' && inR(String(r[1]), rg));
    const er = latest(data.erros, r => String(r[0] || ''), 10).filter(r => r[8] !== 'excluido' && inR(String(r[1]), rg));
    const pc = latest(data.parcel, r => String(r[0] || ''), 3).filter(r => r[1] !== 'excluido' && inR(String(r[0]), rg));
    return {
      volume: sum(m.rec.total), days, media: days ? sum(m.rec.total) / days : null,
      phd: avg(m.phd.phd), ds: avg(m.tr.ds), absPct: pres ? abs / pres : null,
      avarias: av.length, avAbertas: av.filter(r => r[9] !== 'Concluído').length,
      erros: er.length, parcelPac: sum(pc.map(r => Number(r[5]) || 0)), semAt: sum(pc.map(r => Number(r[7]) || 0)),
    };
  }

  async function render(ctx, force = false) {
    ui = ctx;
    const hubs = CT().myHubs();
    const rg = ui.range();
    const per = rg.from === rg.to ? rg.from.split('-').reverse().join('/') : `${rg.from.split('-').reverse().join('/')} a ${rg.to.split('-').reverse().join('/')}`;
    const head = ui.head('Consolidado dos hubs', `${hubs.length} hub(s) · ${per} (filtro do topo)`);
    if (!busy) ui.main.innerHTML = head + ui.empty(`Lendo a planilha de ${hubs.length} hub(s)…`);
    busy = true;
    const res = [];
    for (const h of hubs) {
      const file = CT().dataFile(h, rg.to.slice(0, 4));
      if (!file) { res.push({ h, error: 'sem planilha de dados' }); continue; }
      const r = await read(file, force);
      res.push(r.error ? { h, error: r.error } : { h, s: summarize(r.data, rg) });
    }
    busy = false;
    if (!ui.isActive()) return;
    const ok = res.filter(x => x.s), tot = k => ok.reduce((s, x) => s + (x.s[k] || 0), 0);
    const meta = window.APP_CONFIG.METAS || {};
    ui.main.innerHTML = head + `<div class="card-tools" style="justify-content:flex-end;margin:-6px 0 10px"><button class="tool" data-cs="reload">↻ Ler de novo</button></div>
      <div class="kpis">${[
        ui.kpi('Volume recebido', f.int(tot('volume')), [`<span>${ok.length} de ${hubs.length} hub(s)</span>`]),
        ui.kpi('Avarias', f.int(tot('avarias')), [tot('avAbertas') ? `<span class="pill warn">${tot('avAbertas')} em aberto</span>` : '<span class="pill good">✓ nenhuma em aberto</span>']),
        ui.kpi('Erros de piso', f.int(tot('erros')), ['<span>registrados no período</span>']),
        ui.kpi('Parcel sem AT', f.int(tot('semAt')), [`<span>de ${f.int(tot('parcelPac'))} pacote(s) consultados</span>`]),
      ].join('')}</div>
      <div class="grid">
        <section class="card w12"><div class="card-head"><div><div class="card-title">Por hub</div><div class="card-sub">Médias dos dias com lançamento</div></div></div>
          <div class="table-wrap"><table class="pc-table cs-table"><thead><tr><th class="left">Hub</th><th>Volume</th><th>Média/dia</th><th>PHD médio</th><th>DS médio</th><th>% ABS</th><th>Avarias</th><th>Em aberto</th><th>Erros de piso</th><th>Parcel sem AT</th></tr></thead><tbody>
          ${res.map(({ h, s, error }) => s ? `<tr><td class="left"><b>${esc(h.id)}</b> <span class="muted small">${esc(h.nome)}</span></td><td>${f.int(s.volume)}</td><td>${f.int(s.media)}</td>
            <td>${f.int(s.phd)}</td><td class="${s.ds != null && meta.dsMin && s.ds < meta.dsMin ? 'bad' : ''}">${f.pct(s.ds)}</td><td class="${s.absPct != null && meta.absMax && s.absPct > meta.absMax ? 'bad' : ''}">${f.pct(s.absPct)}</td>
            <td>${f.int(s.avarias)}</td><td>${f.int(s.avAbertas)}</td><td>${f.int(s.erros)}</td><td>${f.int(s.semAt)}</td></tr>`
            : `<tr><td class="left"><b>${esc(h.id)}</b> <span class="muted small">${esc(h.nome)}</span></td><td colspan="9" class="left"><span class="pill warn">${esc(error)}</span></td></tr>`).join('')}
          </tbody></table></div></section>
        ${ui.card('csCh1', 'Volume recebido por hub', 'No período', { w: 6 })}
        ${ui.card('csCh2', 'Avarias e erros de piso por hub', 'No período', { w: 6 })}
      </div>`;
    const lab = ok.map(x => x.h.id);
    H.render('csCh1', { labels: lab, legend: false, datasets: [H.bar('Volume', ok.map(x => x.s.volume || null), H.color(1))] });
    H.render('csCh2', { labels: lab, datasets: [H.bar('Avarias', ok.map(x => x.s.avarias || null), H.color(1)), H.bar('Erros de piso', ok.map(x => x.s.erros || null), H.color(3))] });
  }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-cs="reload"]') && ui && ui.isActive()) render(ui, true);
  });

  return { render };
})();
