// Impede gerar o instalador sem o client OAuth Desktop do Google (google-oauth.local.json, fora do git).
// Formato: { "desktop": { "clientId": "...", "clientSecret": "GOCSPX-..." }, "android": { "clientId": "..." } }
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'google-oauth.local.json');
try {
  const d = JSON.parse(fs.readFileSync(file, 'utf8')).desktop || {};
  if (!d.clientId || !d.clientSecret) throw new Error('faltam desktop.clientId / desktop.clientSecret');
  console.log('Client OAuth desktop: ' + d.clientId);
} catch (e) {
  console.error('\n✖ google-oauth.local.json inválido ou ausente (' + e.message + ').\n' +
    '  Crie o arquivo na raiz do projeto (veja google-oauth.example.json) antes de gerar o instalador.\n');
  process.exit(1);
}
