// Transforma as guias brutas em um modelo de dados organizado por área.
window.buildModel = function buildModel(raw) {
  const P = window.Parser;
  const S = window.APP_CONFIG.SHEETS;
  const sheet = name => (raw.sheets || {})[name] || [];
  const blocks = {};
  for (const [k, name] of Object.entries(S)) blocks[k] = P.parseBlocks(sheet(name));

  const firstBlock = ['recebimento', 'gerencial', 'hc', 'inventario', 'transporte', 'reversa']
    .map(k => blocks[k][0]).find(Boolean);
  const dates = firstBlock ? firstBlock.dates : [];
  const empty = () => dates.map(() => null);
  const g = (k, label, title) => P.series(blocks[k], label, title, dates);
  // Primeira série encontrada (a guia específica tem prioridade; Gerencial é o reserva).
  const pick = (...arrs) => arrs.find(a => a && a.some(v => v != null)) || empty();

  const rec = {
    am: pick(g('recebimento', 'Recebimento AM')),
    pm: pick(g('recebimento', 'Recebimento PM')),
    total: pick(g('recebimento', 'Total', 'Recebimento'), g('recebimento', 'Vol real'), g('gerencial', 'Volume')),
    xptCarregado: pick(g('recebimento', 'Xpt carregado')),
    packedXpt: pick(g('recebimento', 'Packed XPT'), g('gerencial', 'Packed XPT')),
    projetado: pick(g('recebimento', 'Vol projetado')),
  };
  rec.pctXpt = rec.packedXpt.map((v, i) => v != null && rec.total[i] ? v / rec.total[i] : null);
  rec.aderencia = rec.total.map((v, i) => rec.projetado[i] ? (v || 0) / rec.projetado[i] : null);

  const hcBlock = (title, labels) => Object.fromEntries(labels.map(([k, l]) => [k, pick(g('hc', l, title))]));
  const hc = {
    dwAM: pick(g('hc', 'Diaristas AM')),
    dwPM: pick(g('hc', 'Diaristas PM')),
    am: hcBlock('HC AM', [['hc', 'HC AM'], ['dsr', 'DSR'], ['abs', 'ABS'], ['ferias', 'FERIAS'], ['desligado', 'Desligado'], ['afastamento', 'Afastamento'], ['presente', 'TOTAL']]),
    pm: hcBlock('HC PM', [['hc', 'HC PM'], ['dsr', 'DSR'], ['abs', 'ABS'], ['ferias', 'FERIAS'], ['desligado', 'Desligado'], ['afastamento', 'Afastamento'], ['presente', 'TOTAL']]),
    total: hcBlock('HC TOTAL', [['hc', 'HC'], ['abs', 'ABS'], ['dsr', 'DSR'], ['ferias', 'FERIAS'], ['diaristas', 'DIARISTAS'], ['desligado', 'Desligado'], ['afastamento', 'Afastamento'], ['presente', 'TOTAL']]),
  };
  hc.total.pctAbs = hc.total.abs.map((v, i) => hc.total.presente[i] ? (v || 0) / hc.total.presente[i] : null);
  hc.total.pctDw = hc.total.diaristas.map((v, i) => hc.total.presente[i] ? (v || 0) / hc.total.presente[i] : null);
  // HC planejado do dia = linha TOTAL do bloco HC TOTAL (linha 40 da guia HC); a soma dos dias é o "HC Planejado" do mês.
  // HC presente do dia = TOTAL do HC AM (linha 17) + TOTAL do HC PM (linha 29).
  hc.planDia = hc.total.presente;
  hc.presente = dates.map((_, i) => (hc.am.presente[i] == null && hc.pm.presente[i] == null ? null : (hc.am.presente[i] || 0) + (hc.pm.presente[i] || 0)));

  // PHD calculado (não vem da planilha): pacotes recebidos ÷ (pessoas presentes AM + PM + diaristas).
  const phdPeople = dates.map((_, i) => (hc.am.presente[i] || 0) + (hc.pm.presente[i] || 0));
  const phdDw = dates.map((_, i) => (hc.dwAM[i] || 0) + (hc.dwPM[i] || 0));
  const phd = {
    people: phdPeople,
    dw: phdDw,
    phd: dates.map((_, i) => {
      const vol = rec.total[i], den = phdPeople[i] + phdDw[i];
      return vol && den ? Math.round(vol / den) : null;
    }),
  };

  const maBlock = t => Object.fromEntries([
    ['total', 'Total'], ['backlog', 'Backlog'], ['emRota', 'Em Rota'], ['enviadoSoc', 'Enviado ao SOC'],
    ['semRastreio', 'Sem Rastreio'], ['lost', 'Lost Confirmado'],
  ].map(([k, l]) => [k, pick(g('inventario', l, t))]));
  const inv = {
    aging: [
      ['0 dias', '0 dias'], ['1 - 2 dias', '1 - 2 dias'], ['3 - 7 dias', '3 - 7 dias'],
      ['8 - 14 dias', '8 - 14 dias'], ['15+ dias', 'Acima de 15 dias'],
    ].map(([name, l]) => ({ name, data: pick(g('inventario', l, 'Inventario'), g('gerencial', l)) })),
    total: pick(g('inventario', 'Total', 'Inventario')),
    ma: { T1: maBlock('MA T1'), T3: maBlock('MA T3') },
  };

  const rev = {
    onHold: pick(g('reversa', 'ON Hold'), g('gerencial', 'ON Hold')),
    avariaHub: pick(g('reversa', 'Avaria HUB'), g('gerencial', 'Avaria HUB')),
    avariaSoc: pick(g('reversa', 'Avaria SOC'), g('gerencial', 'Avaria SOC')),
    retornoSoc: pick(g('reversa', 'Retorno SOC'), g('gerencial', 'Retorno SOC')),
  };

  const tr = {
    rotas: pick(g('transporte', 'Rotas'), g('gerencial', 'Rotas')),
    ats: pick(g('transporte', 'ATs no piso'), g('gerencial', 'ATs no piso')),
    spr: pick(g('transporte', 'SPR'), g('gerencial', 'SPR')),
    ds: pick(g('transporte', 'DS'), g('gerencial', 'DS')),
    dsD0: pick(g('transporte', 'DS D0'), g('gerencial', 'DS D0')),
  };

  // ---- Missing ----
  const missing = {};
  for (const [k, name] of [['T3', S.missingT3], ['T1', S.missingT1]]) missing[k] = P.auditRows(P.table(sheet(name), 'AT/TO'));

  return {
    raw, dates, rec, hc, phd, inv, rev, tr, missing,
    hse: parseHSE(sheet(S.hse)),
    sheetsFound: Object.fromEntries(Object.entries(S).map(([k, n]) => [k, !!(raw.sheets || {})[n]])),
  };

  function parseHSE(grid) {
    const f = P.finder(grid);
    const h = f.find('Nome do colaborador', { exact: false });
    if (!h) return null;
    const hr = grid[h.r].map(P.norm);
    const col = (name, from = 0) => hr.findIndex((x, i) => i >= from && x === P.norm(name));
    const cLider = col('Lider');
    const cSide = col('Lider', cLider + 1);
    const cTurno = col('Turno');
    const cDia = hr.findIndex(x => x === 'dia');
    const cBpo = col('BPO'), cContrato = col('Contrato'), cCod = col('Codigo');

    const people = [];
    for (let r = h.r + 1; r < grid.length; r++) {
      const name = f.cell(r, h.c);
      if (!name || /http|links/i.test(name)) break;
      people.push({
        nome: name.replace(/\s+(SPXBR|GN)\d+$/i, ''), codigo: f.cell(r, cCod), bpo: f.cell(r, cBpo),
        contrato: f.cell(r, cContrato), lider: f.cell(r, cLider), status: f.cell(r, cLider + 1),
      });
    }

    // Tabelas "Lider/Turno | Status" na coluna lateral (Safety Walk, Cuidado ativo, Parada...)
    const checklists = [];
    if (cSide >= 0) {
      let cur = null;
      for (let r = 0; r < grid.length; r++) {
        const a = f.cell(r, cSide), b = f.cell(r, cSide + 1);
        if (P.norm(b) === 'status') {
          let title = '';
          for (let k = r - 1; k >= Math.max(0, r - 3); k--) {
            if (f.cell(k, cSide + 1) && k !== h.r) break;
            if (f.cell(k, cSide)) { title = f.cell(k, cSide); break; }
          }
          if (r === h.r) title = f.cell(0, cSide) || title;
          cur = { title: (title || (P.norm(a) === 'lider' ? 'Líderes' : 'Checklist')).replace(/\s*-\s*Realiza.*$/i, ''), col: a, items: [] };
          checklists.push(cur);
          continue;
        }
        if (!cur) continue;
        if (!a) { cur = null; continue; }
        if (!b && /realiza/i.test(a)) { cur = null; continue; }
        cur.items.push({ nome: a, status: b });
      }
    }

    const ginastica = [];
    if (cTurno >= 0) {
      const weeks = grid[h.r].slice(cTurno + 1, cTurno + 5).map(P.txt);
      for (let r = h.r + 1; r < h.r + 8; r++) {
        const t = f.cell(r, cTurno);
        if (!t || /justific/i.test(t)) break;
        ginastica.push({ turno: t, semanas: weeks.map((w, i) => ({ semana: w, status: f.cell(r, cTurno + 1 + i) })) });
      }
    }

    const dds = { dates: [], rows: [] };
    if (cDia >= 0) {
      const dcols = [];
      grid[h.r].forEach((c, i) => { if (i > cDia && P.isDate(c)) dcols.push(i); });
      dds.dates = dcols.map(c => f.cell(h.r, c));
      for (let r = h.r + 1; r < h.r + 8; r++) {
        const t = f.cell(r, cDia);
        if (!t) break;
        dds.rows.push({ turno: t, values: dcols.map(c => f.cell(r, c)) });
      }
    }

    const links = [];
    grid.forEach(row => (row || []).forEach(c => {
      const t = P.txt(c);
      const m = t.match(/https?:\/\/\S+/);
      if (!m) return;
      let label = t.slice(0, m.index).replace(/🔗/g, '').replace(/[:\-–\s]+$/, '').trim();
      const parts = label.split(/:\s+/);
      label = parts[parts.length - 1] || label;
      if (!label) label = new URL(m[0]).hostname;
      if (!links.some(l => l.url === m[0])) links.push({ label, url: m[0] });
    }));

    return { people, checklists, ginastica, dds, links };
  }
};

// Junta os modelos de vários meses (uma planilha por mês) num período contínuo.
// Séries diárias são concatenadas na ordem das datas; o que é "retrato do momento"
// (Report T3, Missing, PHD semanal) vem do mês mais recente; o HSE fica guardado mês a mês.
window.mergeModels = function mergeModels(models) {
  const toKey = d => d.split('/').reverse().join('');
  const list = models.filter(m => m && m.dates.length)
    .sort((a, b) => toKey(a.dates[0]).localeCompare(toKey(b.dates[0])));
  if (!list.length) return models[0] || null;
  // A guia HSE é diferente em cada planilha mensal: fica guardada por mês, para a tela de HSE escolher.
  const hseByMonth = Object.fromEntries(list.filter(m => m.monthKey && m.hse).map(m => [m.monthKey, m.hse]));
  // As guias Missing T1/T3 também são de cada planilha mensal: a tela Missing escolhe o mês.
  const missingByMonth = Object.fromEntries(list.filter(m => m.monthKey && m.missing).map(m => [m.monthKey, m.missing]));
  if (list.length === 1) return { ...list[0], hseByMonth, missingByMonth };

  // Mantém cada data uma vez só (se duas planilhas repetirem dias, vale a do mês mais recente).
  const seen = new Map();
  list.forEach((m, mi) => m.dates.forEach((d, i) => seen.set(d, [mi, i])));
  const dates = [...seen.keys()].sort((a, b) => toKey(a).localeCompare(toKey(b)));
  const pickAt = (getter) => dates.map(d => { const [mi, i] = seen.get(d); const arr = getter(list[mi]); return arr ? arr[i] ?? null : null; });

  const latest = list[list.length - 1];
  const isSeries = (v, m) => Array.isArray(v) && v.length === m.dates.length && v.every(x => x == null || typeof x === 'number');

  // Percorre a estrutura do modelo mais recente e concatena toda série diária encontrada.
  function walk(node, path) {
    if (isSeries(node, latest)) return pickAt(m => path.reduce((o, k) => (o == null ? o : o[k]), m));
    if (Array.isArray(node)) return node.map((x, i) => (x && typeof x === 'object' ? walk(x, [...path, i]) : x));
    if (node && typeof node === 'object' && !(node instanceof Date)) {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v, [...path, k]);
      return out;
    }
    return node;
  }

  const merged = {};
  for (const k of ['rec', 'hc', 'phd', 'inv', 'rev', 'tr']) merged[k] = walk(latest[k], [k]);
  return {
    ...latest,
    ...merged,
    dates,
    // Missing T1/T3 é o retrato de um dia: vale o mês mais recente em que a guia está preenchida
    // (as planilhas dos meses futuros já existem, mas com essas guias vazias).
    missing: Object.fromEntries(['T3', 'T1'].map(k => [k, ([...list].reverse().find(m => m.missing && (m.missing[k] || []).length) || latest).missing[k] || []])),
    hseByMonth,
    missingByMonth,
    months: list.map(m => m.monthKey).filter(Boolean),
  };
};
