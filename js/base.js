// Planilha-base compartilhada: guarda os reports preenchidos e os relatórios Audit importados
// para que todos os usuários do app vejam o que os outros fizeram.
// - Reports: cada salvamento vira UMA linha, com as alterações em JSON; vale a gravação mais recente de cada campo.
// - Audit: cada importação vira uma linha com o resumo calculado (as linhas do CSV não são guardadas).
// - Parcel: cada salvamento vira uma linha com o resultado do rastreio do dia (pacote, operador do missing, AT, motorista…);
//   vale o salvamento mais recente de cada dia.
// - Sem internet: as gravações ficam numa fila no aparelho e são enviadas depois.
window.Base = (() => {
  const api = window.hubApi || null;
  const C = window.APP_CONFIG;
  const ID = (String(C.BASE_SHEET_URL || '').match(/\/d\/([a-zA-Z0-9-_]+)/) || [])[1] || '';
  const CHUNK = 45000; // limite seguro por célula (o Google aceita até 50 mil caracteres)

  const ls = {
    get(k, d) { try { const v = localStorage.getItem('hub.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hub.' + k, JSON.stringify(v)); } catch (e) { /* sem espaço */ } },
  };

  let reports = new Map(); // "iso|kind|campo" -> { v, user, at, removed }
  let audits = new Map();  // "iso|turno" -> { date, shift, fileName, status, user, importedAt, importId, summary }
  let parcels = new Map(); // "iso" -> { date, status, user, at, items: [{ c, s, op, mt, at, cage, dn, di, dest, dmg }] }
  let loadedAt = 0;
  let loading = null;
  let ensured = false;
  let flushing = null;
  const status = { state: 'off', msg: '', at: null };
  const listeners = new Set();

  // Ativa só com chave de acesso e com dados reais (no modo demonstração nada é gravado na planilha).
  let hasKey = false, active = false;
  const ready = (async () => { try { hasKey = !!(api && api.getConfig && (await api.getConfig()).hasKey); } catch (e) { hasKey = false; } })();
  const enabled = () => !!(api && api.baseRead && ID && hasKey && active);
  const setActive = on => { active = !!on; if (!enabled()) setStatus('off', ''); };
  const setStatus = (state, msg = '') => { status.state = state; status.msg = msg; status.at = new Date(); listeners.forEach(fn => fn(status)); };
  const clean = err => String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  // ---------- Usuário ----------
  const user = () => ls.get('user', '');
  const setUser = name => { ls.set('user', String(name || '').trim()); listeners.forEach(fn => fn(status)); };
  let askUser = null; // definido pelo app (abre o diálogo de nome)
  async function ensureUser() {
    if (user()) return user();
    if (askUser) { const n = await askUser(); if (n) setUser(n); }
    return user() || 'Sem nome';
  }

  // ---------- Leitura ----------
  // Colunas: Data, Report, Usuário, Gravado em, Aparelho, Campos alterados, Alterações (JSON: { campo: valor | null = removido }).
  function applyReportRow(r) {
    const [date, kind, who, at, , , json] = r.map(x => (x == null ? '' : String(x)));
    if (!date || !kind || !json) return;
    let changes;
    try { changes = JSON.parse(json); } catch (e) { return; }
    Object.entries(changes || {}).forEach(([field, value]) => {
      const key = `${date}|${kind}|${field}`;
      const cur = reports.get(key);
      if (!cur || at >= cur.at) reports.set(key, { v: value == null ? '' : String(value), user: who, at, removed: value == null });
    });
  }
  const reportRow = (iso, kind, changes, who, at) =>
    [iso, kind, who, at, device(), Object.keys(changes).length, JSON.stringify(changes)];
  // Colunas: Data, Turno, Arquivo, Status, Usuário, Gravado em, Import ID, 11 colunas legíveis, Resumo (JSON 1..3).
  const AUDIT_JSON_AT = 18;
  function applyAuditRow(r) {
    const cells = r.map(x => (x == null ? '' : String(x)));
    const [date, shift, fileName, st, who, at, importId] = cells;
    if (!date || !shift) return;
    const key = `${date}|${shift}`;
    const cur = audits.get(key);
    if (cur && at < cur.importedAt) return;
    let summary = null;
    try { const js = cells.slice(AUDIT_JSON_AT).join(''); summary = js ? JSON.parse(js) : null; } catch (e) { return; }
    audits.set(key, { date, shift, fileName, status: st, user: who, importedAt: at, importId, summary });
  }

  // Colunas: Data, Status, Usuário, Gravado em, Aparelho, 6 colunas legíveis, Resultado (JSON 1..5).
  const PARCEL_JSON_AT = 11, PARCEL_CHUNKS = 5;
  function applyParcelRow(r) {
    const cells = r.map(x => (x == null ? '' : String(x)));
    const [date, st, who, at] = cells;
    if (!date) return;
    const cur = parcels.get(date);
    if (cur && at < cur.at) return;
    let items = [];
    try { const js = cells.slice(PARCEL_JSON_AT).join(''); items = js ? JSON.parse(js) : []; } catch (e) { return; }
    parcels.set(date, { date, status: st, user: who, at, items: Array.isArray(items) ? items : [] });
  }
  const APPLY = { Reports: applyReportRow, Audit: applyAuditRow, Parcel: applyParcelRow };

  async function load(force = false) {
    await ready;
    if (!enabled()) return false;
    if (!force && Date.now() - loadedAt < 20000) return true;
    if (loading) return loading;
    loading = (async () => {
      try {
        setStatus('sync', 'Sincronizando…');
        if (!ensured) { await api.baseEnsure(ID); ensured = true; }
        await flush();
        const data = await api.baseRead(ID);
        reports = new Map(); audits = new Map(); parcels = new Map();
        data.reports.forEach(applyReportRow);
        data.audit.forEach(applyAuditRow);
        (data.parcel || []).forEach(applyParcelRow);
        // O que ainda está na fila (não enviado) vale por cima do que veio da planilha.
        ls.get('basePending', []).forEach(op => op.rows.forEach(APPLY[op.tab] || (() => {})));
        loadedAt = Date.now();
        const pend = ls.get('basePending', []).length;
        setStatus(pend ? 'pending' : 'ok', pend ? `${pend} envio(s) pendente(s)` : 'Sincronizado');
        migrateOnce();
        return true;
      } catch (err) {
        setStatus('error', clean(err));
        return false;
      } finally { loading = null; }
    })();
    return loading;
  }

  // ---------- Escrita (fila) ----------
  function queue(tab, rows) {
    const pend = ls.get('basePending', []);
    pend.push({ tab, rows });
    ls.set('basePending', pend);
    flush().catch(() => {});
  }
  async function flush() {
    if (!enabled()) return;
    if (flushing) { await flushing.catch(() => {}); if (!ls.get('basePending', []).length) return; }
    flushing = (async () => {
      if (!ls.get('basePending', []).length) return;
      setStatus('sync', 'Enviando…');
      try {
        if (!ensured) { await api.baseEnsure(ID); ensured = true; }
        // Relê a fila a cada envio: gravações feitas durante o envio também saem.
        let pend;
        while ((pend = ls.get('basePending', [])).length) {
          await api.baseAppend(ID, pend[0].tab, pend[0].rows);
          ls.set('basePending', ls.get('basePending', []).slice(1));
        }
        setStatus('ok', 'Salvo na planilha-base');
      } catch (err) {
        setStatus('pending', `Não enviado ainda (${clean(err)}). Tentaremos de novo.`);
        throw err;
      } finally { flushing = null; }
    })();
    return flushing;
  }

  const nowIso = () => new Date().toISOString();
  const device = () => (api && api.platform) || 'app';

  // ---------- Reports ----------
  function reportDay(iso) {
    const vals = {}, meta = {};
    reports.forEach((x, key) => {
      const [d, kind, field] = key.split('|');
      if (d !== iso || x.removed) return;
      (vals[kind] = vals[kind] || {})[field] = x.v;
      (meta[kind] = meta[kind] || {})[field] = { user: x.user, at: x.at };
    });
    return { vals, meta };
  }
  async function setField(iso, kind, field, value) {
    return saveFields(iso, kind, { [field]: value == null ? null : String(value) });
  }
  // Grava todas as alterações de um report numa única linha (uma requisição). changes: { campo: valor | null (remover) }
  async function saveFields(iso, kind, changes) {
    const clean = {};
    Object.entries(changes || {}).forEach(([f, v]) => { clean[f] = v == null ? null : String(v); });
    const n = Object.keys(clean).length;
    if (!n) return 0;
    const row = reportRow(iso, kind, clean, await ensureUser(), nowIso());
    applyReportRow(row);
    queue('Reports', [row]);
    return n;
  }
  async function clearReport(iso, kind, fields) {
    if (!fields.length) return;
    const changes = {};
    fields.forEach(f => { changes[f] = null; });
    return saveFields(iso, kind, changes);
  }

  // ---------- Audit ----------
  const auditList = () => [...audits.values()].filter(a => a.status !== 'excluido');
  async function auditSave(rep) {
    const who = await ensureUser(), at = nowIso();
    const importId = `${rep.date}_${rep.shift}_${Date.now().toString(36)}`;
    const x = rep.summary;
    const json = JSON.stringify(x);
    const chunks = [];
    for (let k = 0; k < json.length; k += CHUNK) chunks.push(json.slice(k, k + CHUNK));
    if (chunks.length > 3) throw new Error('Resumo grande demais para a planilha-base.');
    const avg = x.mins.length ? x.mins.reduce((a, b) => a + b, 0) / x.mins.length : '';
    const meta = (window.APP_CONFIG.METAS || {}).tempoConferenciaMin || 6;
    const hm = iso => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
    const row = [rep.date, rep.shift, rep.fileName || '', 'ativo', who, at, importId,
      x.ats, x.initial, x.missing, x.initial ? +(x.missing / x.initial * 100).toFixed(2) : '', x.missorted, x.atsMissing,
      avg === '' ? '' : +avg.toFixed(2), x.mins.filter(v => v > meta).length, hm(x.t0), hm(x.t1), Object.keys(x.ops).length, ...chunks];
    applyAuditRow(row);
    queue('Audit', [row]);
    return { ...audits.get(`${rep.date}|${rep.shift}`) };
  }
  async function auditDelete(date, shift) {
    const who = await ensureUser();
    const cur = audits.get(`${date}|${shift}`);
    const row = [date, shift, cur ? cur.fileName : '', 'excluido', who, nowIso(), cur ? cur.importId : ''];
    applyAuditRow(row);
    queue('Audit', [row]);
  }

  // ---------- Parcel (resultado do rastreio por dia) ----------
  const parcelList = () => [...parcels.values()].filter(p => p.status !== 'excluido').sort((a, b) => a.date.localeCompare(b.date));
  const parcelGet = iso => { const p = parcels.get(iso); return p && p.status !== 'excluido' ? p : null; };
  async function parcelSave(iso, items) {
    const who = await ensureUser(), at = nowIso();
    const json = JSON.stringify(items);
    const chunks = [];
    for (let k = 0; k < json.length; k += CHUNK) chunks.push(json.slice(k, k + CHUNK));
    if (chunks.length > PARCEL_CHUNKS) throw new Error('Resultado grande demais para a planilha-base. Salve menos pacotes por dia.');
    const n = s => items.filter(x => x.s === s).length;
    const row = [iso, 'ativo', who, at, device(), items.length, n('ok'), n('noat'), n('avaria'), n('xpt'), new Set(items.map(x => x.op).filter(Boolean)).size, ...chunks];
    applyParcelRow(row);
    queue('Parcel', [row]);
    return parcels.get(iso);
  }
  async function parcelDelete(iso) {
    const row = [iso, 'excluido', await ensureUser(), nowIso(), device()];
    applyParcelRow(row);
    queue('Parcel', [row]);
  }

  // ---------- Migração única dos dados que estavam só neste aparelho ----------
  async function migrateOnce() {
    if (ls.get('baseMigrated', false) || !api) return;
    ls.set('baseMigrated', true);
    try {
      const who = user() || 'Dados antigos deste aparelho';
      const at = nowIso();
      const local = api.reportsListLocal ? await api.reportsListLocal() : {};
      const rows = [];
      Object.entries(local).forEach(([iso, kinds]) => Object.entries(kinds || {}).forEach(([kind, fields]) => {
        const changes = {};
        Object.entries(fields || {}).forEach(([field, v]) => { if (!reports.has(`${iso}|${kind}|${field}`)) changes[field] = String(v); });
        if (Object.keys(changes).length) rows.push(reportRow(iso, kind, changes, who, at));
      }));
      if (rows.length) { rows.forEach(applyReportRow); queue('Reports', rows); }
      const localAudits = api.auditList ? await api.auditList() : [];
      for (const a of localAudits) {
        if (audits.has(`${a.date}|${a.shift}`)) continue;
        const summary = a.summary || (a.rows && window.Audit ? window.Audit.summarize(a.header, a.rows) : null);
        if (summary) await auditSave({ date: a.date, shift: a.shift, fileName: a.fileName, summary });
      }
    } catch (e) { /* tenta de novo na próxima vez */ ls.set('baseMigrated', false); }
  }

  return {
    enabled, load, flush, status, onChange: fn => listeners.add(fn), ready, setActive,
    user, setUser, ensureUser, setAskUser: fn => { askUser = fn; },
    reportDay, setField, saveFields, clearReport, loadedAt: () => loadedAt,
    auditList, auditSave, auditDelete,
    parcelList, parcelGet, parcelSave, parcelDelete,
    sheetUrl: () => (ID ? `https://docs.google.com/spreadsheets/d/${ID}/edit` : ''),
  };
})();
