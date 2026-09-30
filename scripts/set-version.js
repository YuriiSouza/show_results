// Copia a versão do package.json para o app (js/version.js) e para o Android (build.gradle).
// Rodado automaticamente antes de gerar os instaladores e o app mobile.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
fs.writeFileSync(path.join(root, 'js', 'version.js'),
  `// Gerado por scripts/set-version.js a partir do package.json — não edite à mão.\nwindow.APP_VERSION = '${version}';\n`);
const gradle = path.join(root, 'android', 'app', 'build.gradle');
if (fs.existsSync(gradle)) {
  const [a, b, c] = version.split('.').map(Number);
  let g = fs.readFileSync(gradle, 'utf8');
  g = g.replace(/versionCode \d+/, `versionCode ${a * 10000 + b * 100 + c}`).replace(/versionName "[^"]*"/, `versionName "${version}"`);
  fs.writeFileSync(gradle, g);
}
console.log('✓ Versão ' + version);
