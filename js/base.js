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
  const LEGACY_ID = (String(C.BASE_SHEET_URL || '').match(/\/d\/([a-zA-Z0-9-_]+)/) || [])[1] || '';
  // Multi-hub (js/central.js): a planilha-base é a planilha de dados do hub escolhido, no ano atual.
  const multi = () => !!(window.Central && window.Central.on());
  const curId = () => (multi() ? window.Central.dataId() : LEGACY_ID);
  // Para onde vai uma gravação da fila. Multi-hub: NUNCA a planilha-base antiga (ela só é lida); o que ficou na fila
  // de antes vai para a planilha do hub atual.
  const target = op => (multi() ? (op.id && op.id !== LEGACY_ID ? op.id : curId()) : (op.id || LEGACY_ID));
  const CHUNK = 45000; // limite seguro por célula (o Google aceita até 50 mil caracteres)

  const ls = {
    get(k, d) { try { const v = localStorage.getItem('hub.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hub.' + k, JSON.stringify(v)); } catch (e) { /* sem espaço */ } },
  };

  let reports = new Map(); // "iso|kind|campo" -> { v, user, at, removed }
  let audits = new Map();  // "iso|turno" -> { date, shift, fileName, status, user, importedAt, importId, summary }
  const mapaHist = new Map(); // "iso|turno" -> todos os salvamentos (para restaurar uma versão anterior)
  let mapas = new Map();   // "iso|turno" -> { date, turno, status, user, at, map: { layout, versions } }
  let erros = new Map();   // id -> { id, date, turno, tipo, code, rota, time, resp, status, user, at, detail }
  let recebs = new Map();  // "iso|turno" -> { date, turno, status, user, at, inicio, meta, res }
  let parcels = new Map(); // "iso" -> { date, status, user, at, items: [{ c, s, op, mt, at, cage, dn, di, dest, dmg }] }
  let indic = new Map();   // "iso|indicador" -> { v (null = apagado), user, at }
  let hses = new Map();    // "AAAA-MM" -> { month, user, at, hse }
  let noshows = new Map(); // "iso|turno|AT" -> { status: confirmado | erro, obs, user, at }
  let avarias = new Map(); // id -> { id, date, br, origem, tipo, setor, obs, resp, recebidoEm, trat, acao, evid, status, user, at, detail }
  let loadedAt = 0;
  let loading = null;
  let ensured = false;
  let flushing = null;
  const status = { state: 'off', msg: '', at: null };
  const listeners = new Set();

  // Ativa só com login Google e com dados reais (no modo demonstração nada é gravado na planilha).
  let signedIn = false, active = false;
  const readAuth = async () => { try { signedIn = !!(api && api.getConfig && (await api.getConfig()).signedIn); } catch (e) { signedIn = false; } };
  const ready = readAuth();
  // Relê o login (chamado a cada atualização): entrar com o Google sem reabrir o app também ativa a planilha-base.
  const recheck = () => readAuth();
  const enabled = () => !!(api && api.baseRead && curId() && signedIn && active);
  const setActive = on => { active = !!on; if (!enabled()) setStatus('off', ''); };
  const setStatus = (state, msg = '') => { status.state = state; status.msg = msg; status.at = new Date(); listeners.forEach(fn => fn(status)); };
  const clean = err => String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  // ---------- Usuário ----------
  const user = () => { const m = multi() && window.Central.me(); return (m && (m.nome || m.email)) || ls.get('user', ''); };
  const setUser = name => { ls.set('user', String(name || '').trim()); listeners.forEach(fn => fn(status)); };
  let askUser = null; // definido pelo app (abre o diálogo de nome)
  async function ensureUser() {
    // Gerente (e outros papéis só de consulta) não grava nada.
    if (multi() && window.Central.readOnly()) throw new Error(`Seu acesso (${window.Central.role()}) é só de consulta: nada foi salvo.`);
    if (multi() && !curId()) throw new Error('Este hub ainda não tem planilha de dados para o ano: peça ao administrador.');
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
  // MapaPiso: Data, Turno, Status, Usuário, Gravado em, Aparelho, Mudanças, Pessoas, Mapa (JSON 1..5).
  const MAPA_JSON_AT = 8, MAPA_CHUNKS = 5;
  function applyMapaRow(r) {
    const cells = r.map(x => (x == null ? '' : String(x)));
    const [date, turno, st, who, at] = cells;
    if (!date || !turno) return;
    const key = `${date}|${turno}`, cur = mapas.get(key);
    if (cur && at < cur.at) return;
    let map = null;
    try { const js = cells.slice(MAPA_JSON_AT).join(''); map = js ? JSON.parse(js) : null; } catch (e) { return; }
    mapas.set(key, { date, turno, status: st, user: who, at, map });
  }
  // Guarda todos os salvamentos de cada dia/turno (não só o mais recente).
  function histMapaRow(r) {
    const cells = r.map(x => (x == null ? '' : String(x)));
    const [date, turno, st, who, at] = cells;
    if (!date || !turno || st === 'excluido') return;
    let map = null;
    try { const js = cells.slice(MAPA_JSON_AT).join(''); map = js ? JSON.parse(js) : null; } catch (e) { return; }
    if (!map) return;
    const key = `${date}|${turno}`, list = mapaHist.get(key) || [];
    if (!list.some(x => x.at === at)) list.push({ user: who, at, map });
    mapaHist.set(key, list.sort((a, b) => b.at.localeCompare(a.at)));
  }
  // ErrosPiso: ID, Data, Turno, Tipo, Código, Rota/letra, Horário, Responsáveis, Status, Usuário, Gravado em, Aparelho, Detalhe (JSON).
  function applyErroRow(r) {
    const c = r.map(x => (x == null ? '' : String(x)));
    const [id, date, turno, tipo, code, rota, time, resp, st, who, at, , json] = c;
    if (!id || !date) return;
    const cur = erros.get(id);
    if (cur && at < cur.at) return;
    let detail = {};
    try { detail = json ? JSON.parse(json) : {}; } catch (e) { detail = {}; }
    erros.set(id, { id, date, turno, tipo, code, rota, time, resp: resp ? resp.split(' | ') : [], status: st, user: who, at, detail });
  }
  // RecebimentoHora: Data, Turno, Status, Usuário, Gravado em, Aparelho, Início, A receber, Recebido, Ritmo, Previsão, Operadores, Resultado (JSON 1..2).
  const RH_JSON_AT = 12, RH_CHUNKS = 2;
  function applyRecebRow(r) {
    const c = r.map(x => (x == null ? '' : String(x)));
    const [date, turno, st, who, at, , inicio, meta] = c;
    if (!date || !turno) return;
    const key = `${date}|${turno}`, cur = recebs.get(key);
    if (cur && at < cur.at) return;
    let res = null;
    try { const js = c.slice(RH_JSON_AT).join(''); res = js ? JSON.parse(js) : null; } catch (e) { return; }
    recebs.set(key, { date, turno, status: st, user: who, at, inicio, meta: meta === '' ? null : Number(meta), res });
  }
  // Avarias: ID, Data, BR, Origem, Tipo, Setor, Observação, Responsável, Recebido em, Tratativa, Ação tomada, Evidência,
  // Status, Usuário, Gravado em, Aparelho, Detalhe (JSON).
  function applyAvariaRow(r) {
    const c = r.map(x => (x == null ? '' : String(x)));
    const [id, date, br, origem, tipo, setor, obs, resp, recebidoEm, trat, acao, evid, st, who, at, , json] = c;
    if (!id || !date) return;
    const cur = avarias.get(id);
    if (cur && at < cur.at) return;
    let detail = {};
    try { detail = json ? JSON.parse(json) : {}; } catch (e) { detail = {}; }
    avarias.set(id, { id, date, br, origem, tipo, setor, obs, resp, recebidoEm, trat: trat || 'Aberto', acao, evid, status: st, user: who, at, detail });
  }
  // Indicadores: Data, Indicador, Valor, Status, Usuário, Gravado em, Origem. Vale a linha mais recente de cada dia/indicador.
  function applyIndRow(r) {
    const c = r.map(x => (x == null ? '' : x));
    const [date, path, v, st, who, at] = c;
    const iso = String(date).trim(), key = `${iso}|${String(path).trim()}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !path) return;
    const cur = indic.get(key), when = String(at);
    if (cur && when < cur.at) return;
    const n = v === '' || st === 'excluido' ? null : Number(v);
    indic.set(key, { v: n != null && isFinite(n) ? n : null, user: String(who), at: when });
  }
  // HSE: Mês, Status, Usuário, Gravado em, Origem, HSE (JSON 1..3).
  const HSE_JSON_AT = 5, HSE_CHUNKS = 3;
  function applyHseRow(r) {
    const c = r.map(x => (x == null ? '' : String(x)));
    const [month, st, who, at] = c;
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const cur = hses.get(month);
    if (cur && at < cur.at) return;
    let hse = null;
    try { const js = c.slice(HSE_JSON_AT).join(''); hse = js ? JSON.parse(js) : null; } catch (e) { return; }
    hses.set(month, { month, user: who, at, hse: st === 'excluido' ? null : hse });
  }
  // NoShow: Data, Turno, AT, Validação (confirmado | erro | '' = a validar), Observação, Usuário, Gravado em.
  function applyNoShowRow(r) {
    const [date, turno, at, val, obs, who, when] = r.map(x => (x == null ? '' : String(x)));
    if (!date || !turno || !at) return;
    const key = `${date}|${turno}|${at}`, cur = noshows.get(key);
    if (cur && when < cur.at) return;
    noshows.set(key, { status: val, obs, user: who, at: when });
  }
  const APPLY = { NoShow: applyNoShowRow, Indicadores: applyIndRow, HSE: applyHseRow, Avarias: applyAvariaRow, RecebimentoHora: applyRecebRow, Reports: applyReportRow, Audit: applyAuditRow, Parcel: applyParcelRow, MapaPiso: applyMapaRow, ErrosPiso: applyErroRow };

  // Ao entrar numa tela, só relê a planilha-base se a última leitura tiver mais de PASSIVE_TTL (o Atualizar do topo, a
  // atualização automática e o salvamento do mapa forçam a leitura). Cada leitura traz todas as abas da planilha-base.
  const PASSIVE_TTL = 3 * 60e3;
  async function load(force = false) {
    await ready;
    if (!enabled()) return false;
    if (!force && Date.now() - loadedAt < PASSIVE_TTL) return true;
    if (loading) return loading;
    loading = (async () => {
      try {
        setStatus('sync', 'Sincronizando…');
        const ID = curId();
        if (ensured !== ID) { await api.baseEnsure(ID); ensured = ID; }
        await flush();
        const data = await api.baseRead(ID);
        reports = new Map(); audits = new Map(); parcels = new Map(); recebs = new Map(); mapaHist.clear(); mapas = new Map(); erros = new Map();
        avarias = new Map(); indic = new Map(); hses = new Map(); noshows = new Map();
        (data.noshow || []).forEach(applyNoShowRow);
        (data.indicadores || []).forEach(applyIndRow);
        (data.hse || []).forEach(applyHseRow);
        data.reports.forEach(applyReportRow);
        data.audit.forEach(applyAuditRow);
        (data.parcel || []).forEach(applyParcelRow);
        (data.mapa || []).forEach(r => { applyMapaRow(r); histMapaRow(r); });
        (data.erros || []).forEach(applyErroRow);
        (data.receb || []).forEach(applyRecebRow);
        (data.avarias || []).forEach(applyAvariaRow);
        // O que ainda está na fila (não enviado) vale por cima do que veio da planilha (só o que é desta planilha).
        ls.get('basePending', []).filter(op => target(op) === ID).forEach(op => op.rows.forEach(APPLY[op.tab] || (() => {})));
        loadedAt = Date.now();
        const pend = ls.get('basePending', []).length;
        setStatus(pend ? 'pending' : 'ok', pend ? `${pend} envio(s) pendente(s)` : 'Sincronizado');
        if (!multi()) migrateOnce();   // multi-hub: a migração para a planilha do hub é feita à parte
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
    pend.push({ tab, rows, id: curId() });   // cada gravação vai para a planilha do hub em que foi feita
    ls.set('basePending', pend);
    flush().catch(() => {});
  }
  async function flush() {
    if (!enabled()) return;
    if (flushing) { await flushing.catch(() => {}); if (!ls.get('basePending', []).length) return; }
    flushing = (async () => {
      if (!ls.get('basePending', []).length) return;
      setStatus('sync', 'Enviando…');
      const sent = new Set([ensured]);
      try {
        // Envia em lote: junta as gravações da fila por aba (uma chamada por aba, ~2 MB no máximo por vez). Relê a fila a
        // cada lote: gravações feitas durante o envio também saem. Repetir uma linha é inofensivo (vale a última gravação).
        let pend;
        while ((pend = ls.get('basePending', [])).length) {
          let n = 0, size = 0;
          while (n < pend.length && (n === 0 || size < 2e6)) { size += JSON.stringify(pend[n].rows).length; n++; }
          const byTab = new Map();
          pend.slice(0, n).forEach(op => { const k = `${target(op)}|${op.tab}`; byTab.set(k, [...(byTab.get(k) || []), ...op.rows]); });
          for (const [k, rows] of byTab) {
            const [id, tab] = k.split('|');
            if (!id) throw new Error('Sem planilha de dados do hub para gravar.');
            if (!sent.has(id)) { await api.baseEnsure(id); sent.add(id); }
            await api.baseAppend(id, tab, rows);
          }
          ls.set('basePending', ls.get('basePending', []).slice(n));
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

  // ---------- Mapa de piso ----------
  const mapaList = () => [...mapas.values()].filter(m => m.status !== 'excluido' && m.map).sort((a, b) => (a.date + a.turno).localeCompare(b.date + b.turno));
  const mapaGet = (iso, turno) => { const m = mapas.get(`${iso}|${turno}`); return m && m.status !== 'excluido' ? m : null; };
  async function mapaSave(iso, turno, map) {
    const who = await ensureUser(), at = nowIso();
    const json = JSON.stringify(map);
    const chunks = [];
    for (let k = 0; k < json.length; k += CHUNK) chunks.push(json.slice(k, k + CHUNK));
    if (chunks.length > MAPA_CHUNKS) throw new Error('Mapa grande demais para a planilha-base.');
    const people = new Set();
    (map.versions || []).forEach(v => Object.values(v.slots || {}).forEach(n => { if (n) people.add(n); }));
    const row = [iso, turno, 'ativo', who, at, device(), (map.versions || []).length, people.size, ...chunks];
    applyMapaRow(row); histMapaRow(row);
    queue('MapaPiso', [row]);
    return mapas.get(`${iso}|${turno}`);
  }

  const mapaHistory = (iso, turno) => (mapaHist.get(`${iso}|${turno}`) || []).slice();

  // ---------- Erros de piso ----------
  const erroList = () => [...erros.values()].filter(e => e.status !== 'excluido').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  // Colunas legíveis depois do JSON: Categoria, Operador SPX (recebedor), Etiquetador, Observação.
  function readable(e) {
    const d = e.detail || {};
    const cat = e.tipo === 'sort' ? 'Sorting' : e.tipo === 'xpt' ? 'XPT' : d.classe === 'backlog' ? 'Backlog' : d.classe === 'naorec' ? 'Não recebido' : 'Etiquetagem';
    return [cat, e.tipo !== 'etiq' ? '' : d.recebeu || d.operadorSpx || '', e.tipo !== 'etiq' ? '' : (e.resp || []).join(' | '), d.obs || ''];
  }
  // Conteúdo do registro sem quem/quando gravou (chaves do detalhe em ordem fixa), para saber se algo mudou.
  const sortKeys = o => Object.keys(o || {}).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {});
  const erroSig = (e, st) => JSON.stringify([e.date, e.turno, e.tipo, e.code || '', e.rota || '', e.time || '', (e.resp || []).join(' | '), st, sortKeys(e.detail)]);
  async function erroSave(e) {
    // Regravar um registro igual ao que já está na planilha (ex.: buscar de novo o responsável de um erro que continua
    // pendente) só gastaria linha: não grava.
    const cur = e.id && erros.get(e.id);
    if (cur && erroSig(cur, cur.status) === erroSig(e, 'ativo')) return cur;
    const who = await ensureUser(), at = nowIso();
    const id = e.id || `${e.date}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const row = [id, e.date, e.turno, e.tipo, e.code || '', e.rota || '', e.time || '', (e.resp || []).join(' | '), 'ativo', who, at, device(), JSON.stringify(e.detail || {}), ...readable(e)];
    applyErroRow(row);
    queue('ErrosPiso', [row]);
    return erros.get(id);
  }
  async function erroDelete(id) {
    const cur = erros.get(id);
    if (!cur) return;
    const row = [id, cur.date, cur.turno, cur.tipo, cur.code, cur.rota, cur.time, cur.resp.join(' | '), 'excluido', await ensureUser(), nowIso(), device(), JSON.stringify(cur.detail || {}), ...readable(cur)];
    applyErroRow(row);
    queue('ErrosPiso', [row]);
  }

  // ---------- Recebimento por hora ----------
  const recebList = () => [...recebs.values()].filter(x => x.status !== 'excluido').sort((a, b) => (a.date + a.turno).localeCompare(b.date + b.turno));
  const recebGet = (iso, turno) => { const x = recebs.get(`${iso}|${turno}`); return x && x.status !== 'excluido' ? x : null; };
  // rec: { inicio, meta, res: { recebido, ritmo, eta, ops, hours, fetchedAt } | null }
  async function recebSave(iso, turno, rec) {
    const who = await ensureUser(), at = nowIso();
    const res = rec.res || null;
    const json = res ? JSON.stringify(res) : '';
    const chunks = [];
    for (let k = 0; k < json.length; k += CHUNK) chunks.push(json.slice(k, k + CHUNK));
    if (chunks.length > RH_CHUNKS) throw new Error('Resultado grande demais para a planilha-base.');
    const row = [iso, turno, 'ativo', who, at, device(), rec.inicio || '', rec.meta == null ? '' : rec.meta,
      res ? res.recebido : '', res && res.ritmo != null ? Math.round(res.ritmo) : '', res && res.eta ? new Date(res.eta * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '',
      res ? (res.ops || []).length : '', ...chunks];
    applyRecebRow(row);
    queue('RecebimentoHora', [row]);
    return recebs.get(`${iso}|${turno}`);
  }

  // ---------- Avarias ----------
  const avariaList = () => [...avarias.values()].filter(a => a.status !== 'excluido').sort((a, b) => (a.date + a.at).localeCompare(b.date + b.at));
  const avariaRow = (a, st, who, at) => [a.id, a.date, a.br || '', a.origem || '', a.tipo || '', a.setor || '', a.obs || '', a.resp || '', a.recebidoEm || '',
    a.trat || 'Aberto', a.acao || '', a.evid || '', st, who, at, device(), JSON.stringify(a.detail || {})];
  async function avariaSave(a) {
    const id = a.id || `AV_${a.date}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const row = avariaRow({ ...a, id }, 'ativo', await ensureUser(), nowIso());
    applyAvariaRow(row);
    queue('Avarias', [row]);
    return avarias.get(id);
  }
  async function avariaDelete(id) {
    const cur = avarias.get(id);
    if (!cur) return;
    const row = avariaRow(cur, 'excluido', await ensureUser(), nowIso());
    applyAvariaRow(row);
    queue('Avarias', [row]);
  }

  // ---------- Indicadores do dia e HSE (o que vinha das planilhas mensais) ----------
  // Modelo do dashboard montado da guia Indicadores (todos os dias do 1º lançamento até hoje). Sem nada: null.
  function indicadoresModel() {
    const rows = [];
    indic.forEach((x, k) => { if (x.v == null) return; const [iso, path] = k.split('|'); rows.push({ iso, path, v: x.v }); });
    if (!rows.length) return null;
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const last = rows.reduce((m, r) => (r.iso > m ? r.iso : m), '');
    const hseByMonth = {};
    hses.forEach(h => { if (h.hse) hseByMonth[h.month] = h.hse; });
    return window.modelFromRows(rows, { to: last > today ? last : today, hseByMonth });
  }
  // Linhas a acrescentar para gravar "items" ({ iso, path, v | null }) sobre o que já existe (Map como "indic"): só o que mudou.
  function indDiff(current, items, who, at, origem) {
    const out = [];
    items.forEach(({ iso, path, v }) => {
      const cur = current.get(`${iso}|${path}`), now = v == null || v === '' ? null : Number(v);
      if ((cur ? cur.v : null) === now) return;
      out.push([iso, path, now == null ? '' : now, now == null ? 'excluido' : 'ativo', who, at, origem || device()]);
      current.set(`${iso}|${path}`, { v: now, user: who, at });
    });
    return out;
  }
  async function indicadoresSave(items, origem) {
    const rows = indDiff(new Map(indic), items, await ensureUser(), nowIso(), origem);
    rows.forEach(applyIndRow);
    for (let k = 0; k < rows.length; k += 5000) queue('Indicadores', rows.slice(k, k + 5000));
    return rows.length;
  }
  const hseRow = (month, hse, who, at, origem) => {
    const json = JSON.stringify(hse || null), chunks = [];
    for (let k = 0; k < json.length; k += CHUNK) chunks.push(json.slice(k, k + CHUNK));
    if (chunks.length > HSE_CHUNKS) throw new Error('HSE grande demais para a planilha.');
    return [month, 'ativo', who, at, origem || device(), ...chunks];
  };
  // Validação das rotas noshow (tela Audit de gestão).
  const noshowGet = (date, turno, at) => noshows.get(`${date}|${turno}|${at}`) || null;
  async function noshowSet(date, turno, at, status, obs = '') {
    const row = [date, turno, at, status, obs, await ensureUser(), nowIso()];
    applyNoShowRow(row);
    queue('NoShow', [row]);
  }
  // HSE do mês lançado no app (tela Lançar indicadores → HSE do mês).
  const hseByMonth = () => { const o = {}; hses.forEach(h => { if (h.hse) o[h.month] = h.hse; }); return o; };
  const hseGet = month => { const h = hses.get(month); return h && h.hse ? h.hse : null; };
  const hseMeta = month => { const h = hses.get(month); return h ? { user: h.user, at: h.at } : null; };
  async function hseSave(month, hse) {
    const row = hseRow(month, hse, await ensureUser(), nowIso(), 'Lançamento no app');
    applyHseRow(row);
    queue('HSE', [row]);
  }
  // Para a importação das planilhas mensais numa planilha de hub qualquer (Administração): lê o que ela já tem.
  function parseExisting(data) {
    const keep = [indic, hses];
    indic = new Map(); hses = new Map();
    (data.indicadores || []).forEach(applyIndRow); (data.hse || []).forEach(applyHseRow);
    const out = { indic, hses };
    [indic, hses] = keep;
    return out;
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
    enabled, load, flush, status, recheck, isSignedIn: () => signedIn, onChange: fn => listeners.add(fn), ready, setActive,
    user, setUser, ensureUser, setAskUser: fn => { askUser = fn; },
    reportDay, setField, saveFields, clearReport, loadedAt: () => loadedAt,
    auditList, auditSave, auditDelete,
    parcelList, parcelGet, parcelSave, parcelDelete,
    recebList, recebGet, recebSave,
    mapaList, mapaGet, mapaSave, mapaHistory, erroList, erroSave, erroDelete,
    avariaList, avariaSave, avariaDelete,
    indicadoresModel, indicadoresSave, indDiff, hseRow, parseExisting, hseGet, hseMeta, hseSave, hseByMonth, noshowGet, noshowSet, hasIndicadores: () => indic.size > 0,
    indicadorGet: (iso, path) => indic.get(`${iso}|${path}`) || null,
    sheetUrl: () => (curId() ? `https://docs.google.com/spreadsheets/d/${curId()}/edit` : ''),
  };
})();
