// Versão mobile (Android/iOS, via Capacitor) da ponte window.hubApi que o Electron
// fornece em electron/preload.js. Mesmas funções, implementadas no próprio aparelho:
// - lê a planilha pela API do Google com o login Google de quem usa o app (OAuth com PKCE no navegador);
// - guarda configuração e relatórios Audit na área privada do app.
(() => {
  const Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform() || window.hubApi) return;

  const { Preferences, Filesystem, App, Browser, SecureStorage } = Cap.Plugins;
  const DATA = 'DATA';
  const AUDIT_DIR = 'audit';
  const SHIFTS = ['AM', 'PM1', 'PM2'];

  // ---------- Configuração ----------
  const getPref = async (key, fallback) => {
    const { value } = await Preferences.get({ key });
    if (value == null) return fallback;
    try { return JSON.parse(value); } catch (e) { return fallback; }
  };
  const setPref = (key, v) => Preferences.set({ key, value: JSON.stringify(v) });

  function spreadsheetId(input) {
    const s = String(input || '').trim();
    const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : '';
  }

  async function publicConfig() {
    const cfg = await getPref('config', {});
    const st = await authState();
    return {
      spreadsheetUrl: cfg.spreadsheetUrl || '',
      months: cfg.months || {},
      signedIn: st.signedIn,
      email: st.email,
      dataDir: '',
      mobile: true,
    };
  }

  // ---------- Login Google (authorization code + PKCE, client OAuth Android) ----------
  // O navegador (Custom Tab) volta para o app pelo esquema reverso do client id, registrado no AndroidManifest.
  const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  const TOKEN_URL = 'https://oauth2.googleapis.com/token';
  const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
  const SCOPES = 'https://www.googleapis.com/auth/spreadsheets openid email';
  const AUTH_KEY = 'hub_google_auth';       // { refreshToken, email } no Keystore (SecureStorage)
  const PENDING_KEY = 'hub_google_pending'; // { verifier, state } enquanto o login está no navegador
  const clientId = () => (window.GOOGLE_OAUTH && window.GOOGLE_OAUTH.androidClientId) || '';
  const redirectScheme = () => `com.googleusercontent.apps.${clientId().replace('.apps.googleusercontent.com', '')}`;
  const redirectUri = () => `${redirectScheme()}:/oauthredirect`;

  const b64url = bytes => {
    let bin = '';
    new Uint8Array(bytes).forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  };
  const randomStr = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

  async function readAuth() {
    try { const { data } = await SecureStorage.internalGetItem({ prefixedKey: AUTH_KEY }); return data ? JSON.parse(data) : null; }
    catch (e) { return null; }
  }
  const writeAuth = v => SecureStorage.internalSetItem({ prefixedKey: AUTH_KEY, data: JSON.stringify(v) });
  const clearAuth = () => SecureStorage.internalRemoveItem({ prefixedKey: AUTH_KEY }).catch(() => {});
  async function authState() {
    const a = await readAuth();
    return { signedIn: !!(a && a.refreshToken), email: (a && a.email) || '' };
  }
  function notSignedIn() {
    const e = new Error('Entre com sua conta Google em ⚙ Conectar planilhas.');
    e.code = 'NOT_SIGNED_IN';
    return e;
  }

  let tokenCache = { token: null, exp: 0 };
  async function postForm(url, params) {
    const res = await httpFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  }
  const emailFromIdToken = t => {
    try { return JSON.parse(atob(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch (e) { return ''; }
  };

  let signInWaiter = null; // { resolve, reject } do login em andamento
  async function signIn() {
    if (!clientId()) throw new Error('Este aplicativo foi gerado sem o client OAuth do Google (google-oauth.local.json).');
    const verifier = randomStr(32);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = randomStr(16);
    await setPref(PENDING_KEY, { verifier, state });
    const url = `${AUTH_URL}?${new URLSearchParams({
      client_id: clientId(), redirect_uri: redirectUri(), response_type: 'code', scope: SCOPES,
      code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
    })}`;
    if (signInWaiter) signInWaiter.reject(new Error('Login anterior cancelado.'));
    const done = new Promise((resolve, reject) => { signInWaiter = { resolve, reject }; });
    await Browser.open({ url });
    return done;
  }

  // Recebe com.googleusercontent.apps.<id>:/oauthredirect?code=...&state=... e troca o código por tokens.
  async function handleRedirect(url) {
    if (!url || !clientId() || !url.startsWith(redirectScheme() + ':')) return;
    const waiter = signInWaiter;
    signInWaiter = null;
    try {
      Browser.close().catch(() => {});
      const params = new URL(url.replace(/^[^:]+:\/*/, 'https://x/')).searchParams;
      const pending = await getPref(PENDING_KEY, null);
      await Preferences.remove({ key: PENDING_KEY });
      if (params.get('error')) throw new Error(params.get('error') === 'access_denied' ? 'Login cancelado.' : 'O Google não devolveu a autorização. Tente de novo.');
      if (!pending || params.get('state') !== pending.state || !params.get('code')) throw new Error('Login inválido ou expirado. Tente de novo.');
      const r = await postForm(TOKEN_URL, { code: params.get('code'), client_id: clientId(), code_verifier: pending.verifier, redirect_uri: redirectUri(), grant_type: 'authorization_code' });
      if (!r.ok || !r.body.refresh_token) throw new Error('O Google recusou o login (' + (r.body.error_description || r.body.error || r.status) + ').');
      await writeAuth({ refreshToken: r.body.refresh_token, email: emailFromIdToken(r.body.id_token) });
      tokenCache = { token: r.body.access_token, exp: Date.now() + (r.body.expires_in || 3600) * 1000 };
      const st = await authState();
      if (waiter) waiter.resolve(st);
      else location.reload(); // o app foi reaberto pelo retorno do login
    } catch (err) {
      if (waiter) waiter.reject(err);
    }
  }
  App.addListener('appUrlOpen', e => handleRedirect(e.url));
  App.getLaunchUrl().then(r => r && handleRedirect(r.url)).catch(() => {});
  // Fechou o navegador sem concluir: libera o botão "Entrar".
  Browser.addListener('browserFinished', () => setTimeout(() => {
    if (signInWaiter) { signInWaiter.reject(new Error('Login cancelado.')); signInWaiter = null; }
  }, 1500));

  async function signOut() {
    const a = await readAuth();
    await clearAuth();
    tokenCache = { token: null, exp: 0 };
    if (a && a.refreshToken) await postForm(REVOKE_URL, { token: a.refreshToken }).catch(() => {});
    return authState();
  }

  async function getValidAccessToken() {
    if (tokenCache.token && tokenCache.exp - 60000 > Date.now()) return tokenCache.token;
    const a = await readAuth();
    if (!a || !a.refreshToken) throw notSignedIn();
    const r = await postForm(TOKEN_URL, { client_id: clientId(), refresh_token: a.refreshToken, grant_type: 'refresh_token' });
    if (!r.ok) {
      if (r.body.error === 'invalid_grant') { await clearAuth(); throw notSignedIn(); }
      throw new Error('Não foi possível renovar o login do Google (' + (r.body.error_description || r.body.error || r.status) + ').');
    }
    tokenCache = { token: r.body.access_token, exp: Date.now() + (r.body.expires_in || 3600) * 1000 };
    return tokenCache.token;
  }

  async function httpFetch(url, opts) {
    try { return await fetch(url, opts); }
    catch (e) { throw new Error('Sem conexão com o Google. Verifique a internet do aparelho.'); }
  }

  async function sheetsGet(url, token) {
    const res = await httpFetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    const msg = (body.error && body.error.message) || '';
    if (res.status === 401) throw new Error('O login do Google expirou. Entre de novo em ⚙ Conectar planilhas.');
    if (res.status === 403) {
      if (/has not been used|is disabled/i.test(msg)) throw new Error('A "Google Sheets API" não está ativada no projeto do Google Cloud do app.');
      throw new Error(`Sem permissão. Peça para compartilharem a planilha com a sua conta (${(await authState()).email || 'conta Google conectada'}).`);
    }
    if (res.status === 404) throw new Error('Planilha não encontrada. Confira o link da planilha.');
    throw new Error('Erro da API do Google: ' + (msg || res.status));
  }

  async function fetchSheets(wanted, override) {
    const cfg = await getPref('config', {});
    const id = spreadsheetId(override && override.spreadsheetUrl != null ? override.spreadsheetUrl : cfg.spreadsheetUrl);
    if (!id) throw new Error('Informe o link da planilha.');
    const token = await getValidAccessToken();
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
    const meta = await sheetsGet(`${base}?fields=properties.title,sheets.properties.title`, token);
    const existing = (meta.sheets || []).map(s => s.properties.title);
    const names = wanted && wanted.length ? existing.filter(n => wanted.includes(n)) : existing;
    const out = { spreadsheet: meta.properties.title, updatedAt: new Date().toISOString(), sheets: {},
                  missingSheets: (wanted || []).filter(n => !existing.includes(n)) };
    if (!names.length) return out;
    const qs = names.map(n => 'ranges=' + encodeURIComponent(`'${n.replace(/'/g, "''")}'`)).join('&');
    const data = await sheetsGet(`${base}/values:batchGet?${qs}&valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`, token);
    (data.valueRanges || []).forEach((vr, i) => { out.sheets[names[i]] = vr.values || []; });
    return out;
  }

  // ---------- Planilha-base compartilhada ----------
  const BASE_TABS = {
    Reports: ['Data', 'Report', 'Usuário', 'Gravado em', 'Aparelho', 'Campos alterados', 'Alterações (JSON)'],
    // Audit: só o resumo calculado de cada importação (sem as linhas do CSV).
    Audit: ['Data', 'Turno', 'Arquivo', 'Status', 'Usuário', 'Gravado em', 'Import ID', 'ATs', 'Pedidos', 'Missing', '% Missing',
      'Missorted', 'ATs com missing', 'Tempo médio (min)', 'ATs acima da meta', 'Início', 'Fim', 'Operadores', 'Resumo (JSON 1)', 'Resumo (JSON 2)', 'Resumo (JSON 3)'],
    // Parcel: resultado do rastreio de cada dia (um salvamento por linha; vale o mais recente do dia).
    Parcel: ['Data', 'Status', 'Usuário', 'Gravado em', 'Aparelho', 'Pacotes', 'Com AT', 'Sem AT', 'Avarias', 'Outro XPT', 'Operadores', 'Resultado (JSON 1)', 'Resultado (JSON 2)', 'Resultado (JSON 3)', 'Resultado (JSON 4)', 'Resultado (JSON 5)'],
    // Mapa de piso: quem está em cada função, por dia e turno (com as mudanças durante o turno). Vale o salvamento mais recente.
    MapaPiso: ['Data', 'Turno', 'Status', 'Usuário', 'Gravado em', 'Aparelho', 'Mudanças', 'Pessoas', 'Mapa (JSON 1)', 'Mapa (JSON 2)', 'Mapa (JSON 3)', 'Mapa (JSON 4)', 'Mapa (JSON 5)'],
    // Erros de piso (sorting / etiquetagem) registrados durante a operação, com os responsáveis. Vale a linha mais recente de cada ID.
    ErrosPiso: ['ID', 'Data', 'Turno', 'Tipo', 'Código', 'Rota / letra', 'Horário', 'Responsáveis', 'Status', 'Usuário', 'Gravado em', 'Aparelho', 'Detalhe (JSON)', 'Categoria', 'Operador SPX (recebedor)', 'Etiquetador', 'Observação'],
    // Recebimento por hora (painel de produtividade do SPX) e a meta do turno. Vale o salvamento mais recente do dia/turno.
    RecebimentoHora: ['Data', 'Turno', 'Status', 'Usuário', 'Gravado em', 'Aparelho', 'Início', 'A receber', 'Recebido', 'Ritmo (pac/h)', 'Previsão de término', 'Operadores', 'Resultado (JSON 1)', 'Resultado (JSON 2)'],
  };
  const q = tab => encodeURIComponent(`'${tab}'`);
  const baseUrl = id => {
    if (!/^[a-zA-Z0-9-_]{20,}$/.test(String(id || ''))) throw new Error('Link da planilha-base inválido.');
    return `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
  };
  async function sheetsSend(method, url, token, body) {
    const res = await httpFetch(url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (res.ok) return out;
    if (res.status === 403) throw new Error(`Sem permissão para gravar. Peça para compartilharem a planilha-base como EDITOR com a sua conta (${(await authState()).email || 'conta Google conectada'}).`);
    if (res.status === 404) throw new Error('Planilha-base não encontrada. Confira BASE_SHEET_URL em js/config.js.');
    throw new Error('Erro ao gravar na planilha-base: ' + ((out.error && out.error.message) || res.status));
  }
  async function baseEnsure(id) {
    const token = await getValidAccessToken();
    const base = baseUrl(id);
    const meta = await sheetsGet(`${base}?fields=properties.title,sheets.properties.title`, token);
    const have = (meta.sheets || []).map(x => x.properties.title);
    const missing = Object.keys(BASE_TABS).filter(t => !have.includes(t));
    if (missing.length) {
      await sheetsSend('POST', `${base}:batchUpdate`, token, { requests: missing.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) });
      for (const t of missing) await sheetsSend('PUT', `${base}/values/${q(t)}!A1?valueInputOption=RAW`, token, { values: [BASE_TABS[t]] });
    }
    // Guias que já existiam: atualiza o cabeçalho quando o app ganhou colunas novas (ex.: ErrosPiso).
    const old = Object.keys(BASE_TABS).filter(t => have.includes(t));
    if (old.length) {
      const heads = await sheetsGet(`${base}/values:batchGet?${old.map(t => `ranges=${q(t)}!1:1`).join('&')}`, token);
      for (const [k, t] of old.entries()) {
        const cur = ((((heads.valueRanges || [])[k] || {}).values || [])[0] || []).map(String);
        if (cur.join('|') !== BASE_TABS[t].join('|')) await sheetsSend('PUT', `${base}/values/${q(t)}!A1?valueInputOption=RAW`, token, { values: [BASE_TABS[t]] });
      }
    }
    return { title: meta.properties.title, created: missing };
  }
  async function baseRead(id) {
    const token = await getValidAccessToken();
    const data = await sheetsGet(`${baseUrl(id)}/values:batchGet?ranges=${q('Reports')}!A2:G&ranges=${q('Audit')}!A2:U&ranges=${q('Parcel')}!A2:P&ranges=${q('MapaPiso')}!A2:M&ranges=${q('ErrosPiso')}!A2:M&ranges=${q('RecebimentoHora')}!A2:N&valueRenderOption=UNFORMATTED_VALUE`, token);
    const [rep, aud, par, mapa, err, rh] = data.valueRanges || [];
    return { reports: (rep && rep.values) || [], audit: (aud && aud.values) || [], parcel: (par && par.values) || [],
      mapa: (mapa && mapa.values) || [], erros: (err && err.values) || [], receb: (rh && rh.values) || [] };
  }
  async function baseAppend(id, tab, rows) {
    if (!BASE_TABS[tab]) throw new Error('Guia inválida.');
    if (!Array.isArray(rows) || !rows.length) return true;
    const token = await getValidAccessToken();
    await sheetsSend('POST', `${baseUrl(id)}/values/${q(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, token, { values: rows });
    return true;
  }
  async function reportsListLocal() {
    const out = {};
    let files = [];
    try { files = (await Filesystem.readdir({ path: 'reports', directory: DATA })).files; } catch (e) { return out; }
    for (const f of files) {
      const n = typeof f === 'string' ? f : f.name;
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(n)) continue;
      try { out[n.slice(0, 10)] = JSON.parse((await Filesystem.readFile({ path: `reports/${n}`, directory: DATA, encoding: 'utf8' })).data); } catch (e) { /* ignora */ }
    }
    return out;
  }

  // ---------- Relatórios Audit (arquivos na área privada do app) ----------
  const auditPath = (date, shift) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !SHIFTS.includes(shift)) throw new Error('Dia ou turno inválido.');
    return `${AUDIT_DIR}/${date}_${shift}.json`;
  };
  async function auditList() {
    let files = [];
    try { files = (await Filesystem.readdir({ path: AUDIT_DIR, directory: DATA })).files; } catch (e) { return []; }
    const names = files.map(f => (typeof f === 'string' ? f : f.name)).filter(n => /^\d{4}-\d{2}-\d{2}_(AM|PM1|PM2)\.json$/.test(n));
    const out = [];
    for (const n of names) {
      try { out.push(JSON.parse((await Filesystem.readFile({ path: `${AUDIT_DIR}/${n}`, directory: DATA, encoding: 'utf8' })).data)); }
      catch (e) { /* arquivo corrompido: ignora */ }
    }
    return out;
  }
  async function auditSave(rep) {
    const path = auditPath(rep.date, rep.shift);
    // Só o resumo calculado é guardado (as linhas do CSV não).
    const data = { date: rep.date, shift: rep.shift, fileName: String(rep.fileName || ''), importedAt: new Date().toISOString(),
                   summary: rep.summary };
    await Filesystem.writeFile({ path, directory: DATA, encoding: 'utf8', data: JSON.stringify(data), recursive: true });
    return data;
  }
  async function auditDelete(date, shift) {
    try { await Filesystem.deleteFile({ path: auditPath(date, shift), directory: DATA }); } catch (e) { /* já removido */ }
    return true;
  }

  window.hubApi = {
    getConfig: publicConfig,
    async saveConfig({ months }) {
      const cfg = await getPref('config', {});
      const clean = {};
      Object.entries(months || {}).forEach(([m, url]) => {
        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(m) && String(url || '').trim()) clean[m] = String(url).trim();
      });
      cfg.months = clean;
      delete cfg.spreadsheetUrl;
      await setPref('config', cfg);
      return publicConfig();
    },
    async cacheGet(month) {
      try { return JSON.parse((await Filesystem.readFile({ path: `cache/${month}.json`, directory: DATA, encoding: 'utf8' })).data); }
      catch (e) { return null; }
    },
    async cacheSet(month, data) {
      if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Mês inválido.');
      await Filesystem.writeFile({ path: `cache/${month}.json`, directory: DATA, encoding: 'utf8', data: JSON.stringify(data), recursive: true });
      return true;
    },
    async cacheClear() {
      try { await Filesystem.rmdir({ path: 'cache', directory: DATA, recursive: true }); } catch (e) { /* vazio */ }
      return true;
    },
    fetchSheets,
    auditList, auditSave, auditDelete,
    baseEnsure, baseRead, baseAppend, reportsListLocal,
    os: Cap.getPlatform(), // 'android' | 'ios'
    openExternal: url => { window.open(url, '_system'); },
    platform: Cap.getPlatform(),
    async reportGet(date) {
      try { return JSON.parse((await Filesystem.readFile({ path: `reports/${date}.json`, directory: DATA, encoding: 'utf8' })).data); }
      catch (e) { return {}; }
    },
    async reportSet(date, data) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Data inválida.');
      await Filesystem.writeFile({ path: `reports/${date}.json`, directory: DATA, encoding: 'utf8', data: JSON.stringify(data || {}), recursive: true });
      return true;
    },
  };
  window.auth = { getState: authState, signIn, signOut };
  document.documentElement.classList.add('is-mobile-app');
})();
