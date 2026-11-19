// Registro de erros e alertas da tela (AppLog).
// - Erros não tratados (window.onerror, promessas rejeitadas) e console.error viram "error".
// - Demoras acima do limite (atualizar dados, abrir uma tela, ler a planilha, ler a Central) viram "warn" (lento).
// - No computador vai para o arquivo do dia em <pasta do app>/logs (junto com as chamadas ao Google e ao SPX, que o
//   processo principal cronometra). No celular, fica numa fila no aparelho.
// - A cada 5 minutos os erros e alertas são enviados para a guia Logs da planilha do hub (repetidos viram uma linha com
//   "Vezes"), para o administrador acompanhar em Ferramentas → Usuários e hubs → Registros.
window.AppLog = (() => {
  const api = window.hubApi || null;
  const C = window.APP_CONFIG || {};
  const SLOW = { refresh: 12000, render: 1500, central: 6000, base: 6000, ...(C.LOG_SLOW_MS || {}) };
  const LSQ = 'hub.logq', MAXQ = 300, recent = [];
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(LSQ) || '[]'); } catch (e) { return []; } };
  const lsSet = q => { try { localStorage.setItem(LSQ, JSON.stringify(q.slice(-MAXQ))); } catch (e) { /* sem espaço */ } };
  const tela = () => { try { return localStorage.getItem('hub.tab') || ''; } catch (e) { return ''; } };
  let busy = false;

  function add(level, tipo, msg, ms = null, detail = '') {
    const e = { t: new Date().toISOString(), level, tipo, msg: String(msg || '').slice(0, 500), ms: ms == null ? null : Math.round(ms), tela: tela(),
      detail: String(detail || '').slice(0, 1000) };
    recent.push(e); if (recent.length > 200) recent.shift();
    if (api && api.logWrite) api.logWrite(e).catch(() => {});
    else if (level === 'error' || level === 'warn') { const q = lsGet(); q.push(e); lsSet(q); }
    return e;
  }
  const error = (tipo, msg, detail) => add('error', tipo, msg, null, detail);
  const warn = (tipo, msg, ms, detail) => add('warn', tipo, msg, ms, detail);
  // Cronômetro: const fim = AppLog.timer('render', 'Tela Avarias'); … fim();  → avisa se passou do limite do tipo.
  function timer(kind, label) {
    const t0 = performance.now();
    return (extra = '') => {
      const ms = performance.now() - t0, lim = SLOW[kind] || 5000;
      if (ms > lim) warn('lento', `${label} demorou ${(ms / 1000).toFixed(1)} s (limite ${(lim / 1000).toFixed(1)} s)`, ms, extra);
      return ms;
    };
  }

  // ---------- Captura automática ----------
  window.addEventListener('error', ev => error('erro', ev.message || 'Erro na tela', ev.error && ev.error.stack ? ev.error.stack : `${ev.filename || ''}:${ev.lineno || ''}`));
  window.addEventListener('unhandledrejection', ev => { const r = ev.reason; error('erro', (r && r.message) || String(r), r && r.stack); });
  const ce = console.error.bind(console);
  console.error = (...a) => { try { error('console', a.map(x => (x && x.message) || (typeof x === 'string' ? x : JSON.stringify(x))).join(' '), (a.find(x => x && x.stack) || {}).stack); } catch (e) { /* nada */ } ce(...a); };

  // ---------- Envio para a planilha do hub ----------
  async function flush() {
    if (busy || !api || !api.baseAppend) return;
    const CT = window.Central, id = CT && CT.on && CT.on() ? CT.dataId() : '';
    if (!id) return;
    busy = true;
    let list = [];
    try {
      list = api.logTake ? await api.logTake() : lsGet();
      if (!api.logTake) lsSet([]);
      if (!list.length) return;
      // Repetidos (mesmo nível, tipo e mensagem) viram uma linha com a contagem.
      const groups = new Map();
      list.forEach(e => { const k = `${e.level}|${e.tipo}|${e.msg}`; const g = groups.get(k); if (g) { g.n++; g.ms = Math.max(g.ms || 0, e.ms || 0); } else groups.set(k, { ...e, n: 1 }); });
      const me = CT.me ? CT.me() : null, who = me ? me.nome || me.email : CT.email ? CT.email() : '';
      const rows = [...groups.values()].slice(0, 100).map(e => [e.t, e.level, e.tipo || '', e.msg, e.ms == null ? '' : e.ms, e.tela || '', who,
        window.APP_VERSION || '', api.platform || 'app', e.n, e.detail || e.canal || '']);
      await api.baseAppend(id, 'Logs', rows);
    } catch (err) {
      // Não conseguiu enviar: guarda de volta (no celular) para a próxima vez. No computador continua no arquivo do dia.
      if (!api.logTake) lsSet([...list, ...lsGet()]);
    } finally { busy = false; }
  }
  setInterval(flush, 5 * 60000);
  setTimeout(flush, 60000);

  return { add, error, warn, timer, flush, recent: () => recent.slice(), SLOW,
    openFolder: () => (api && api.logOpen ? api.logOpen() : null) };
})();
