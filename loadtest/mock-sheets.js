// Servidor que imita a API do Google Sheets para o teste de carga (k6), SEM tocar no Google de verdade.
// Reproduz as cotas da API (por projeto e por usuário, por minuto) e uma latência parecida com a real:
// acima da cota responde 429, como o Google. Assim dá para ver como o padrão de chamadas do app se comporta com 100 e
// 1000 pessoas usando ao mesmo tempo.
//
//   node loadtest/mock-sheets.js            (porta 8787)
//   COTA_PROJETO_LEITURA=300 COTA_USUARIO_LEITURA=60 COTA_PROJETO_ESCRITA=300 COTA_USUARIO_ESCRITA=60 node loadtest/mock-sheets.js
//
// As cotas padrão são as da documentação da Google Sheets API (por minuto). Confira as do seu projeto em
// console.cloud.google.com → APIs e serviços → Google Sheets API → Cotas, e passe pelas variáveis acima.
const http = require('http');

const PORT = Number(process.env.PORT || 8787);
const Q = {
  projRead: Number(process.env.COTA_PROJETO_LEITURA || 300),
  userRead: Number(process.env.COTA_USUARIO_LEITURA || 60),
  projWrite: Number(process.env.COTA_PROJETO_ESCRITA || 300),
  userWrite: Number(process.env.COTA_USUARIO_ESCRITA || 60),
};
const LAT = { read: [120, 450], write: [200, 700] };   // ms (mín, máx)

// Janela de 60 s deslizante por chave.
const hits = new Map();
function allow(key, limit) {
  const now = Date.now(), arr = (hits.get(key) || []).filter(t => now - t < 60000);
  if (arr.length >= limit) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr); return true;
}
const stats = { read: 0, write: 0, r429: 0, w429: 0, byMin: new Map() };
const rnd = ([a, b]) => a + Math.random() * (b - a);

const server = http.createServer((req, res) => {
  if (req.url === '/_stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ...stats, byMin: Object.fromEntries(stats.byMin) }, null, 2));
  }
  const user = String(req.headers.authorization || '').replace(/^Bearer\s+/, '') || 'anon';
  const write = req.method === 'POST' || req.method === 'PUT';
  const kind = write ? 'write' : 'read';
  const okProj = allow(`p:${kind}`, write ? Q.projWrite : Q.projRead);
  const okUser = okProj && allow(`u:${user}:${kind}`, write ? Q.userWrite : Q.userRead);
  const min = new Date().toISOString().slice(11, 16);
  const m = stats.byMin.get(min) || { read: 0, write: 0, r429: 0, w429: 0 };
  stats.byMin.set(min, m);
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    if (!okProj || !okUser) {
      stats[write ? 'w429' : 'r429']++; m[write ? 'w429' : 'r429']++;
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { code: 429, message: `Quota exceeded (${okProj ? 'por usuário' : 'por projeto'})`, status: 'RESOURCE_EXHAUSTED' } }));
    }
    stats[kind]++; m[kind]++;
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Resposta com tamanho parecido com a real (a leitura da planilha do hub tem várias guias).
      res.end(write ? '{"updates":{"updatedRows":1}}' : JSON.stringify({ valueRanges: Array.from({ length: 10 }, () => ({ values: Array.from({ length: 50 }, () => ['2026-11-19', 'x', 1, 2, 3]) })) }));
    }, rnd(LAT[kind]));
  });
});
server.listen(PORT, () => console.log(`Mock da Google Sheets API em http://localhost:${PORT} · cotas/min: leitura ${Q.projRead} projeto, ${Q.userRead} usuário · escrita ${Q.projWrite} projeto, ${Q.userWrite} usuário`));
