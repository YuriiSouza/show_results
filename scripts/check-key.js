// Impede gerar o instalador sem a chave embutida (electron/credentials/service-account.json).
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'electron', 'credentials', 'service-account.json');
try {
  const k = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (k.type !== 'service_account' || !k.client_email || !k.private_key) throw new Error('arquivo inválido');
  console.log('Chave embutida: ' + k.client_email);
} catch (e) {
  console.error('\n✖ Chave não encontrada em electron/credentials/service-account.json (' + e.message + ').\n' +
    '  Copie a chave da conta de serviço para esse caminho antes de gerar o instalador.\n');
  process.exit(1);
}
