// Planilha Central: cadastro automático no primeiro login e liberação de acesso por Admin, Gerente, Site líder e Líder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = ['js/config.js', 'js/central.js'].map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));

const AT = '2026-11-20T10:00:00.000Z';
const row = (email, papel, hubs, status = 'ativo') => [email, email.split('@')[0], papel, hubs, status, 'seed', AT];
const BASE = {
  Usuarios: [
    row('admin@x.com', 'Admin', '*'),
    row('gerente@x.com', 'Gerente', 'LGO03, LGO05'),
    row('lider@x.com', 'Líder', 'LGO03'),
    row('analista@x.com', 'Analista', 'LGO03'),
    row('outro@x.com', 'Analista', 'LGO05'),
    row('sl5@x.com', 'Site líder', 'LGO05'),
  ],
  Hubs: ['LGO03', 'LGO05', 'LGO07'].map(id => [id, id, '', 'ativo', 'seed', AT, '{}']),
  Arquivos: [['LGO03', '2026', 'https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaa/edit', 'ativo', 'seed', AT]],
};

// Abre a Central como `email`; devolve o módulo e as linhas gravadas.
async function open(email, data = BASE) {
  const writes = [];
  const store = {};
  const api = {
    getConfig: async () => ({ signedIn: true, email }),
    centralEnsure: async () => {},
    centralRead: async () => JSON.parse(JSON.stringify(data)),
    centralAppend: async (_id, tab, rows) => { writes.push(...rows.map(r => [tab, r])); },
  };
  const ctx = { console, Date, JSON, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } };
  ctx.window = ctx; ctx.window.hubApi = api;
  vm.createContext(ctx);
  SRC.forEach(s => vm.runInContext(s, ctx));
  const CT = ctx.window.Central;
  await CT.init();
  return { CT, writes };
}

test('primeiro login: a pessoa entra sozinha como Analista, sem hub', async () => {
  const { CT, writes } = await open('joao.silva@x.com');
  assert.equal(writes.length, 1);
  const [tab, r] = writes[0];
  assert.equal(tab, 'Usuarios');
  assert.deepEqual([...r.slice(0, 5)], ['joao.silva@x.com', 'Joao Silva', 'Analista', '', 'ativo']);
  assert.equal(CT.state(), 'nohub');
  assert.equal(CT.canManage(), false);
});

test('quem já está cadastrado não é gravado de novo', async () => {
  const { writes, CT } = await open('analista@x.com');
  assert.equal(writes.length, 0);
  assert.equal(CT.state(), 'ok');
});

test('Líder libera só o próprio hub e no máximo o papel Líder', async () => {
  const data = { ...BASE, Usuarios: [...BASE.Usuarios, row('novo@x.com', 'Analista', '')] };
  const { CT, writes } = await open('lider@x.com', data);
  assert.equal(CT.canManage(), true);
  assert.deepEqual([...CT.grantHubs()], ['LGO03']);
  assert.deepEqual([...CT.grantRoles()].sort(), ['Analista', 'Líder', 'Qualidade']);
  // Vê quem aguarda hub e quem está no LGO03; não vê o LGO05 nem o admin.
  const seen = CT.visibleUsers().map(u => u.email);
  assert.ok(seen.includes('novo@x.com') && seen.includes('analista@x.com'));
  assert.ok(!seen.includes('outro@x.com') && !seen.includes('admin@x.com'));
  assert.equal(CT.pending().length, 1);
  await assert.rejects(CT.saveUser({ email: 'novo@x.com', nome: 'Novo', papel: 'Analista', hubs: ['LGO05'] }), /hubs que você tem/);
  await assert.rejects(CT.saveUser({ email: 'novo@x.com', nome: 'Novo', papel: 'Site líder', hubs: ['LGO03'] }), /no máximo o papel/);
  await assert.rejects(CT.saveUser({ email: 'novo@x.com', nome: 'Novo', papel: 'Admin', hubs: ['LGO03'] }), /no máximo o papel/);
  await assert.rejects(CT.saveUser({ email: 'lider@x.com', nome: 'Eu', papel: 'Líder', hubs: ['LGO03'] }), /próprio acesso/);
  await assert.rejects(CT.saveUser({ email: 'gerente@x.com', nome: 'G', papel: 'Líder', hubs: ['LGO03'] }), /acima do seu/);
  await CT.saveUser({ email: 'novo@x.com', nome: 'Novo', papel: 'Analista', hubs: ['LGO03'] });
  assert.deepEqual([...writes.at(-1)[1].slice(0, 4)], ['novo@x.com', 'Novo', 'Analista', 'LGO03']);
  // Hubs e planilhas continuam só do Admin.
  await assert.rejects(CT.saveHub({ id: 'LGO09', nome: 'X' }), /administrador/);
});

test('Gerente mexe só nos hubs dele e mantém os outros hubs da pessoa', async () => {
  const data = { ...BASE, Usuarios: [...BASE.Usuarios, row('q@x.com', 'Qualidade', 'LGO03, LGO07')] };
  const { CT, writes } = await open('gerente@x.com', data);
  assert.ok(CT.canEdit(CT.users().find(u => u.email === 'q@x.com')));
  // Tira o LGO03 e põe o LGO05: o LGO07 (que o gerente não tem) fica.
  await CT.saveUser({ email: 'q@x.com', nome: 'Q', papel: 'Qualidade', hubs: ['LGO05'] });
  assert.deepEqual(writes.at(-1)[1][3].split(', ').sort(), ['LGO05', 'LGO07']);
  // Papel de um hub só não pode ficar com dois hubs.
  await assert.rejects(CT.saveUser({ email: 'outro@x.com', nome: 'O', papel: 'Analista', hubs: ['LGO03', 'LGO05'] }), /hub só/);
});

test('Site líder não edita quem não tem hub em comum; Analista não libera nada', async () => {
  const { CT } = await open('sl5@x.com');
  assert.equal(CT.canEdit(CT.users().find(u => u.email === 'analista@x.com')), false);
  assert.equal(CT.canEdit(CT.users().find(u => u.email === 'outro@x.com')), true);
  const a = await open('analista@x.com');
  assert.equal(a.CT.canManage(), false);
  await assert.rejects(a.CT.saveUser({ email: 'outro@x.com', nome: 'O', papel: 'Analista', hubs: ['LGO03'] }), /não pode liberar/);
});

test('Admin continua podendo tudo', async () => {
  const { CT } = await open('admin@x.com');
  assert.deepEqual([...CT.grantRoles()], [...CT.ROLES]);
  assert.equal(CT.visibleUsers().length, BASE.Usuarios.length);
  await CT.saveUser({ email: 'outro@x.com', nome: 'O', papel: 'Gerente', hubs: ['LGO05', 'LGO07'] });
});
