// Login Google de cada usuário (OAuth "installed app"): abre o navegador do sistema, recebe o código num
// servidor local efêmero em 127.0.0.1 e troca por tokens com PKCE. O refresh token fica cifrado com
// safeStorage na pasta de dados do usuário; o acesso às planilhas depende só do compartilhamento com a conta.
const { app, shell, safeStorage } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets openid email';
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

const TOKEN_FILE = () => path.join(app.getPath('userData'), 'google-auth.bin');
// google-oauth.local.json (fora do git) vai dentro do instalador; no CI vem do secret GOOGLE_OAUTH_JSON.
const CLIENT_FILE = path.join(__dirname, '..', 'google-oauth.local.json');

const b64url = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function client() {
  let c;
  try { c = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8')).desktop; } catch (e) { c = null; }
  if (!c || !c.clientId || !c.clientSecret) throw new Error('Este aplicativo foi gerado sem o client OAuth do Google (google-oauth.local.json).');
  return c;
}

function notSignedIn() {
  const e = new Error('Entre com sua conta Google em ⚙ Conectar planilhas.');
  e.code = 'NOT_SIGNED_IN';
  return e;
}

// ---------- Armazenamento (refresh token cifrado) ----------
function readStored() {
  try {
    const raw = fs.readFileSync(TOKEN_FILE());
    return JSON.parse(safeStorage.decryptString(raw));
  } catch (e) { return null; }
}
function writeStored(data) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('O sistema não oferece armazenamento seguro para guardar o login.');
  fs.mkdirSync(path.dirname(TOKEN_FILE()), { recursive: true });
  fs.writeFileSync(TOKEN_FILE(), safeStorage.encryptString(JSON.stringify(data)), { mode: 0o600 });
}
function clearStored() { try { fs.unlinkSync(TOKEN_FILE()); } catch (e) { /* já removido */ } }

let cache = { token: null, exp: 0 };

async function post(url, params) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  } catch (e) { throw new Error('Sem conexão com o Google. Verifique a internet do computador.'); }
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

function emailFromIdToken(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64').toString('utf8')).email || ''; } catch (e) { return ''; }
}

// ---------- Login ----------
let pending = null; // { server, reject }

function waitForCode(state) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404); return res.end(); }
      const err = u.searchParams.get('error');
      const code = u.searchParams.get('code');
      const ok = !err && code && u.searchParams.get('state') === state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Dashboard HUB LGO 03</title>
        <body style="font-family:system-ui,sans-serif;text-align:center;padding:48px">
        <h2>${ok ? '✅ Login concluído' : '⚠ Login não concluído'}</h2>
        <p>${ok ? 'Pode fechar esta aba e voltar ao aplicativo.' : 'Volte ao aplicativo e tente de novo.'}</p></body>`);
      finish();
      if (ok) resolve({ code, redirectUri: server.redirectUri });
      else reject(new Error(err === 'access_denied' ? 'Login cancelado.' : 'O Google não devolveu a autorização. Tente de novo.'));
    });
    const timer = setTimeout(() => { finish(); reject(new Error('Tempo esgotado esperando o login no navegador.')); }, SIGN_IN_TIMEOUT_MS);
    function finish() { clearTimeout(timer); server.close(); if (pending && pending.server === server) pending = null; }
    pending = { server, reject: e => { finish(); reject(e); } };
    server.on('error', e => { finish(); reject(e); });
    server.listen(0, '127.0.0.1', () => {
      server.redirectUri = `http://127.0.0.1:${server.address().port}`;
      server.emit('ready');
    });
  });
}

async function signIn() {
  const c = client();
  if (pending) pending.reject(new Error('Login anterior cancelado.'));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const codePromise = waitForCode(state);
  codePromise.catch(() => {}); // o erro é tratado no await abaixo
  const { server } = pending;
  await new Promise(r => (server.redirectUri ? r() : server.once('ready', r)));
  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: c.clientId, redirect_uri: server.redirectUri, response_type: 'code', scope: SCOPES,
    code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
  })}`;
  try { await shell.openExternal(url); } catch (e) { if (pending && pending.server === server) pending.reject(e); }
  const { code, redirectUri } = await codePromise;
  const r = await post(TOKEN_URL, {
    code, client_id: c.clientId, client_secret: c.clientSecret, code_verifier: verifier,
    redirect_uri: redirectUri, grant_type: 'authorization_code',
  });
  if (!r.ok || !r.body.refresh_token) throw new Error('O Google recusou o login (' + (r.body.error_description || r.body.error || r.status) + ').');
  const email = emailFromIdToken(r.body.id_token);
  writeStored({ refreshToken: r.body.refresh_token, email });
  cache = { token: r.body.access_token, exp: Date.now() + (r.body.expires_in || 3600) * 1000 };
  return getAuthState();
}

function getAuthState() {
  const s = readStored();
  return { signedIn: !!(s && s.refreshToken), email: (s && s.email) || '' };
}

async function signOut() {
  const s = readStored();
  clearStored();
  cache = { token: null, exp: 0 };
  if (s && s.refreshToken) await post(REVOKE_URL, { token: s.refreshToken }).catch(() => {});
  return getAuthState();
}

async function getValidAccessToken() {
  if (cache.token && cache.exp - 60000 > Date.now()) return cache.token;
  const s = readStored();
  if (!s || !s.refreshToken) throw notSignedIn();
  const c = client();
  const r = await post(TOKEN_URL, { client_id: c.clientId, client_secret: c.clientSecret, refresh_token: s.refreshToken, grant_type: 'refresh_token' });
  if (!r.ok) {
    if (r.body.error === 'invalid_grant') { clearStored(); throw notSignedIn(); }
    throw new Error('Não foi possível renovar o login do Google (' + (r.body.error_description || r.body.error || r.status) + ').');
  }
  cache = { token: r.body.access_token, exp: Date.now() + (r.body.expires_in || 3600) * 1000 };
  return cache.token;
}

module.exports = { signIn, signOut, getAuthState, getValidAccessToken };
