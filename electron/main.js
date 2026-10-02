// Processo principal do aplicativo desktop.
// Lê a planilha pela API do Google Sheets usando uma conta de serviço cuja chave
// fica somente neste computador (pasta de dados do usuário).
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = () => app.getPath('userData');
const CONFIG_FILE = () => path.join(DATA_DIR(), 'config.json');
const KEY_FILE = () => path.join(DATA_DIR(), 'service-account.json');

// ---------- Configuração local ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writePrivate(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch (e) { /* Windows ignora */ }
}
const readConfig = () => readJson(CONFIG_FILE(), {});
const writeConfig = cfg => writePrivate(CONFIG_FILE(), JSON.stringify(cfg, null, 2));
// Chave embutida no instalador (electron/credentials/service-account.json, fora do git).
// Uma chave escolhida pelo usuário nas configurações tem prioridade sobre ela.
const EMBEDDED_KEY_FILE = path.join(__dirname, 'credentials', 'service-account.json');
const validKey = k => (k && k.type === 'service_account' && k.client_email && k.private_key ? k : null);
const customKey = () => validKey(readJson(KEY_FILE(), null));
const embeddedKey = () => validKey(readJson(EMBEDDED_KEY_FILE, null));
const readKey = () => customKey() || embeddedKey();

function spreadsheetId(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : '';
}

function publicConfig() {
  const cfg = readConfig();
  const key = readKey();
  return {
    spreadsheetUrl: cfg.spreadsheetUrl || '',
    months: cfg.months || {},
    hasKey: !!key,
    keySource: customKey() ? 'custom' : key ? 'embedded' : '',
    clientEmail: key ? key.client_email : '',
    dataDir: DATA_DIR(),
  };
}

// ---------- Google OAuth (JWT da conta de serviço) ----------
let tokenCache = { token: null, exp: 0, email: null };
const b64url = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.email === key.client_email && tokenCache.exp - 60 > now) return tokenCache.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: key.client_email,
    // Leitura das planilhas mensais + escrita na planilha-base compartilhada do app.
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly',
    aud: key.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const signature = b64url(crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(key.private_key));
  const res = await httpFetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${signature}`,
    }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('A chave da conta de serviço foi recusada pelo Google (' + (body.error_description || body.error || res.status) + ').');
  tokenCache = { token: body.access_token, exp: now + (body.expires_in || 3600), email: key.client_email };
  return tokenCache.token;
}

async function httpFetch(url, opts) {
  try { return await fetch(url, opts); }
  catch (e) { throw new Error('Sem conexão com o Google. Verifique a internet do computador.'); }
}

async function sheetsGet(url, token) {
  const res = await httpFetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body;
  const key = readKey();
  if (res.status === 403) {
    const msg = (body.error && body.error.message) || '';
    if (/has not been used|is disabled/i.test(msg)) throw new Error('A "Google Sheets API" não está ativada no projeto da conta de serviço. Ative em console.cloud.google.com → APIs e serviços.');
    throw new Error(`Sem permissão. Compartilhe a planilha (como Leitor) com: ${key ? key.client_email : 'o e-mail da conta de serviço'}`);
  }
  if (res.status === 404) throw new Error('Planilha não encontrada. Confira o link da planilha nas configurações.');
  throw new Error('Erro da API do Google: ' + ((body.error && body.error.message) || res.status));
}

// Devolve { spreadsheet, updatedAt, sheets: { nome: [[texto,...],...] } } — o mesmo formato do modo demonstração.
async function fetchSheets(wanted, override) {
  const cfg = readConfig();
  const id = spreadsheetId(override && override.spreadsheetUrl != null ? override.spreadsheetUrl : cfg.spreadsheetUrl);
  const key = readKey();
  if (!key) throw new Error('Selecione o arquivo de chave (.json) da conta de serviço nas configurações.');
  if (!id) throw new Error('Informe o link da planilha nas configurações.');
  const token = await accessToken(key);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
  const meta = await sheetsGet(`${base}?fields=properties.title,sheets.properties.title`, token);
  const existing = (meta.sheets || []).map(s => s.properties.title);
  const names = wanted && wanted.length ? existing.filter(n => wanted.includes(n)) : existing;
  const out = { spreadsheet: meta.properties.title, updatedAt: new Date().toISOString(), sheets: {}, missingSheets: (wanted || []).filter(n => !existing.includes(n)) };
  if (!names.length) return out;
  const qs = names.map(n => 'ranges=' + encodeURIComponent(`'${n.replace(/'/g, "''")}'`)).join('&');
  const data = await sheetsGet(`${base}/values:batchGet?${qs}&valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`, token);
  (data.valueRanges || []).forEach((vr, i) => { out.sheets[names[i]] = vr.values || []; });
  return out;
}

// ---------- Relatórios Audit (LMHub), salvos só neste computador ----------
const AUDIT_DIR = () => path.join(DATA_DIR(), 'audit');
const SHIFTS = ['AM', 'PM1', 'PM2'];
const auditFile = (date, shift) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !SHIFTS.includes(shift)) throw new Error('Dia ou turno inválido.');
  return path.join(AUDIT_DIR(), `${date}_${shift}.json`);
};

ipcMain.handle('audit:list', () => {
  let files = [];
  try { files = fs.readdirSync(AUDIT_DIR()).filter(f => /^\d{4}-\d{2}-\d{2}_(AM|PM1|PM2)\.json$/.test(f)); } catch (e) { return []; }
  return files.map(f => readJson(path.join(AUDIT_DIR(), f), null)).filter(Boolean);
});

ipcMain.handle('audit:save', (_e, rep) => {
  const file = auditFile(rep.date, rep.shift);
  if (!rep.summary || typeof rep.summary !== 'object') throw new Error('Relatório inválido.');
  // Só o resumo calculado é guardado (as linhas do CSV não).
  const data = { date: rep.date, shift: rep.shift, fileName: String(rep.fileName || ''), importedAt: new Date().toISOString(),
                 summary: rep.summary };
  writePrivate(file, JSON.stringify(data));
  return data;
});

ipcMain.handle('audit:delete', (_e, { date, shift }) => {
  try { fs.unlinkSync(auditFile(date, shift)); } catch (e) { /* já removido */ }
  return true;
});

// ---------- Planilha-base compartilhada (reports e Audit de todos os usuários) ----------
// Audit: só o resumo calculado de cada importação (sem as linhas do CSV).
const AUDIT_COLS = ['Data', 'Turno', 'Arquivo', 'Status', 'Usuário', 'Gravado em', 'Import ID', 'ATs', 'Pedidos', 'Missing', '% Missing',
  'Missorted', 'ATs com missing', 'Tempo médio (min)', 'ATs acima da meta', 'Início', 'Fim', 'Operadores', 'Resumo (JSON 1)', 'Resumo (JSON 2)', 'Resumo (JSON 3)'];
const BASE_TABS = {
  Reports: ['Data', 'Report', 'Usuário', 'Gravado em', 'Aparelho', 'Campos alterados', 'Alterações (JSON)'],
  Audit: AUDIT_COLS,
};
const baseId = id => { if (!/^[a-zA-Z0-9-_]{20,}$/.test(String(id || ''))) throw new Error('Link da planilha-base inválido.'); return id; };
const q = tab => encodeURIComponent(`'${tab}'`);

async function sheetsSend(method, url, token, body) {
  const res = await httpFetch(url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (res.ok) return out;
  const key = readKey();
  if (res.status === 403) throw new Error(`Sem permissão para gravar. Compartilhe a planilha-base como EDITOR com: ${key ? key.client_email : 'o e-mail da conta de serviço'}`);
  if (res.status === 404) throw new Error('Planilha-base não encontrada. Confira o link em js/config.js (BASE_SHEET_URL).');
  throw new Error('Erro ao gravar na planilha-base: ' + ((out.error && out.error.message) || res.status));
}
async function baseToken() {
  const key = readKey();
  if (!key) throw new Error('App sem chave de acesso.');
  return accessToken(key);
}

// Cria as guias que faltarem, com cabeçalho.
ipcMain.handle('base:ensure', async (_e, id) => {
  const token = await baseToken();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${baseId(id)}`;
  const meta = await sheetsGet(`${base}?fields=properties.title,sheets.properties.title`, token);
  const have = (meta.sheets || []).map(x => x.properties.title);
  const missing = Object.keys(BASE_TABS).filter(t => !have.includes(t));
  if (missing.length) {
    await sheetsSend('POST', `${base}:batchUpdate`, token, { requests: missing.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) });
    for (const t of missing) await sheetsSend('PUT', `${base}/values/${q(t)}!A1?valueInputOption=RAW`, token, { values: [BASE_TABS[t]] });
  }
  return { title: meta.properties.title, created: missing };
});

// Lê o que o app precisa: Reports e o resumo de cada Audit importado.
ipcMain.handle('base:read', async (_e, id) => {
  const token = await baseToken();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${baseId(id)}`;
  const data = await sheetsGet(`${base}/values:batchGet?ranges=${q('Reports')}!A2:G&ranges=${q('Audit')}!A2:U&valueRenderOption=UNFORMATTED_VALUE`, token);
  const [rep, aud] = data.valueRanges || [];
  return { reports: (rep && rep.values) || [], audit: (aud && aud.values) || [] };
});

// Acrescenta linhas ao fim de uma guia.
ipcMain.handle('base:append', async (_e, id, tab, rows) => {
  if (!BASE_TABS[tab]) throw new Error('Guia inválida.');
  if (!Array.isArray(rows) || !rows.length) return true;
  const token = await baseToken();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${baseId(id)}`;
  await sheetsSend('POST', `${base}/values/${q(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, token, { values: rows });
  return true;
});

// Dados antigos gravados só neste computador (para enviar à planilha-base uma única vez).
ipcMain.handle('reports:listLocal', () => {
  const out = {};
  try {
    fs.readdirSync(REPORTS_DIR()).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .forEach(f => { out[f.slice(0, 10)] = readJson(path.join(REPORTS_DIR(), f), {}); });
  } catch (e) { /* nenhum */ }
  return out;
});

// ---------- Valores digitados nos reports (um arquivo por dia) ----------
const REPORTS_DIR = () => path.join(DATA_DIR(), 'reports');
const reportFile = date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Data inválida.');
  return path.join(REPORTS_DIR(), `${date}.json`);
};
ipcMain.handle('reports:get', (_e, date) => readJson(reportFile(date), {}));
ipcMain.handle('reports:set', (_e, date, data) => { writePrivate(reportFile(date), JSON.stringify(data || {})); return true; });

// ---------- Atualizações: lista os arquivos da pasta do Drive com os instaladores ----------
ipcMain.handle('drive:list', async (_e, folderId) => {
  if (!/^[a-zA-Z0-9-_]{10,}$/.test(String(folderId || ''))) throw new Error('Pasta do Drive inválida.');
  const key = readKey();
  if (!key) throw new Error('App sem chave de acesso.');
  const token = await accessToken(key);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await httpFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink,modifiedTime,size)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: 'Bearer ' + token } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body.error && body.error.message) || ('Erro do Drive ' + res.status));
  return body.files || [];
});
ipcMain.handle('app:openExternal', (_e, url) => { if (/^https:\/\//.test(String(url))) shell.openExternal(url); });

// ---------- IPC ----------
ipcMain.handle('config:get', () => publicConfig());

// months: { 'AAAA-MM': 'link da planilha do mês' }
ipcMain.handle('config:save', (_e, { months }) => {
  const cfg = readConfig();
  const clean = {};
  Object.entries(months || {}).forEach(([m, url]) => {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(m) && String(url || '').trim()) clean[m] = String(url).trim();
  });
  cfg.months = clean;
  delete cfg.spreadsheetUrl;
  writeConfig(cfg);
  return publicConfig();
});

// Cache dos meses já lidos (meses fechados não precisam ser baixados de novo).
const CACHE_DIR = () => path.join(DATA_DIR(), 'cache');
const cacheFile = m => {
  if (!/^\d{4}-\d{2}$/.test(m)) throw new Error('Mês inválido.');
  return path.join(CACHE_DIR(), `${m}.json`);
};
ipcMain.handle('cache:get', (_e, month) => readJson(cacheFile(month), null));
ipcMain.handle('cache:set', (_e, month, data) => { writePrivate(cacheFile(month), JSON.stringify(data)); return true; });
ipcMain.handle('cache:clear', () => { fs.rmSync(CACHE_DIR(), { recursive: true, force: true }); return true; });

ipcMain.handle('config:pickKey', async e => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: 'Selecione a chave JSON da conta de serviço',
    properties: ['openFile'],
    filters: [{ name: 'Chave JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { ...publicConfig(), canceled: true };
  const key = readJson(r.filePaths[0], null);
  if (!validKey(key))
    throw new Error('Este arquivo não é uma chave de conta de serviço do Google (tipo "service_account").');
  writePrivate(KEY_FILE(), JSON.stringify(key));
  tokenCache = { token: null, exp: 0, email: null };
  return publicConfig();
});

ipcMain.handle('config:removeKey', () => {
  try { fs.unlinkSync(KEY_FILE()); } catch (e) { /* já removida */ }
  tokenCache = { token: null, exp: 0, email: null };
  return publicConfig();
});

ipcMain.handle('sheets:fetch', (_e, { sheets, override } = {}) => fetchSheets(sheets, override));

// Rastreio do SPX (aba Parcel): a sessão colada pelo usuário fica só na memória.
require('./parcel').register(ipcMain);

// ---------- Janela ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 380, minHeight: 500,
    title: 'Dashboard HUB LGO 03',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#F5F5F5',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));

  // Links (ex.: HSE) abrem no navegador do sistema; a janela do app nunca navega para fora.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Menu do botão direito: copiar/colar em campos e em textos selecionados.
  win.webContents.on('context-menu', (_e, p) => {
    const items = [];
    if (p.isEditable) items.push({ role: 'cut', label: 'Recortar', enabled: p.editFlags.canCut },
      { role: 'copy', label: 'Copiar', enabled: p.editFlags.canCopy },
      { role: 'paste', label: 'Colar', enabled: p.editFlags.canPaste },
      { type: 'separator' }, { role: 'selectAll', label: 'Selecionar tudo' });
    else if (p.selectionText) items.push({ role: 'copy', label: 'Copiar' });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
  // A janela nunca sai da tela do app (ex.: soltar um arquivo fora da área de importação).
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
  { label: 'Editar', submenu: [
    { role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' },
    { role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' },
    { role: 'selectAll', label: 'Selecionar tudo' },
  ] },
  { label: 'Aplicativo', submenu: [{ role: 'reload', label: 'Recarregar' }, { role: 'togglefullscreen', label: 'Tela cheia' }, { type: 'separator' }, { role: 'quit', label: 'Sair' }] },
  { label: 'Exibir', submenu: [{ role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { role: 'resetZoom', label: 'Tamanho original' }, { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' }] },
]));

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
