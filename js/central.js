// Planilha Central (multi-hub): quem pode usar o app, em quais hubs e com qual papel, e onde ficam os dados de cada hub.
// - Usuario = e-mail da conta Google (Workspace). Papel: Admin, Gerente, Qualidade, Site líder, Líder, Analista.
// - Cada hub tem uma planilha de dados por ano (guia Arquivos); a planilha-base do app passa a ser a do hub escolhido.
// - A segurança de verdade é o compartilhamento do Google Drive (cada hub só compartilha as suas planilhas). Esta lista
//   diz ao app o que mostrar; quem não tem a planilha compartilhada não consegue ler, mesmo que esteja na lista.
// - Vale a linha mais recente de cada chave (Usuarios: e-mail · Hubs: ID · Arquivos: hub + ano); nada é apagado.
// - O que foi lido fica guardado no aparelho e é aplicado já na abertura (o app não espera a rede para montar a tela).
window.Central = (() => {
  const C = window.APP_CONFIG;
  const api = window.hubApi || null;
  const sheetId = url => (String(url || '').match(/\/d\/([a-zA-Z0-9-_]+)/) || [])[1] || (/^[a-zA-Z0-9-_]{20,}$/.test(String(url || '').trim()) ? String(url).trim() : '');
  const ID = sheetId(C.CENTRAL_SHEET_URL);

  const ROLES = ['Admin', 'Gerente', 'Qualidade', 'Site líder', 'Líder', 'Analista'];
  // Papéis que acompanham vários hubs (os demais ficam num hub só) e papéis que só consultam.
  const MULTI = ['Admin', 'Gerente', 'Qualidade'];
  const READONLY = ['Gerente'];

  const ls = {
    get(k, d) { try { const v = localStorage.getItem('hub.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hub.' + k, JSON.stringify(v)); } catch (e) { /* sem espaço */ } },
  };
  const s = x => (x == null ? '' : String(x)).trim();
  const lower = x => s(x).toLowerCase();
  const nowIso = () => new Date().toISOString();
  const year = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 4);
  const clean = err => String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  let users = new Map(), hubs = new Map(), files = new Map();
  let email = '', state = 'off', error = '', loadedAt = 0;
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { /* tela fechada */ } });

  // ---------- Linhas da planilha ----------
  // Usuarios: E-mail, Nome, Papel, Hubs ("*" = todos; vários separados por vírgula), Status, Atualizado por, Atualizado em.
  const userRow = (u, by, at) => [lower(u.email), s(u.nome), s(u.papel), (u.hubs || []).join(', '), u.status || 'ativo', by, at];
  function applyUser(r) {
    const [mail, nome, papel, hubsTxt, st, by, at] = r.map(s);
    const key = lower(mail);
    if (!key) return;
    const cur = users.get(key);
    if (cur && at < cur.at) return;
    users.set(key, { email: key, nome, papel: ROLES.includes(papel) ? papel : 'Analista', hubs: hubsTxt.split(/[,;]/).map(x => s(x).toUpperCase()).filter(Boolean), status: st || 'ativo', by, at });
  }
  // Hubs: ID, Nome, Cidade, Status, Atualizado por, Atualizado em, Configuração (JSON: estação SPX, turnos, metas…).
  const hubRow = (h, by, at) => [s(h.id).toUpperCase(), s(h.nome), s(h.cidade), h.status || 'ativo', by, at, JSON.stringify(h.cfg || {})];
  function applyHub(r) {
    const [id, nome, cidade, st, by, at, json] = r.map(s);
    const key = id.toUpperCase();
    if (!key) return;
    const cur = hubs.get(key);
    if (cur && at < cur.at) return;
    let cfg = {};
    try { cfg = json ? JSON.parse(json) : {}; } catch (e) { cfg = {}; }
    hubs.set(key, { id: key, nome, cidade, status: st || 'ativo', by, at, cfg });
  }
  // Arquivos: Hub, Ano, Planilha de dados (link), Status, Atualizado por, Atualizado em.
  const fileRow = (f, by, at) => [s(f.hub).toUpperCase(), s(f.ano), s(f.url), f.status || 'ativo', by, at];
  function applyFile(r) {
    const [hub, ano, url, st, by, at] = r.map(s);
    if (!hub || !ano) return;
    const key = `${hub.toUpperCase()}|${ano}`, cur = files.get(key);
    if (cur && at < cur.at) return;
    files.set(key, { hub: hub.toUpperCase(), ano, url, id: sheetId(url), status: st || 'ativo', by, at });
  }
  function parse(data) {
    users = new Map(); hubs = new Map(); files = new Map();
    (data.Usuarios || []).forEach(applyUser);
    (data.Hubs || []).forEach(applyHub);
    (data.Arquivos || []).forEach(applyFile);
  }

  // ---------- Quem sou eu e qual hub ----------
  const me = () => users.get(lower(email)) || null;
  const role = () => (me() || {}).papel || '';
  const isAdmin = () => role() === 'Admin';
  const readOnly = () => on() && READONLY.includes(role());
  const activeHubs = () => [...hubs.values()].filter(h => h.status !== 'inativo').sort((a, b) => a.id.localeCompare(b.id));
  function myHubs() {
    const u = me();
    if (!u || u.status === 'inativo') return [];
    if (u.papel === 'Admin' || u.hubs.includes('*')) return activeHubs();
    const list = activeHubs().filter(h => u.hubs.includes(h.id));
    return MULTI.includes(u.papel) ? list : list.slice(0, 1);
  }
  function hub() {
    const list = myHubs();
    return list.find(h => h.id === ls.get('hub', '')) || list[0] || null;
  }
  // Planilha de dados do hub no ano (padrão: o ano atual). Sem a do ano, a mais recente.
  function dataFile(h = hub(), ano = year()) {
    if (!h) return null;
    const list = [...files.values()].filter(f => f.hub === h.id && f.status !== 'inativo' && f.id);
    return list.find(f => f.ano === String(ano)) || list.sort((a, b) => b.ano.localeCompare(a.ano))[0] || null;
  }
  const dataId = () => (dataFile() || {}).id || '';

  // Configuração do hub por cima do js/config.js (no mesmo objeto: as telas que já leram APP_CONFIG veem a mudança).
  const DEFAULTS = { HUB_NAME: C.HUB_NAME, HUB_CITY: C.HUB_CITY, PARCEL: { ...C.PARCEL }, RECEB_JANELAS: JSON.parse(JSON.stringify(C.RECEB_JANELAS || {})), METAS: { ...C.METAS } };
  function applyConfig(h) {
    C.HUB_NAME = h ? h.nome || h.id : DEFAULTS.HUB_NAME;
    C.HUB_CITY = h ? h.cidade : DEFAULTS.HUB_CITY;
    const cfg = (h && h.cfg) || {};
    const put = (k, v) => { Object.keys(C[k]).forEach(x => delete C[k][x]); Object.assign(C[k], v); };
    put('PARCEL', { ...DEFAULTS.PARCEL, ...(cfg.PARCEL || {}) });
    put('RECEB_JANELAS', { ...DEFAULTS.RECEB_JANELAS, ...(cfg.RECEB_JANELAS || {}) });
    put('METAS', { ...DEFAULTS.METAS, ...(cfg.METAS || {}) });
    C.HUB_ID = h ? h.id : '';
  }
  const signature = () => { const h = hub(); return JSON.stringify(h ? [h.id, h.nome, h.cidade, h.cfg] : null); };

  // ---------- Leitura ----------
  const on = () => !!(ID && api && api.centralRead);
  // Na abertura: aplica o que ficou guardado da última leitura.
  (function boot() {
    if (!on()) return;
    const cache = ls.get('central', null);
    if (!cache) return;
    email = cache.email || '';
    parse(cache.data || {});
    applyConfig(hub());
  })();

  // Lê a planilha Central. Devolve { reload } quando a configuração do hub mudou desde a abertura.
  async function init() {
    if (!on()) { state = 'off'; return { reload: false }; }
    const before = ls.get('central', null) ? signature() : null;
    try {
      const cfg = await api.getConfig();
      if (!cfg.signedIn) { state = 'nologin'; emit(); return { reload: false }; }
      email = lower(cfg.email);
      if (!email) throw new Error('Não foi possível identificar o e-mail da conta Google. Saia e entre de novo.');
      await api.centralEnsure(ID);
      const data = await api.centralRead(ID);
      parse(data);
      await bootstrap();
      ls.set('central', { email, data: { Usuarios: [...users.values()].map(u => userRow(u, u.by, u.at)), Hubs: [...hubs.values()].map(h => hubRow(h, h.by, h.at)), Arquivos: [...files.values()].map(f => fileRow(f, f.by, f.at)) } });
      loadedAt = Date.now(); error = '';
    } catch (err) {
      error = clean(err);
      // Sem rede: segue com o que ficou guardado (se houver).
      if (!ls.get('central', null)) { state = 'error'; emit(); return { reload: false }; }
    }
    const u = me();
    state = !u ? 'nouser' : u.status === 'inativo' ? 'inactive' : !myHubs().length ? 'nohub' : !dataFile() ? 'nofile' : 'ok';
    applyConfig(hub());
    emit();
    return { reload: before != null && before !== signature() };
  }

  // Planilha Central vazia: quem abre primeiro vira Admin, e o hub do js/config.js é cadastrado (com a planilha de dados
  // indicada em CENTRAL_SEED, se houver). Assim o primeiro uso não precisa de nada feito à mão na planilha.
  async function bootstrap() {
    const seed = C.CENTRAL_SEED || {};
    const rows = { Usuarios: [], Hubs: [], Arquivos: [] }, at = nowIso();
    if (!users.size) rows.Usuarios.push(userRow({ email, nome: email.split('@')[0], papel: 'Admin', hubs: ['*'] }, email, at));
    if (!hubs.size && seed.hub) rows.Hubs.push(hubRow({ id: seed.hub, nome: C.HUB_NAME, cidade: C.HUB_CITY, cfg: { PARCEL: C.PARCEL, RECEB_JANELAS: C.RECEB_JANELAS, METAS: C.METAS, months: 'config' } }, email, at));
    if (!files.size && seed.hub && seed.file) rows.Arquivos.push(fileRow({ hub: seed.hub, ano: seed.ano || year(), url: seed.file }, email, at));
    for (const [tab, list] of Object.entries(rows)) {
      if (!list.length) continue;
      await api.centralAppend(ID, tab, list);
      list.forEach({ Usuarios: applyUser, Hubs: applyHub, Arquivos: applyFile }[tab]);
    }
  }

  // ---------- Escrita (só Admin; a planilha Central é compartilhada como editor apenas com os admins) ----------
  async function write(tab, row, apply) {
    if (!isAdmin()) throw new Error('Só o administrador pode alterar usuários e hubs.');
    await api.centralAppend(ID, tab, [row]);
    apply(row);
    const cache = ls.get('central', { email, data: {} });
    (cache.data[tab] = cache.data[tab] || []).push(row);
    ls.set('central', cache);
    emit();
  }
  const okEmail = x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
  async function saveUser(u) {
    const mail = lower(u.email);
    if (!okEmail(mail)) throw new Error('E-mail inválido.');
    if (!ROLES.includes(u.papel)) throw new Error('Papel inválido.');
    if (mail === lower(email) && (u.papel !== 'Admin' || u.status === 'inativo')) throw new Error('Você não pode tirar o seu próprio acesso de administrador.');
    const hs = u.papel === 'Admin' ? ['*'] : (u.hubs || []).map(x => s(x).toUpperCase()).filter(Boolean);
    if (!hs.length) throw new Error('Escolha pelo menos um hub.');
    if (!MULTI.includes(u.papel) && hs.length > 1) throw new Error(`O papel ${u.papel} fica em um hub só.`);
    await write('Usuarios', userRow({ ...u, email: mail, hubs: hs }, email, nowIso()), applyUser);
  }
  async function saveHub(h) {
    const id = s(h.id).toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(id)) throw new Error('ID do hub: só letras, números, - e _ (ex.: LGO03).');
    if (!s(h.nome)) throw new Error('Informe o nome do hub.');
    await write('Hubs', hubRow({ ...h, id }, email, nowIso()), applyHub);
  }
  async function saveFile(f) {
    if (!sheetId(f.url)) throw new Error('Link da planilha inválido.');
    if (!/^\d{4}$/.test(s(f.ano))) throw new Error('Ano inválido.');
    // Confere o acesso e já cria as guias do app na planilha nova.
    if (f.status !== 'inativo') await api.baseEnsure(sheetId(f.url));
    await write('Arquivos', fileRow(f, email, nowIso()), applyFile);
  }

  function setHub(id) { ls.set('hub', id); }

  return {
    on, init, state: () => state, error: () => error, email: () => email, me, role, isAdmin, readOnly, ROLES, MULTI, READONLY,
    hub, myHubs, setHub, dataFile, dataId, year,
    users: () => [...users.values()].sort((a, b) => a.email.localeCompare(b.email)),
    hubs: () => [...hubs.values()].sort((a, b) => a.id.localeCompare(b.id)),
    files: () => [...files.values()].sort((a, b) => (a.hub + a.ano).localeCompare(b.hub + b.ano)),
    saveUser, saveHub, saveFile, onChange: fn => listeners.add(fn), loadedAt: () => loadedAt,
    sheetUrl: () => (ID ? `https://docs.google.com/spreadsheets/d/${ID}/edit` : ''),
  };
})();
