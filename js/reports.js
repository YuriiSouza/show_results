// Reports de turno (Parcial T1/T3, Fechamento T1/T3 e Geral) para o dia do filtro.
// T1 = colunas PM das guias; T3 = colunas AM; o Geral é o acumulado do dia.
// Todo campo é editável: o valor inicial vem das guias de dados
// e o que não existe fica vazio, marcado com um * discreto. Edições ficam salvas por dia.
// As guias "Report T1/T3/All" da planilha NÃO são usadas.
window.Reports = (() => {
  const H = window.Charts;
  const f = H.fmt;
  const esc = H.esc;
  const C = window.APP_CONFIG;
  const S = C.SHEETS;
  const api = window.hubApi || null;

  let ui = null;
  let zoom = false;
  let bound = false;
  let seq = 0;
  let current = null; // { kind, iso, fields: Map(id -> field), sections }

  const KINDS = {
    rpP1: { type: 'parcial', turno: 'T1', name: 'Report parcial · Turno T1 (PM)' },
    rpF1: { type: 'fech', turno: 'T1', name: 'Fechamento de turno · T1 (PM)' },
    rpP3: { type: 'parcial', turno: 'T3', name: 'Report parcial · Turno T3 (AM)' },
    rpF3: { type: 'fech', turno: 'T3', name: 'Fechamento de turno · T3 (AM)' },
    rpAll: { type: 'geral', name: 'Report geral do dia · T1 + T3' },
  };
  const SHIFT = { T1: 'pm', T3: 'am' };
  const STATUS_OPTS = ['Em andamento', 'Finalizado'];
  // Texto livre da guia de report -> opção do Status.
  const statusOf = t => (/finaliz/i.test(t || '') ? 'Finalizado' : /andamento/i.test(t || '') ? 'Em andamento' : '');
  const confStatus = c => c && src(c.ok === c.total ? 'Finalizado' : 'Em andamento', 'auto', `${c.how}: Finalizado quando todas as ATs estão validadas (${c.ok}/${c.total})`);

  // ---------- Valores digitados (um arquivo por dia) ----------
  const LS_KEY = d => `hub.rp.${d}`;
  const store = {
    async get(iso) {
      if (api && api.reportGet) return (await api.reportGet(iso)) || {};
      try { return JSON.parse(localStorage.getItem(LS_KEY(iso)) || '{}'); } catch (e) { return {}; }
    },
    async set(iso, data) {
      if (api && api.reportSet) return api.reportSet(iso, data);
      try { localStorage.setItem(LS_KEY(iso), JSON.stringify(data)); } catch (e) { /* sem espaço */ }
    },
  };

  // ---------- Auxiliares ----------
  const empty = v => v == null || v === '' || (typeof v === 'number' && !isFinite(v));
  // src: auto (guias de dados) · calc (calculado)
  const src = (v, s, how, fmt = f.int) => (empty(v) ? null : { v: typeof v === 'number' ? fmt(v) : String(v).trim(), src: s, how });
  const firstOf = (...xs) => xs.find(Boolean) || null;
  const toIso = d => d.split('/').reverse().join('-');
  const sameDay = (date, d) => date && `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}` === d;
  const longDate = d => {
    const [dd, mm, yy] = d.split('/').map(Number);
    return new Date(yy, mm - 1, dd).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase());
  };
  const num = v => window.Parser.num(v);
  const toMin = t => { const m = String(t || '').match(/(\d{1,2})\s*:\s*(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const fromMin = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.round(n % 60)).padStart(2, '0')}`;

  // Conferência do turno: Audit importado do dia; senão a guia Missing, se for do mesmo dia.
  async function conference(m, d, turno) {
    const sh = C.REPORT.auditShift[turno];
    const rep = window.Audit && await window.Audit.getSaved(toIso(d), sh);
    if (rep && rep.s && rep.s.ats) {
      const x = rep.s;
      return { total: x.ats, ok: x.ats - (x.notValidated || 0), pct: (x.ats - (x.notValidated || 0)) / x.ats, missing: x.missing, how: `Relatório Audit ${sh} de ${d}` };
    }
    const mr = (m.missing || {})[turno] || [];
    if (mr.length && mr.every(r => sameDay(r.start, d))) {
      const total = mr.length, ok = mr.filter(r => /^validated$/i.test(r.status)).length;
      return { total, ok, pct: ok / total, missing: mr.reduce((s, r) => s + r.missing, 0), how: `Guia ${turno === 'T1' ? S.missingT1 : S.missingT3} de ${d}` };
    }
    return null;
  }

  // ---------- Definição dos campos de cada report ----------
  // Campo: { id, label, icon, auto, area, hint }. auto = valor inicial com origem (ou null).
  async function build(kind, day) {
    const m = ui.model();
    const i = m.dates.indexOf(day.d);
    const k = KINDS[kind];
    const d = day.d;
    const F = (id, label, auto, extra = {}) => ({ id, label, auto: auto || null, ...extra });
    const sec = (id, icon, title, fields, extra = {}) => { fields.forEach(fd => { fd.sec = fd.sec || title; }); return { id, icon, title, fields, ...extra }; };
    const g = (arr, how, fmt) => (i >= 0 ? src(arr[i], 'auto', how, fmt) : null);

    if (k.type === 'parcial') {
      const t = k.turno, s = SHIFT[t], S2 = s.toUpperCase();
      // Total só na linha Recebimento; o % de cada linha é o Recebido dela ÷ Total de Recebimento.
      const rows = ['Recebimento', 'LM', 'XPT', 'Backlog'].map(l => {
        const id = l.toLowerCase();
        return { label: l, fields: [
          l === 'Recebimento' ? F(`${id}_total`, 'Total', null) : null,
          F(`${id}_rec`, 'Recebido', l === 'Recebimento' ? g(m.rec[s], `Guia ${S.recebimento} · Recebimento ${S2} (turno ${t})`) : null),
          F(`${id}_pct`, '% Recebido', null, { calc: vals => {
            const a = num(vals.recebimento_total), b = num(vals[`${id}_rec`]);
            return a && b != null ? src(f.pct(b / a, 1), 'calc', `${l} recebido ÷ Total de Recebimento`) : null;
          } }),
        ].map(fd => (fd ? { ...fd, sec: `Volumes · ${l}` } : null)) };
      });
      return {
        title: `Report parcial de turno ${t}`, sub: `Turno ${t} · ${S2}`,
        layout: 'parcial',
        table: { title: 'Volumes', icon: '📦', cols: ['Total', 'Recebido', '% Recebido'], rows },
        sections: [
          sec('hor', '🕒', 'Horários', [
            F('h_descarga', 'Início descarga', null, { hint: 'hh:mm' }),
            F('h_receb', 'Início recebimento', null, { hint: 'hh:mm' }),
            F('h_sort1', 'Início 1º sorting', null, { hint: 'hh:mm' }),
            F('h_sort2', 'Início 2º sorting', null, { hint: 'hh:mm' }),
          ]),
          sec('qtd', '👥', 'Quantidade', [
            F('abs_hc', 'ABS HC', g(m.hc[s].abs, `Guia ${S.hc} · bloco HC ${S2} · ABS (turno ${t})`)),
            F('falta_inj', 'Falta injustificada', null),
            F('atestado', 'Atestado', null),
          ]),
        ],
        obs: F('obs', 'Observação', null, { area: true }),
      };
    }

    const maFields = () => [['total', 'Total'], ['backlog', 'Backlog'], ['emRota', 'Em rota'], ['enviadoSoc', 'Enviado ao SOC'], ['semRastreio', 'Sem rastreio'], ['lost', 'Lost confirmado']];
    const noShowDay = g(m.tr.ats, `Guia ${S.transporte} · ATs no piso (valor do dia)`);

    if (k.type === 'fech') {
      const t = k.turno, s = SHIFT[t], S2 = s.toUpperCase();
      const conf = await conference(m, d, t);
      const hc = m.hc[s];
      return {
        title: `Fechamento de turno ${t}`, sub: `Turno ${t} · colunas ${S2} das guias`,
        layout: 'cols',
        sections: [
          sec('vol', '📦', 'Volumetria', [
            F('rec', `Recebimento ${S2}`, g(m.rec[s], `Guia ${S.recebimento} · Recebimento ${S2}`)),
            F('packed', 'Packed XPT D+1', g(m.rec.packedXpt, `Guia ${S.recebimento} · Packed XPT (valor do dia, igual no T1 e no T3)`)),
            F('phd', 'PHD do turno', g(m.phd.phd, `Guia ${S.phd} · PHD do dia (edite se o turno for diferente)`)),
          ]),
          sec('xpt', '🚚', 'Carregamento XPT', [
            F('xpt_plan', 'Planejados', null),
            F('xpt_done', 'Carregados', g(m.rec.xptCarregado, `Guia ${S.recebimento} · Xpt carregado`)),
          ], { summary: v => (v.xpt_done !== '' && v.xpt_plan !== '' ? `${v.xpt_done} / ${v.xpt_plan}` : '') }),
          sec('hc', '👥', 'HC', [
            F('hc', `HC ${S2}`, g(hc.presente, `Guia ${S.hc} · HC ${S2} · TOTAL`)),
            F('dw', `Diaristas ${S2}`, g(t === 'T1' ? m.hc.dwPM : m.hc.dwAM, `Guia ${S.hc} · Diaristas ${S2}`)),
            F('abs', 'ABS', g(hc.abs, `Guia ${S.hc} · HC ${S2} · ABS`)),
          ]),
          sec('faltas', '🩺', 'Faltas', [
            F('atestado', 'Atestado', null),
            F('ferias', 'Férias', g(hc.ferias, `Guia ${S.hc} · HC ${S2} · FERIAS`)),
            F('dsr', 'DSR', g(hc.dsr, `Guia ${S.hc} · HC ${S2} · DSR`)),
          ]),
          sec('conf', '🔢', `Conferência ${S2}`, [
            F('conf_status', 'Status', confStatus(conf), { options: STATUS_OPTS }),
            F('missing', `Missing ${t}`, conf && src(conf.missing, 'auto', `${conf.how}: soma de Missing Orders`)),
          ]),
          sec('exp', '🚗', 'Expedição', [
            F('rotas', 'Rotas do turno', null, { hint: 'A guia Transporte tem só o total do dia' }),
            F('noshow', 'NoShow', noShowDay),
            F('carregamento', `Carregamento ${t}`, null, { hint: 'hh:mm' }),
          ]),
          sec('ma', '📦', `Macro Aging ${t}`, maFields().map(([key, l]) => F(`ma_${key}`, l, g(m.inv.ma[t][key], `Guia ${S.inventario} · MA ${t} · ${l}`)))),
          sec('rev', '↩️', 'Reversa do turno', [['onHold', 'On hold'], ['avariaHub', 'Avaria HUB'], ['avariaSoc', 'Avaria SOC'], ['retornoSoc', 'Retorno SOC']]
            .map(([key, l]) => F(`rev_${key}`, l, null, { hint: 'A guia Reversa tem só o total do dia' }))),
        ],
        obs: F('obs', 'Observação', null, { area: true }),
      };
    }

    // ---- Geral: acumulado do dia (T1 + T3) ----
    const [c1, c3] = [await conference(m, d, 'T1'), await conference(m, d, 'T3')];
    const shiftVal = (kind2, id) => {
      const v = day.all[kind2] && day.all[kind2][id];
      return v != null && v !== '' ? v : (day.eff[kind2] && day.eff[kind2][id]) || '';
    };
    const sumShifts = (id, label) => {
      const a = num(shiftVal('rpF1', id)), b = num(shiftVal('rpF3', id));
      return a != null && b != null ? src(a + b, 'calc', `${label}: Fechamento T1 + Fechamento T3`) : null;
    };
    const fromShift = (kind2, id, label) => { const v = shiftVal(kind2, id); return v ? src(v, 'calc', `Valor do ${label}`) : null; };
    const t = m.hc.total;
    return {
      title: 'Report geral do dia', sub: 'Acumulado do dia · T1 (PM) + T3 (AM)',
      layout: 'cols',
      sections: [
        sec('vol', '📦', 'Volumetria', [
          F('rec_am', 'Recebimento AM', g(m.rec.am, `Guia ${S.recebimento} · Recebimento AM`)),
          F('rec_pm', 'Recebimento PM', g(m.rec.pm, `Guia ${S.recebimento} · Recebimento PM`)),
          F('rec_total', 'Total recebido', g(m.rec.total, `Guia ${S.recebimento} · Total`)),
          F('phd', 'PHD', g(m.phd.phd, `Guia ${S.phd} · PHD do dia`)),
        ]),
        sec('hc', '👥', 'HC', [
          F('hc_am', 'HC AM', g(m.hc.am.presente, `Guia ${S.hc} · HC AM · TOTAL`)),
          F('hc_pm', 'HC PM', g(m.hc.pm.presente, `Guia ${S.hc} · HC PM · TOTAL`)),
          F('dw_am', 'Diaristas AM', g(m.hc.dwAM, `Guia ${S.hc} · Diaristas AM`)),
          F('dw_pm', 'Diaristas PM', g(m.hc.dwPM, `Guia ${S.hc} · Diaristas PM`)),
          F('abs', 'ABS', g(t.abs, `Guia ${S.hc} · HC TOTAL · ABS`)),
        ]),
        sec('faltas', '🩺', 'Faltas', [
          F('atestado', 'Atestado', sumShifts('atestado', 'Atestado')),
          F('ferias', 'Férias', g(t.ferias, `Guia ${S.hc} · HC TOTAL · FERIAS`)),
          F('dsr', 'DSR', g(t.dsr, `Guia ${S.hc} · HC TOTAL · DSR`)),
        ]),
        sec('conf', '🔢', 'Conferência', [
          F('conf_am_status', 'Status AM (T3)', firstOf(confStatus(c3), fromShift('rpF3', 'conf_status', 'Fechamento T3')), { options: STATUS_OPTS }),
          F('conf_pm_status', 'Status PM (T1)', firstOf(confStatus(c1), fromShift('rpF1', 'conf_status', 'Fechamento T1')), { options: STATUS_OPTS }),
        ]),
        sec('erros', '❌', 'Erros operacionais', [
          F('missing_t1', 'Missing T1', firstOf(c1 && src(c1.missing, 'auto', `${c1.how}: soma de Missing Orders`), fromShift('rpF1', 'missing', 'Fechamento T1'))),
          F('missing_t3', 'Missing T3', firstOf(c3 && src(c3.missing, 'auto', `${c3.how}: soma de Missing Orders`), fromShift('rpF3', 'missing', 'Fechamento T3'))),
          F('missing_all', 'Missing total', null, { calc: v => { const a = num(v.missing_t1), b = num(v.missing_t3); return a != null && b != null ? src(a + b, 'calc', 'Missing T1 + Missing T3') : null; } }),
        ]),
        sec('exp', '🚗', 'Expedição', [
          F('rotas', 'Rotas do dia', g(m.tr.rotas, `Guia ${S.transporte} · Rotas`)),
          F('noshow', 'NoShow', g(m.tr.ats, `Guia ${S.transporte} · ATs no piso`)),
          F('carr_t1', 'Carregamento T1', fromShift('rpF1', 'carregamento', 'Fechamento T1'), { hint: 'hh:mm' }),
          F('carr_t3', 'Carregamento T3', fromShift('rpF3', 'carregamento', 'Fechamento T3'), { hint: 'hh:mm' }),
          F('carr_all', 'Carregamento médio', null, { hint: 'hh:mm', calc: v => { const a = toMin(v.carr_t1), b = toMin(v.carr_t3); return a != null && b != null ? src(fromMin((a + b) / 2), 'calc', 'Média de Carregamento T1 e T3') : null; } }),
        ]),
        sec('xpt', '🚚', 'XPT', [
          F('xpt_plan', 'Carregamentos planejados', firstOf(fromShift('rpF3', 'xpt_plan', 'Fechamento T3'), fromShift('rpF1', 'xpt_plan', 'Fechamento T1'))),
          F('xpt_done', 'Carregamentos realizados', g(m.rec.xptCarregado, `Guia ${S.recebimento} · Xpt carregado`)),
          F('packed', 'Packed XPT D+1', g(m.rec.packedXpt, `Guia ${S.recebimento} · Packed XPT`)),
          F('d0', 'D-0 (dia zero)', null),
        ], { summary: v => (v.xpt_done !== '' && v.xpt_plan !== '' ? `${v.xpt_done} / ${v.xpt_plan}` : '') }),
        sec('ma', '📦', 'Macro Aging (T1 + T3)', maFields().map(([key, l]) => {
          const a = i >= 0 ? m.inv.ma.T1[key][i] : null, b = i >= 0 ? m.inv.ma.T3[key][i] : null;
          return F(`ma_${key}`, l, a != null || b != null ? src((a || 0) + (b || 0), 'calc', `Guia ${S.inventario} · MA T1 + MA T3 · ${l}`) : null);
        })),
        sec('stuck', '⏳', 'Stucks (inventário)', m.inv.aging.map(a => F(`st_${a.name}`, a.name === '15+ dias' ? 'Acima de 15 dias' : a.name, g(a.data, `Guia ${S.inventario} · ${a.name}`)))),
        sec('rev', '↩️', 'Reversa do dia', [['onHold', 'On hold'], ['avariaHub', 'Avaria HUB'], ['avariaSoc', 'Avaria SOC'], ['retornoSoc', 'Retorno SOC']]
          .map(([key, l]) => F(`rev_${key}`, l, g(m.rev[key], `Guia ${S.reversa} · ${l}`)))),
      ],
      obs: F('obs', 'Observação', null, { area: true }),
    };
  }

  // Valores efetivos: digitado > calculado > automático; e o estado de cada campo.
  function resolve(def, edits) {
    const all = [...(def.table ? def.table.rows.flatMap(r => r.fields).filter(Boolean) : []), ...def.sections.flatMap(s => s.fields), def.obs];
    const vals = {};
    const state = {};
    const pass = calcOnly => all.forEach(fd => {
      if (!!fd.calc !== calcOnly) return;
      const a = fd.calc ? fd.calc(vals) : fd.auto;
      fd.autoNow = a;
      if (Object.prototype.hasOwnProperty.call(edits, fd.id)) {
        vals[fd.id] = edits[fd.id];
        state[fd.id] = edits[fd.id] === '' ? 'missing' : 'edited';
      } else if (a) { vals[fd.id] = a.v; state[fd.id] = a.src; }
      else { vals[fd.id] = ''; state[fd.id] = fd.area ? 'optional' : 'missing'; }
    });
    pass(false); pass(true);
    return { all, vals, state };
  }

  // ---------- Tela ----------
  const STATE_TXT = { auto: 'Das guias', calc: 'Calculado', edited: 'Digitado no app', missing: 'Sem valor', optional: '' };

  const howText = (fd, r) => {
    const st = r.state[fd.id];
    return st === 'edited' ? `${whoTxt(r.meta && r.meta[fd.id])}${fd.autoNow ? ` · valor das guias: ${fd.autoNow.v} (${fd.autoNow.how})` : ''}`
      : fd.autoNow ? `${STATE_TXT[fd.autoNow.src]}: ${fd.autoNow.how}` : (fd.hint ? `Sem dado nas guias (${fd.hint}).` : 'Sem dado nas guias.');
  };
  function fieldHtml(fd, r) {
    const v = r.vals[fd.id], st = r.state[fd.id];
    const how = howText(fd, r);
    const reset = '';
    const control = fd.options
      ? `<select id="rf-${fd.id}" class="rf-in rf-select" data-fid="${fd.id}" title="${esc(how)}">
          <option value=""${v ? '' : ' selected'}>—</option>${fd.options.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}
          ${v && !fd.options.includes(v) ? `<option selected>${esc(v)}</option>` : ''}</select>`
      : `<input id="rf-${fd.id}" class="rf-in" data-fid="${fd.id}" value="${esc(v)}" placeholder="" title="${esc(how)}" autocomplete="off">`;
    return `<div class="rf st-${st}" data-row="${fd.id}"><label for="rf-${fd.id}">${esc(fd.label)}</label>
      <div class="rf-box">${control}${reset}</div></div>`;
  }

  function reportHtml(def, r, day, narrow) {
    const secHtml = (s, idx) => `<section class="rs" data-sec="${idx}"><h3>${s.icon} ${esc(s.title)}${s.summary ? `<span class="rs-sum">${esc(s.summary(r.vals) || '')}</span>` : ''}</h3>
      <div class="rs-rows">${s.fields.map(fd => fieldHtml(fd, r)).join('')}</div></section>`;
    const table = def.table ? `<section class="rs rs-table"><h3>${def.table.icon} ${esc(def.table.title)}</h3>
      <div class="rs-rows"><div class="rt-row rt-head"><span></span>${def.table.cols.map(c => `<span>${c}</span>`).join('')}</div>
      ${def.table.rows.map(row => `<div class="rt-row"><span class="rt-l">${esc(row.label)}</span>${row.fields.map(fd => {
        if (!fd) return '<span></span>';
        const st = r.state[fd.id];
        const how = st === 'edited' ? whoTxt(r.meta && r.meta[fd.id]) : fd.autoNow ? `${STATE_TXT[fd.autoNow.src]}: ${fd.autoNow.how}` : 'Sem dado nas guias.';
        return `<div class="rf st-${st}" data-row="${fd.id}"><div class="rf-box"><input class="rf-in" data-fid="${fd.id}" value="${esc(r.vals[fd.id])}" placeholder="" title="${esc(how)}" aria-label="${esc(row.label + ' ' + fd.label)}" autocomplete="off"></div></div>`;
      }).join('')}</div>`).join('')}</div></section>` : '';
    const obs = def.obs;
    const obsHtml = `<div class="rpx-obs rf st-${r.state[obs.id]}" data-row="${obs.id}"><label for="rf-obs">📝 Observação</label>
        <textarea id="rf-obs" class="rf-in" data-fid="${obs.id}" rows="2" placeholder="Escreva a observação do turno…">${esc(r.vals[obs.id])}</textarea></div>`;

    let body;
    if (def.layout === 'parcial') {
      // Grade 2x2: Volumes | Horários / Quantidade | Observação — cada linha com a mesma altura.
      const [hor, qtd] = def.sections;
      body = `<div class="rpx-body rpx-grid2">${table}${secHtml(hor, 0)}${secHtml(qtd, 1)}${obsHtml.replace('rpx-obs', 'rpx-obs rs')}</div>`;
    } else {
      // Distribui as seções em colunas de altura parecida; os blocos esticam até o fim da coluna.
      const n = narrow ? 2 : 4;
      const cols = Array.from({ length: n }, () => ({ h: 0, items: [] }));
      def.sections.forEach((sec, idx) => {
        const c = cols.reduce((a, b) => (b.h < a.h ? b : a));
        c.items.push(secHtml(sec, idx));
        c.h += sec.fields.length + 1.6;
      });
      body = `<div class="rpx-body rpx-colgrid" style="grid-template-columns: repeat(${n}, minmax(0, 1fr))">${cols.map(c => `<div class="rcol">${c.items.join('')}</div>`).join('')}</div>${obsHtml}`;
    }
    return `<div class="rpx rpx-${def.layout}">
      <div class="rpx-head"><div><div class="rpx-title">${esc(def.title)} · ${esc(C.HUB_NAME)}</div><div class="rpx-sub">${esc(def.sub)}</div></div>
        <div class="rpx-date">${esc(longDate(day.d))}</div></div>
      ${body}
    </div>`;
  }

  function counts(r) {
    const c = { missing: 0, edited: 0, auto: 0, calc: 0 };
    Object.values(r.state).forEach(s => { if (c[s] != null) c[s]++; });
    return c;
  }
  function legendHtml(r) {
    const c = counts(r);
    return `${c.missing ? `<button class="rp-missing" data-rp-next title="Ir para o primeiro campo sem valor">* ${c.missing} sem valor</button>` : '<span class="rp-done">✓ Report completo</span>'}
      <span class="lg lg-auto"><i></i>das guias</span><span class="lg lg-calc"><i></i>calculado</span><span class="lg"><b class="req">*</b> sem valor</span>`;
  }

  // Ajusta o report ao espaço livre (sem rolagem). "Ampliar" encaixa só pela largura.
  function fit() {
    const stage = document.getElementById('rpStage');
    const rp = stage && stage.querySelector('.rpx');
    if (!rp) return;
    rp.style.transform = 'none';
    const availW = stage.clientWidth;
    const availH = Math.max(220, window.innerHeight - stage.getBoundingClientRect().top - 12);
    const w = rp.offsetWidth, h = rp.offsetHeight;
    const sc = zoom ? availW / w : Math.min(availW / w, availH / h, 1.35);
    rp.style.transform = `scale(${sc})`;
    stage.style.height = `${Math.ceil(h * sc)}px`;
    rp.style.left = `${Math.max(0, (availW - w * sc) / 2)}px`;
  }

  // Planilha-base compartilhada (js/base.js) quando disponível; senão, só neste aparelho.
  const shared = () => window.Base && window.Base.enabled();

  // Rascunho: alterações ainda não salvas, por dia e report ({ campo: valor | null = voltar ao valor das guias }).
  // Fica guardado no aparelho até o usuário clicar em Salvar.
  const DRAFT_KEY = 'hub.rpDraft';
  const drafts = (() => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}'); } catch (e) { return {}; } })();
  const saveDrafts = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch (e) { /* sem espaço */ } };
  const draftOf = (iso, kind) => drafts[`${iso}|${kind}`] || {};
  const merged = (saved, draft) => {
    const out = { ...(saved || {}) };
    Object.entries(draft || {}).forEach(([f, v]) => { if (v == null) delete out[f]; else out[f] = v; });
    return out;
  };

  async function loadDay(d) {
    const iso = toIso(d);
    let saved, meta = {};
    if (shared()) {
      // Só busca na planilha se ainda não buscou; o resto vem do botão Atualizar.
      if (!window.Base.loadedAt()) await window.Base.load(true);
      ({ vals: saved, meta } = window.Base.reportDay(iso));
    } else saved = await store.get(iso);
    const all = {};
    Object.keys(KINDS).forEach(k => { all[k] = merged(saved[k], draftOf(iso, k)); });
    return { d, iso, saved, all, meta, eff: {} };
  }
  const whoTxt = x => (x ? `Digitado por ${x.user || 'sem nome'} em ${new Date(x.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Digitado no app');
  function lastEdit(meta) {
    let last = null;
    Object.values(meta || {}).forEach(x => { if (!last || x.at > last.at) last = x; });
    return last;
  }
  function syncHtml(meta) {
    if (!shared()) return '<span class="rp-sync off" title="Sem planilha-base: o que for digitado fica só neste aparelho">💾 Só neste aparelho</span>';
    const st = window.Base.status, last = lastEdit(meta);
    const icon = { ok: '☁️', sync: '⏳', pending: '⏳', error: '⚠️' }[st.state] || '☁️';
    const txt = st.state === 'error' ? 'Erro ao sincronizar' : st.state === 'pending' ? 'Envio pendente' : st.state === 'sync' ? 'Sincronizando…' : 'Salvo na planilha-base';
    return `<span class="rp-sync ${st.state}" title="${esc(st.msg || txt)}">${icon} ${txt}${last ? ` · última edição: ${esc(last.user || 'sem nome')} ${new Date(last.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>`;
  }

  async function render(kind, ctx) {
    ui = ctx;
    bindOnce();
    const my = ++seq;
    const m = ui.model();
    if (!m || !m.dates.length) { ui.main.innerHTML = ui.empty('Sem dados.'); return; }
    const d = m.dates[ui.dayIdx()];
    const day = await loadDay(d);
    // O Geral usa os valores efetivos dos fechamentos T1 e T3 do mesmo dia.
    if (KINDS[kind].type === 'geral') {
      for (const k2 of ['rpF1', 'rpF3']) day.eff[k2] = resolve(await build(k2, day), day.all[k2] || {}).vals;
    }
    const def = await build(kind, day);
    if (my !== seq || !ui.isActive(kind)) return;
    const edits = day.all[kind] || {};
    const r = resolve(def, edits);
    r.meta = (day.meta || {})[kind] || {};
    current = { kind, day, def, r };
    const i = ui.dayIdx();
    const narrow = ui.main.clientWidth < 760;
    ui.main.innerHTML = `
      <div class="rp-toolbar">
        <div class="rp-day">
          <button class="cal-arrow" data-rp-day="-1" ${i <= 0 ? 'disabled' : ''} aria-label="Dia anterior">‹</button>
          <div><span class="range-cap">Dia do report</span><b>${esc(d)}</b></div>
          <button class="cal-arrow" data-rp-day="1" ${i >= m.dates.length - 1 ? 'disabled' : ''} aria-label="Próximo dia">›</button>
        </div>
        <div class="rp-legend" id="rpLegend">${legendHtml(r)}</div>
        <div id="rpSync">${syncHtml(r.meta)}</div>
        <div class="rp-tools">
          <span class="rp-unsaved" id="rpUnsaved"></span>
          <button class="btn-primary solid rp-save" data-rp-save id="rpSave" disabled>Salvar</button>
          <button class="tool" data-rp-refresh title="Buscar na planilha-base o que outros usuários salvaram">↻ Atualizar</button>
          <button class="tool" data-rp-sources>Fontes</button>
          <button class="tool" data-rp-clear title="Voltar todos os campos aos valores das guias (vale depois de Salvar)">Limpar edições</button>
          <button class="tool ${zoom ? 'active' : ''}" data-rp-zoom>${zoom ? 'Ajustar à tela' : 'Ampliar'}</button>
        </div>
      </div>
      <div class="rp-stage ${narrow ? 'narrow' : ''}" id="rpStage">${reportHtml(def, r, day, narrow)}</div>`;
    updateUnsaved();
    requestAnimationFrame(fit);
  }

  function updateUnsaved() {
    if (!current) return;
    const n = Object.keys(draftOf(current.day.iso, current.kind)).length;
    const el = document.getElementById('rpUnsaved'), btn = document.getElementById('rpSave');
    if (el) el.textContent = n ? `● ${n} alteração(ões) não salva(s)` : '';
    if (btn) btn.disabled = !n;
  }

  // Guarda a alteração no rascunho (não grava na planilha) e atualiza o report sem perder o foco.
  function setValue(id, value) {
    if (!current) return;
    const { kind, day, def } = current;
    const fd = current.r.all.find(x => x.id === id);
    const auto = fd && fd.autoNow ? String(fd.autoNow.v).trim() : '';
    const savedV = (day.saved[kind] || {})[id];
    const v = value == null ? null : String(value).trim();
    const key = `${day.iso}|${kind}`;
    const draft = { ...(drafts[key] || {}) };
    // Valor final desejado: null = sem edição (fica o valor das guias).
    const want = v === null || v === auto ? null : v;
    if ((want === null && savedV === undefined) || (want !== null && want === savedV)) delete draft[id];
    else draft[id] = want;
    if (Object.keys(draft).length) drafts[key] = draft; else delete drafts[key];
    saveDrafts();
    day.all[kind] = merged(day.saved[kind], draft);
    const r = resolve(def, day.all[kind]);
    r.meta = (day.meta || {})[kind] || {};
    current.r = r;
    patch(r);
  }

  async function saveDraft() {
    if (!current) return;
    const { kind, day } = current;
    const key = `${day.iso}|${kind}`;
    const draft = drafts[key];
    if (!draft || !Object.keys(draft).length) return;
    if (shared()) await window.Base.saveFields(day.iso, kind, draft);
    else await store.set(day.iso, { ...(await store.get(day.iso)), [kind]: merged((await store.get(day.iso))[kind], draft) });
    delete drafts[key];
    saveDrafts();
    ui.toast(shared() ? `${Object.keys(draft).length} alteração(ões) salva(s) na planilha-base` : 'Alterações salvas neste aparelho');
    render(kind, ui);
  }

  function patch(r) {
    const stage = document.getElementById('rpStage');
    if (!stage) return;
    r.all.forEach(fd => {
      const row = stage.querySelector(`[data-row="${fd.id}"]`);
      if (!row) return;
      const input = row.querySelector('.rf-in');
      const st = r.state[fd.id];
      row.className = row.className.replace(/\bst-\w+/, `st-${st}`);
      if (input && document.activeElement !== input) input.value = r.vals[fd.id];
      if (input) input.title = howText(fd, r);
    });
    stage.querySelectorAll('.rs[data-sec]').forEach(el => {
      const s = current.def.sections[+el.dataset.sec];
      const sum = el.querySelector('.rs-sum');
      if (s && s.summary && sum) sum.textContent = s.summary(r.vals);
    });
    document.getElementById('rpLegend').innerHTML = legendHtml(r);
    const sync = document.getElementById('rpSync');
    if (sync) sync.innerHTML = syncHtml(r.meta);
    updateUnsaved();
  }

  function showSources() {
    if (!current) return;
    const { r } = current;
    const order = ['missing', 'edited', 'calc', 'auto', 'optional'];
    const rows = [...r.all].sort((a, b) => order.indexOf(r.state[a.id]) - order.indexOf(r.state[b.id]));
    document.getElementById('rpSourcesBody').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Campo</th><th class="left">Valor</th><th class="left">Origem</th></tr></thead><tbody>
      ${rows.map(fd => { const st = r.state[fd.id]; return `<tr><td>${esc(fd.sec ? fd.sec + ' · ' : '')}${esc(fd.label)}</td><td class="left">${esc(r.vals[fd.id] || '—')}</td>
        <td class="left src-cell"><b class="src-${st}">${STATE_TXT[st] || 'Opcional'}</b><br><span class="muted">${esc(st === 'edited' ? whoTxt(r.meta && r.meta[fd.id]) : fd.autoNow ? fd.autoNow.how : (fd.hint || 'Não existe nas guias de dados'))}</span></td></tr>`; }).join('')}
      </tbody></table></div>`;
    document.getElementById('rpSources').showModal();
  }

  function bindOnce() {
    if (bound) return;
    bound = true;
    const active = () => Object.keys(KINDS).find(k => ui.isActive(k));
    ui.main.addEventListener('click', async e => {
      const kind = active();
      if (!kind) return;
      const day = e.target.closest('[data-rp-day]');
      if (day) { ui.setDay(ui.dayIdx() + Number(day.dataset.rpDay)); return; }
      if (e.target.closest('[data-rp-zoom]')) { zoom = !zoom; render(kind, ui); return; }
      if (e.target.closest('[data-rp-sources]')) { showSources(); return; }
      if (e.target.closest('[data-rp-save]')) { await saveDraft(); return; }
      if (e.target.closest('[data-rp-refresh]')) {
        if (shared()) { await window.Base.load(true); ui.toast('Report atualizado com a planilha-base'); }
        render(kind, ui);
        return;
      }
      if (e.target.closest('[data-rp-next]')) {
        const first = document.querySelector('#rpStage .st-missing .rf-in');
        if (first) { if (!zoom) { zoom = true; await render(kind, ui); } const el = document.querySelector('#rpStage .st-missing .rf-in'); el.scrollIntoView({ block: 'center' }); el.focus(); }
        return;
      }
      if (e.target.closest('[data-rp-clear]') && current) {
        if (!confirm('Voltar todos os campos deste report aos valores das guias? (as alterações só valem depois de Salvar)')) return;
        const key = `${current.day.iso}|${current.kind}`;
        const draft = {};
        Object.keys(current.day.saved[current.kind] || {}).forEach(f => { draft[f] = null; });
        if (Object.keys(draft).length) drafts[key] = draft; else delete drafts[key];
        saveDrafts();
        render(kind, ui);
      }
    });
    ui.main.addEventListener('change', e => {
      const id = e.target.dataset && e.target.dataset.fid;
      if (id && active()) setValue(id, e.target.value);
    });
    ui.main.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || !e.target.dataset.fid) return;
      e.preventDefault();
      const inputs = [...document.querySelectorAll('#rpStage .rf-in')];
      const next = inputs[inputs.indexOf(e.target) + 1];
      e.target.blur();
      if (next) next.focus();
    });
    window.addEventListener('resize', () => { if (active()) fit(); });
    if (window.Base) window.Base.onChange(() => { const el = document.getElementById('rpSync'); if (el && current) el.innerHTML = syncHtml(current.r.meta); });
    document.getElementById('rpSourcesClose').addEventListener('click', () => document.getElementById('rpSources').close());
  }

  return { render, KINDS };
})();
