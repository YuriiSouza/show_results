// Consultas no SPX para a aba "Parcel" (faz o papel de proxy: a tela não fala com o SPX):
// rastreio do pedido e detalhe da AT (gaiola e motorista).
// A sessão vem do cURL que o usuário cola no app e fica SÓ na memória deste processo:
// nunca é gravada em disco, nunca aparece em log e nunca volta para a tela.
const HOST = 'https://spx.shopee.com.br';
const PATH = '/api/fleet_order/order/detail/tracking_info';
const AT_PATH = '/spx_delivery/admin/assignment/assignment_task/detail';
// Painel de produtividade (WFM): pacotes recebidos por operador e por hora.
const WFM_PATH = '/api/wfm/admin/dashboard/list';
// Só estes cabeçalhos do cURL são reaproveitados. Os x-sap-* (assinaturas por requisição geradas
// pelo site) ficam de fora de propósito: se o SPX exigir, a saída é uma exportação oficial em lote.
const ALLOWED = ['cookie', 'x-csrftoken', 'device-id', 'app', 'referer', 'user-agent', 'accept', 'accept-language'];
const CODE_RE = /^[A-Z0-9]{8,40}$/;
const AT_CODE_RE = /^AT[A-Z0-9]{6,30}$/;
const TIMEOUT_MS = 15000, RETRIES = 3;

let session = null;

// "Copiar como cURL" (bash ou cmd) -> { cabeçalho: valor } só com os cabeçalhos permitidos.
function parseCurl(text) {
  let s = String(text || '');
  if (/\^"|\^\r?\n/.test(s)) s = s.replace(/\^\r?\n/g, ' ').replace(/\^(.)/g, '$1'); // formato cmd do Windows
  s = s.replace(/\\\r?\n/g, ' ');
  const headers = {};
  const re = /(?:^|\s)(-H|--header|-b|--cookie|-A|--user-agent|-e|--referer)\s+(?:\$'((?:[^'\\]|\\.)*)'|'([^']*)'|"((?:[^"\\]|\\.)*)")/g;
  const unesc = v => v.replace(/\\(.)/g, '$1');
  let m;
  while ((m = re.exec(s))) {
    const value = m[3] != null ? m[3] : unesc(m[2] != null ? m[2] : m[4]);
    let name = { '-b': 'cookie', '--cookie': 'cookie', '-A': 'user-agent', '--user-agent': 'user-agent', '-e': 'referer', '--referer': 'referer' }[m[1]];
    let val = value;
    if (!name) {
      const i = value.indexOf(':');
      if (i < 0) continue;
      name = value.slice(0, i).trim().toLowerCase();
      val = value.slice(i + 1);
    }
    val = val.replace(/[\r\n]+/g, ' ').trim();
    if (ALLOWED.includes(name) && val) headers[name] = val;
  }
  return headers;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const AUTH_MSG = 'O SPX recusou a sessão. Entre de novo no SPX, copie um cURL novo e cole em "Sessão SPX".';

// Uma chamada ao SPX (GET, ou POST com JSON quando há body). Tenta de novo (com espera crescente) em 429/5xx,
// tempo esgotado e falha de rede.
async function request(url, fetchImpl, payload) {
  if (!session) return { ok: false, auth: true, error: 'Informe a sessão do SPX.' };
  let last = 'Falha na consulta', wait = 0;
  for (let i = 0; i <= RETRIES; i++) {
    if (i) await sleep(wait);
    wait = 1000 * 2 ** i + Math.random() * 300;
    let res;
    const init = payload == null ? { headers: session } : { method: 'POST', headers: { ...session, 'content-type': 'application/json;charset=UTF-8', origin: HOST }, body: JSON.stringify(payload) };
    try { res = await fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch (e) { last = e && e.name === 'TimeoutError' ? 'Tempo esgotado (15 s)' : 'Sem conexão com o SPX'; continue; }
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400))
      return { ok: false, auth: true, status: res.status, error: `${AUTH_MSG} (HTTP ${res.status})` };
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after'));
      if (ra > 0) wait = Math.min(ra, 15) * 1000;
      last = `SPX respondeu HTTP ${res.status}`;
      continue;
    }
    if (!res.ok) return { ok: false, status: res.status, error: `SPX respondeu HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== 'object') return { ok: false, auth: true, error: AUTH_MSG };
    if (body.retcode != null && body.retcode !== 0) {
      const msg = String(body.message || body.msg || '').slice(0, 120);
      return { ok: false, auth: /login|auth|token|session|permission/i.test(msg), error: `SPX: ${msg || 'erro'} (retcode ${body.retcode})` };
    }
    return { ok: true, data: body.data || body };
  }
  return { ok: false, error: `${last} — ${RETRIES + 1} tentativas` };
}

// Rastreio de um pedido.
function track(code, fetchImpl = fetch) {
  code = String(code || '').trim().toUpperCase();
  if (session && !CODE_RE.test(code)) return Promise.resolve({ ok: false, error: 'Código inválido' });
  return request(`${HOST}${PATH}?shipment_id=${encodeURIComponent(code)}`, fetchImpl);
}

// Detalhe de uma AT (a mesma chamada da tela "Assignment Task"): traz a gaiola e o motorista.
function atDetail(at, fetchImpl = fetch) {
  at = String(at || '').trim().toUpperCase();
  if (session && !AT_CODE_RE.test(at)) return Promise.resolve({ ok: false, error: 'AT inválida' });
  return request(`${HOST}${AT_PATH}?assignment_task_id=${encodeURIComponent(at)}`, fetchImpl);
}

// Recebimento por operador e por hora (a mesma chamada do painel de produtividade do SPX). Busca todas as páginas.
async function wfm(fetchImpl = fetch) {
  const list = [];
  let times = null;
  for (let page = 1; page <= 10; page++) {
    const r = await request(`${HOST}${WFM_PATH}`, fetchImpl, { unit_type: 1, process_type: 1, period_type: 1, operator_email: '',
      pageno: page, count: 24, productivity: 1, order_by_total: 100, event_id_list: [] });
    if (!r.ok) return r;
    const d = r.data || {};
    list.push(...(d.efficiency_list || []));
    if (!times) times = d.time_list || [];
    if (!(d.efficiency_list || []).length || list.length >= (Number(d.total) || 0)) break;
  }
  return { ok: true, data: { efficiency_list: list, time_list: times || [] } };
}

function register(ipcMain) {
  ipcMain.handle('parcel:setSession', (_e, curl) => {
    const h = parseCurl(curl);
    if (!h.cookie) return { ok: false, error: 'Não encontrei o cookie da sessão. Use "Copiar como cURL" na requisição tracking_info, com o SPX logado.' };
    session = h;
    return { ok: true, headers: Object.keys(h) };
  });
  ipcMain.handle('parcel:clearSession', () => { session = null; return true; });
  ipcMain.handle('parcel:hasSession', () => !!session);
  ipcMain.handle('parcel:track', (_e, code) => track(code));
  ipcMain.handle('parcel:at', (_e, at) => atDetail(at));
  ipcMain.handle('spx:wfm', () => wfm());
}

module.exports = { register, parseCurl, track, atDetail, wfm, ALLOWED, _setSession: h => { session = h; } };
