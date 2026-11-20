// Processo principal do aplicativo desktop.
// Lê a planilha pela API do Google Sheets com o login Google de quem usa o app (electron/googleAuth.js):
// cada pessoa só acessa as planilhas compartilhadas com a própria conta.
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const auth = require('./googleAuth');

const DATA_DIR = () => app.getPath('userData');

// ---------- Registro de erros e alertas (logs) ----------
// Um arquivo por dia em <pasta do app>/logs/AAAA-MM-DD.jsonl (guarda 30 dias). Cada chamada da tela ao processo principal
// (Google Sheets, SPX…) é cronometrada: falha vira "error"; demora acima do limite vira "warn" (lento). Os erros e alertas
// ficam também numa fila que a tela envia, de tempos em tempos, para a guia Logs da planilha do hub.
const LOG_DIR = () => path.join(DATA_DIR(), 'logs');
const SLOW_MS = { 'sheets:fetch': 8000, 'base:read': 6000, 'base:readAll': 15000, 'base:append': 6000, 'base:ensure': 6000, 'central:read': 5000,
  'central:ensure': 6000, 'central:append': 5000, 'parcel:track': 8000, 'parcel:at': 8000, 'spx:wfm': 10000 };
const NO_TIMING = new Set(['auth:sign-in', 'updater:download', 'updater:check', 'log:write', 'log:take', 'log:open']);
const logQueue = [];   // erros e alertas ainda não enviados à planilha
function logWrite(entry) {
  const e = { t: new Date().toISOString(), src: 'app', ...entry };
  try {
    fs.mkdirSync(LOG_DIR(), { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR(), `${e.t.slice(0, 10)}.jsonl`), JSON.stringify(e) + '\n');
  } catch (err) { /* sem disco: segue sem log */ }
  if (e.level === 'error' || e.level === 'warn') { logQueue.push(e); if (logQueue.length > 500) logQueue.shift(); }
}
function logPrune() {
  try {
    const old = Date.now() - 30 * 864e5;
    fs.readdirSync(LOG_DIR()).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && new Date(f.slice(0, 10)).getTime() < old).forEach(f => fs.unlinkSync(path.join(LOG_DIR(), f)));
  } catch (e) { /* nada a limpar */ }
}
// Cronometra todos os ipcMain.handle registrados daqui para frente (inclusive os de parcel.js e updater.js).
{
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (ch, fn) => handle(ch, async (...args) => {
    if (NO_TIMING.has(ch)) return fn(...args);
    const t0 = Date.now();
    try {
      const r = await fn(...args);
      const ms = Date.now() - t0;
      if (ms > (SLOW_MS[ch] || 10000)) logWrite({ level: 'warn', tipo: 'lento', msg: `${ch} demorou ${(ms / 1000).toFixed(1)} s`, ms, canal: ch });
      if (r && r.ok === false && r.error && !r.noSession) logWrite({ level: 'warn', tipo: 'falha', msg: `${ch}: ${String(r.error).slice(0, 300)}`, ms, canal: ch });
      return r;
    } catch (err) {
      logWrite({ level: 'error', tipo: 'falha', msg: `${ch}: ${String((err && err.message) || err).slice(0, 300)}`, ms: Date.now() - t0, canal: ch });
      throw err;
    }
  });
}
const CONFIG_FILE = () => path.join(DATA_DIR(), 'config.json');

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
function spreadsheetId(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : '';
}

function publicConfig() {
  const cfg = readConfig();
  const st = auth.getAuthState();
  return {
    spreadsheetUrl: cfg.spreadsheetUrl || '',
    months: cfg.months || {},
    signedIn: st.signedIn,
    email: st.email,
    dataDir: DATA_DIR(),
  };
}

// Cota do Google excedida (429) ou instabilidade (500/502/503): tenta de novo até 3 vezes, esperando 1 s, 2 s e 4 s
// (mais um pouco de acaso, para os aparelhos não tentarem todos juntos).
async function httpFetch(url, opts) {
  for (let k = 0; ; k++) {
    let res;
    try { res = await fetch(url, opts); }
    catch (e) { throw new Error('Sem conexão com o Google. Verifique a internet do computador.'); }
    if (![429, 500, 502, 503].includes(res.status) || k >= 3) return res;
    await new Promise(r => setTimeout(r, 1000 * 2 ** k + Math.random() * 1000));
  }
}

async function sheetsGet(url, token) {
  const res = await httpFetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body;
  if (res.status === 401) throw new Error('O login do Google expirou. Entre de novo em ⚙ Conectar planilhas.');
  if (res.status === 403) {
    const msg = (body.error && body.error.message) || '';
    if (/has not been used|is disabled/i.test(msg)) throw new Error('A "Google Sheets API" não está ativada no projeto do Google Cloud do app. Ative em console.cloud.google.com → APIs e serviços.');
    throw new Error(`Sem permissão. Peça para compartilharem a planilha com a sua conta (${auth.getAuthState().email || 'conta Google conectada'}).`);
  }
  if (res.status === 429) throw new Error('O Google limitou as consultas agora (muitos acessos ao mesmo tempo). Tente de novo em 1 minuto.');
  if (res.status === 404) throw new Error('Planilha não encontrada. Confira o link da planilha nas configurações.');
  throw new Error('Erro da API do Google: ' + ((body.error && body.error.message) || res.status));
}

// Devolve { spreadsheet, updatedAt, sheets: { nome: [[texto,...],...] } } — o mesmo formato do modo demonstração.
async function fetchSheets(wanted, override) {
  const cfg = readConfig();
  const id = spreadsheetId(override && override.spreadsheetUrl != null ? override.spreadsheetUrl : cfg.spreadsheetUrl);
  if (!id) throw new Error('Informe o link da planilha nas configurações.');
  const token = await auth.getValidAccessToken();
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
  // Parcel: resultado do rastreio de cada dia (um salvamento por linha; vale o mais recente do dia).
  Parcel: ['Data', 'Status', 'Usuário', 'Gravado em', 'Aparelho', 'Pacotes', 'Com AT', 'Sem AT', 'Avarias', 'Outro XPT', 'Operadores', 'Resultado (JSON 1)', 'Resultado (JSON 2)', 'Resultado (JSON 3)', 'Resultado (JSON 4)', 'Resultado (JSON 5)'],
  // Mapa de piso: quem está em cada função, por dia e turno (com as mudanças durante o turno). Vale o salvamento mais recente.
  MapaPiso: ['Data', 'Turno', 'Status', 'Usuário', 'Gravado em', 'Aparelho', 'Mudanças', 'Pessoas', 'Mapa (JSON 1)', 'Mapa (JSON 2)', 'Mapa (JSON 3)', 'Mapa (JSON 4)', 'Mapa (JSON 5)'],
  // Erros de piso (sorting / etiquetagem) registrados durante a operação, com os responsáveis. Vale a linha mais recente de cada ID.
  ErrosPiso: ['ID', 'Data', 'Turno', 'Tipo', 'Código', 'Rota / letra', 'Horário', 'Responsáveis', 'Status', 'Usuário', 'Gravado em', 'Aparelho', 'Detalhe (JSON)', 'Categoria', 'Operador SPX (recebedor)', 'Etiquetador', 'Observação'],
  // Recebimento por hora (painel de produtividade do SPX) e a meta do turno. Vale o salvamento mais recente do dia/turno.
  RecebimentoHora: ['Data', 'Turno', 'Status', 'Usuário', 'Gravado em', 'Aparelho', 'Início', 'A receber', 'Recebido', 'Ritmo (pac/h)', 'Previsão de término', 'Operadores', 'Resultado (JSON 1)', 'Resultado (JSON 2)'],
  // Avarias: cada ocorrência (BR, origem, tipo, setor, quem recebeu no hub) e a tratativa. Vale a linha mais recente de cada ID.
  // Registro de erros e alertas do app (falhas, lentidão), enviado de tempos em tempos por cada aparelho.
  Logs: ['Quando', 'Nível', 'Tipo', 'Mensagem', 'Duração (ms)', 'Tela', 'Usuário', 'Versão', 'Aparelho', 'Vezes', 'Detalhe'],
  // Validação das rotas noshow do Audit de gestão: confirmado ou erro (não conta como noshow). Vale a mais recente de cada AT.
  NoShow: ['Data', 'Turno', 'AT', 'Validação', 'Observação', 'Usuário', 'Gravado em'],
  // Indicadores do dia (o que antes vinha das planilhas mensais): uma linha por dia e indicador; vale a mais recente.
  Indicadores: ['Data', 'Indicador', 'Valor', 'Status', 'Usuário', 'Gravado em', 'Origem'],
  // HSE do mês (pessoas, checklists, ginástica, DDS e links), em JSON; vale o salvamento mais recente do mês.
  HSE: ['Mês', 'Status', 'Usuário', 'Gravado em', 'Origem', 'HSE (JSON 1)', 'HSE (JSON 2)', 'HSE (JSON 3)'],
  Avarias: ['ID', 'Data', 'BR', 'Origem', 'Tipo', 'Setor', 'Observação', 'Responsável (recebeu no hub)', 'Recebido em', 'Tratativa', 'Ação tomada', 'Evidência', 'Status', 'Usuário', 'Gravado em', 'Aparelho', 'Detalhe (JSON)'],
};
// ---------- Planilha Central (multi-hub): usuários, hubs e arquivos de dados de cada hub ----------
// Só cadastro: os dados da operação ficam na planilha de cada hub. Vale a linha mais recente de cada chave
// (Usuarios: e-mail · Hubs: ID · Arquivos: hub + ano). Leitura para todos; gravação só para os admins (compartilhamento).
const CENTRAL_TABS = {
  Usuarios: ['E-mail', 'Nome', 'Papel', 'Hubs', 'Status', 'Atualizado por', 'Atualizado em'],
  Hubs: ['ID', 'Nome', 'Cidade', 'Status', 'Atualizado por', 'Atualizado em', 'Configuração (JSON)'],
  Arquivos: ['Hub', 'Ano', 'Planilha de dados', 'Status', 'Atualizado por', 'Atualizado em'],
};
// Planilhas atuais (planilha-base antiga e planilhas mensais): o app só LÊ. Qualquer gravação nelas é recusada aqui.
const READ_ONLY_SHEETS = new Set(['10e4zgv7kzpx8L4Gbx1TJUgmnBr3-ccSm_ty_JXvByIU', '1NkE0vyBZBztc6BnEppSfGD40nN-JTsQdfMHfPvfsCac', '1bS4L0tZ1UmbFN27RDyCaTRvvfrQsLaqDtdytbf9VzuU', '1lzYnReuKdwJ107eB7F9zNOWtOPZrNBrscuLFrZZCs7k', '1hsO3OzMM8v4xWIO_CRwTRQ0y6EG1ZWzchxR-guFKJQU', '1HZ67FxxF3OBIY45PiCy64lk79Gsh8RmsQ_wI1F0hNQU', '1R5iGLhMuze9sLy6yqtUgFWTnxpTnGcZy-CmCo9xDvjc', '1CnMff3cP7xQQpyxvGcXZrKSrgmm1IwLagi-LDG4s_gg']);
const writable = id => { if (READ_ONLY_SHEETS.has(String(id))) throw new Error('Esta planilha é só leitura no app (dados atuais).'); return id; };
const baseId = id => { if (!/^[a-zA-Z0-9-_]{20,}$/.test(String(id || ''))) throw new Error('Link da planilha-base inválido.'); return id; };
const q = tab => encodeURIComponent(`'${tab}'`);

async function sheetsSend(method, url, token, body) {
  const res = await httpFetch(url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (res.ok) return out;
  if (res.status === 403) throw new Error(`Sem permissão para gravar. Peça para compartilharem a planilha-base como EDITOR com a sua conta (${auth.getAuthState().email || 'conta Google conectada'}).`);
  if (res.status === 429) throw new Error('O Google limitou as gravações agora (muitos acessos ao mesmo tempo). O app tenta de novo sozinho.');
  if (res.status === 404) throw new Error('Planilha-base não encontrada. Confira o link em js/config.js (BASE_SHEET_URL).');
  throw new Error('Erro ao gravar na planilha-base: ' + ((out.error && out.error.message) || res.status));
}
const baseToken = () => auth.getValidAccessToken();

// Cria as guias que faltarem, com cabeçalho.
async function ensureTabs(id, TABS) {
  writable(id);
  const token = await baseToken();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${baseId(id)}`;
  const meta = await sheetsGet(`${base}?fields=properties.title,sheets.properties.title`, token);
  const have = (meta.sheets || []).map(x => x.properties.title);
  const missing = Object.keys(TABS).filter(t => !have.includes(t));
  if (missing.length) {
    await sheetsSend('POST', `${base}:batchUpdate`, token, { requests: missing.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) });
    for (const t of missing) await sheetsSend('PUT', `${base}/values/${q(t)}!A1?valueInputOption=RAW`, token, { values: [TABS[t]] });
  }
  // Guias que já existiam: atualiza o cabeçalho quando o app ganhou colunas novas (ex.: ErrosPiso).
  const old = Object.keys(TABS).filter(t => have.includes(t));
  if (old.length) {
    const heads = await sheetsGet(`${base}/values:batchGet?${old.map(t => `ranges=${q(t)}!1:1`).join('&')}`, token);
    for (const [k, t] of old.entries()) {
      const cur = ((((heads.valueRanges || [])[k] || {}).values || [])[0] || []).map(String);
      if (cur.join('|') !== TABS[t].join('|')) await sheetsSend('PUT', `${base}/values/${q(t)}!A1?valueInputOption=RAW`, token, { values: [TABS[t]] });
    }
  }
  return { title: meta.properties.title, created: missing };
}
ipcMain.handle('base:ensure', (_e, id) => ensureTabs(id, BASE_TABS));

// Lê o que o app precisa: Reports, o resumo de cada Audit importado e os resultados do Parcel.
// Lê TODAS as colunas de todas as guias do app que existirem na planilha (só leitura). Usado na migração da planilha-base
// antiga para a planilha do hub: { guia: linhas }.
// Lê as últimas linhas de uma guia do app (ex.: Logs), só leitura.
ipcMain.handle('base:readTab', async (_e, id, tab) => {
  if (!BASE_TABS[tab]) throw new Error('Guia inválida.');
  const token = await baseToken();
  const data = await sheetsGet(`https://sheets.googleapis.com/v4/spreadsheets/${baseId(id)}/values/${q(tab)}!A2:Z?valueRenderOption=UNFORMATTED_VALUE`, token);
  return (data.values || []).slice(-2000);
});
ipcMain.handle('base:readAll', async (_e, id) => {
  const token = await baseToken();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${baseId(id)}`;
  const meta = await sheetsGet(`${base}?fields=properties.title,sheets.properties.title`, token);
  const tabs = (meta.sheets || []).map(x => x.properties.title).filter(t => BASE_TABS[t]);
  if (!tabs.length) return { title: meta.properties.title, tabs: {} };
  const data = await sheetsGet(`${base}/values:batchGet?${tabs.map(t => `ranges=${q(t)}!A2:ZZ`).join('&')}&valueRenderOption=UNFORMATTED_VALUE`, token);
  return { title: meta.properties.title, tabs: Object.fromEntries(tabs.map((t, k) => [t, ((data.valueRanges || [])[k] || {}).values || []])) };
});
ipcMain.handle('base:read', async (_e, id) => {
  const token = await baseToken();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${baseId(id)}`;
  const data = await sheetsGet(`${base}/values:batchGet?ranges=${q('Reports')}!A2:G&ranges=${q('Audit')}!A2:U&ranges=${q('Parcel')}!A2:P&ranges=${q('MapaPiso')}!A2:M&ranges=${q('ErrosPiso')}!A2:M&ranges=${q('RecebimentoHora')}!A2:N&ranges=${q('Avarias')}!A2:Q&ranges=${q('Indicadores')}!A2:G&ranges=${q('HSE')}!A2:H&ranges=${q('NoShow')}!A2:G&valueRenderOption=UNFORMATTED_VALUE`, token);
  const [rep, aud, par, mapa, err, rh, av, ind, hse, ns] = data.valueRanges || [];
  return { reports: (rep && rep.values) || [], audit: (aud && aud.values) || [], parcel: (par && par.values) || [],
    mapa: (mapa && mapa.values) || [], erros: (err && err.values) || [], receb: (rh && rh.values) || [], avarias: (av && av.values) || [],
    indicadores: (ind && ind.values) || [], hse: (hse && hse.values) || [], noshow: (ns && ns.values) || [] };
});

// Acrescenta linhas ao fim de uma guia.
ipcMain.handle('base:append', async (_e, id, tab, rows) => {
  writable(id);
  if (!BASE_TABS[tab]) throw new Error('Guia inválida.');
  if (!Array.isArray(rows) || !rows.length) return true;
  const token = await baseToken();
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${baseId(id)}`;
  await sheetsSend('POST', `${base}/values/${q(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, token, { values: rows });
  return true;
});

// Planilha Central: cria as guias, lê tudo e acrescenta linhas.
ipcMain.handle('central:ensure', (_e, id) => ensureTabs(id, CENTRAL_TABS));
ipcMain.handle('central:read', async (_e, id) => {
  const token = await baseToken();
  const tabs = Object.keys(CENTRAL_TABS);
  const data = await sheetsGet(`https://sheets.googleapis.com/v4/spreadsheets/${baseId(id)}/values:batchGet?${tabs.map(t => `ranges=${q(t)}!A2:Z`).join('&')}&valueRenderOption=UNFORMATTED_VALUE`, token);
  return Object.fromEntries(tabs.map((t, k) => [t, ((data.valueRanges || [])[k] || {}).values || []]));
});
ipcMain.handle('central:append', async (_e, id, tab, rows) => {
  writable(id);
  if (!CENTRAL_TABS[tab]) throw new Error('Guia inválida.');
  if (!Array.isArray(rows) || !rows.length) return true;
  const token = await baseToken();
  await sheetsSend('POST', `https://sheets.googleapis.com/v4/spreadsheets/${baseId(id)}/values/${q(tab)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, token, { values: rows });
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

ipcMain.handle('log:write', (_e, entry) => { if (entry && typeof entry === 'object') logWrite({ ...entry, src: 'tela' }); return true; });
ipcMain.handle('log:take', () => logQueue.splice(0));
ipcMain.handle('log:open', () => { fs.mkdirSync(LOG_DIR(), { recursive: true }); return shell.openPath(LOG_DIR()); });
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

// Login Google de quem usa o app.
ipcMain.handle('auth:state', () => auth.getAuthState());
ipcMain.handle('auth:sign-in', async e => {
  const st = await auth.signIn();
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); } // volta do navegador para o app
  return st;
});
ipcMain.handle('auth:sign-out', () => auth.signOut());

ipcMain.handle('sheets:fetch', (_e, { sheets, override } = {}) => fetchSheets(sheets, override));

// Rastreio do SPX (aba Parcel): a sessão colada pelo usuário fica só na memória.
require('./parcel').register(ipcMain);

// Atualização automática (GitHub Releases).
const updater = require('./updater');
updater.register(ipcMain);

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
      devTools: !app.isPackaged,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  updater.setWindow(win);

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
  { label: 'Exibir', submenu: [{ role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { role: 'resetZoom', label: 'Tamanho original' },
    // Ferramentas de desenvolvedor só ao rodar pelo código (npm start): no instalador elas mostrariam os links das planilhas.
    ...(app.isPackaged ? [] : [{ role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' }])] },
]));

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => { logPrune(); createWindow(); });
  app.on('window-all-closed', () => app.quit());
}
