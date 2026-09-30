// Versão mobile (Android/iOS, via Capacitor) da ponte window.hubApi que o Electron
// fornece em electron/preload.js. Mesmas funções, implementadas no próprio aparelho:
// - lê a planilha pela API do Google com a chave da conta de serviço embutida no app;
// - guarda configuração e relatórios Audit na área privada do app.
(() => {
  const Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform() || window.hubApi) return;

  const { Preferences, Filesystem } = Cap.Plugins;
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

  let embedded; // undefined = não carregada ainda; null = não existe no app
  async function embeddedKey() {
    if (embedded !== undefined) return embedded;
    try {
      const res = await fetch('credentials/service-account.json', { cache: 'no-store' });
      const k = res.ok ? await res.json() : null;
      embedded = k && k.type === 'service_account' && k.client_email && k.private_key ? k : null;
    } catch (e) { embedded = null; }
    return embedded;
  }

  function spreadsheetId(input) {
    const s = String(input || '').trim();
    const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : '';
  }

  async function publicConfig() {
    const cfg = await getPref('config', {});
    const key = await embeddedKey();
    return {
      spreadsheetUrl: cfg.spreadsheetUrl || '',
      months: cfg.months || {},
      hasKey: !!key,
      keySource: key ? 'embedded' : '',
      clientEmail: key ? key.client_email : '',
      dataDir: '',
      mobile: true,
    };
  }

  // ---------- Google OAuth (JWT RS256 assinado com WebCrypto) ----------
  let tokenCache = { token: null, exp: 0 };
  const enc = new TextEncoder();
  const b64url = bytes => {
    let bin = '';
    new Uint8Array(bytes).forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  };
  const pemToDer = pem => {
    const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  };

  async function accessToken(key) {
    const now = Math.floor(Date.now() / 1000);
    if (tokenCache.token && tokenCache.exp - 60 > now) return tokenCache.token;
    const tokenUri = key.token_uri || 'https://oauth2.googleapis.com/token';
    const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
    const claim = b64url(enc.encode(JSON.stringify({
      iss: key.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly',
      aud: tokenUri, iat: now, exp: now + 3600,
    })));
    const cryptoKey = await crypto.subtle.importKey('pkcs8', pemToDer(key.private_key),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, enc.encode(`${header}.${claim}`));
    const res = await httpFetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${header}.${claim}.${b64url(sig)}`,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('A chave da conta de serviço foi recusada pelo Google (' + (body.error_description || body.error || res.status) + ').');
    tokenCache = { token: body.access_token, exp: now + (body.expires_in || 3600) };
    return tokenCache.token;
  }

  async function httpFetch(url, opts) {
    try { return await fetch(url, opts); }
    catch (e) { throw new Error('Sem conexão com o Google. Verifique a internet do aparelho.'); }
  }

  async function sheetsGet(url, token, key) {
    const res = await httpFetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    const msg = (body.error && body.error.message) || '';
    if (res.status === 403) {
      if (/has not been used|is disabled/i.test(msg)) throw new Error('A "Google Sheets API" não está ativada no projeto da conta de serviço.');
      throw new Error(`Sem permissão. Compartilhe a planilha (como Leitor) com: ${key.client_email}`);
    }
    if (res.status === 404) throw new Error('Planilha não encontrada. Confira o link da planilha.');
    throw new Error('Erro da API do Google: ' + (msg || res.status));
  }

  async function fetchSheets(wanted, override) {
    const cfg = await getPref('config', {});
    const id = spreadsheetId(override && override.spreadsheetUrl != null ? override.spreadsheetUrl : cfg.spreadsheetUrl);
    const key = await embeddedKey();
    if (!key) throw new Error('Este aplicativo foi gerado sem a chave de acesso embutida.');
    if (!id) throw new Error('Informe o link da planilha.');
    const token = await accessToken(key);
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
    const meta = await sheetsGet(`${base}?fields=properties.title,sheets.properties.title`, token, key);
    const existing = (meta.sheets || []).map(s => s.properties.title);
    const names = wanted && wanted.length ? existing.filter(n => wanted.includes(n)) : existing;
    const out = { spreadsheet: meta.properties.title, updatedAt: new Date().toISOString(), sheets: {},
                  missingSheets: (wanted || []).filter(n => !existing.includes(n)) };
    if (!names.length) return out;
    const qs = names.map(n => 'ranges=' + encodeURIComponent(`'${n.replace(/'/g, "''")}'`)).join('&');
    const data = await sheetsGet(`${base}/values:batchGet?${qs}&valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`, token, key);
    (data.valueRanges || []).forEach((vr, i) => { out.sheets[names[i]] = vr.values || []; });
    return out;
  }

  // ---------- Planilha-base compartilhada ----------
  const BASE_TABS = {
    Reports: ['Data', 'Report', 'Usuário', 'Gravado em', 'Aparelho', 'Campos alterados', 'Alterações (JSON)'],
    // Audit: só o resumo calculado de cada importação (sem as linhas do CSV).
    Audit: ['Data', 'Turno', 'Arquivo', 'Status', 'Usuário', 'Gravado em', 'Import ID', 'ATs', 'Pedidos', 'Missing', '% Missing',
      'Missorted', 'ATs com missing', 'Tempo médio (min)', 'ATs acima da meta', 'Início', 'Fim', 'Operadores', 'Resumo (JSON 1)', 'Resumo (JSON 2)', 'Resumo (JSON 3)'],
  };
  const q = tab => encodeURIComponent(`'${tab}'`);
  const baseUrl = id => {
    if (!/^[a-zA-Z0-9-_]{20,}$/.test(String(id || ''))) throw new Error('Link da planilha-base inválido.');
    return `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
  };
  async function baseToken() {
    const key = await embeddedKey();
    if (!key) throw new Error('App sem chave de acesso.');
    return { key, token: await accessToken(key) };
  }
  async function sheetsSend(method, url, token, body, key) {
    const res = await httpFetch(url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (res.ok) return out;
    if (res.status === 403) throw new Error(`Sem permissão para gravar. Compartilhe a planilha-base como EDITOR com: ${key.client_email}`);
    if (res.status === 404) throw new Error('Planilha-base não encontrada. Confira BASE_SHEET_URL em js/config.js.');
    throw new Error('Erro ao gravar na planilha-base: ' + ((out.error && out.error.message) || res.status));
  }
  async function baseEnsure(id) {
    const { key, token } = await baseToken();
    const base = baseUrl(id);
    const meta = await sheetsGet(`${base}?fields=properties.title,sheets.properties.title`, token, key);
    const have = (meta.sheets || []).map(x => x.properties.title);
    const missing = Object.keys(BASE_TABS).filter(t => !have.includes(t));
    if (missing.length) {
      await sheetsSend('POST', `${base}:batchUpdate`, token, { requests: missing.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) }, key);
      for (const t of missing) await sheetsSend('PUT', `${base}/values/${q(t)}!A1?valueInputOption=RAW`, token, { values: [BASE_TABS[t]] }, key);
    }
    return { title: meta.properties.title, created: missing };
  }
  async function baseRead(id) {
    const { key, token } = await baseToken();
    const data = await sheetsGet(`${baseUrl(id)}/values:batchGet?ranges=${q('Reports')}!A2:G&ranges=${q('Audit')}!A2:U&valueRenderOption=UNFORMATTED_VALUE`, token, key);
    const [rep, aud] = data.valueRanges || [];
    return { reports: (rep && rep.values) || [], audit: (aud && aud.values) || [] };
  }
  async function baseAppend(id, tab, rows) {
    if (!BASE_TABS[tab]) throw new Error('Guia inválida.');
    if (!Array.isArray(rows) || !rows.length) return true;
    const { key, token } = await baseToken();
    await sheetsSend('POST', `${baseUrl(id)}/values/${q(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, token, { values: rows }, key);
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
    pickKey: async () => { throw new Error('No celular é usada apenas a chave embutida no aplicativo.'); },
    removeKey: publicConfig,
    fetchSheets,
    auditList, auditSave, auditDelete,
    baseEnsure, baseRead, baseAppend, reportsListLocal,
    os: Cap.getPlatform(), // 'android' | 'ios'
    async driveList(folderId) {
      if (!/^[a-zA-Z0-9-_]{10,}$/.test(String(folderId || ''))) throw new Error('Pasta do Drive inválida.');
      const { token } = await baseToken();
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const res = await httpFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink,modifiedTime,size)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: 'Bearer ' + token } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body.error && body.error.message) || ('Erro do Drive ' + res.status));
      return body.files || [];
    },
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
  document.documentElement.classList.add('is-mobile-app');
})();
