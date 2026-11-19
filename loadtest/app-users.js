// Teste de carga (k6) do padrão de chamadas do app ao Google Sheets, contra o mock (loadtest/mock-sheets.js).
// Cada usuário virtual (VU) é uma pessoa com o app aberto:
//   - abrir o app: 3 leituras da planilha Central (dados, cabeçalhos, usuários/hubs) + 2 de conferência das guias da
//     planilha do hub + 1 leitura da planilha do hub = 6 leituras seguidas (é o tempo de "abrir o app");
//   - usando: relê a planilha do hub a cada ~3 min (trocar de tela; o app guarda por 3 min) e grava algo a cada ~4 min
//     (lançamento, avaria, mapa…), mais o envio dos registros de erro a cada 5 min (1 em cada 5 aparelhos tem algo).
// Uso:
//   k6 run -e USERS=100 loadtest/app-users.js
//   k6 run -e USERS=1000 loadtest/app-users.js
//   k6 run -e USERS=1000 -e RETRY=0 loadtest/app-users.js      (sem nova tentativa após 429, como era antes)
// Variáveis: USERS (100), RAMP (2m: todo mundo abrindo o app), HOLD (8m), BASE (http://localhost:8787), RETRY (1).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const USERS = Number(__ENV.USERS || 100);
const BASE = __ENV.BASE || 'http://localhost:8787';
const RETRY = __ENV.RETRY !== '0';

export const options = {
  scenarios: {
    app: {
      executor: 'ramping-vus', startVUs: 0, gracefulRampDown: '30s',
      stages: [{ duration: __ENV.RAMP || '2m', target: USERS }, { duration: __ENV.HOLD || '8m', target: USERS }],
    },
  },
  thresholds: {
    cota_estourada: ['rate<0.01'],            // menos de 1% das chamadas recusadas por cota (429)
    abrir_app_ms: ['p(95)<8000'],             // 95% abrem o app em menos de 8 s
    falha_para_usuario: ['rate<0.005'],       // erro que chega ao usuário (depois das novas tentativas)
  },
};

const quota = new Rate('cota_estourada');
const userFail = new Rate('falha_para_usuario');
const openMs = new Trend('abrir_app_ms', true);
const retries = new Counter('novas_tentativas');

// Uma chamada como o app faz; com RETRY, 429 é tentado de novo com espera crescente (1 s, 2 s, 4 s).
function call(method, path, token) {
  const params = { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, tags: { op: method === 'GET' ? 'leitura' : 'escrita' } };
  for (let k = 0; ; k++) {
    const r = method === 'GET' ? http.get(`${BASE}${path}`, params) : http.request(method, `${BASE}${path}`, '{"values":[["x"]]}', params);
    quota.add(r.status === 429);
    if (r.status !== 429 || !RETRY || k >= 3) { userFail.add(r.status !== 200); check(r, { 'resposta 200': x => x.status === 200 }); return r; }
    retries.add(1);
    sleep(2 ** k + Math.random());
  }
}

export default function () {
  const token = `usuario-${__VU}`;
  if (__ITER === 0) {
    const t0 = Date.now();
    call('GET', '/v4/spreadsheets/CENTRAL?fields=sheets', token);
    call('GET', '/v4/spreadsheets/CENTRAL/values:batchGet?ranges=cabecalhos', token);
    call('GET', '/v4/spreadsheets/CENTRAL/values:batchGet?ranges=Usuarios,Hubs,Arquivos', token);
    call('GET', '/v4/spreadsheets/HUB/?fields=sheets', token);
    call('GET', '/v4/spreadsheets/HUB/values:batchGet?ranges=cabecalhos', token);
    call('GET', '/v4/spreadsheets/HUB/values:batchGet?ranges=todas', token);
    openMs.add(Date.now() - t0);
  }
  // Um "ciclo" de uso: ~1 min de tela; a cada 3 ciclos relê a planilha, a cada 4 grava, a cada 5 envia registros.
  sleep(45 + Math.random() * 30);
  if (__ITER % 3 === 2) call('GET', '/v4/spreadsheets/HUB/values:batchGet?ranges=todas', token);
  if (__ITER % 4 === 3) call('POST', '/v4/spreadsheets/HUB/values/Indicadores!A1:append', token);
  if (__ITER % 5 === 4 && __VU % 5 === 0) call('POST', '/v4/spreadsheets/HUB/values/Logs!A1:append', token);
}
