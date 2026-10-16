// Monta mobile/www (a pasta que o Capacitor empacota no app Android/iOS) a partir do
// mesmo código do app desktop. Se a chave estiver em electron/credentials/service-account.json,
// ela é embutida no app mobile também.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'mobile', 'www');
const copy = (rel, dest = rel) => {
  const from = path.join(root, rel), to = path.join(out, dest);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
['css', 'js', 'node_modules/chart.js/dist/chart.umd.js'].forEach(p => copy(p));
[400, 500, 600, 700, 800].forEach(w => copy(`node_modules/@fontsource/inter/files/inter-latin-${w}-normal.woff2`));

// index.html com a política de segurança ajustada ao Capacitor (ponte nativa + API do Google).
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,
  `<meta http-equiv="Content-Security-Policy" content="default-src 'self' capacitor: https://localhost; ` +
  `script-src 'self' 'unsafe-inline' capacitor: https://localhost; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; ` +
  `connect-src 'self' capacitor: https://localhost https://oauth2.googleapis.com https://sheets.googleapis.com https://www.googleapis.com https://api.github.com; object-src 'none'; base-uri 'none'">`);
html = html.replace('width=device-width, initial-scale=1', 'width=device-width, initial-scale=1, viewport-fit=cover');
// A ponte com o Google (window.hubApi) precisa existir ANTES dos módulos que a usam (base, audit, reports, app...).
html = html.replace('<script src="js/config.js"></script>', '<script src="js/config.js"></script>\n  <script src="js/mobile-api.js"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html);

const key = path.join(root, 'electron', 'credentials', 'service-account.json');
if (fs.existsSync(key)) {
  copy('electron/credentials/service-account.json', 'credentials/service-account.json');
  console.log('✓ Chave embutida no app mobile.');
} else {
  console.warn('⚠ Chave não encontrada em electron/credentials/service-account.json — o app mobile vai abrir só em modo demonstração.');
}
console.log('✓ mobile/www pronto.');
