// Mapa de piso (quem está em cada função, por dia e turno, com as mudanças durante o turno e rodízio)
// e Erros de piso (sorting / etiquetagem registrados na operação, com os responsáveis tirados do mapa).
// Tudo fica na planilha-base (guias MapaPiso e ErrosPiso). O nome de cada pessoa é gravado como texto,
// então o histórico não depende da guia HSE do mês.
window.Piso = (() => {
  const H = window.Charts;
  const esc = H.esc;
  const PC = window.ParcelCore;
  const TZ = 'America/Sao_Paulo';
  const TURNOS = ['AM', 'PM1', 'PM2'];
  const FUNCS = { ind: 'Indução', rec: 'Recebimento/Etiquetagem', sort: 'Sorting', s2: '2º Sorting', aud: 'Auditoria', desc: 'Descarga', xpt: 'XPT', s5: '5S', int: 'Intervalo' };
  const HIST_DAYS = 10; // o rodízio olha os últimos 10 dias
  const REC_SIZE = 2; // pessoas por posto de recebimento/etiquetagem: quem recebe (bipa) e quem etiqueta
  const DEFAULT_LAYOUT = {
    mesas: [
      { id: 'm1', nome: 'Mesa 1', ind: 2, rec: 2, sort: 2 },
      { id: 'm2', nome: 'Mesa 2', ind: 2, rec: 2, sort: 2 },
      { id: 'm3', nome: 'Mesa 3', ind: 2, rec: 2, sort: 2 },
      { id: 'm4', nome: 'Mesa 4 (Volumoso)', ind: 2, rec: 2, sort: 2 },
    ],
    letras: 'ABCDEFGHIJKL'.split(''), s2: 2, aud: 2, desc: 4, xpt: 2, s5: 2, rotas: 20, rotasLetra: {},
  };
  const $ = id => document.getElementById(id);
  const api = () => window.hubApi || null;
  const B = () => window.Base;
  const baseOn = () => !!(B() && B().enabled());
  const clone = x => JSON.parse(JSON.stringify(x));
  const LSK = 'hub.piso';
  const ls = (() => { try { return JSON.parse(localStorage.getItem(LSK)) || {}; } catch (e) { return {}; } })();
  const lsSave = () => { try { localStorage.setItem(LSK, JSON.stringify(ls)); } catch (e) { /* sem armazenamento */ } };
  const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
  const nowHm = () => new Date().toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const hmOf = ts => new Date(ts * 1000).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const br = iso => iso.split('-').reverse().join('/');
  const brShort = iso => iso.split('-').reverse().slice(0, 2).join('/');
  let ui = null;

  // ---------- Nomes ----------
  // Chave de comparação: sem "[ops123]", sem matrícula (GN / SPXBR) no fim, sem acento e em maiúsculas.
  const nk = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/^\s*\[[^\]]*\]\s*/, '').replace(/\s+(SPXBR|GN)\s*\d+\s*$/, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  function sameName(a, b) {
    const x = nk(a), y = nk(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const [s, l] = x.length <= y.length ? [x, y] : [y, x];
    const ts = s.split(' '), tl = new Set(l.split(' '));
    return ts.length >= 2 && ts.every(t => tl.has(t));
  }
  // Guia HSE do mês atual (ou a mais recente conectada) e o mês dela.
  function hseCur() {
    const m = ui.model();
    if (!m) return { key: '', hse: null };
    const by = m.hseByMonth || {}, keys = Object.keys(by).sort(), now = ui.ym(new Date());
    const key = by[now] ? now : keys[keys.length - 1] || '';
    return { key, hse: (key && by[key]) || m.hse || null };
  }
  // Colaboradores da guia HSE do mês atual (só para sugerir nomes; o mapa grava o nome como texto).
  function people() {
    const hse = hseCur().hse;
    const seen = new Set();
    return ((hse && hse.people) || []).map(p => String(p.nome || '').trim()).filter(n => n && !seen.has(nk(n)) && seen.add(nk(n)))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
  // Nome digitado -> nome da lista, quando bate; senão, o texto como foi digitado.
  // Diarista: pode ocupar quantas vagas forem precisas (não é uma pessoa só; não conta como "em duas funções").
  const DIARISTA = 'DIARISTA';
  const isDw = n => nk(n).startsWith(DIARISTA);
  const canon = v => { v = String(v || '').trim().replace(/\s+/g, ' '); if (!v) return ''; if (isDw(v)) return DIARISTA; const p = people().find(n => nk(n) === nk(v)); return p || v.toUpperCase(); };

  // ---------- Layout e vagas ----------
  // Vagas do layout. Com a mudança (v), o 2º Sorting e a Auditoria de cada letra têm quantas pessoas estiverem
  // na lista (de 0 a 50); o número do layout é só o padrão para o rodízio preencher.
  const listKeys = (v, f, l) => Object.keys((v && v.slots) || {}).filter(k => k.startsWith(`${f}.${l}.`) && v.slots[k]).sort((a, b) => +a.split('.')[2] - +b.split('.')[2]);
  function slotsOf(L, v) {
    const out = [];
    L.mesas.forEach(m => {
      for (let k = 0; k < m.ind; k++) out.push({ key: `${m.id}.ind.${k}`, func: 'ind', mesa: m.id });
      for (let s = 0; s < m.rec; s++) for (let k = 0; k < REC_SIZE; k++) out.push({ key: `${m.id}.rec.${s}.${k}`, func: 'rec', mesa: m.id, posto: `${m.id}.rec.${s}` });
      for (let k = 0; k < m.sort; k++) out.push({ key: `${m.id}.sort.${k}`, func: 'sort', mesa: m.id });
    });
    L.letras.forEach(l => {
      ['s2', 'aud'].forEach(f => {
        const ks = listKeys(v, f, l), n = Math.max(L[f] || 0, ks.length ? +ks[ks.length - 1].split('.')[2] + 1 : 0);
        for (let k = 0; k < n; k++) out.push({ key: `${f}.${l}.${k}`, func: f, letra: l });
      });
    });
    for (let k = 0; k < L.desc; k++) out.push({ key: `desc.${k}`, func: 'desc' });
    for (let k = 0; k < (L.xpt || 0); k++) out.push({ key: `xpt.${k}`, func: 'xpt' });
    for (let k = 0; k < L.s5; k++) out.push({ key: `s5.${k}`, func: 's5' });
    return out;
  }
  const funcOf = key => { const p = key.split('.'); return FUNCS[p[0]] ? p[0] : p[1]; };
  const parseLetras = t => {
    t = String(t || '').toUpperCase().trim();
    const r = t.match(/^([A-Z])\s*-\s*([A-Z])$/);
    if (r) { const a = r[1].charCodeAt(0), b = r[2].charCodeAt(0); return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => String.fromCharCode(a + i)); }
    return [...new Set(t.split(/[\s,;]+/).filter(x => /^[A-Z]{1,2}$/.test(x)))];
  };
  // Mudança (versão) do mapa que valia num horário: a última que começou até esse horário.
  const sortedVers = map => map.versions.map((v, i) => ({ ...v, i })).sort((a, b) => (a.from || '').localeCompare(b.from || ''));
  const versionAt = (map, hm) => { const v = sortedVers(map); return v.filter(x => (x.from || '') <= (hm || '99:99')).pop() || v[0]; };
  const verLabel = v => (v.tipo === 'intervalo' ? `intervalo das ${v.from}` : v.tipo === 'volta' ? `volta do intervalo (${v.from})` : v.from ? `a partir das ${v.from}` : 'início do turno');
  const verChip = v => (v.tipo === 'intervalo' ? `☕ Intervalo ${v.from}` : v.tipo === 'volta' ? `Volta ${v.from}` : v.from ? 'Às ' + v.from : 'Início');
  // Vagas de intervalo da mudança (int.0, int.1…): ficam fora do layout.
  const intKeys = v => Object.keys(v.slots).filter(k => k.startsWith('int.') && v.slots[k]).sort((a, b) => +a.split('.')[1] - +b.split('.')[1]);
  // Bancadas de recebimento/etiquetagem numeradas em sequência entre as mesas (Mesa 1: 1 e 2, Mesa 2: 3 e 4…).
  function bancadaNo(L, mesaId, s) {
    let n = 0;
    for (const m of L.mesas || []) { if (m.id === mesaId) return n + s + 1; n += m.rec || 0; }
    return s + 1;
  }
  // Onde fica uma vaga, em texto: "Mesa 1 · Indução", "2º Sorting letra C", "Descarga"…
  function slotDesc(key, L) {
    const p = key.split('.');
    if (p[0] === 'int') return 'Intervalo';
    if (p[0] === 's2' || p[0] === 'aud') return `${FUNCS[p[0]]} letra ${p[1]}`;
    if (FUNCS[p[0]]) return FUNCS[p[0]];
    const ms = (L.mesas || []).find(m => m.id === p[0]);
    return `${ms ? ms.nome : 'Mesa'} · ${p[1] === 'rec' ? `Bancada ${bancadaNo(L, p[0], +p[2])} (${p[3] === '0' ? 'recebe' : 'etiqueta'})` : FUNCS[p[1]]}`;
  }

  // Sub-abas dentro de uma tela (Mapa | Dashboard, Registro | Análise).
  const subTabs = (items, curv, attr) => `<div class="pc-tabs" role="tablist">${items.map(([k, l]) =>
    `<button role="tab" aria-selected="${k === curv}" class="${k === curv ? 'active' : ''}" ${attr}="${k}">${l}</button>`).join('')}</div>`;

  // ================= Mapa de piso =================
  const st = { date: todayIso(), turno: TURNOS.includes(ls.turno) ? ls.turno : 'AM', ver: 0, map: null, dirty: false, locks: new Set(), undo: null, bf: 's2', bsel: new Set(), modo: 'fix', mt: '', mtUsed: 0 };

  function loadMap() {
    const key = `${st.date}|${st.turno}`;
    const draft = (ls.drafts || {})[key];
    const saved = baseOn() ? B().mapaGet(st.date, st.turno) : null;
    // baseAt: salvamento da planilha em que a edição se baseia (para juntar com o que outra pessoa salvar depois).
    if (draft && (!saved || draft.at > saved.at)) { st.map = clone(draft.map); st.dirty = true; st.baseAt = draft.baseAt || null; }
    else if (saved) { st.map = clone(saved.map); st.dirty = false; st.baseAt = saved.at; }
    else {
      // Mapa novo: layout do último mapa salvo (o líder ajusta o layout uma vez e ele segue valendo).
      const last = baseOn() ? B().mapaList().pop() : null;
      st.map = { layout: clone((last && last.map.layout) || DEFAULT_LAYOUT), xptDest: clone((last && last.map.xptDest) || {}), versions: [{ from: '', slots: {} }] };
      st.dirty = false; st.baseAt = null;
    }
    if (!st.map.layout || !st.map.layout.mesas) st.map.layout = clone(DEFAULT_LAYOUT);
    if (st.map.layout.xpt == null) st.map.layout.xpt = DEFAULT_LAYOUT.xpt;   // mapas de antes da função XPT
    st.ver = Math.min(st.ver, st.map.versions.length - 1);
    st.undo = null;
    // Mapa já salvo do dia de hoje: o turno está rodando, então as alterações viram trocas com horário.
    st.modo = saved && st.date === todayIso() ? 'troca' : 'fix';
    st.mt = '';
  }
  function touch() {
    st.dirty = true;
    ls.drafts = ls.drafts || {};
    ls.drafts[`${st.date}|${st.turno}`] = { at: new Date().toISOString(), map: st.map, baseAt: st.baseAt || null };
    lsSave();
  }
  const cur = () => st.map.versions[st.ver];
  // Modo de edição (chave na barra de mudanças):
  //  - 'fix'   (✏️ Corrigir): a alteração corrige a mudança aberta e as seguintes que ainda tinham o mesmo nome na vaga;
  //  - 'troca' (⏱ Troca de função): a alteração é uma troca às HH:MM (campo único; em branco = agora). Usa a mudança
  //    daquele horário ou cria uma nova a partir do mapa que valia ali, e também vale para as mudanças seguintes.
  // O horário escolhido à mão volta para "agora" depois de 10 min sem uso (hoje), para não ficar preso sem querer.
  const modoTroca = () => st.modo === 'troca';
  const MT_IDLE = 10 * 60e3;
  const peekWhen = () => { if (st.mt && isToday() && Date.now() - st.mtUsed > MT_IDLE) st.mt = ''; return st.mt || nowHm(); };
  const useWhen = () => { const w = peekWhen(); st.mtUsed = Date.now(); return w; };
  // No modo troca, a tela mostra o mapa que vale no horário da troca.
  const syncVer = () => { if (modoTroca()) st.ver = versionAt(st.map, peekWhen()).i; };
  function editVersion() {
    if (!modoTroca()) return { v: cur(), created: false };
    const when = useWhen();
    const same = st.map.versions.findIndex(x => (x.from || '') === when);
    if (same >= 0) { st.ver = same; return { v: cur(), created: false }; }
    st.map.versions.push({ from: when, slots: clone(versionAt(st.map, when).slots) });
    st.ver = st.map.versions.length - 1;
    return { v: cur(), created: true };
  }
  // Leva a alteração da mudança v às mudanças seguintes: em cada vaga alterada, as mudanças depois dela que ainda tinham o
  // nome antigo recebem o novo, até a primeira que já tinha outro nome (troca feita de propósito). O intervalo não
  // interrompe (a vaga fica vazia nele e a Volta repõe o nome).
  function propagate(map, v, before) {
    const later = sortedVers(map).filter(x => (x.from || '') > (v.from || '')).map(x => map.versions[x.i]);
    new Set([...Object.keys(before), ...Object.keys(v.slots)]).forEach(k => {
      const a = before[k] || '', b = v.slots[k] || '';
      if (nk(a) === nk(b)) return;
      for (const x of later) {
        if (nk(x.slots[k]) !== nk(a)) { if (x.tipo === 'intervalo') continue; break; }
        if (b) x.slots[k] = b; else delete x.slots[k];
      }
    });
  }
  // Começa e termina uma alteração no mapa (com desfazer de todas as mudanças, já que a correção pode passar adiante).
  function beginEdit() {
    const snap = { versions: clone(st.map.versions), ver: st.ver };
    const r = editVersion();
    return { ...r, before: clone(r.v.slots), snap };
  }
  function endEdit(r, undo) {
    propagate(st.map, r.v, r.before);
    if (undo) st.undo = r.snap;
    touch();
  }
  // O que mudou de uma mudança para a outra, por pessoa: "Ana: Mesa 1 · Indução → Descarga".
  function verDiff(prev, v, L) {
    const where = slots => {
      const m = new Map();
      Object.entries(slots || {}).forEach(([k, n]) => { if (!n || isDw(n)) return; const e = m.get(nk(n)) || { n, d: [] }; e.d.push(slotDesc(k, L)); m.set(nk(n), e); });
      return m;
    };
    const a = where(prev && prev.slots), b = where(v.slots), out = [], saiu = [], entrou = [];
    new Set([...a.keys(), ...b.keys()]).forEach(k => {
      const x = a.has(k) ? a.get(k).d.sort().join(', ') : '', y = b.has(k) ? b.get(k).d.sort().join(', ') : '';
      if (x === y) return;
      const n = (b.get(k) || a.get(k)).n;
      if (!x) entrou.push({ n, d: y }); else if (!y) saiu.push({ n, d: x }); else out.push(`${n}: ${x} → ${y}`);
    });
    // Quem saiu e quem entrou na mesma vaga viram uma linha: "Mesa 1 · Indução: Ana → Bia".
    saiu.forEach(o => {
      const j = entrou.findIndex(e => e.d === o.d);
      if (j >= 0) { out.push(`${o.d}: ${o.n} → ${entrou[j].n}`); entrou.splice(j, 1); } else out.push(`${o.n} saiu de ${o.d}`);
    });
    entrou.forEach(e => out.push(`${e.n} entrou: ${e.d}`));
    return out;
  }

  // Junta duas edições do mesmo mapa (ex.: um líder montou a Mesa 1 e a Descarga e outro, ao mesmo tempo, a Mesa 2 e a 4).
  // base = mapa salvo em que a nossa edição começou (null = mapa novo). Vaga a vaga: se nós mudamos em relação à base,
  // fica o nosso; senão, o deles. Mudanças (horários) que só um dos lados criou entram; a que um lado excluiu sai.
  // Quadro do 2º Sorting / Auditoria: junta os movimentos dos dois.
  function mergeMaps(base, ours, theirs) {
    const b = base || { versions: [{ from: '', slots: {} }] };
    const vk = v => `${v.from || ''}|${v.tipo || ''}`;
    const idx = m => new Map(((m && m.versions) || []).map(v => [vk(v), v]));
    const B0 = idx(b), O = idx(ours), T = idx(theirs);
    const same = (x, y) => JSON.stringify(x == null ? null : x) === JSON.stringify(y == null ? null : y);
    const pick = (bv, ov, tv) => (same(ov, bv) ? tv : ov);
    const versions = [];
    new Set([...O.keys(), ...T.keys()]).forEach(k => {
      const o = O.get(k), t = T.get(k), bb = B0.get(k);
      if (o && t) {
        const bs = (bb && bb.slots) || {}, slots = {};
        new Set([...Object.keys(o.slots || {}), ...Object.keys(t.slots || {}), ...Object.keys(bs)]).forEach(key => {
          const val = pick(bs[key] || '', (o.slots || {})[key] || '', (t.slots || {})[key] || '');
          if (val) slots[key] = val;
        });
        versions.push({ ...t, ...o, slots });
      } else if (!bb) versions.push(clone(o || t));   // criada por um dos lados (a que existia na base e sumiu foi excluída)
    });
    versions.sort((x, y) => (x.from || '').localeCompare(y.from || ''));
    const bx = b.xptDest || {}, ox = ours.xptDest || {}, tx = theirs.xptDest || {}, xptDest = {};
    new Set([...Object.keys(ox), ...Object.keys(tx), ...Object.keys(bx)]).forEach(key => { const val = pick(bx[key], ox[key], tx[key]); if (val && val.length) xptDest[key] = val; });
    const board = {};
    ['s2', 'aud'].forEach(f => {
      const seen = new Set();
      board[f] = [...((theirs.board || {})[f] || []), ...((ours.board || {})[f] || [])].filter(e => { const id = JSON.stringify([e.t, e.n, e.to]); return !seen.has(id) && seen.add(id); });
    });
    const audFaixas = {};
    new Set([...Object.keys(theirs.audFaixas || {}), ...Object.keys(ours.audFaixas || {})]).forEach(l => {
      const seen = new Set();
      audFaixas[l] = [...((theirs.audFaixas || {})[l] || []), ...((ours.audFaixas || {})[l] || [])].filter(a => { const id = JSON.stringify(a); return !seen.has(id) && seen.add(id); });
    });
    return { ...theirs, ...ours, layout: clone(pick(b.layout, ours.layout, theirs.layout) || ours.layout), xptDest, board, audFaixas, versions: versions.length ? versions : [{ from: '', slots: {} }] };
  }

  function renderMapa(ctx) {
    ui = ctx;
    // Ao entrar na tela, o quadro do 2º Sorting/Auditoria e as listas antigas por letra começam recolhidos.
    if (!st.inMapa) { st.boardOpen = false; st.legacyOpen = false; }
    st.inMapa = true;
    if (!st.map || st.loadedKey !== `${st.date}|${st.turno}`) { loadMap(); st.loadedKey = `${st.date}|${st.turno}`; }
    drawMapa();
    if (baseOn()) B().load().then(() => { if (ui.isActive('mapa') && !st.dirty) { loadMap(); drawMapa(); } });
  }

  function drawMapa() {
    syncVer();
    const m = ui.main, L = st.map.layout, v = cur();
    const tabs = subTabs([['mapa', 'Mapa do turno'], ['dash', 'Dashboard']], ls.mview === 'dash' ? 'dash' : 'mapa', 'data-pz-view');
    if (ls.mview === 'dash') {
      m.innerHTML = ui.head('Mapa de piso', 'Análise dos mapas salvos · período do filtro do topo') + tabs + '<div id="pzDash"></div>';
      drawMapaDash();
      return;
    }
    vacMap = vacated();
    prevSt = prevStart();
    const saved = baseOn() ? B().mapaGet(st.date, st.turno) : null;
    const vers = sortedVers(st.map);
    m.innerHTML = ui.head('Mapa de piso', 'Quem está em cada função · por dia e turno') + tabs + `
      <div class="au-bar pz-bar">
        <label>Dia <input type="date" id="pzDate" value="${st.date}"></label>
        <label>Turno <select id="pzTurno">${TURNOS.map(t => `<option ${t === st.turno ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <span class="pz-state ${st.dirty ? 'warn' : saved ? 'ok' : ''}">${st.dirty ? '● Alterações não salvas' : saved ? `✓ Salvo por ${esc(saved.user)} · ${new Date(saved.at).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Mapa novo'}</span>
        <div class="au-bar-right pz-actions">
          ${!saved && !st.dirty ? '<button class="tool" data-pz="copy-last" title="Copia o último mapa salvo deste turno">Copiar último mapa</button>' : ''}
          ${saved && st.dirty ? '<button class="tool danger" data-pz="discard" title="Desfaz as alterações não salvas e volta ao mapa salvo na planilha">Descartar alterações</button>' : ''}
          ${baseOn() && B().mapaHistory(st.date, st.turno).length ? `<button class="tool" data-pz="versions" title="Restaurar um salvamento anterior deste dia e turno">Versões salvas (${B().mapaHistory(st.date, st.turno).length})</button>` : ''}
          <button class="tool" data-pz="layout">Editar layout</button>
          <button class="tool" data-pz="text">Copiar texto</button>
          <button class="btn-primary solid" data-pz="save" ${baseOn() ? '' : 'disabled title="Salvar precisa do login Google e da planilha-base"'}>Salvar mapa</button>
        </div>
      </div>
      <div class="pz-vers">
        <div class="pz-mode" role="radiogroup" aria-label="Modo de edição">
          <button role="radio" aria-checked="${!modoTroca()}" class="${modoTroca() ? '' : 'on'}" data-pz-modo="fix" title="Arrumar o mapa sem registrar troca (ex.: nome errado, montagem do início)">✏️ Corrigir</button>
          <button role="radio" aria-checked="${modoTroca()}" class="${modoTroca() ? 'on' : ''}" data-pz-modo="troca" title="Quem mudou de função durante o turno: a alteração vale a partir do horário">⏱ Troca de função</button>
        </div>
        ${modoTroca() ? `<label class="pz-from">às <input type="time" id="pzMT" value="${esc(st.mt || '')}" title="Em branco = agora"></label>
          ${st.mt ? '<button class="link" data-pz="mt-now">usar agora</button>' : `<span class="muted small">(agora · ${nowHm()})</span>`}` : ''}
        <span class="pz-sep"></span>
        <button class="btn-ghost" data-pz="intervalo" title="Sugere quem vai para o intervalo e cria a mudança">☕ Intervalo</button>
        <button class="btn-ghost ${ls.prevOff ? '' : 'on'}" data-pz="prev" aria-pressed="${!ls.prevOff}" title="Mostra em cinza, em cada vaga vazia, quem estava nela no início do ${st.turno} ${prevSt ? (prevSt.label === 'ontem' ? 'de ontem' : `de ${prevSt.label}`) : 'anterior'}">📅 Início ${prevSt && prevSt.label !== 'ontem' ? `de ${prevSt.label}` : 'de ontem'}</button>
        <button class="btn-ghost" data-pz="rodizio" title="Coloca as pessoas em funções diferentes das que fizeram nos últimos ${HIST_DAYS} dias">🔄 Rodízio</button>
        ${st.undo ? '<button class="tool" data-pz="undo">Desfazer</button>' : ''}
      </div>
      <div class="pz-mode-hint ${modoTroca() ? 'troca' : ''}">${modoTroca()
        ? `Cada alteração é registrada como <b>troca às ${esc(peekWhen())}</b> e vale daí em diante. Mostrando o mapa que vale nesse horário.`
        : `Alterações <b>corrigem ${esc(verLabel(v))}</b>${vers.length > 1 ? ' e as mudanças seguintes que tinham o mesmo nome' : ''}. Não registra horário.`}</div>
      ${timeline(vers, L)}
      ${v.tipo === 'intervalo' ? `<div class="pz-int-hint">☕ <b>Mudança de intervalo (${esc(v.from)})</b>: ${vacMap.size} vaga(s) ficaram livres (em destaque). Você pode mudar a função de quem não foi para o intervalo para cobrir essas vagas — vale a partir das ${esc(v.from)}.
        ${st.map.versions.some(x => x.tipo === 'volta') ? 'Na <b>Volta</b>, todos retornam às funções de antes do intervalo; se alguma troca deve continuar, ajuste também a Volta.' : ''}</div>` : ''}
      <datalist id="pzPeople"><option value="${DIARISTA}">${people().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="pz-grid ${ls.sideOff ? 'side-off' : ''}" id="pzGrid">
        <div class="pz-main">
          <div class="pz-mesas">${L.mesas.map(mesaCard).join('')}</div>
          ${boardCard()}
          ${legacyLetters() ? lettersCard() : ''}
          <div class="pz-mesas">${simpleCard('desc', 'Descarga', L.desc)}${xptCard(L.xpt || 0)}${simpleCard('s5', '5S', L.s5)}${intCard()}</div>
        </div>
        <aside class="pz-side" id="pzSide"></aside>
      </div>`;
    drawSide();
  }

  // Linha do tempo do turno: cada mudança com o horário e quem trocou de função; clicar abre a mudança (para corrigir).
  // Os movimentos do quadro do 2º Sorting / Auditoria aparecem junto, pelo horário.
  function timeline(vers, L) {
    const rows = vers.map((x, j) => {
      const diff = j ? verDiff(vers[j - 1], x, L) : [];
      const n = new Set(Object.values(x.slots).filter(y => y && !isDw(y)).map(nk)).size;
      const txt = j ? (diff.length ? diff.slice(0, 3).join(' · ') + (diff.length > 3 ? ` · +${diff.length - 3}` : '') : 'sem troca') : `${n} pessoa(s) em função`;
      const on = x.i === st.ver;
      return { t: x.from || '', html: `<div class="pz-tl-row ${on ? 'on' : ''} ${x.tipo || ''}">
        <button class="pz-tl-main" data-pz-ver="${x.i}" title="${esc(diff.join('\n') || verLabel(x))}"><b>${esc(verChip(x))}</b><span>${esc(txt)}</span></button>
        ${on && j && !modoTroca() ? `<label class="pz-from">horário <input type="time" id="pzFrom" value="${esc(x.from || '')}"></label>
          <button class="tool danger" data-pz="del-ver">Excluir</button>` : ''}</div>` };
    });
    const b = boardOf();
    ['s2', 'aud'].forEach(f => {
      const g = new Map();
      b[f].forEach(e => { if (!e.t) return; const k = e.t; (g.get(k) || g.set(k, []).get(k)).push(e); });
      g.forEach((es, t) => {
        const dest = to => (to === 'pool' ? 'Disponíveis' : to === 'int' ? 'Intervalo' : !to ? 'saiu' : to);
        const txt = es.length > 3 ? `${es.length} movimento(s)` : es.map(e => `${e.n} → ${dest(e.to)}`).join(' · ');
        rows.push({ t, html: `<div class="pz-tl-row board"><span class="pz-tl-main"><b>${esc(t)}</b><span>${BF[f]}: ${esc(txt)}</span></span></div>` });
      });
    });
    rows.sort((x, y) => x.t.localeCompare(y.t));
    return `<details class="pz-tline" ${ls.tlOff ? '' : 'open'}><summary data-tl="1">Linha do tempo do turno <span class="muted">(${vers.length} mudança(s))</span></summary>
      <div class="pz-tl-list">${rows.map(r => r.html).join('')}</div></details>`;
  }
  // Na mudança de intervalo: vagas que ficaram livres porque a pessoa foi para o intervalo (nome de quem saiu).
  function vacated() {
    const v = cur(), out = new Map();
    if (v.tipo !== 'intervalo') return out;
    const vs = sortedVers(st.map), i = vs.findIndex(x => x.i === st.ver), prev = i > 0 ? vs[i - 1] : null;
    if (!prev) return out;
    const onBreak = new Set(intKeys(v).map(k => nk(v.slots[k])));
    Object.entries(prev.slots).forEach(([k, n]) => { if (n && !k.startsWith('int.') && !v.slots[k] && onBreak.has(nk(n))) out.set(k, n); });
    return out;
  }
  let vacMap = new Map();
  // Início do último mapa salvo do mesmo turno (normalmente ontem): o nome de quem começou em cada vaga aparece em cinza
  // (placeholder) na vaga vazia, para ajudar no revezamento.
  let prevSt = null;
  function prevStart() {
    if (!baseOn()) return null;
    const r = B().mapaList().filter(x => x.turno === st.turno && x.date < st.date).pop();
    if (!r) return null;
    const y = new Date(st.date + 'T12:00:00'); y.setDate(y.getDate() - 1);
    // Primeiro nome de cada vaga no turno (sem intervalo/volta): a montagem pode ter sido salva aos poucos e virado trocas.
    const slots = {};
    sortedVers(r.map).filter(v => v.tipo !== 'intervalo' && v.tipo !== 'volta').forEach(v => Object.entries(v.slots || {}).forEach(([k, n]) => { if (n && !k.startsWith('int.') && !slots[k]) slots[k] = n; }));
    return { date: r.date, label: r.date === y.toISOString().slice(0, 10) ? 'ontem' : brShort(r.date), slots };
  }
  const slotInput = (key, ph = '') => {
    const v = cur().slots[key] || '';
    const vac = !v && vacMap.get(key);
    const was = !ls.prevOff && prevSt && prevSt.slots[key];
    if (vac) ph = `☕ ${vac} (intervalo) · quem cobre?`;
    else if (was && !isDw(was)) ph = `${ph ? `${ph} · ` : ''}${was} (${prevSt.label})`;
    return `<div class="pz-slot${vac ? ' vac' : ''}"><input list="pzPeople" data-slot="${key}" value="${esc(v)}" placeholder="${esc(ph)}" aria-label="${esc(ph || 'Vaga')}" autocomplete="off">
      <button class="pz-lock ${st.locks.has(key) ? 'on' : ''}" data-lock="${key}" title="${st.locks.has(key) ? 'Fixo no rodízio (clique para soltar)' : 'Fixar esta vaga no rodízio'}">${st.locks.has(key) ? '🔒' : '🔓'}</button></div>`;
  };
  const range = n => Array.from({ length: n }, (_, i) => i);
  // Cabeçalho de quadro com o atalho "Limpar" (apaga todas as vagas da área nesta mudança).
  const cardHead = (title, area) => `<div class="pz-card-head"><div class="pz-title">${title}</div>
    <button class="tool pz-clear" data-pz-clear="${area}" title="Limpar todas as vagas desta área nesta mudança">Limpar</button></div>`;
  function mesaCard(ms) {
    return `<section class="card pz-card">${cardHead(esc(ms.nome), `mesa:${ms.id}`)}
      ${ms.ind ? `<div class="pz-sub">Indução</div>${range(ms.ind).map(k => slotInput(`${ms.id}.ind.${k}`)).join('')}` : ''}
      ${ms.rec ? `<div class="pz-sub">Recebimento / Etiquetagem</div>${range(ms.rec).map(s => `<div class="pz-posto"><span class="muted small">Bancada ${bancadaNo(st.map.layout, ms.id, s)}</span>
        ${range(REC_SIZE).map(k => slotInput(`${ms.id}.rec.${s}.${k}`, k === 0 ? 'Recebe' : 'Etiqueta')).join('')}</div>`).join('')}` : ''}
      ${ms.sort ? `<div class="pz-sub">Sorting</div>${range(ms.sort).map(k => slotInput(`${ms.id}.sort.${k}`)).join('')}` : ''}
    </section>`;
  }
  // ---------- Quadro do 2º Sorting e da Auditoria (kanban) ----------
  // Cada pessoa é um cartão; as colunas são "Disponíveis" e as letras. Mover um cartão grava um movimento com horário
  // (map.board[f] = [{ t, n, to }]); to = letra, 'pool' (disponível), 'int' (intervalo) ou '' (saiu). Vale para o turno
  // inteiro, sem precisar criar mudança. Vários grupos podem estar em letras diferentes ao mesmo tempo.
  const BF = { s2: '2º Sorting', aud: 'Auditoria' };
  const boardOf = (map = st.map) => { map.board = map.board || {}; map.board.s2 = map.board.s2 || []; map.board.aud = map.board.aud || []; return map.board; };
  const isToday = () => st.date === todayIso();
  // Estado de cada pessoa num horário (último movimento até ali). Sem horário: agora (hoje) ou o fim do turno (outros dias).
  function bStateAt(ev, T) {
    const at = T || (isToday() ? nowHm() : '99:99');
    const m = new Map();
    ev.map((e, i) => ({ ...e, i })).filter(e => (e.t || '') <= at).sort((a, b) => (a.t || '').localeCompare(b.t || '') || a.i - b.i)
      .forEach(e => m.set(nk(e.n), { n: e.n, to: e.to, t: e.t }));
    return m;
  }
  const bPeople = (f, T) => [...bStateAt(boardOf()[f], T).values()].filter(x => x.to);
  // ---------- Auditoria por rota ----------
  // Cada rota é auditada por uma pessoa só. A letra tem N rotas (layout: rotas por letra, com exceções por letra) e o app
  // divide 1..N em faixas iguais entre quem está auditando a letra naquele horário (ordem de chegada na letra). O líder
  // pode ajustar as faixas (map.audFaixas[letra] = [{ t, faixas: [{ n, de, ate }] }]); o ajuste vale enquanto o grupo da
  // letra for o mesmo — se alguém entra ou sai, volta a divisão automática.
  const rotasDe = (L, letra) => { const x = ((L && L.rotasLetra) || {})[letra]; return x > 0 ? x : (L && L.rotas > 0 ? L.rotas : 20); };
  // Rotas do turno (map.rotas = { de: 'E-7', ate: 'H-2' }): as letras do quadro vão da letra inicial à final; a primeira
  // letra começa no número inicial e a última termina no número final (as do meio vão de 1 a N).
  const parseRota = r => { const m = String(r || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z])-?(\d+)$/); return m ? { l: m[1], n: +m[2] } : null; };
  const letrasEntre = (a, b) => Array.from({ length: Math.max(0, b.charCodeAt(0) - a.charCodeAt(0) + 1) }, (_, i) => String.fromCharCode(a.charCodeAt(0) + i));
  function faixaLetra(map, letra) {
    const N = rotasDe(map.layout, letra), R = map.rotas || {}, a = parseRota(R.de), b = parseRota(R.ate);
    return [a && a.l === letra ? a.n : 1, b && b.l === letra ? Math.min(b.n, N) : N];
  }
  function totalRotas(map) {
    const a = parseRota((map.rotas || {}).de), b = parseRota((map.rotas || {}).ate);
    if (!a || !b) return 0;
    return letrasEntre(a.l, b.l).reduce((t, l) => { const [lo, hi] = faixaLetra(map, l); return t + Math.max(0, hi - lo + 1); }, 0);
  }
  function dividir(names, N, lo = 1) {
    const total = N - lo + 1, k = names.length, out = [];
    let de = lo;
    names.forEach((n, i) => { const q = Math.floor(total / k) + (i < total % k ? 1 : 0); if (q > 0) out.push({ n, de, ate: de + q - 1 }); de += q; });
    return out;
  }
  function audGroup(map, letra, T) {
    const ev = ((map.board || {}).aud) || [];
    if (ev.length) {
      return [...bStateAt(ev, T).values()].filter(x => x.to === letra).sort((a, b) => (a.t || '').localeCompare(b.t || '') || a.n.localeCompare(b.n, 'pt-BR')).map(x => x.n);
    }
    // Mapas antigos: lista da Auditoria da letra na mudança daquele horário.
    const v = versionAt(map, T || '99:99');
    return v ? listKeys(v, 'aud', letra).map(k => v.slots[k]) : [];
  }
  function audRoutes(map, letra, T) {
    const names = audGroup(map, letra, T), [lo, N] = faixaLetra(map, letra);
    if (!names.length || N < lo) return [];
    const at = T || (map === st.map && isToday() ? nowHm() : '99:99');
    const adj = (((map.audFaixas || {})[letra]) || []).filter(a => (a.t || '') <= at).pop();
    const same = adj && adj.faixas && adj.faixas.length === names.length && adj.faixas.every(f => names.some(n => nk(n) === nk(f.n)));
    return same ? adj.faixas.map(f => ({ ...f })) : dividir(names, N, lo);
  }
  const audWho = (map, letra, num, T) => audRoutes(map, letra, T).filter(f => num >= f.de && num <= f.ate).map(f => f.n);
  function bMove(f, names, to, t) {
    const ev = boardOf()[f], when = t || (modoTroca() ? useWhen() : nowHm());
    names.forEach(n => ev.push({ t: when, n, to }));
    touch();
  }
  const n2Of = () => bPeople('s2').filter(x => x.to !== 'int').length, nAOf = () => bPeople('aud').filter(x => x.to !== 'int').length;
  // "Disponíveis" automático: todos que já tiveram alguma função no mapa do dia (vagas de qualquer mudança e o quadro das
  // duas abas) e ainda não estão neste quadro. Aparecem como cartão "sugerido"; ao mover, viram um movimento normal.
  function boardSuggest(f) {
    const here = new Set(bPeople(f).map(x => nk(x.n)));
    const out = new Map();
    const add = n => { if (n && !isDw(n) && !here.has(nk(n)) && !out.has(nk(n))) out.set(nk(n), n); };
    st.map.versions.forEach(v => Object.values(v.slots || {}).forEach(add));
    ['s2', 'aud'].forEach(g => (boardOf()[g] || []).forEach(e => add(e.n)));
    return [...out.values()].map(n => ({ n, to: 'pool', sug: true }));
  }
  // Pessoas do quadro + sugeridas (para mostrar e mover).
  const boardAll = f => [...bPeople(f), ...boardSuggest(f)];
  const legacyLetters = () => Object.keys(cur().slots).some(k => /^(s2|aud)\./.test(k) && cur().slots[k]);
  // Ajuste manual das faixas de rotas de uma letra (vale a partir do horário: o da troca ou agora).
  async function ajustarRotas(letra) {
    const [lo, N] = faixaLetra(st.map, letra), cur0 = audRoutes(st.map, letra);
    if (!cur0.length) return ui.toast(`Ninguém auditando a letra ${letra}.`, true);
    const row = (x, i) => `<div class="pz-faixa"><b>${esc(x.n)}</b><label>de ${letra}-<input type="number" min="${lo}" max="${N}" data-fde="${i}" value="${x.de}"></label><label>até ${letra}-<input type="number" min="${lo}" max="${N}" data-fate="${i}" value="${x.ate}"></label></div>`;
    const r = await modal(`Rotas da letra ${letra} (${letra}-${lo} a ${letra}-${N})`, `<p class="muted">Cada rota é auditada por uma pessoa só. Ajuste as faixas; vale a partir das ${esc(modoTroca() ? peekWhen() : nowHm())}. Se alguém entrar ou sair da letra, o app volta a dividir igualmente.</p>
      <div id="pzFaixas">${cur0.map(row).join('')}</div><div class="muted small" id="pzFaixaMsg"></div>`,
      [['cancel', 'Cancelar', 'btn-ghost'], ['auto', 'Dividir igualmente', 'btn-ghost'], ['ok', 'Salvar faixas', 'btn-primary solid']],
      dlg => {
        const check = () => {
          const fx = cur0.map((x, i) => ({ de: +dlg.querySelector(`[data-fde="${i}"]`).value, ate: +dlg.querySelector(`[data-fate="${i}"]`).value }));
          const cnt = Array(N + 1).fill(0);
          fx.forEach(f => { for (let k = Math.max(lo, f.de); k <= Math.min(N, f.ate); k++) cnt[k]++; });
          const sem = cnt.map((c, k) => (k >= lo && !c ? k : 0)).filter(Boolean), dup = cnt.map((c, k) => (c > 1 ? k : 0)).filter(Boolean);
          dlg.querySelector('#pzFaixaMsg').innerHTML = [sem.length ? `⚠ Sem auditor: ${sem.map(k => `${letra}-${k}`).join(', ')}` : '', dup.length ? `⚠ Com mais de um auditor: ${dup.map(k => `${letra}-${k}`).join(', ')}` : ''].filter(Boolean).join('<br>') || '✓ Todas as rotas com um auditor.';
        };
        dlg.addEventListener('input', check); check();
      },
      dlg => cur0.map((x, i) => ({ n: x.n, de: +dlg.querySelector(`[data-fde="${i}"]`).value, ate: +dlg.querySelector(`[data-fate="${i}"]`).value })));
    if (!r || r.btn === 'cancel') return;
    if (r.btn === 'ok') {
      const bad = r.data.filter(f => !(f.de >= lo && f.ate <= N && f.de <= f.ate));
      if (bad.length) return ui.toast(`Faixa inválida para ${bad.map(f => f.n).join(', ')}: use rotas entre ${letra}-${lo} e ${letra}-${N}, com "de" menor ou igual a "até".`, true);
    }
    const t = modoTroca() ? useWhen() : nowHm();
    st.map.audFaixas = st.map.audFaixas || {};
    const list = (st.map.audFaixas[letra] = (st.map.audFaixas[letra] || []).filter(a => a.t !== t));
    list.push({ t, faixas: r.btn === 'auto' ? dividir(cur0.map(x => x.n), N, lo) : r.data.filter(f => f.de > 0 && f.ate >= f.de) });
    touch(); drawMapa();
    ui.toast(`Rotas da letra ${letra} ${r.btn === 'auto' ? 'divididas igualmente' : 'ajustadas'} a partir das ${t}.`);
  }
  // Rotas do turno (de / até), rotas por letra e exceções: ficam no quadro do 2º Sorting e Auditoria.
  function rotasCfg() {
    const R = st.map.rotas || {}, L = st.map.layout, tot = totalRotas(st.map), sug = rotaSugerida();
    return `<div class="pz-rotas-cfg">
      <b>Rotas do turno</b>
      <label>de <input type="text" data-rt="de" value="${esc(R.de || '')}" placeholder="${esc(sug || 'A-1')}" autocomplete="off"></label>
      <label>até <input type="text" data-rt="ate" value="${esc(R.ate || '')}" placeholder="E-6" autocomplete="off"></label>
      ${tot ? `<span class="pill good">${tot} rotas · letras ${esc(L.letras[0])} a ${esc(L.letras[L.letras.length - 1])}</span>` : '<span class="pill bad">Defina a primeira e a última rota do turno</span>'}
      ${!R.de && sug ? `<button class="link" data-rt-sug="${esc(sug)}">usar ${esc(sug)}</button>` : ''}
      <label title="Cada letra tem rotas de 1 até N">Rotas por letra <input type="number" min="1" max="99" data-rt="n" value="${L.rotas || 20}"></label>
      <label title="Letras com outra quantidade de rotas, ex.: C=18, F=15">Exceções <input type="text" data-rt="exc" value="${esc(Object.entries(L.rotasLetra || {}).map(([k, v]) => `${k}=${v}`).join(', '))}" placeholder="C=18" autocomplete="off"></label>
    </div>`;
  }
  // Sugestão da primeira rota: a seguinte à última rota do turno anterior do mesmo dia (AM → PM1 → PM2).
  function rotaSugerida() {
    if (!baseOn()) return '';
    const i = TURNOS.indexOf(st.turno);
    const prev = B().mapaList().filter(r => r.date === st.date && TURNOS.indexOf(r.turno) < i && r.map && r.map.rotas && parseRota(r.map.rotas.ate)).pop();
    if (!prev) return '';
    const b = parseRota(prev.map.rotas.ate), N = rotasDe(prev.map.layout, b.l);
    return b.n < N ? `${b.l}-${b.n + 1}` : `${String.fromCharCode(b.l.charCodeAt(0) + 1)}-1`;
  }
  function setRotas(field, value) {
    const L = st.map.layout, R = (st.map.rotas = st.map.rotas || {});
    if (field === 'n') L.rotas = Math.max(1, Math.min(99, parseInt(value, 10) || 20));
    else if (field === 'exc') L.rotasLetra = Object.fromEntries((String(value).toUpperCase().match(/[A-Z]\s*[=:]\s*\d+/g) || []).map(x => { const [k, v] = x.split(/\s*[=:]\s*/); return [k, Math.max(1, Math.min(99, +v))]; }));
    else {
      const v = String(value || '').trim();
      if (v && !parseRota(v)) return ui.toast('Rota inválida: use letra-número, ex.: E-7.', true);
      if (v) R[field] = `${parseRota(v).l}-${parseRota(v).n}`; else delete R[field];
    }
    const a = parseRota(R.de), b = parseRota(R.ate);
    if (a && b && (a.l > b.l || (a.l === b.l && a.n > b.n))) { ui.toast('A primeira rota tem que vir antes da última.', true); delete R[field]; }
    if (a && b && R.de && R.ate) L.letras = letrasEntre(a.l, b.l);
    touch(); drawMapa();
  }
  function boardCard() {
    const L = st.map.layout;
    const f = st.bf, all = boardAll(f);
    const cols = [['pool', 'Disponíveis'], ...L.letras.map(l => [l, `Letra ${l}`])];
    const byCol = id => all.filter(x => x.to === id).sort((a, b) => a.n.localeCompare(b.n, 'pt-BR'));
    const targets = from => cols.filter(([id]) => id !== from).map(([id, lb]) => `<option value="${id}">${esc(lb)}</option>`).join('');
    const sel = st.bsel.size;
    const faixa = new Map();
    if (f === 'aud') L.letras.forEach(l => audRoutes(st.map, l).forEach(x => faixa.set(`${l}|${nk(x.n)}`, x)));
    const col = ([id, label]) => {
      const ps = byCol(id);
      return `<div class="pz-col ${id === 'pool' ? 'pool' : ''} ${ps.length ? '' : 'empty'}" data-bcol="${id}">
        <div class="pz-col-head"><b>${esc(label)}</b><span class="pz-col-n">${ps.length}</span>
          ${ps.length ? `<select class="pz-col-move" data-bmove="${id}" title="Mover todos desta coluna" aria-label="Mover todos de ${esc(label)}"><option value="">Mover todos ▸</option>${targets(id)}<option value="">──────</option><option value="__out">Tirar todos da função</option></select>` : ''}</div>
        <div class="pz-col-body">${ps.map(x => `<div class="pz-pcard ${st.bsel.has(nk(x.n)) ? 'sel' : ''} ${isDw(x.n) ? 'dw' : ''} ${x.sug ? 'sug' : ''}" draggable="true" data-bcard="${esc(x.n)}" title="${x.sug ? 'Já tem função no mapa do dia' : `Desde ${esc(x.t || '')}`} · clique para selecionar, arraste para mover">
          <span>${esc(x.n)}${(fx => (fx ? `<small class="pz-rotas">rotas ${id}-${fx.de} a ${id}-${fx.ate}</small>` : ''))(faixa.get(`${id}|${nk(x.n)}`))}</span>${x.sug ? '' : `<button data-brm="${esc(x.n)}" title="Tirar da função" aria-label="Tirar ${esc(x.n)}">×</button>`}</div>`).join('')}
          ${sel && !ps.some(x => st.bsel.has(nk(x.n))) ? `<button class="pz-col-drop" data-bto="${id}">Mover ${sel} aqui</button>` : ''}</div>
        ${f === 'aud' && id !== 'pool' && ps.length ? `<div class="pz-col-foot"><button class="tool" data-baj="${id}" title="Mudar quais rotas cada auditor confere">Ajustar rotas (${(([a, b]) => `${id}-${a} a ${id}-${b}`)(faixaLetra(st.map, id))})</button></div>` : ''}
        ${id === 'pool' ? `<div class="pz-col-foot"><button class="tool" data-bpick="1">+ Adicionar pessoas</button><button class="tool" data-bdw="1" title="Adiciona um diarista">+ Diarista</button></div>` : ''}
      </div>`;
    };
    const ev = boardOf()[f];
    const groups = [];
    ev.forEach(e => { const g = groups[groups.length - 1]; if (g && g.t === e.t && g.to === e.to) g.n.push(e.n); else groups.push({ t: e.t, to: e.to, n: [e.n] }); });
    const lbl = to => (to === 'pool' ? 'Disponíveis' : to === 'int' ? 'Intervalo' : !to ? 'saiu da função' : `letra ${to}`);
    const n2 = bPeople('s2').length, nA = bPeople('aud').length;
    if (!st.boardOpen) {
      const lets = st => [...new Set(bPeople(st).filter(x => x.to && x.to !== 'pool' && x.to !== 'int').map(x => x.to))].sort().join(', ') || '—';
      const R = st.map.rotas || {}, tot = totalRotas(st.map);
      return `<section class="card pz-card pz-board off"><div class="pz-card-head"><div class="pz-title">2º Sorting e Auditoria</div>
        <button class="tool" data-board-toggle="1" title="Mostrar o quadro">Expandir ▾</button></div>
        <div class="muted small">${tot ? `Rotas <b>${esc(R.de)} a ${esc(R.ate)}</b> (${tot}) · ` : '<b class="bad">⚠ Rotas do turno não definidas (expanda o quadro)</b> · '}2º Sorting: <b>${n2Of()}</b> pessoa(s) · letras ${esc(lets('s2'))} &nbsp;·&nbsp; Auditoria: <b>${nAOf()}</b> · letras ${esc(lets('aud'))}</div></section>`;
    }
    return `<section class="card pz-card pz-board bf-${f}">
      <div class="pz-seg" role="tablist" aria-label="Quadro">
        <button role="tab" aria-selected="${f === 's2'}" class="${f === 's2' ? 'on' : ''}" data-bf="s2">2º Sorting <b>${n2}</b></button>
        <button role="tab" aria-selected="${f === 'aud'}" class="${f === 'aud' ? 'on' : ''}" data-bf="aud">Auditoria <b>${nA}</b></button>
      </div>
      <div class="pz-card-head"><div class="pz-title">Você está no quadro: <span class="pz-bf-name">${BF[f]}</span></div>
        <div class="pz-board-tools">
          <button class="tool" data-board-toggle="1" title="Recolher o quadro">Recolher ▴</button>
          <button class="tool pz-clear" data-pz-clear="board:${f}" title="Tirar todos do ${BF[f]}">Limpar</button>
        </div></div>
      <div class="muted small">Em "Disponíveis" já aparecem, tracejados, todos que têm alguma função no mapa do dia; "+ Adicionar pessoas" é para quem estiver de fora. Arraste os cartões entre as colunas, ou clique para selecionar e depois em "Mover aqui". "Mover todos ▸" passa a coluna inteira para outra letra. Cada movimento grava o horário: ${modoTroca() ? `o da troca (${esc(peekWhen())})` : 'agora'}${isToday() ? '' : ' (dia que não é hoje: mostra como terminou o turno)'}.</div>
      ${rotasCfg()}
      ${sel ? `<div class="pz-bsel">${sel} selecionado(s) — clique em "Mover ${sel} aqui" na coluna de destino. <button class="link" data-bclear="1">Desmarcar</button></div>` : ''}
      <div class="pz-cols">${cols.map(col).join('')}</div>
      ${groups.length ? `<details class="pz-tl"><summary>Linha do tempo do ${BF[f]} (${groups.length} movimento(s))</summary>
        <ul>${groups.slice().reverse().slice(0, 60).map(g => `<li><b>${esc(g.t || '')}</b> · ${g.n.length > 3 ? `${g.n.length} pessoas` : g.n.map(esc).join(', ')} → ${lbl(g.to)}</li>`).join('')}</ul></details>` : ''}
    </section>`;
  }
  // Adicionar pessoas ao quadro (vão para "Disponíveis"). Quem está numa vaga do mapa pode ser retirado de lá.
  async function boardPick() {
    const f = st.bf, v = cur(), L = st.map.layout;
    const on = new Set(boardAll(f).map(x => nk(x.n)));
    const where = new Map();
    Object.entries(v.slots).forEach(([k, n]) => { if (n && !isDw(n)) where.set(nk(n), slotDesc(k, L)); });
    const other = f === 's2' ? 'aud' : 's2';
    bPeople(other).forEach(x => { if (!isDw(x.n)) where.set(nk(x.n), BF[other]); });
    const names = [...new Map([...people(), ...Object.values(v.slots).filter(n => n && !isDw(n))].map(n => [nk(n), n])).values()]
      .filter(n => !on.has(nk(n))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const r = await modal(`Adicionar ao ${BF[f]}`, `
      <input type="search" class="search pz-pick-search" id="pzPickQ" placeholder="Buscar nome…" autocomplete="off">
      <div class="pz-pick-list" id="pzPickList">${names.map(n => `<label class="pz-int-row"><input type="checkbox" data-pick="${esc(n)}">
        <span class="pz-int-name">${esc(n)}</span><span class="muted small">${where.has(nk(n)) ? esc(where.get(nk(n))) : ''}</span></label>`).join('')}</div>
      <div class="muted small" id="pzPickCount">Entram na coluna "Disponíveis"; depois arraste para a letra.</div>`,
      [['cancel', 'Cancelar', 'btn-ghost'], ['ok', 'Adicionar', 'btn-primary solid']],
      dlg => {
        dlg.querySelector('#pzPickQ').addEventListener('input', e => { const q = nk(e.target.value); dlg.querySelectorAll('#pzPickList label').forEach(x => { x.hidden = !!q && !nk(x.textContent).includes(q); }); });
        dlg.addEventListener('change', () => { dlg.querySelector('#pzPickCount').textContent = `${dlg.querySelectorAll('#pzPickList input:checked').length} selecionada(s)`; });
        setTimeout(() => dlg.querySelector('#pzPickQ').focus(), 0);
      },
      dlg => [...dlg.querySelectorAll('#pzPickList input:checked')].map(i => i.dataset.pick));
    if (!r || r.btn !== 'ok' || !r.data.length) return;
    const busy = r.data.filter(n => where.has(nk(n)));
    if (busy.length) {
      const q = await modal('Colaborador já está em outra função', `<p>${busy.map(n => `<b>${esc(n)}</b> está em <b>${esc(where.get(nk(n)))}</b>`).join('<br>')}</p>
        <p class="muted">Deseja retirá-los de lá?</p>`, [['cancel', 'Cancelar', 'btn-ghost'], ['keep', 'Manter nas duas', 'btn-ghost'], ['move', 'Retirar de lá', 'btn-primary solid']]);
      if (q.btn === 'cancel') return;
      if (q.btn === 'move') {
        const out = new Set(busy.map(nk));
        Object.keys(v.slots).forEach(k => { if (v.slots[k] && out.has(nk(v.slots[k]))) delete v.slots[k]; });
        const leave = bPeople(other).filter(x => out.has(nk(x.n))).map(x => x.n);
        if (leave.length) bMove(other, leave, '');
      }
    }
    bMove(f, r.data, 'pool');
    drawMapa();
  }

  function lettersCard() {
    const L = st.map.layout, v = cur();
    if (!L.letras.length) return '';
    const cell = (f, l) => {
      const ks = listKeys(v, f, l);
      const vac = [...vacMap.entries()].filter(([k]) => k.startsWith(`${f}.${l}.`));
      return `<div class="pz-chips">${ks.map(k => `<span class="pz-chip">${esc(v.slots[k])}<button data-pz-rm="${k}" title="Tirar da lista" aria-label="Tirar ${esc(v.slots[k])}">×</button></span>`).join('')}
        ${vac.map(([, n]) => `<span class="pz-chip vac" title="Saiu para o intervalo">☕ ${esc(n)}</span>`).join('')}
        <button class="tool pz-add" data-pz-pick="${f}.${l}" title="Selecionar as pessoas da lista">${ks.length ? '+ / editar' : '+ Selecionar'}</button></div>`;
    };
    const n = L.letras.reduce((a, l) => a + listKeys(v, 's2', l).length + listKeys(v, 'aud', l).length, 0);
    if (!st.legacyOpen) return `<section class="card pz-card"><div class="pz-card-head"><div class="pz-title">Listas por letra (formato anterior)</div>
        <button class="tool" data-legacy-toggle="1" title="Mostrar as listas">Expandir ▾</button></div>
        <div class="muted small">${n} pessoa(s) em listas por letra (mapas montados antes do quadro).</div></section>`;
    return `<section class="card pz-card"><div class="pz-card-head"><div class="pz-title">Listas por letra (formato anterior)</div>
        <div class="pz-board-tools"><button class="tool" data-legacy-toggle="1" title="Recolher">Recolher ▴</button><button class="tool pz-clear" data-pz-clear="letras" title="Limpar todas as listas">Limpar</button></div></div>
      <div class="table-wrap"><table class="pz-letters"><thead><tr><th>Letra</th><th class="left">2º Sorting</th><th class="left">Auditoria</th></tr></thead><tbody>
      ${L.letras.map(l => `<tr><td><b>${esc(l)}</b>${listKeys(v, 's2', l).length || listKeys(v, 'aud', l).length ? `<button class="pz-clear-l" data-pz-clear="letra:${l}" title="Limpar a letra ${esc(l)}">×</button>` : ''}</td><td class="left">${cell('s2', l)}</td><td class="left">${cell('aud', l)}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  }
  // Limpa uma área inteira da mudança atual: mesa:m1 · letras · letra:C · func:desc|xpt|s5|int.
  async function clearArea(area) {
    const v = cur(), [kind, id] = area.split(':'), L = st.map.layout;
    if (kind === 'board') {
      const ps = bPeople(id).filter(x => x.to !== 'int');
      if (!ps.length) return ui.toast('O quadro já está vazio.');
      if (!(await uiConfirm(`Tirar todas as ${ps.length} pessoa(s) do ${BF[id]}?`, { ok: 'Limpar' }))) return;
      bMove(id, ps.map(x => x.n), ''); drawMapa(); return;
    }
    const match = k => kind === 'mesa' ? k.startsWith(`${id}.`) : kind === 'letras' ? /^(s2|aud)\./.test(k)
      : kind === 'letra' ? k.startsWith(`s2.${id}.`) || k.startsWith(`aud.${id}.`) : k.startsWith(`${id}.`);
    const keys = Object.keys(v.slots).filter(k => v.slots[k] && match(k));
    if (!keys.length) return ui.toast('Essa área já está vazia.');
    const nome = kind === 'mesa' ? (L.mesas.find(m => m.id === id) || {}).nome : kind === 'letras' ? '2º Sorting e Auditoria (todas as letras)'
      : kind === 'letra' ? `letra ${id} (2º Sorting e Auditoria)` : FUNCS[id];
    if (!(await uiConfirm(`Limpar ${nome}? Sai(em) ${keys.length} pessoa(s)${modoTroca() ? ` (troca às ${peekWhen()})` : ` (correção de ${verLabel(v)})`}.`, { ok: 'Limpar' }))) return;
    const ed = beginEdit();
    keys.forEach(k => delete ed.v.slots[k]);
    endEdit(ed, true); drawMapa();
    ui.toast(`${nome}: ${keys.length} vaga(s) limpa(s). Use "Desfazer" se foi sem querer.`);
  }
  // Grava a lista de uma letra (s2.C.0, s2.C.1…) na mudança atual.
  function setList(f, l, names, v) {
    listKeys(v, f, l).forEach(k => delete v.slots[k]);
    Object.keys(v.slots).filter(k => k.startsWith(`${f}.${l}.`)).forEach(k => delete v.slots[k]);
    names.forEach((n, i) => { v.slots[`${f}.${l}.${i}`] = n; });
  }
  // Seleção das pessoas de uma lista (2º Sorting / Auditoria da letra): busca, marcar várias, diaristas por número.
  async function openPicker(f, l) {
    const v = cur(), L = st.map.layout;
    const mine = listKeys(v, f, l).map(k => v.slots[k]);
    const mineSet = new Set(mine.filter(n => !isDw(n)).map(nk));
    const where = new Map();
    Object.entries(v.slots).forEach(([k, n]) => { if (n && !isDw(n) && !k.startsWith(`${f}.${l}.`)) where.set(nk(n), slotDesc(k, L)); });
    const extra = Object.values(v.slots).filter(n => n && !isDw(n));
    const names = [...new Map([...people(), ...extra, ...mine.filter(n => !isDw(n))].map(n => [nk(n), n])).values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const dwNow = mine.filter(isDw).length;
    const r = await modal(`${FUNCS[f]} — letra ${esc(l)}`, `
      <input type="search" class="search pz-pick-search" id="pzPickQ" placeholder="Buscar nome…" autocomplete="off">
      <div class="pz-pick-list" id="pzPickList">${names.map(n => `<label class="pz-int-row"><input type="checkbox" data-pick="${esc(n)}" ${mineSet.has(nk(n)) ? 'checked' : ''}>
        <span class="pz-int-name">${esc(n)}</span><span class="muted small">${where.has(nk(n)) ? esc(where.get(nk(n))) : ''}</span></label>`).join('')}</div>
      <div class="pz-int-form"><label>Diaristas nesta lista <input type="number" id="pzPickDw" min="0" max="50" value="${dwNow}"></label></div>
      <div class="muted small" id="pzPickCount"></div>`,
      [['cancel', 'Cancelar', 'btn-ghost'], ['ok', 'Aplicar', 'btn-primary solid']],
      dlg => {
        const count = () => { dlg.querySelector('#pzPickCount').textContent = `${dlg.querySelectorAll('#pzPickList input:checked').length} pessoa(s) + ${+dlg.querySelector('#pzPickDw').value || 0} diarista(s)`; };
        dlg.querySelector('#pzPickQ').addEventListener('input', e => {
          const q = nk(e.target.value);
          dlg.querySelectorAll('#pzPickList label').forEach(x => { x.hidden = !!q && !nk(x.textContent).includes(q); });
        });
        dlg.addEventListener('change', count); count();
        setTimeout(() => dlg.querySelector('#pzPickQ').focus(), 0);
      },
      dlg => ({ picked: [...dlg.querySelectorAll('#pzPickList input:checked')].map(i => i.dataset.pick), dw: Math.max(0, Math.min(50, parseInt(dlg.querySelector('#pzPickDw').value, 10) || 0)) }));
    if (!r || r.btn !== 'ok') return;
    // Mantém a ordem de quem já estava; os novos entram no fim.
    const pickedSet = new Set(r.data.picked.map(nk));
    const keep = mine.filter(n => !isDw(n) && pickedSet.has(nk(n)));
    const added = r.data.picked.filter(n => !mineSet.has(nk(n)));
    const busy = added.filter(n => where.has(nk(n)));
    let q = { btn: 'keep' };
    if (busy.length) {
      q = await modal('Colaborador já está em outra função', `<p>${busy.map(n => `<b>${esc(n)}</b> está em <b>${esc(where.get(nk(n)))}</b>`).join('<br>')}</p>
        <p class="muted">Deseja retirá-los de lá?${modoTroca() ? '' : ' Se a pessoa trocou de função durante o turno, cancele e use <b>⏱ Troca de função</b>.'}</p>`,
        [['cancel', 'Cancelar', 'btn-ghost'], ['keep', 'Manter nas duas', 'btn-ghost'], ['move', 'Retirar de lá', 'btn-primary solid']]);
      if (q.btn === 'cancel') return;
    }
    const ed = beginEdit(), ev = ed.v;
    if (q.btn === 'move') {
      const out = new Set(busy.map(nk));
      // Tira das outras vagas; as listas (sorting/auditoria) são reorganizadas sem buracos.
      Object.keys(ev.slots).forEach(k => { if (ev.slots[k] && out.has(nk(ev.slots[k])) && !k.startsWith(`${f}.${l}.`)) delete ev.slots[k]; });
      L.letras.forEach(x => ['s2', 'aud'].forEach(g => { if (g === f && x === l) return; const ns = Object.keys(ev.slots).filter(k => k.startsWith(`${g}.${x}.`)).sort((a, b) => +a.split('.')[2] - +b.split('.')[2]).map(k => ev.slots[k]).filter(Boolean); setList(g, x, ns, ev); }));
    }
    setList(f, l, [...keep, ...added, ...Array(r.data.dw).fill(DIARISTA)], ev);
    endEdit(ed); drawMapa();
  }
  const intCard = () => { const ks = intKeys(cur()); return ks.length ? `<section class="card pz-card pz-int">${cardHead('☕ Intervalo', 'func:int')}${ks.map(k => slotInput(k)).join('')}</section>` : ''; };
  // XPT: cada vaga é um XPT (destino) para o turno inteiro; quem está na vaga bipa os pacotes daquele XPT.
  const xptDest = () => (st.map.xptDest = st.map.xptDest || {});
  // XPTs de uma vaga: lista (mapas antigos guardavam um texto só).
  const destsOf = (map, k) => { const d = (map.xptDest || {})[k]; return [...new Set((Array.isArray(d) ? d : d ? [d] : []).map(x => xptBase(x)).filter(Boolean))]; };
  const allDests = map => Object.keys(map.xptDest || {}).flatMap(k => destsOf(map, k));
  // Nome do XPT só com o começo: "XPT-SMD-01-X" → "XPT-SMD"; "smd" → "XPT-SMD".
  function xptBase(d) {
    const t = String(d || '').toUpperCase().trim().replace(/[\s_]+/g, '-');
    if (!t) return '';
    const m = t.match(/^XPT-?([A-Z]+)/) || t.match(/^([A-Z]+)/);
    return m ? `XPT-${m[1]}` : t;
  }
  function knownXpts() {
    const set = new Set();
    (baseOn() ? B().mapaList() : []).forEach(r => r.map && allDests(r.map).forEach(d => set.add(d)));
    (baseOn() ? B().parcelList() : []).forEach(p => p.items.forEach(x => x.dest && /^XPT/i.test(x.dest) && set.add(xptBase(x.dest))));
    allDests(st.map).forEach(d => set.add(d));
    return [...set].sort();
  }
  // Uma linha por colaborador: o nome e, na frente, quantos XPTs ele fizer (só o começo do nome, ex.: XPT-SMD).
  const xptCard = n => `<section class="card pz-card pz-xpt">${cardHead('XPT', 'func:xpt')}
      <div class="muted small">Escolha o colaborador e coloque na frente quantos XPTs ele fizer, só pelo começo do nome (XPT-SMD vale para XPT-SMD-01, XPT-SMD-01-X…).</div>
      <datalist id="pzXptList">${knownXpts().map(d => `<option value="${esc(d)}">`).join('')}</datalist>
      ${range(n).map(k => { const key = `xpt.${k}`; return `<div class="pz-xpt-row">${slotInput(key, 'Colaborador')}
        <div class="pz-xpt-tags">${destsOf(st.map, key).map(d => `<span class="pz-tag">${esc(d)}<button data-xrm="${key}|${esc(d)}" title="Tirar ${esc(d)}" aria-label="Tirar ${esc(d)}">×</button></span>`).join('')}
          <input class="pz-xpt-add" list="pzXptList" data-xadd="${key}" placeholder="+ XPT" aria-label="Adicionar XPT" autocomplete="off"></div></div>`; }).join('')}
      <button class="tool" data-pz="xpt-row">+ Colaborador no XPT</button></section>`;
  const simpleCard = (f, title, n) => (n ? `<section class="card pz-card">${cardHead(title, `func:${f}`)}${range(n).map(k => slotInput(`${f}.${k}`)).join('')}</section>` : '');

  function layoutEditor() {
    const L = st.map.layout;
    const num = (name, v, extra = '') => `<input type="number" min="0" max="20" data-lay="${name}" value="${v}" ${extra}>`;
    return `<p class="muted small">Vale para este mapa e para os próximos (o mapa novo usa o layout do último salvo).</p>
      <div class="table-wrap"><table><thead><tr><th class="left">Mesa</th><th>Indução</th><th>Bancadas receb./etiq. (2 pessoas)</th><th>Sorting</th><th></th></tr></thead><tbody>
        ${L.mesas.map((ms, i) => `<tr><td class="left"><input type="text" data-lay="mesa.${i}.nome" value="${esc(ms.nome)}"></td>
          <td>${num(`mesa.${i}.ind`, ms.ind)}</td><td>${num(`mesa.${i}.rec`, ms.rec)}</td><td>${num(`mesa.${i}.sort`, ms.sort)}</td>
          <td><button class="tool danger" data-pz-delmesa="${i}" title="Remover mesa">Remover</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="pz-lay-row">
        <button class="tool" data-pz="add-mesa">+ Mesa</button>
        <label title="Quantas pessoas o rodízio coloca por letra (a lista aceita de 0 a 50)">2º Sorting por letra (rodízio) ${num('s2', L.s2)}</label>
        <label title="Quantas pessoas o rodízio coloca por letra (a lista aceita de 0 a 50)">Auditoria por letra (rodízio) ${num('aud', L.aud)}</label>
        <span class="muted small">As letras e as rotas do turno ficam no quadro do 2º Sorting e Auditoria.</span>
        <label>Descarga ${num('desc', L.desc)}</label>
        <label>XPT ${num('xpt', L.xpt || 0)}</label>
        <label>5S ${num('s5', L.s5)}</label>
      </div>`;
  }
  // Layout num modal: fechar (×) e "Layout padrão" no canto superior direito. Cada alteração já vale no mapa.
  function openLayout() {
    const dlg = document.createElement('dialog');
    dlg.className = 'pz-modal pz-layout-dlg';
    dlg.innerHTML = `<div class="settings"><div class="dlg-head"><h2>Layout do piso</h2><div class="dlg-head-tools">
      <button type="button" class="tool" data-pzl="reset">Layout padrão</button>
      <button type="button" class="dlg-x" data-pzl="close" title="Fechar" aria-label="Fechar">×</button></div></div>
      <div id="pzLayBody">${layoutEditor()}</div></div>`;
    document.body.appendChild(dlg);
    const redraw = () => { touch(); $('pzLayBody').innerHTML = layoutEditor(); drawMapa(); };
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dlg.addEventListener('click', async e => {
      const t = e.target.closest('[data-pzl],[data-pz],[data-pz-delmesa]');
      if (!t) return;
      const d = t.dataset, L = st.map.layout;
      if (d.pzl === 'close') close();
      else if (d.pzl === 'reset') { if (await uiConfirm('Voltar ao layout padrão (4 mesas, letras A-L)?')) { st.map.layout = clone(DEFAULT_LAYOUT); redraw(); } }
      else if (d.pzDelmesa != null) { if (await uiConfirm(`Remover ${L.mesas[+d.pzDelmesa].nome}?`)) { L.mesas.splice(+d.pzDelmesa, 1); redraw(); } }
      else if (d.pz === 'add-mesa') {
        const n = Math.max(0, ...L.mesas.map(m => +String(m.id).slice(1) || 0)) + 1;
        L.mesas.push({ id: 'm' + n, nome: `Mesa ${L.mesas.length + 1}`, ind: 2, rec: 2, sort: 2 }); redraw();
      }
    });
    dlg.addEventListener('change', e => {
      const t = e.target, lay = t.dataset.lay;
      if (!lay) return;
      const L = st.map.layout, p = lay.split('.');
      const n = Math.max(0, Math.min(20, parseInt(t.value, 10) || 0));
      if (p[0] === 'mesa') { if (p[2] === 'nome') L.mesas[+p[1]].nome = t.value.trim() || L.mesas[+p[1]].nome; else L.mesas[+p[1]][p[2]] = n; }
      else if (p[0] === 'letras') L.letras = parseLetras(t.value);
      else if (p[0] === 'rotas') L.rotas = Math.max(1, Math.min(99, parseInt(t.value, 10) || 20));
      else if (p[0] === 'rotasLetra') L.rotasLetra = Object.fromEntries((t.value.toUpperCase().match(/[A-Z]{1,2}\s*[=:]\s*\d+/g) || []).map(x => { const [k, v] = x.split(/\s*[=:]\s*/); return [k, Math.max(1, Math.min(99, +v))]; }));
      else L[p[0]] = n;
      redraw();
    });
    dlg.showModal();
  }

  // Painel lateral: quem está sem função, quem está em mais de uma vaga, e quantos por função.
  function drawSide() {
    const el = $('pzSide');
    if (!el) return;
    const v = cur(), slots = slotsOf(st.map.layout, v);
    const filled = slots.filter(s => v.slots[s.key]);
    const byName = new Map();
    const nDw = filled.filter(s => isDw(v.slots[s.key])).length;
    filled.filter(s => !isDw(v.slots[s.key])).forEach(s => { const k = nk(v.slots[s.key]); byName.set(k, [...(byName.get(k) || []), s]); });
    // Vários XPTs com a mesma pessoa contam como uma função só (uma pessoa pode fazer mais de um XPT).
    const multi = a => a.filter(s => s.func !== 'xpt').length + (a.some(s => s.func === 'xpt') ? 1 : 0) > 1;
    const dup = [...byName.entries()].filter(([, a]) => multi(a));
    const inInt = new Set(intKeys(v).map(k => nk(v.slots[k])));
    const onBoard = ['s2', 'aud'].flatMap(f => bPeople(f).filter(x => x.to !== 'int' && !isDw(x.n)));
    onBoard.forEach(x => { const k = nk(x.n); byName.set(k, [...(byName.get(k) || []), { func: x.to === 'pool' ? 's2' : 's2', board: true }]); });
    ['s2', 'aud'].forEach(f => bPeople(f).filter(x => x.to === 'int').forEach(x => inInt.add(nk(x.n))));
    const free = people().filter(n => !byName.has(nk(n)) && !inInt.has(nk(n)));
    const perFunc = Object.keys(FUNCS).map(f => [f, filled.filter(s => s.func === f).length, slots.filter(s => s.func === f).length]).filter(x => x[2]);
    document.querySelectorAll('.pz-slot input').forEach(i => {
      const k = nk(i.value);
      i.classList.toggle('dup', !!k && !isDw(i.value) && multi(byName.get(k) || []));
    });
    // Painel recolhido: só uma faixa com o botão para abrir (a escolha fica salva no aparelho).
    if (ls.sideOff) {
      el.innerHTML = `<button class="pz-side-open" data-pz="side" title="Mostrar resumo e sem função">◂ <span>Resumo · ${byName.size} em função · ${free.length} sem função${dup.length ? ` · ⚠ ${dup.length}` : ''}</span></button>`;
      return;
    }
    el.innerHTML = `
      <section class="card pz-card"><div class="pz-side-head"><div class="pz-title">Resumo · ${esc(verLabel(v))}</div>
        <button class="tool" data-pz="side" title="Recolher o painel">Recolher ▸</button></div>
        <div class="pz-kv"><span>Pessoas em função</span><b>${byName.size}</b></div>
        ${nDw ? `<div class="pz-kv"><span>Diaristas</span><b>${nDw}</b></div>` : ''}
        ${inInt.size ? `<div class="pz-kv"><span>Em intervalo</span><b>${inInt.size}</b></div>` : ''}
        ${perFunc.filter(([f]) => f !== 's2' && f !== 'aud').map(([f, n, t]) => `<div class="pz-kv"><span>${FUNCS[f]}</span><b>${n}/${t}</b></div>`).join('')}
        ${['s2', 'aud'].map(f => { const ps = bPeople(f).filter(x => x.to !== 'int'); const nl = ps.filter(x => x.to !== 'pool').length;
          return `<div class="pz-kv"><span>${BF[f]}</span><b title="em letra / no quadro">${nl}/${ps.length}</b></div>`; }).join('')}
      </section>
      ${dup.length ? `<section class="card pz-card"><div class="pz-title">Em mais de uma vaga</div>
        ${dup.map(([, a]) => `<div class="pz-warn">⚠ ${esc(v.slots[a[0].key])} <span class="muted small">(${a.map(s => FUNCS[s.func]).join(', ')})</span></div>`).join('')}
        <div class="muted small">Se a pessoa mudou de função durante o turno, use <b>⏱ Troca de função</b> com o horário.</div></section>` : ''}
      <section class="card pz-card"><div class="pz-title">Sem função <span class="muted">(${free.length})</span></div>
        <input class="search" id="pzFree" type="search" placeholder="Buscar…">
        <div class="pz-free" id="pzFreeList">${free.map(n => `<div>${esc(n)}</div>`).join('') || '<span class="muted small">Todos da lista HSE estão no mapa.</span>'}</div>
        <div class="muted small">Lista da guia HSE do mês atual.</div></section>`;
  }

  // ---------- Versões salvas (restaurar um salvamento anterior) ----------
  async function openVersions() {
    const hist = B().mapaHistory(st.date, st.turno);
    const fmt = iso => new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const ppl = m => new Set(m.versions.flatMap(v => Object.values(v.slots || {}).filter(Boolean).map(nk))).size;
    const r = await modal(`Versões salvas — ${brShort(st.date)} · ${st.turno}`, `<p class="muted">Escolha um salvamento. <b>Juntar</b> completa o mapa em edição com o que só existe nele (ex.: duas pessoas montaram partes diferentes e uma salvou por cima da outra); <b>Restaurar</b> volta exatamente a ele. Depois, clique em <b>Salvar mapa</b> para confirmar.</p>
      <div class="pz-pick-list">${hist.map((h, i) => `<label class="pz-int-row"><input type="radio" name="pzVer" value="${i}" ${i === 0 ? 'checked' : ''}>
        <span class="pz-int-name">${fmt(h.at)} · ${esc(h.user)}${i === 0 ? ' <span class="pill good">mais recente</span>' : ''}</span>
        <span class="muted small">${h.map.versions.length} mudança(s) · ${ppl(h.map)} pessoa(s)</span></label>`).join('')}</div>`,
      [['cancel', 'Cancelar', 'btn-ghost'], ['ok', 'Restaurar esta versão', 'btn-ghost'], ['merge', 'Juntar com o mapa em edição', 'btn-primary solid']], null,
      dlg => +((dlg.querySelector('input[name="pzVer"]:checked') || {}).value || 0));
    if (!r || (r.btn !== 'ok' && r.btn !== 'merge')) return;
    if (r.btn === 'merge') {
      // Sem base: o que está em edição fica; o salvamento escolhido completa as vagas vazias e as mudanças que faltam.
      st.map = mergeMaps(null, st.map, clone(hist[r.data].map));
      st.ver = 0; st.undo = null; touch(); drawMapa();
      return ui.toast(`Juntado com o salvamento de ${fmt(hist[r.data].at)} (${hist[r.data].user}). Confira e clique em Salvar mapa.`);
    }
    st.map = clone(hist[r.data].map);
    if (!st.map.layout || !st.map.layout.mesas) st.map.layout = clone(DEFAULT_LAYOUT);
    st.ver = 0; st.undo = null; touch(); drawMapa();
    ui.toast(`Versão de ${fmt(hist[r.data].at)} restaurada. Confira e clique em Salvar mapa.`);
  }

  // ---------- Sexo presumido pelo primeiro nome (regra do rodízio) ----------
  // Descarga, Indução e a mesa de volumoso são feitas só por homens. Não há cadastro: o app presume pelo primeiro nome
  // e mostra a lista para o líder revisar antes do rodízio. Nome sem como saber fica como "?" (não entra nessas vagas).
  // As correções do líder ficam lembradas neste aparelho (ls.sexo).
  const F_NAMES = new Set('ALICE BEATRIZ CARMEN ELLEN ESTHER EVELYN INGRID IRIS ISABEL ISIS IVONE KAREN KELLY LIZ MABEL MIRIAM NOEMI RAQUEL RUTH SUELEN SUELLEN TAIS THAIS JANE JENIFER JENNIFER JHENIFER MARIZE ROSE INES INEZ ASHLEY EMILY EMILLY STEFANY STEPHANY TIFFANY LUANY GISELE GIZELE ADRIELLY'.split(' '));
  const M_NAMES = new Set('KAUA LUCA NICOLA JOSUA ISAIA JOSE DAVI LEVI HENRY WESLEY WESLLEY WESLEI RAMON SOLANO GERSON EVERTON WELINGTON WELLINGTON ALEX ROBERT JOAO'.split(' '));
  const AMBIG = new Set('ARIEL DARCI JURACI VALDECI ALDACI GILDACI DENI DENIS DIVANI ADAIR ALTAIR CLAUDI ELI DJANIR JACI'.split(' '));
  function presumeSex(name) {
    const first = nk(name).split(' ')[0] || '';
    if (!first || isDw(name)) return '';
    if (AMBIG.has(first) || /CI$/.test(first)) return '';
    if (F_NAMES.has(first)) return 'F';
    if (M_NAMES.has(first)) return 'M';
    if (/(A|ANE|ANNE|AINE|IANE|ENE|INE|ELE|ELLE|ETE|ICE|ISE|IDE|EIDE|LY|LLY|NY|ELY)$/.test(first)) return 'F';
    if (/(O|OS|EL|AEL|UEL|ON|OR|ER|AS|IO|EU|ES|IR|UR|AN|EN|IM|UL|IL|E|US|IZ|ARD|RT|NT|K|C|D|X|Z|G|B|P|T|H|M)$/.test(first)) return 'M';
    return '';
  }
  const sexOf = n => { const o = (ls.sexo || {})[nk(n)]; return o != null ? o : presumeSex(n); };
  const isMale = n => sexOf(n) === 'M';
  // Revisão antes do rodízio: lista quem entra, com o sexo presumido (o líder corrige o que estiver errado).
  async function reviewSex(pool, title) {
    const rows = pool.filter(n => !isDw(n)).slice().sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const lab = { M: 'Homem', F: 'Mulher', '': 'Não sei' };
    const r = await modal(title, `<p class="muted">Descarga, Indução e a mesa de volumoso só recebem <b>homens</b>. O sexo abaixo é <b>presumido pelo nome</b>: confira e corrija antes de continuar. Quem ficar como "Não sei" não entra nessas vagas.</p>
      <input type="search" class="search pz-pick-search" id="pzSexQ" placeholder="Buscar nome…" autocomplete="off">
      <div class="pz-pick-list" id="pzSexList">${rows.map(n => { const o = (ls.sexo || {})[nk(n)], v = sexOf(n); return `<div class="pz-col-row" data-colrow="${esc(nk(n))}"><span class="pz-int-name">${esc(n)}${o != null ? ' <span class="muted small">(corrigido)</span>' : ''}</span>
        <select data-sexo="${esc(n)}" data-was="${v}" class="${v ? '' : 'unk'}">${['M', 'F', ''].map(k => `<option value="${k}" ${k === v ? 'selected' : ''}>${lab[k]}</option>`).join('')}</select></div>`; }).join('')}</div>
      <div class="muted small" id="pzSexCount"></div>`,
      [['cancel', 'Cancelar', 'btn-ghost'], ['ok', 'Fazer o rodízio', 'btn-primary solid']],
      dlg => {
        const count = () => { const v = [...dlg.querySelectorAll('[data-sexo]')].map(x => x.value); dlg.querySelector('#pzSexCount').textContent = `${v.filter(x => x === 'M').length} homem(ns) · ${v.filter(x => x === 'F').length} mulher(es) · ${v.filter(x => !x).length} sem como saber`; };
        dlg.querySelector('#pzSexQ').addEventListener('input', e => { const q = nk(e.target.value); dlg.querySelectorAll('[data-colrow]').forEach(x => { x.hidden = !!q && !x.dataset.colrow.includes(q); }); });
        dlg.addEventListener('change', e => { if (e.target.dataset.sexo != null) e.target.classList.toggle('unk', !e.target.value); count(); }); count();
      },
      dlg => [...dlg.querySelectorAll('[data-sexo]')].filter(x => x.value !== x.dataset.was).map(x => [x.dataset.sexo, x.value]));
    if (!r || r.btn !== 'ok') return false;
    if (r.data.length) {
      ls.sexo = ls.sexo || {};
      // Guarda só o que diverge do presumido (se o líder voltou ao presumido, esquece a correção).
      r.data.forEach(([n, v]) => { if (v === presumeSex(n)) delete ls.sexo[nk(n)]; else ls.sexo[nk(n)] = v; });
      lsSave();
    }
    return true;
  }

  // Quem fez um XPT num dia (todas as mudanças e turnos do dia, ou só um turno). O XPT vale pelo começo do nome
  // (xptBase): quem fez o XPT-SMD responde pelos pacotes do XPT-SMD-01, XPT-SMD-01-X, XPT-SMD-02…
  const sameXpt = (a, b) => { const x = xptBase(a), y = xptBase(b); return !!x && x === y; };
  function xptWho(iso, dest, turno) {
    const out = new Map();
    (baseOn() ? B().mapaList() : []).filter(r => r.date === iso && (!turno || r.turno === turno) && r.map).forEach(r => {
      const keys = Object.keys(r.map.xptDest || {}).filter(k => destsOf(r.map, k).some(d => sameXpt(d, dest)));
      r.map.versions.forEach(v => keys.forEach(k => { const n = v.slots[k]; if (n && !out.has(nk(n))) out.set(nk(n), n); }));
    });
    return [...out.values()];
  }

  // ---------- Rodízio ----------
  // Histórico dos últimos 10 dias: quantas vezes cada pessoa fez cada função, a função do último mapa dela,
  // quem trabalhou neste turno (para preencher um mapa vazio) e quais vagas costumam ser usadas.
  function history() {
    const cnt = new Map(), last = new Map(), pool = new Map(), useSlot = new Map();
    const from = new Date(st.date + 'T12:00:00'); from.setDate(from.getDate() - HIST_DAYS);
    const fromIso = from.toISOString().slice(0, 10);
    (baseOn() ? B().mapaList() : []).filter(r => r.date >= fromIso && `${r.date}|${r.turno}` < `${st.date}|${st.turno}`).forEach(r => {
      const did = new Map();
      r.map.versions.forEach(v => Object.entries(v.slots || {}).forEach(([key, name]) => {
        const f = funcOf(key);
        if (!name || f === 'int' || isDw(name)) return;
        const k = nk(name);
        if (!did.has(k)) did.set(k, new Set());
        did.get(k).add(f);
        if (r.turno === st.turno) { pool.set(k, name); useSlot.set(key, (useSlot.get(key) || 0) + 1); }
      }));
      ['s2', 'aud'].forEach(f => ((r.map.board || {})[f] || []).forEach(e => {
        if (!e.to || e.to === 'pool' || e.to === 'int' || isDw(e.n)) return;
        const k = nk(e.n);
        if (!did.has(k)) did.set(k, new Set());
        did.get(k).add(f);
        if (r.turno === st.turno) pool.set(k, e.n);
      }));
      did.forEach((fs, k) => {
        const c = cnt.get(k) || {};
        fs.forEach(f => { c[f] = (c[f] || 0) + 1; });
        cnt.set(k, c);
      });
      const lv = sortedVers(r.map).filter(v => v.tipo !== 'intervalo').pop();
      if (lv) Object.entries(lv.slots || {}).forEach(([key, name]) => { if (name && funcOf(key) !== 'int') last.set(nk(name), funcOf(key)); });
    });
    return { cnt, last, pool, useSlot };
  }
  // Mapa já preenchido: redistribui as mesmas pessoas. Mapa vazio: preenche com quem trabalhou neste turno
  // nos últimos 10 dias, cada um numa função diferente das que fez. Vagas com 🔒 e o intervalo ficam como estão.
  async function rodizio() {
    const v = cur(), slots = slotsOf(st.map.layout, v);
    const { cnt, last, pool: hPool, useSlot } = history();
    const locked = new Set(slots.filter(s => st.locks.has(s.key) && v.slots[s.key]).map(s => nk(v.slots[s.key])));
    intKeys(v).forEach(k => locked.add(nk(v.slots[k])));
    let target = slots.filter(s => v.slots[s.key] && !st.locks.has(s.key) && !isDw(v.slots[s.key]));
    let pool, mode;
    if (target.length) {
      pool = [...new Map(target.map(s => [nk(v.slots[s.key]), v.slots[s.key]])).values()];
      mode = 'redistribuir';
    } else {
      pool = [...hPool.entries()].filter(([k]) => !locked.has(k)).map(([, n]) => canon(n));
      if (!pool.length) return ui.toast(`Sem mapas do turno ${st.turno} nos últimos ${HIST_DAYS} dias para montar o rodízio. Preencha o mapa e use o rodízio para trocar as funções.`, true);
      // Vagas mais usadas nos últimos dias primeiro (o rodízio preenche o que a operação costuma abrir).
      target = slots.filter(s => !st.locks.has(s.key) && !v.slots[s.key])
        .sort((x, y) => (useSlot.get(y.key) || 0) - (useSlot.get(x.key) || 0) || slots.indexOf(x) - slots.indexOf(y))
        .slice(0, pool.length);
      mode = 'preencher';
    }
    if (target.length < 1) return ui.toast('Não há vagas livres para o rodízio (solte as vagas com 🔒).', true);
    if (!(await reviewSex(pool, mode === 'preencher' ? `Rodízio — ${pool.length} pessoa(s) do turno ${st.turno} (últimos ${HIST_DAYS} dias)` : `Rodízio — ${pool.length} pessoa(s) desta mudança`))) return;
    const now = new Map(target.filter(s => v.slots[s.key]).map(s => [nk(v.slots[s.key]), s.func]));
    const ed = beginEdit(), ev = ed.v;
    const left = new Set(pool);
    // Descarga, Indução e mesa de volumoso só com homens (cadastro de Colaboradores). Essas vagas são preenchidas primeiro.
    const volum = new Set(st.map.layout.mesas.filter(m => /volum/i.test(m.nome)).map(m => m.id));
    const heavy = sl => sl.func === 'desc' || sl.func === 'ind' || volum.has(sl.mesa);
    const useSex = true;
    let semHomem = 0;
    target.slice().sort(() => Math.random() - 0.5).sort((x, y) => (useSex ? heavy(y) - heavy(x) : 0)).forEach(s => {
      let best = null, bestScore = Infinity;
      left.forEach(n => {
        if (useSex && heavy(s) && !isMale(n)) return;
        const k = nk(n);
        const score = ((cnt.get(k) || {})[s.func] || 0) * 2 + (last.get(k) === s.func ? 6 : 0) + (now.get(k) === s.func ? 3 : 0) + Math.random() * 0.5;
        if (score < bestScore) { bestScore = score; best = n; }
      });
      if (best != null) { ev.slots[s.key] = best; left.delete(best); } else { delete ev.slots[s.key]; if (useSex && heavy(s)) semHomem++; }
    });
    const changed = target.filter(s => nk(ed.before[s.key]) !== nk(ev.slots[s.key])).length;
    endEdit(ed, true); drawMapa();
    if (semHomem) ui.toast(`Rodízio: ${semHomem} vaga(s) de Descarga/Indução/volumoso ficaram vazias por falta de homens. Preencha à mão.`, true);
    else ui.toast(mode === 'preencher'
      ? `Rodízio: ${target.length - left.size} pessoa(s) do turno ${st.turno} (últimos ${HIST_DAYS} dias) colocadas em funções diferentes. Confira quem veio hoje e salve.`
      : `Rodízio: ${changed} vaga(s) mudaram. Confira e clique em Salvar mapa.`);
  }

  // ---------- Intervalo ----------
  // 1ª leva: volumoso, descarga e 1º sorting primeiro; 2ª leva: recebimento/etiquetagem primeiro.
  // Cada pessoa tira um intervalo por dia (vale para todos os turnos do dia).
  function intervaloHoje() {
    const done = new Set();
    const maps = (baseOn() ? B().mapaList() : []).filter(r => r.date === st.date && r.turno !== st.turno).map(r => r.map).concat([st.map]);
    maps.forEach(m => { m.versions.forEach(v => intKeys(v).forEach(k => done.add(nk(v.slots[k])))); ['s2', 'aud'].forEach(f => ((m.board || {})[f] || []).forEach(e => { if (e.to === 'int') done.add(nk(e.n)); })); });
    return done;
  }
  function intervaloSugestao(n) {
    const v = cur(), L = st.map.layout, slots = slotsOf(L, v);
    const leva = st.map.versions.some(x => x.tipo === 'intervalo') ? 2 : 1;
    const done = intervaloHoje();
    const volum = new Set(L.mesas.filter(m => /volum/i.test(m.nome)).map(m => m.id));
    const prio = s => {
      if (leva === 1) return volum.has(s.mesa) || s.func === 'desc' ? 0 : s.func === 'sort' ? 1 : s.func === 'rec' ? 5 : 3;
      return s.func === 'rec' ? 0 : 2;
    };
    const cands = slots.filter(s => v.slots[s.key] && !isDw(v.slots[s.key])).map(s => ({ key: s.key, name: v.slots[s.key], func: s.func, where: slotDesc(s.key, L), prio: prio(s), done: done.has(nk(v.slots[s.key])) }));
    ['s2', 'aud'].forEach(f => bPeople(f).filter(x => x.to !== 'int' && !isDw(x.n)).forEach(x => cands.push({ key: `board.${f}`, name: x.n, func: f,
      where: `${BF[f]} · ${x.to === 'pool' ? 'disponível' : `letra ${x.to}`}`, prio: prio({ func: f }), done: done.has(nk(x.n)), board: f, letra: x.to })));
    // Uma linha por pessoa (a primeira vaga dela).
    const uniq = [...new Map(cands.map(c => [nk(c.name), c])).values()];
    const avail = uniq.filter(c => !c.done);
    // Escolhe pela prioridade, espalhando entre funções (não esvazia uma função inteira de uma vez).
    const picked = [], perFunc = new Map();
    const pool = avail.slice();
    while (picked.length < n && pool.length) {
      pool.sort((x, y) => (x.prio + (perFunc.get(x.func) || 0) * 0.6) - (y.prio + (perFunc.get(y.func) || 0) * 0.6) || x.name.localeCompare(y.name, 'pt-BR'));
      const c = pool.shift();
      picked.push(c); perFunc.set(c.func, (perFunc.get(c.func) || 0) + 1);
    }
    return { leva, all: uniq.sort((x, y) => x.prio - y.prio || x.name.localeCompare(y.name, 'pt-BR')), picked: new Set(picked.map(c => nk(c.name))) };
  }
  async function intervalo() {
    const v = cur(), slots = slotsOf(st.map.layout, v);
    const alocados = new Set([...slots.filter(s => v.slots[s.key] && !isDw(v.slots[s.key])).map(s => nk(v.slots[s.key])),
      ...['s2', 'aud'].flatMap(f => bPeople(f).filter(x => x.to !== 'int' && !isDw(x.n)).map(x => nk(x.n)))]).size;
    if (!alocados) return ui.toast('O mapa desta mudança está vazio.', true);
    let n = Math.min(alocados, Math.max(1, Math.round(alocados / 2)));
    let sug = intervaloSugestao(n);
    const listHtml = () => sug.all.map(c => `<label class="pz-int-row ${c.done ? 'muted' : ''}"><input type="checkbox" data-int-name="${esc(c.name)}" data-int-key="${c.key}" ${sug.picked.has(nk(c.name)) ? 'checked' : ''} ${c.done ? 'disabled' : ''}>
      <span class="pz-int-name">${esc(c.name)}</span><span class="muted small">${esc(c.where)}${c.done ? ' · já fez intervalo hoje' : ''}</span></label>`).join('');
    const end = (hm, min) => { const [h, m] = hm.split(':').map(Number), t = h * 60 + m + min; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
    const r = await modal(`☕ Intervalo — ${sug.leva}ª leva`, `
      <p class="muted">Na mudança atual (${esc(verLabel(v))}) há <b>${alocados}</b> pessoa(s) em função.
        ${sug.leva === 1 ? 'Na 1ª leva vão primeiro volumoso, descarga e 1º sorting.' : 'Na 2ª leva vão primeiro recebimento e etiquetagem.'} Quem já fez intervalo hoje não entra.</p>
      <div class="pz-int-form">
        <label>Pessoas no intervalo <input type="number" id="pzIntN" min="1" max="${alocados}" value="${n}"></label>
        <label>Horário <input type="time" id="pzIntAt" value="${nowHm()}"></label>
        <label>Duração (min) <input type="number" id="pzIntDur" min="10" max="180" value="60"></label>
        <label class="pz-int-check"><input type="checkbox" id="pzIntBack" checked> Criar a volta do intervalo</label>
      </div>
      <div class="pz-int-list" id="pzIntList">${listHtml()}</div>
      <div class="muted small" id="pzIntCount"></div>`,
      [['cancel', 'Cancelar', 'btn-ghost'], ['ok', 'Criar intervalo', 'btn-primary solid']],
      dlg => {
        const count = () => { const k = dlg.querySelectorAll('#pzIntList input:checked').length; dlg.querySelector('#pzIntCount').textContent = `${k} selecionada(s)`; };
        dlg.querySelector('#pzIntN').addEventListener('change', e => {
          n = Math.max(1, Math.min(alocados, parseInt(e.target.value, 10) || 1)); e.target.value = n;
          sug = intervaloSugestao(n); dlg.querySelector('#pzIntList').innerHTML = listHtml(); count();
        });
        dlg.querySelector('#pzIntList').addEventListener('change', count);
        count();
      },
      dlg => ({ names: [...dlg.querySelectorAll('#pzIntList input:checked')].map(i => i.dataset.intName), at: dlg.querySelector('#pzIntAt').value || nowHm(),
        dur: Math.max(10, parseInt(dlg.querySelector('#pzIntDur').value, 10) || 60), back: dlg.querySelector('#pzIntBack').checked }));
    if (!r || r.btn !== 'ok' || !r.data.names.length) return;
    const taken = hm => st.map.versions.some(x => x.from === hm);
    if (taken(r.data.at) || (r.data.back && taken(end(r.data.at, r.data.dur)))) return ui.toast(`Já existe uma mudança às ${taken(r.data.at) ? r.data.at : end(r.data.at, r.data.dur)}. Escolha outro horário para o intervalo.`, true);
    const go = new Set(r.data.names.map(nk));
    const base = clone(versionAt(st.map, r.data.at).slots);
    const slotsInt = {};
    Object.entries(base).forEach(([k, name]) => { if (!go.has(nk(name)) && !k.startsWith('int.')) slotsInt[k] = name; });
    r.data.names.forEach((name, i) => { slotsInt[`int.${i}`] = name; });
    st.map.versions.push({ from: r.data.at, tipo: 'intervalo', slots: slotsInt });
    // Quem está no quadro (2º Sorting / Auditoria) vai para o intervalo no quadro e volta para a mesma coluna.
    ['s2', 'aud'].forEach(f => {
      const ps = bPeople(f).filter(x => go.has(nk(x.n)) && x.to !== 'int');
      if (!ps.length) return;
      bMove(f, ps.map(x => x.n), 'int', r.data.at);
      if (r.data.back) ps.forEach(x => bMove(f, [x.n], x.to, end(r.data.at, r.data.dur)));
    });
    const iv = st.map.versions.length - 1;
    if (r.data.back) {
      const back = {};
      Object.entries(base).forEach(([k, name]) => { if (!k.startsWith('int.')) back[k] = name; });
      st.map.versions.push({ from: end(r.data.at, r.data.dur), tipo: 'volta', slots: back });
    }
    st.ver = iv; st.undo = null; touch(); drawMapa();
    ui.toast(`Intervalo das ${r.data.at} criado com ${r.data.names.length} pessoa(s)${r.data.back ? `; volta às ${end(r.data.at, r.data.dur)}` : ''}. Salve o mapa.`);
  }

  // Modal simples (dialog). onOpen(dlg) liga os campos; collect(dlg) lê os campos ao confirmar.
  function modal(title, html, buttons, onOpen, collect) {
    return new Promise(resolve => {
      const dlg = document.createElement('dialog');
      dlg.className = 'pz-modal';
      dlg.innerHTML = `<div class="settings"><h2>${title}</h2>${html}<div class="pz-modal-actions">${buttons.map(([k, l, c]) => `<button type="button" class="${c}" data-modal="${k}">${l}</button>`).join('')}</div></div>`;
      document.body.appendChild(dlg);
      const done = btn => { const data = btn !== 'cancel' && collect ? collect(dlg) : null; dlg.close(); dlg.remove(); resolve({ btn, data }); };
      dlg.addEventListener('click', e => { const b = e.target.closest('[data-modal]'); if (b) done(b.dataset.modal); });
      dlg.addEventListener('cancel', e => { e.preventDefault(); done('cancel'); });
      if (onOpen) onOpen(dlg);
      dlg.showModal();
    });
  }

  function mapText() {
    const L = st.map.layout, v = cur(), get = k => v.slots[k] || '—';
    const list = keys => keys.map(get).join(', ');
    const lines = [`Mapa de piso — ${brShort(st.date)} · ${st.turno}${v.from ? ` (${verLabel(v)})` : ''}`, ''];
    L.mesas.forEach(ms => {
      lines.push(ms.nome.toUpperCase());
      if (ms.ind) lines.push(`Indução: ${list(range(ms.ind).map(k => `${ms.id}.ind.${k}`))}`);
      range(ms.rec).forEach(s => lines.push(`Bancada ${bancadaNo(L, ms.id, s)}: ${get(`${ms.id}.rec.${s}.0`)} (recebe) + ${get(`${ms.id}.rec.${s}.1`)} (etiqueta)`));
      if (ms.sort) lines.push(`Sorting: ${list(range(ms.sort).map(k => `${ms.id}.sort.${k}`))}`);
      lines.push('');
    });
    if (L.letras.length) {
      const lst = (f, l) => { const ns = [...listKeys(v, f, l).map(get), ...bPeople(f).filter(x => x.to === l).map(x => x.n)]; return ns.length ? ns.join(', ') : '—'; };
      lines.push('2º SORTING'); L.letras.forEach(l => lines.push(`${l}: ${lst('s2', l)}`)); lines.push('');
      lines.push('AUDITORIA'); L.letras.forEach(l => lines.push(`${l}: ${lst('aud', l)}`)); lines.push('');
    }
    if (L.desc) lines.push(`Descarga: ${list(range(L.desc).map(k => `desc.${k}`))}`);
    if (L.xpt) range(L.xpt).forEach(k => { const ds = destsOf(st.map, `xpt.${k}`); if (ds.length || v.slots[`xpt.${k}`]) lines.push(`XPT ${get(`xpt.${k}`)}: ${ds.join(', ') || '—'}`); });
    if (L.s5) lines.push(`5S: ${list(range(L.s5).map(k => `s5.${k}`))}`);
    const disp = ['s2', 'aud'].flatMap(f => bPeople(f).filter(x => x.to === 'pool').map(x => x.n));
    if (disp.length) lines.push(`Disponíveis (2º Sorting/Auditoria): ${disp.join(', ')}`);
    if (intKeys(v).length) lines.push(`Intervalo: ${list(intKeys(v))}`);
    return lines.join('\n').trim();
  }
  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    ui.toast(msg);
  }

  async function saveMap() {
    if (!baseOn()) return;
    // Antes de gravar, busca o que outra pessoa salvou deste dia/turno e junta com a nossa edição (senão uma apagaria a outra).
    await B().load(true);
    const latest = B().mapaGet(st.date, st.turno);
    let juntou = null;
    if (latest && latest.at !== st.baseAt) {
      const base = st.baseAt ? (B().mapaHistory(st.date, st.turno).find(h => h.at === st.baseAt) || {}).map : null;
      st.map = mergeMaps(base, st.map, latest.map);
      st.ver = Math.min(st.ver, st.map.versions.length - 1);
      juntou = latest;
    }
    // Só grava as vagas que existem no layout atual.
    st.map.versions.forEach(v => { const keys = new Set(slotsOf(st.map.layout, v).map(s => s.key)); Object.keys(v.slots).forEach(k => { if ((!keys.has(k) && !k.startsWith('int.')) || !v.slots[k]) delete v.slots[k]; }); });
    const first = !latest;
    try {
      const sv = await B().mapaSave(st.date, st.turno, clone(st.map));
      st.baseAt = sv ? sv.at : null;
      if (ls.drafts) { delete ls.drafts[`${st.date}|${st.turno}`]; lsSave(); }
      st.dirty = false;
      // Primeiro salvamento do mapa de hoje: o turno começou, então passa para Troca de função (dá para voltar a Corrigir).
      if (first && isToday() && !modoTroca()) { st.modo = 'troca'; st.mt = ''; st.undo = null; }
      if (juntou) ui.toast(`Mapa salvo e juntado com o que ${juntou.user} salvou às ${new Date(juntou.at).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}. Confira.`);
      else ui.toast(`Mapa de ${brShort(st.date)} · ${st.turno} salvo${st.modo === 'troca' && first ? '. Agora as alterações viram troca de função com horário (use ✏️ Corrigir para arrumar erros).' : ''}`);
      drawMapa();
    } catch (e) { ui.toast(String(e.message || e), true); }
  }

  async function onMapaClick(e) {
    const t = e.target.closest('[data-pz],[data-pz-ver],[data-pz-modo],[data-tl],[data-xrm],[data-baj],[data-rt-sug],[data-lock],[data-pz-pick],[data-pz-rm],[data-pz-clear],[data-bf],[data-bcard],[data-brm],[data-bpick],[data-bdw],[data-bto],[data-bclear],[data-pz-view],[data-board-toggle],[data-legacy-toggle],[data-pd-t],[data-pd-f]');
    if (!t) return;
    const d = t.dataset;
    if (d.lock) { if (!st.locks.delete(d.lock)) st.locks.add(d.lock); t.classList.toggle('on', st.locks.has(d.lock)); t.textContent = st.locks.has(d.lock) ? '🔒' : '🔓'; return; }
    if (d.pdT || d.pdF) {
      const key = d.pdT ? 'dTurnos' : 'dFuncs', val = d.pdT || d.pdF, set = new Set(Array.isArray(ls[key]) ? ls[key] : []);
      if (val === 'all') set.clear(); else if (!set.delete(val)) set.add(val);
      ls[key] = [...set]; lsSave(); drawMapaDash(); return;
    }
    if (d.pzView) { ls.mview = d.pzView; lsSave(); drawMapa(); return; }
    if (d.pzClear) { clearArea(d.pzClear); return; }
    if (d.boardToggle) { st.boardOpen = !st.boardOpen; drawMapa(); return; }
    if (d.legacyToggle) { st.legacyOpen = !st.legacyOpen; drawMapa(); return; }
    if (d.bf) { st.bf = d.bf; st.bsel.clear(); drawMapa(); return; }
    if (d.brm) { bMove(st.bf, [d.brm], ''); st.bsel.delete(nk(d.brm)); drawMapa(); return; }
    if (d.bcard) { const k = nk(d.bcard); if (!st.bsel.delete(k)) st.bsel.add(k); drawMapa(); return; }
    if (d.bpick) { boardPick(); return; }
    if (d.bdw) { bMove(st.bf, [DIARISTA + ' ' + (bPeople(st.bf).filter(x => isDw(x.n)).length + 1)], 'pool'); drawMapa(); return; }
    if (d.bclear) { st.bsel.clear(); drawMapa(); return; }
    if (d.bto) {
      const names = boardAll(st.bf).filter(x => st.bsel.has(nk(x.n))).map(x => x.n);
      bMove(st.bf, names, d.bto); st.bsel.clear(); drawMapa(); return;
    }
    if (d.pzPick) { const [f, l] = d.pzPick.split('.'); openPicker(f, l); return; }
    if (d.pzRm) {
      const [f, l] = d.pzRm.split('.'), v = cur(), names = listKeys(v, f, l).filter(k => k !== d.pzRm).map(k => v.slots[k]);
      const ed = beginEdit(); setList(f, l, names, ed.v); endEdit(ed);
      touch(); drawMapa(); return;
    }
    if (d.tl) { ls.tlOff = !ls.tlOff; lsSave(); return; }
    if (d.baj) { ajustarRotas(d.baj); return; }
    if (d.rtSug) { setRotas('de', d.rtSug); return; }
    if (d.xrm) {
      const [key, dest] = d.xrm.split('|'), ds = destsOf(st.map, key).filter(x => x !== dest);
      if (ds.length) xptDest()[key] = ds; else delete xptDest()[key];
      touch(); drawMapa(); return;
    }
    if (d.pzModo) {
      st.modo = d.pzModo; st.undo = null;
      if (st.modo === 'troca') st.mt = '';
      drawMapa(); return;
    }
    // Abrir uma mudança da linha do tempo é para olhar ou corrigir: passa para o modo Corrigir.
    if (d.pzVer != null) {
      st.ver = +d.pzVer; st.undo = null;
      if (modoTroca()) { st.modo = 'fix'; ui.toast(`Modo Corrigir: alterações agora corrigem ${verLabel(cur())}.`); }
      drawMapa(); return;
    }
    const a = d.pz;
    if (a === 'save') saveMap();
    else if (a === 'text') copyText(mapText(), 'Mapa copiado');
    else if (a === 'side') { ls.sideOff = !ls.sideOff; lsSave(); const g = $('pzGrid'); if (g) g.classList.toggle('side-off', !!ls.sideOff); drawSide(); }
    else if (a === 'layout') openLayout();
    else if (a === 'prev') { ls.prevOff = !ls.prevOff; lsSave(); drawMapa(); }
    else if (a === 'discard') {
      if (!(await uiConfirm('Descartar as alterações não salvas e voltar ao mapa salvo na planilha?', { ok: 'Descartar' }))) return;
      if (ls.drafts) { delete ls.drafts[`${st.date}|${st.turno}`]; lsSave(); }
      st.ver = 0; loadMap(); drawMapa(); ui.toast('Voltou ao mapa salvo.');
    }
    else if (a === 'versions') openVersions();
    else if (a === 'xpt-row') { st.map.layout.xpt = (st.map.layout.xpt || 0) + 1; touch(); drawMapa(); }
    else if (a === 'mt-now') { st.mt = ''; drawMapa();
    } else if (a === 'del-ver') {
      if (st.ver === 0) return;   // o início do turno não pode ser excluído
      if (!(await uiConfirm(`Excluir a mudança "${verLabel(cur())}"?`))) return;
      st.map.versions.splice(st.ver, 1); st.ver = 0; touch(); drawMapa();
    } else if (a === 'rodizio') {
      const vazio = !slotsOf(st.map.layout, cur()).some(s => cur().slots[s.key] && !st.locks.has(s.key));
      // A confirmação é a própria revisão do sexo (lista de quem entra no rodízio).
      void vazio; rodizio();
    } else if (a === 'intervalo') { intervalo();
    } else if (a === 'undo') { if (st.undo) { st.map.versions = st.undo.versions; st.ver = st.undo.ver; st.undo = null; touch(); drawMapa(); } }
    else if (a === 'copy-last') {
      const last = baseOn() ? B().mapaList().filter(r => r.turno === st.turno && `${r.date}|${r.turno}` !== `${st.date}|${st.turno}`).pop() : null;
      if (!last) return ui.toast(`Nenhum mapa salvo do turno ${st.turno} para copiar.`, true);
      st.map = { layout: clone(last.map.layout), xptDest: clone(last.map.xptDest || {}), versions: [{ from: '', slots: clone(sortedVers(last.map).pop().slots) }] };
      st.ver = 0; touch(); drawMapa();
      ui.toast(`Copiado o mapa de ${brShort(last.date)} (última mudança). Ajuste e salve.`);
    }
  }
  async function onMapaChange(e) {
    const t = e.target, d = t.dataset;
    if (t.id === 'pzDate' || t.id === 'pzTurno') {
      if (st.dirty && !(await uiConfirm('Há alterações não salvas neste mapa. Elas ficam guardadas neste aparelho como rascunho. Trocar mesmo assim?'))) { t.value = t.id === 'pzDate' ? st.date : st.turno; return; }
      if (t.id === 'pzDate' && t.value) st.date = t.value;
      if (t.id === 'pzTurno') { st.turno = t.value; ls.turno = t.value; lsSave(); }
      st.ver = 0; loadMap(); st.loadedKey = `${st.date}|${st.turno}`; drawMapa(); return;
    }
    if (d.bmove != null && t.value) {
      const from = d.bmove, to = t.value === '__out' ? '' : t.value;
      bMove(st.bf, boardAll(st.bf).filter(x => x.to === from && (to !== '' || !x.sug)).map(x => x.n), to); st.bsel.clear(); drawMapa(); return;
    }
    if (d.xadd) {
      const add = t.value.split(/[,;\s]+/).map(xptBase).filter(Boolean);
      if (!add.length) { t.value = ''; return; }
      xptDest()[d.xadd] = [...new Set([...destsOf(st.map, d.xadd), ...add])];
      touch(); drawMapa();
      const el = document.querySelector(`[data-xadd="${d.xadd}"]`); if (el) el.focus();
      return;
    }
    if (d.rt) { setRotas(d.rt, t.value); return; }
    if (t.id === 'pzMT') { st.mt = t.value; st.mtUsed = Date.now(); st.undo = null; drawMapa(); return; }
    if (t.id === 'pzFrom') {
      if (st.ver === 0 || !t.value) return;
      if (st.map.versions.some((x, i) => i !== st.ver && x.from === t.value)) { t.value = cur().from; return ui.toast(`Já existe uma mudança às ${t.value}.`, true); }
      cur().from = t.value; touch(); drawMapa(); return;
    }
    if (d.slot) { setSlot(t, d.slot); return; }
  }
  // Colocar alguém numa vaga. Se a pessoa já está em outra vaga desta mudança, pergunta se é para tirar de lá.
  async function setSlot(input, key) {
    const name = canon(input.value), prev = cur().slots[key] || '';
    if (nk(name) === nk(prev)) { input.value = prev; return; }
    let btn = 'keep';
    if (name && !isDw(name)) {
      const isX = k => k.startsWith('xpt.');
      const other = Object.keys(cur().slots).filter(k => k !== key && !(isX(k) && isX(key)) && cur().slots[k] && nk(cur().slots[k]) === nk(name));
      if (other.length) {
        const where = other.map(k => slotDesc(k, st.map.layout)).join(', ');
        const r = await modal('Colaborador já está em outra função', `<p><b>${esc(name)}</b> está em <b>${esc(where)}</b> (${esc(modoTroca() ? `mapa das ${peekWhen()}` : verLabel(cur()))}).</p>
          <p class="muted">Deseja retirá-lo de lá e colocar aqui?${modoTroca() ? '' : ' Se a pessoa trocou de função durante o turno, cancele e use <b>⏱ Troca de função</b>.'}</p>`,
          [['cancel', 'Cancelar', 'btn-ghost'], ['keep', 'Manter nas duas', 'btn-ghost'], ['move', 'Retirar de lá', 'btn-primary solid']]);
        if (r.btn === 'cancel') { input.value = prev; return; }
        btn = r.btn;
        if (btn === 'move') other.forEach(k => { const el = document.querySelector(`[data-slot="${k}"]`); if (el) el.value = ''; });
      }
    }
    const ed = beginEdit(), v = ed.v;
    if (btn === 'move') Object.keys(v.slots).forEach(k => { if (k !== key && !(k.startsWith('xpt.') && key.startsWith('xpt.')) && v.slots[k] && nk(v.slots[k]) === nk(name)) delete v.slots[k]; });
    if (name) v.slots[key] = name; else delete v.slots[key];
    const wasDirty = st.dirty;
    input.value = name; endEdit(ed);
    // Primeira alteração, mudança nova ou correção que passou adiante: redesenha (linha do tempo); senão só o painel.
    const spread = sortedVers(st.map).some(x => (x.from || '') > (v.from || ''));
    if (!wasDirty || ed.created || spread || modoTroca()) { drawMapa(); if (ed.created) ui.toast(`Troca registrada às ${cur().from}.`); } else drawSide();
  }
  function onMapaInput(e) {
    if (e.target.id !== 'pzFree') return;
    const q = nk(e.target.value);
    document.querySelectorAll('#pzFreeList > div').forEach(x => { x.hidden = !!q && !nk(x.textContent).includes(q); });
  }

  // ================= Erros de piso =================
  const se = { date: todayIso(), turno: st.turno, tipo: ['etiq', 'xpt'].includes(ls.tipo) ? ls.tipo : 'sort', code: '', rota: '', time: '', recv: '', classe: '', busy: false, spxMsg: '',
    cats: new Set(Array.isArray(ls.cats) ? ls.cats : []) };
  // Categoria do erro: sorting, etiquetagem, backlog (bipado antes da janela) ou não recebido (depois da janela / nunca).
  const CATS = { sort: ['Sorting', 'warn'], etiq: ['Etiquetagem', 'info'], xpt: ['XPT', 'good'], backlog: ['Backlog', 'neutral'], naorec: ['Não recebido', 'bad'] };
  const semResp = x => ['backlog', 'naorec', 'semjanela'].includes(x.detail && x.detail.classe);   // não procura etiquetador
  const catOf = x => (x.tipo === 'sort' ? 'sort' : x.tipo === 'xpt' ? 'xpt' : x.detail && (x.detail.classe === 'backlog' || x.detail.classe === 'naorec') ? x.detail.classe : 'etiq');
  // Observação do erro: a gravada (busca no SPX, motivo de não ter responsável) ou, nos registros antigos, o motivo
  // calculado agora a partir do mapa.
  const obsOf = x => {
    if (x.detail && x.detail.obs) return x.detail.obs;
    if (x.resp.length) return '';
    if (x.tipo === 'etiq' && !(x.detail && x.detail.recebeu) && !['backlog', 'naorec'].includes(x.detail && x.detail.classe)) return 'Operador do SPX ainda não buscado (sem Sessão SPX no registro).';
    return respFor({ date: x.date, turno: x.turno, tipo: x.tipo, rota: x.rota, time: x.time, recv: x.detail.recebeu, classe: x.detail.classe }).note || '';
  };
  // Janela de recebimento do turno (config RECEB_JANELAS). null = turno sem janela (etiquetagem sem etiquetador).
  const janelaDe = turno => { const J = (window.APP_CONFIG && window.APP_CONFIG.RECEB_JANELAS) || { AM: { inicio: '22:00', fim: '05:30' } }; return J[turno] || null; };
  const janTxt = w => (w ? `${w.inicio}${w.inicio > w.fim ? ' da véspera' : ''} às ${w.fim}` : 'sem janela');
  const rotaLetra = r => { const m = String(r || '').toUpperCase().trim().match(/^([A-Z]{1,2})\s*-?\s*\d*/); return m ? m[1] : ''; };
  const rotaNum = r => { const m = String(r || '').toUpperCase().trim().match(/^[A-Z]{1,2}\s*-?\s*(\d+)/); return m ? +m[1] : 0; };
  const mapOfDay = (iso, turno) => (baseOn() ? B().mapaGet(iso, turno) : null);

  // Responsáveis pelo erro, a partir do mapa que valia no horário.
  // e: { date, turno, tipo: 'sort' | 'etiq', rota, time, recv }
  function respFor(e) {
    // Backlog / não recebido não dependem do mapa: não há etiquetador do turno.
    const J = janelaDe(e.turno);
    if (e.tipo === 'etiq' && (e.classe === 'semjanela' || !J)) return { resp: [], classe: 'semjanela', note: `O turno ${e.turno} não tem janela de recebimento: erro de etiquetagem sem etiquetador.` };
    if (e.tipo === 'etiq' && e.classe === 'backlog') return { resp: [], classe: 'backlog', note: `Backlog: o pacote foi bipado antes da janela de recebimento do turno ${e.turno} (${janTxt(J)}) — sem etiquetador do turno.` };
    if (e.tipo === 'etiq' && e.classe === 'naorec') return { resp: [], classe: 'naorec', note: `Não recebido: o pacote não foi bipado na janela de recebimento do turno ${e.turno} (${janTxt(J)}).` };
    const rec = mapOfDay(e.date, e.turno);
    if (!rec) return { resp: [], note: `Sem mapa de piso salvo para ${brShort(e.date)} · ${e.turno}.` };
    const v = versionAt(rec.map, e.time), slots = slotsOf(rec.map.layout, v);
    const at = `mapa ${verLabel(v)}`;
    if (e.tipo === 'xpt') {
      // XPT: quem estava na vaga daquele XPT no turno (ou, sem ninguém no turno, em qualquer turno do dia).
      if (!e.rota) return { resp: [], note: 'Informe o XPT do pacote (ex.: XPT-SMD).' };
      const xb = xptBase(e.rota);
      let resp = xptWho(e.date, xb, e.turno), onde = `turno ${e.turno}`;
      if (!resp.length) { resp = xptWho(e.date, xb); onde = 'dia'; }
      return { resp, note: resp.length ? `Quem fez o ${xb} no ${onde} (vagas XPT do mapa de piso).` : `Ninguém com o ${xb} no mapa de piso de ${brShort(e.date)}.` };
    }
    if (e.tipo === 'sort') {
      const l = rotaLetra(e.rota), num = rotaNum(e.rota);
      if (!l || !num) return { resp: [], letra: l, note: 'Informe a rota do pacote com o número (ex.: C-12).' };
      // Responsável: quem auditava aquela rota (faixa de rotas da letra) no horário do erro.
      const T = e.time || '99:99';
      const resp = audWho(rec.map, l, num, T);
      return { resp, letra: l, verFrom: '', note: resp.length ? `Auditor da rota ${l}-${num} às ${e.time || 'fim do turno'} (faixas de rotas da Auditoria no mapa de piso).` : `Ninguém auditando a rota ${l}-${num} às ${e.time || 'fim do turno'} no mapa de piso.` };
    }
    if (!e.recv) return { resp: [], note: 'Informe o operador que bipou o pacote (ou busque no SPX).' };
    // Responsável = quem está na vaga "Etiqueta" da bancada onde aparece o operador do SPX. Se o próprio operador
    // está na vaga "Etiqueta", ele é o responsável; se está em "Recebe", é o par dele que etiquetava.
    const mine = slots.find(s => s.func === 'rec' && sameName(v.slots[s.key], e.recv));
    if (!mine) return { resp: [], verFrom: v.from || '', note: `${e.recv} não está em nenhuma bancada de recebimento/etiquetagem (${at}).` };
    const resp = slots.filter(s => s.posto === mine.posto && s.key.endsWith(`.${REC_SIZE - 1}`)).map(s => v.slots[s.key]).filter(Boolean);
    const mesa = rec.map.layout.mesas.find(ms => ms.id === mine.mesa);
    const banc = `Bancada ${bancadaNo(rec.map.layout, mine.mesa, +mine.posto.split('.')[2])}`;
    return { resp, verFrom: v.from || '', posto: `${mesa ? mesa.nome : ''} · ${banc}`,
      note: resp.length ? `Quem etiquetava na ${banc} de ${v.slots[mine.key]} (${at}).` : `${banc} de ${v.slots[mine.key]} sem ninguém na etiquetagem (${at}).` };
  }
  const responsaveis = () => respFor(se);
  // XPTs do mapa de piso de um dia (todas as vagas e turnos).
  const xptOfDay = iso => [...new Set((baseOn() ? B().mapaList() : []).filter(r => r.date === iso && r.map).flatMap(r => allDests(r.map)))].sort();
  // Quem recebeu o pacote no hub, pelo rastreio do SPX (só no PC, com a Sessão SPX ativa).
  // Só vale o operador que bipou dentro da janela (22:00 da véspera até 05:30 do dia do erro):
  // antes = backlog; depois ou nunca = não recebido (nos dois casos não há etiquetador do turno).
  async function lookupReceiver(code, dayIso, turno) {
    const J = janelaDe(turno);
    if (!J) return { classe: 'semjanela', name: '', raw: '', time: '', day: '' };   // turno sem janela: não consulta o SPX
    if (!(api() && api().parcelTrack)) return { error: 'A busca no SPX só funciona no app do computador.' };
    if (!(await window.SpxSession.has())) return { error: 'Sem Sessão SPX.', noSession: true };
    try {
      const r = await api().parcelTrack(code);
      if (!r.ok) return { error: r.error || 'Falha na consulta.' };
      const w = PC.receiverInWindow(r.data, dayIso, J, (window.APP_CONFIG && window.APP_CONFIG.PARCEL) || {});
      const day = w.ts ? new Date(w.ts * 1000).toLocaleDateString('sv-SE', { timeZone: TZ }) : '';
      return { classe: w.classe, name: w.classe === 'etiq' ? canon(w.name) : '', raw: w.name || '', time: w.ts ? hmOf(w.ts) : '', day };
    } catch (e) { return { error: 'Falha na consulta.' }; }
  }

  function renderErros(ctx) {
    ui = ctx;
    drawErros();
    if (baseOn()) B().load().then(() => { if (ui.isActive('erros')) drawErros(); });
  }
  function drawErros() {
    const m = ui.main;
    const r = responsaveis();
    const canSpx = !!(api() && api().parcelTrack);
    const recMap = mapOfDay(se.date, se.turno);
    const recNames = recMap ? [...new Set(recMap.map.versions.flatMap(v => Object.entries(v.slots).filter(([k]) => funcOf(k) === 'rec').map(([, n]) => n)))] : [];
    const today = (baseOn() ? B().erroList() : []).filter(x => x.date === se.date && x.turno === se.turno).reverse();
    const tabs = subTabs([['reg', 'Registro do turno'], ['ana', 'Análise do período']], ls.eview === 'ana' ? 'ana' : 'reg', 'data-pe-view');
    if (ls.eview === 'ana') {
      m.innerHTML = ui.head('Erros de piso', 'Análise do período · filtro do topo') + tabs + '<div id="peAnal"></div>';
      drawAnalise();
      return;
    }
    m.innerHTML = ui.head('Erros de piso', 'Sorting e etiquetagem · responsáveis pelo mapa de piso') + tabs + `
      ${baseOn() ? '' : '<div class="au-demo">Para registrar erros é preciso entrar com a conta Google (planilha-base).</div>'}
      <div class="au-bar pz-bar">
        <label>Dia <input type="date" id="peDate" value="${se.date}"></label>
        <label>Turno <select id="peTurno">${TURNOS.map(t => `<option ${t === se.turno ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <span class="muted small">${recMap ? `Mapa de piso: ${recMap.map.versions.length} mudança(s)` : '⚠ Sem mapa de piso salvo para este dia e turno'}</span>
        <div class="au-bar-right"><button class="btn-primary solid" data-pe="kiosk" ${baseOn() ? '' : 'disabled'} title="Tela cheia para os colaboradores registrarem os erros (sem mostrar responsáveis)">🖥 Modo registro (tela cheia)</button></div>
      </div>
      <div class="grid">
        <section class="card w12"><div class="card-head"><div><div class="card-title">Registrar erro</div><div class="card-sub">Durante a operação, quando o erro aparece</div></div></div>
          <div class="pe-form">
            <div class="chips">${[['sort', 'Erro de sorting'], ['etiq', 'Erro de etiquetagem'], ['xpt', 'Erro de XPT']].map(([k, l]) => `<button class="chip ${se.tipo === k ? 'active' : ''}" data-pe-tipo="${k}">${l}</button>`).join('')}</div>
            <label>Código do pacote (BR) <input id="peCode" type="text" value="${esc(se.code)}" placeholder="BR264457056294A" autocomplete="off"></label>
            ${se.tipo === 'xpt' ? `
              <label>XPT do pacote <input id="peRota" list="peXptList" type="text" value="${esc(se.rota)}" placeholder="XPT-SMD" autocomplete="off"></label>
              <datalist id="peXptList">${xptOfDay(se.date).map(d => `<option value="${esc(d)}">`).join('')}</datalist>
              <label>Horário aproximado <input id="peTime" type="time" value="${esc(se.time)}"></label>
              <div class="muted small">Pacote do XPT com erro (principalmente o que foi sem bipar): o responsável é quem estava na vaga desse XPT no mapa de piso.</div>` : se.tipo === 'sort' ? `
              <label>Gaiola onde o pacote estava <input id="peRota" type="text" value="${esc(se.rota)}" placeholder="C-12" autocomplete="off"></label>
              <label>Horário aproximado <input id="peTime" type="time" value="${esc(se.time)}"></label>
              <div class="muted small">O pacote estava numa gaiola que não era a dele: informe a gaiola onde ele <b>estava</b> (ex.: C-12). O responsável é quem auditava essa rota no horário do erro, pelas faixas de rotas da Auditoria no mapa de piso.</div>` : `
              <div class="pe-row">
                <button class="tool" data-pe="spx" ${canSpx && !se.busy ? '' : 'disabled'} title="${canSpx ? 'Busca no rastreio do SPX quem recebeu o pacote no hub' : 'A busca no SPX só funciona no app do computador'}">${se.busy ? 'Buscando…' : 'Buscar operador no SPX'}</button>
                ${se.spxMsg ? `<span class="muted small">${esc(se.spxMsg)}</span>` : ''}
              </div>
              <label>Operador que bipou (SPX) <input id="peRecv" list="peRecvList" value="${esc(se.recv)}" placeholder="Nome do operador" autocomplete="off"></label>
              <datalist id="peRecvList">${recNames.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
              <label>Horário do recebimento <input id="peTime" type="time" value="${esc(se.time)}"></label>
              <div class="muted small">O responsável é quem está na vaga <b>Etiqueta</b> da bancada desse operador, no horário em que o pacote foi bipado.</div>`}
            <div class="pe-resp ${r.resp.length ? 'ok' : ''}"><b>${r.resp.length ? r.resp.map(esc).join(', ') : 'Sem responsável definido'}</b><div class="muted small">${esc(r.note)}</div></div>
            <button class="btn-primary solid" data-pe="save" ${baseOn() && se.code.trim() ? '' : 'disabled'}>Salvar erro</button>
          </div></section>
        <section class="card w12"><div class="card-head"><div><div class="card-title">Erros do turno</div><div class="card-sub">${brShort(se.date)} · ${se.turno} · ${today.length} erro(s)</div></div>
          ${today.some(x => !x.resp.length && !semResp(x)) ? `<div class="card-tools"><button class="tool" data-pe="fixall" ${se.fixing ? 'disabled' : ''} title="Busca o responsável de todos os erros do turno que estão sem responsável">${se.fixing ? `Buscando… ${se.fixing.done}/${se.fixing.total}` : `🔎 Buscar responsáveis (${today.filter(x => !x.resp.length && !semResp(x)).length})`}</button></div>` : ''}</div>
          ${today.length ? `<div class="table-wrap"><table class="pc-table"><thead><tr><th class="left">Hora</th><th class="left">Tipo</th><th class="left">Pacote</th><th class="left">Gaiola</th><th class="left">Operador SPX</th><th class="left">Etiquetador</th><th class="left">Observação</th><th></th></tr></thead><tbody>
            ${today.map(x => { const c = catOf(x), dash = '<span class="muted">—</span>'; return `<tr><td class="left">${esc(x.time) || '—'}</td><td class="left"><span class="pill ${CATS[c][1]}">${CATS[c][0]}</span>${x.detail.origem === 'quiosque' ? ' <span class="muted small">· registro</span>' : ''}</td>
              <td class="left pc-code">${esc(x.code)}</td><td class="left">${x.tipo !== 'etiq' ? `<b>${esc(x.rota)}</b>` : dash}</td>
              <td class="left">${x.tipo !== 'etiq' ? dash : esc(x.detail.recebeu || x.detail.operadorSpx || '') || dash}</td>
              <td class="left">${c === 'backlog' || c === 'naorec' || semResp(x) ? dash : x.resp.length ? (x.tipo === 'sort' ? `<span class="muted small">auditor:</span> ${x.resp.map(esc).join(', ')}` : x.tipo === 'xpt' ? `<span class="muted small">XPT:</span> ${x.resp.map(esc).join(', ')}` : x.resp.map(esc).join(', ')) : `<button class="tool" data-pe-fix="${esc(x.id)}" title="Busca o operador no SPX e quem estava no mapa">Buscar responsável</button>`}</td>
              <td class="left pc-obs pe-obs">${esc(obsOf(x)) || dash}</td>
              <td><button class="tool danger" data-pe-del="${esc(x.id)}" title="Excluir este registro">Excluir</button></td></tr>`; }).join('')}
          </tbody></table></div>` : ui.empty('Nenhum erro registrado neste turno.')}</section>
      </div>`;
  }

  // Volume recebido por dia (planilhas conectadas), para a taxa de erros por mil pacotes.
  function volumeByIso() {
    const m = ui.model(), out = new Map();
    if (!m || !m.dates) return out;
    m.dates.forEach((d, i) => { const v = m.rec && m.rec.total ? m.rec.total[i] : null; if (v) out.set(d.split('/').reverse().join('-'), v); });
    return out;
  }
  // Nome curto para gráficos: primeiro e último nome (sem "da", "de", "dos"…). O nome completo fica nas tabelas.
  const shortName = n => { const t = String(n || '').trim().split(/\s+/).filter(w => !/^(d[aeo]s?|e)$/i.test(w)); return t.length > 2 ? `${t[0]} ${t[t.length - 1]}` : t.join(' '); };
  const countBy = (list, get) => { const m = new Map(); list.forEach(x => { const k = get(x); if (k) m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt-BR', { numeric: true })); };
  const top10 = arr => { const h = arr.slice(0, 10), r = arr.slice(10).reduce((s, [, n]) => s + n, 0); return r ? [...h, ['Outros', r]] : h; };

  function drawAnalise() {
    const el = $('peAnal');
    if (!el) return;
    const rg = ui.range();
    const all = (baseOn() ? B().erroList() : []).filter(x => x.date >= rg.from && x.date <= rg.to);
    const per = rg.from === rg.to ? brShort(rg.from) : `${brShort(rg.from)} a ${brShort(rg.to)}`;
    if (!baseOn()) { el.innerHTML = ui.empty('A análise usa a planilha-base: entre com a conta Google.'); return; }
    if (!all.length) { el.innerHTML = ui.empty(`Nenhum erro registrado em ${per}. Mude o período no filtro do topo para ver outros dias.`); return; }
    // Filtro por tipo (vários ao mesmo tempo; nenhum = todos). Fica salvo no aparelho.
    const list = all.filter(x => !se.cats.size || se.cats.has(catOf(x)));
    const n = c => list.filter(x => catOf(x) === c).length;
    const chips = `<div class="pc-filters pe-cats"><button class="chip ${se.cats.size ? '' : 'active'}" data-pe-cat="all">Todos</button>
      ${Object.entries(CATS).map(([k, [l]]) => `<button class="chip ${se.cats.has(k) ? 'active' : ''}" data-pe-cat="${k}">${l} <b>${all.filter(x => catOf(x) === k).length}</b></button>`).join('')}</div>`;
    if (!list.length) { el.innerHTML = chips + ui.empty('Nenhum erro desse tipo no período.'); return; }

    // Pessoas (sorting: auditor da rota; etiquetagem: etiquetador). Diaristas ficam fora do ranking.
    const ppl = new Map();
    list.filter(x => ['sort', 'etiq', 'xpt'].includes(catOf(x))).forEach(x => x.resp.filter(nm => !isDw(nm)).forEach(nm => {
      const k = nk(nm), o = ppl.get(k) || { nome: nm, sort: 0, etiq: 0, xpt: 0, days: new Set(), turnos: new Set() };
      o[catOf(x)]++; o.days.add(x.date); o.turnos.add(x.turno); ppl.set(k, o);
    }));
    const rows = [...ppl.values()].sort((a, b) => (b.sort + b.etiq + b.xpt) - (a.sort + a.etiq + a.xpt) || a.nome.localeCompare(b.nome, 'pt-BR'));
    const days = [...new Set(list.map(x => x.date))].sort();
    const vol = volumeByIso();
    const volPer = days.reduce((s2, d) => s2 + (vol.get(d) || 0), 0);
    const comResp = list.filter(x => ['sort', 'etiq', 'xpt'].includes(catOf(x)) && x.resp.length).length;
    const resolviveis = list.filter(x => ['sort', 'etiq', 'xpt'].includes(catOf(x))).length;
    const pend = list.filter(x => ['sort', 'etiq', 'xpt'].includes(catOf(x)) && !x.resp.length).length;
    const byTurno = countBy(list, x => x.turno);
    const byHora = new Map(); list.forEach(x => { const h = (x.time || '').slice(0, 2); if (/^\d\d$/.test(h)) byHora.set(h, (byHora.get(h) || 0) + 1); });
    const horas = [...byHora.keys()].sort();
    const byLetra = countBy(list.filter(x => x.tipo === 'sort'), x => x.detail.letra || rotaLetra(x.rota));
    const byBancada = countBy(list.filter(x => catOf(x) === 'etiq'), x => x.detail.posto || '');
    const byRota = countBy(list.filter(x => x.tipo === 'sort'), x => x.rota);
    const byOperador = countBy(list.filter(x => x.tipo !== 'sort'), x => x.detail.recebeu || x.detail.operadorSpx || '');
    const byOrigem = countBy(list, x => (x.detail.origem === 'quiosque' ? 'Modo registro (tela cheia)' : 'Líder (formulário)'));
    const media = list.length / Math.max(1, days.length);
    const taxa = volPer ? list.length / volPer * 1000 : null;

    el.innerHTML = chips + `<div class="kpis">${[
        ui.kpi('Erros no período', H.fmt.int(list.length), [`<span>${per} · média ${H.fmt.dec(media, 1)}/dia</span>`]),
        ui.kpi('Por mil pacotes', taxa != null ? H.fmt.dec(taxa, 2) : '—', [taxa != null ? `<span>${H.fmt.int(volPer)} pacotes recebidos nos dias com erro</span>` : '<span>sem volume das planilhas nesses dias</span>']),
        ui.kpi('Sorting / Etiquetagem', `${n('sort')} / ${n('etiq')}`, ['<span>gaiola errada / etiqueta errada</span>']),
        ui.kpi('Backlog / Não recebido', `${n('backlog')} / ${n('naorec')}`, ['<span>fora da janela de recebimento do turno</span>']),
        ui.kpi('Com responsável', resolviveis ? H.fmt.pct(comResp / resolviveis, 0) : '—', [pend ? `<span class="pill warn">${pend} sem responsável</span>` : '<span class="pill good">✓ todos com responsável</span>']),
        ui.kpi('Pessoas envolvidas', H.fmt.int(rows.length), [rows[0] ? `<span>mais citada: ${esc(rows[0].nome)} (${rows[0].sort + rows[0].etiq + rows[0].xpt})</span>` : '']),
      ].join('')}</div>
      <div class="grid">
        ${ui.card('peCh1', 'Erros por dia', 'Por tipo', { w: 8 })}
        ${ui.card('peCh3', 'Por turno', 'Erros de cada turno', { w: 4 })}
        ${ui.card('peCh4', 'Por hora', 'Horário do erro (no sorting) ou do bipe (etiquetagem)', { w: 6 })}
        ${ui.card('peCh5', 'Taxa por dia', 'Erros por mil pacotes recebidos', { w: 6 })}
        ${ui.card('peCh2', 'Sorting por letra', 'Letra da gaiola onde o pacote estava', { w: 6 })}
        ${ui.card('peCh6', 'Etiquetagem por bancada', 'Bancada de quem bipou o pacote', { w: 6 })}
        ${ui.card('peCh7', 'Pessoas com mais erros', 'Sorting, etiquetagem e XPT · nome completo na tabela "Pessoas"', { w: 12, h: 'tall' })}
        ${ui.card('', 'Gaiolas com mais erros de sorting', `${byRota.length} gaiola(s)`, { w: 4, body: byRota.length ? `<div class="table-wrap"><table class="pc-table"><thead><tr><th class="left">Gaiola</th><th>Erros</th></tr></thead><tbody>
          ${byRota.slice(0, 15).map(([k, v]) => `<tr><td class="left"><b>${esc(k)}</b></td><td>${v}</td></tr>`).join('')}</tbody></table></div>` : ui.empty('Sem erros de sorting.') })}
        ${ui.card('', 'Operadores SPX dos pacotes com erro', 'Quem bipou (etiquetagem, backlog, não recebido)', { w: 4, body: byOperador.length ? `<div class="table-wrap"><table class="pc-table"><thead><tr><th class="left">Operador</th><th>Pacotes</th></tr></thead><tbody>
          ${byOperador.slice(0, 15).map(([k, v]) => `<tr><td class="left">${esc(k)}</td><td>${v}</td></tr>`).join('')}</tbody></table></div>` : ui.empty('Sem operador registrado.') })}
        ${ui.card('', 'Origem dos registros', 'Quem registrou', { w: 4, body: `<div class="table-wrap"><table class="pc-table"><tbody>${byOrigem.map(([k, v]) => `<tr><td class="left">${esc(k)}</td><td><b>${v}</b></td><td>${H.fmt.pct(v / list.length, 0)}</td></tr>`).join('')}</tbody></table></div>` })}
        ${ui.card('', 'Pessoas', 'Sorting: auditor da rota no horário · Etiquetagem: quem estava na vaga Etiqueta da bancada · XPT: quem fez o XPT', { w: 12,
          tools: '<button class="tool" data-pe="recalc" title="Refaz os responsáveis do período com as regras atuais">Recalcular responsáveis</button><button class="tool" data-pe="copy">Copiar lista</button>',
          body: rows.length ? `<div class="table-wrap"><table class="pc-table"><thead><tr><th class="left">Pessoa</th><th>Sorting</th><th>Etiquetagem</th><th>XPT</th><th>Total</th><th>Dias</th><th>Turnos</th></tr></thead><tbody>
            ${rows.map(o => `<tr><td class="left">${esc(o.nome)}</td><td>${o.sort}</td><td>${o.etiq}</td><td>${o.xpt}</td><td><b>${o.sort + o.etiq + o.xpt}</b></td><td>${o.days.size}</td><td class="left">${[...o.turnos].sort().join(', ')}</td></tr>`).join('')}
          </tbody></table></div>` : ui.empty('Nenhuma pessoa nos tipos filtrados.') })}
      </div>`;
    const colors = { sort: H.color(1), etiq: H.color(2), xpt: H.color(5), backlog: H.color(4), naorec: H.css('--bad') };
    const cats = Object.keys(CATS).filter(c => n(c));
    H.render('peCh1', { labels: days.map(H.dayLabel), stacked: true, totals: true, datasets: cats.map(c =>
      H.bar(CATS[c][0], days.map(d => list.filter(x => x.date === d && catOf(x) === c).length || null), colors[c])) });
    const turnos = TURNOS.filter(t => byTurno.some(([k]) => k === t));
    H.render('peCh3', { labels: turnos, stacked: true, datasets: cats.map(c => H.bar(CATS[c][0], turnos.map(t => list.filter(x => x.turno === t && catOf(x) === c).length || null), colors[c])) });
    H.render('peCh4', { labels: horas.map(h => `${h}h`), stacked: true, datasets: cats.map(c => H.bar(CATS[c][0], horas.map(h => list.filter(x => (x.time || '').startsWith(h) && catOf(x) === c).length || null), colors[c])) });
    H.render('peCh5', { labels: days.map(H.dayLabel), legend: false, yFormat: v => H.fmt.dec(v, 1), datasets: [
      H.bar('Erros por mil', days.map(d => (vol.get(d) ? +(list.filter(x => x.date === d).length / vol.get(d) * 1000).toFixed(2) : null)), H.color(3))] });
    H.render('peCh2', { labels: byLetra.map(x => x[0]).sort(), legend: false, datasets: [H.bar('Erros', byLetra.map(x => x[0]).sort().map(l => (byLetra.find(y => y[0] === l) || [, 0])[1]), H.color(1))] });
    const bb = top10(byBancada);
    H.render('peCh6', { labels: bb.map(x => x[0].replace(/^.* · /, '')), horizontal: true, legend: false, datasets: [H.bar('Erros', bb.map(x => x[1]), H.color(2))] });
    const tp = rows.slice(0, 10);
    H.render('peCh7', { labels: tp.map(o => shortName(o.nome)), horizontal: true, stacked: true, datasets: [H.bar('Sorting', tp.map(o => o.sort || null), H.color(1)), H.bar('Etiquetagem', tp.map(o => o.etiq || null), H.color(2)), H.bar('XPT', tp.map(o => o.xpt || null), H.color(5))] });
    st.copyRows = rows; st.copyPer = per;
  }

  // ---------- Dashboard dos mapas salvos ----------
  // Para cada mapa salvo no período: quem fez cada função (vagas de todas as mudanças + quadro do 2º Sorting/Auditoria),
  // diaristas, intervalos e cobertura das vagas.
  function mapaFacts(r) {
    const funcs = new Map(), first = new Map();
    let dw = 0, intv = new Set();
    const add = (name, f) => {
      if (!name || f === 'int') return;
      if (isDw(name)) return;
      const k = nk(name);
      if (!funcs.has(k)) funcs.set(k, { n: name, f: new Set() });
      funcs.get(k).f.add(f);
      if (!first.has(k)) first.set(k, f);
    };
    sortedVers(r.map).forEach(v => {
      Object.entries(v.slots || {}).forEach(([k, n]) => { if (k.startsWith('int.')) { if (n) intv.add(nk(n)); } else add(n, funcOf(k)); });
      dw = Math.max(dw, Object.values(v.slots || {}).filter(n => n && isDw(n)).length);
    });
    const b = r.map.board || {};
    ['s2', 'aud'].forEach(f => (b[f] || []).forEach(e => {
      if (e.to === 'int') intv.add(nk(e.n));
      else if (e.to && e.to !== 'pool') add(e.n, f);
    }));
    const dwBoard = new Set(['s2', 'aud'].flatMap(f => (b[f] || []).filter(e => isDw(e.n)).map(e => nk(e.n))));
    const v0 = r.map.versions[0] || { slots: {} };
    const cover = {};
    slotsOf(r.map.layout && r.map.layout.mesas ? r.map.layout : DEFAULT_LAYOUT, v0).forEach(sl => { if (sl.func === 's2' || sl.func === 'aud') return; const c = cover[sl.func] || (cover[sl.func] = [0, 0]); c[1]++; if (v0.slots[sl.key]) c[0]++; });
    return { funcs, first, dw: dw + dwBoard.size, intv, cover };
  }
  // Função de cada pessoa no início do turno: vagas da mudança "Início" + onde estava no quadro do 2º Sorting /
  // Auditoria no primeiro horário com movimento (o "Disponíveis" não conta como função).
  function startFuncs(r) {
    const out = new Map();
    const v0 = sortedVers(r.map)[0] || { slots: {} };
    Object.entries(v0.slots || {}).forEach(([k, n]) => { const f = funcOf(k); if (n && f !== 'int' && !isDw(n) && !out.has(nk(n))) out.set(nk(n), f); });
    const b = r.map.board || {};
    ['s2', 'aud'].forEach(f => {
      const ev = b[f] || [];
      if (!ev.length) return;
      const t0 = ev.map(e => e.t || '').sort()[0];
      bStateAt(ev, t0).forEach((x, k) => { if (x.to && x.to !== 'pool' && x.to !== 'int' && !isDw(x.n) && !out.has(k)) out.set(k, f); });
    });
    return out;
  }
  function drawMapaDash() {
    const el = $('pzDash');
    if (!el) return;
    if (!baseOn()) { el.innerHTML = ui.empty('O dashboard usa os mapas salvos na planilha-base: entre com a conta Google.'); return; }
    const rg = ui.range();
    const FL = ['ind', 'rec', 'sort', 's2', 'aud', 'desc', 'xpt', 's5'];
    // Filtros do dashboard (vários ao mesmo tempo; nenhum = todos), salvos no aparelho.
    const fT = new Set(Array.isArray(ls.dTurnos) ? ls.dTurnos : []), fF = new Set(Array.isArray(ls.dFuncs) ? ls.dFuncs : []);
    const inPer = B().mapaList().filter(r => r.date >= rg.from && r.date <= rg.to && r.map);
    const per = rg.from === rg.to ? brShort(rg.from) : `${brShort(rg.from)} a ${brShort(rg.to)}`;
    const chip = (attr, k, label, on, n) => `<button class="chip ${on ? 'active' : ''}" ${attr}="${k}">${label}${n != null ? ` <b>${n}</b>` : ''}</button>`;
    const filtros = `<div class="pc-filters pd-filters">
        <span class="pd-flabel">Turno</span>${chip('data-pd-t', 'all', 'Todos', !fT.size)}${TURNOS.map(t => chip('data-pd-t', t, t, fT.has(t), inPer.filter(r => r.turno === t).length)).join('')}
        <span class="pd-flabel">Função</span>${chip('data-pd-f', 'all', 'Todas', !fF.size)}${FL.map(f => chip('data-pd-f', f, FUNCS[f], fF.has(f))).join('')}
      </div>`;
    const recs = inPer.filter(r => !fT.size || fT.has(r.turno));
    if (!recs.length) { el.innerHTML = filtros + ui.empty(inPer.length ? 'Nenhum mapa salvo para os turnos escolhidos no período.' : `Nenhum mapa salvo em ${per}. Mude o período no filtro do topo.`); return; }
    // Filtro de função: só conta quem fez alguma das funções escolhidas (e só essas funções).
    const facts = recs.map(r => ({ r, ...mapaFacts(r) })).map(fa => {
      if (!fF.size) return fa;
      const funcs = new Map();
      fa.funcs.forEach((v, k) => { const f = new Set([...v.f].filter(x => fF.has(x))); if (f.size) funcs.set(k, { n: v.n, f }); });
      return { ...fa, funcs, intv: new Set([...fa.intv].filter(k => funcs.has(k))) };
    });
    // Pessoa × função (turnos em cada função).
    const ppl = new Map();
    facts.forEach(fa => fa.funcs.forEach((v, k) => {
      const o = ppl.get(k) || { nome: v.n, turnos: 0, f: {}, int: 0 };
      o.turnos++; v.f.forEach(f => { o.f[f] = (o.f[f] || 0) + 1; }); if (fa.intv.has(k)) o.int++;
      ppl.set(k, o);
    }));
    const rows = [...ppl.values()].map(o => { const fs = Object.entries(o.f).sort((a, b) => b[1] - a[1]); return { ...o, poli: fs.length, main: fs[0] ? fs[0][0] : '', mainPct: fs[0] ? fs[0][1] / o.turnos : 0 }; })
      .sort((a, b) => b.turnos - a.turnos || a.nome.localeCompare(b.nome, 'pt-BR'));
    // Rodízio: função de cada pessoa no INÍCIO do turno comparada com o início do mesmo turno no dia anterior
    // (o mapa do dia anterior pode estar fora do período do filtro; sem mapa no dia anterior, o dia não entra).
    let comp = 0, mudou = 0;
    const prevIso = iso => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
    const allMaps = B().mapaList();
    facts.forEach(fa => {
      const prev = allMaps.find(r => r.turno === fa.r.turno && r.date === prevIso(fa.r.date) && r.map);
      if (!prev) return;
      const a = startFuncs(prev), b = startFuncs(fa.r);
      b.forEach((f, k) => { const p = a.get(k); if (p && (!fF.size || fF.has(f) || fF.has(p))) { comp++; if (p !== f) mudou++; } });
    });
    const dates = [...new Set(recs.map(r => r.date))].sort();
    const perFuncDay = f => dates.map(d => facts.filter(fa => fa.r.date === d).reduce((s2, fa) => s2 + [...fa.funcs.values()].filter(v => v.f.has(f)).length, 0) || null);
    const pessoasTurno = facts.map(fa => fa.funcs.size);
    const media = pessoasTurno.reduce((a, b) => a + b, 0) / facts.length;
    const intTotal = facts.reduce((s2, fa) => s2 + fa.intv.size, 0), dwTotal = facts.reduce((s2, fa) => s2 + fa.dw, 0);
    const cover = {};
    facts.forEach(fa => Object.entries(fa.cover).forEach(([f, [a, b]]) => { const c = cover[f] || (cover[f] = [0, 0]); c[0] += a; c[1] += b; }));
    const moves = {};
    recs.forEach(r => ['s2', 'aud'].forEach(f => ((r.map.board || {})[f] || []).forEach(e => { if (e.to && e.to !== 'pool' && e.to !== 'int') moves[e.to] = (moves[e.to] || 0) + 1; })));
    const letras = Object.keys(moves).sort();
    const nSingle = rows.filter(o => o.poli === 1 && o.turnos >= 3).length;
    el.innerHTML = filtros + `<div class="kpis">${[
        ui.kpi('Turnos com mapa', H.fmt.int(recs.length), [`<span>${dates.length} dia(s) · ${per}</span>`]),
        ui.kpi('Pessoas diferentes', H.fmt.int(rows.length), [`<span>média de ${H.fmt.dec(media, 1)} por turno</span>`]),
        ui.kpi('Rodízio', comp ? H.fmt.pct(mudou / comp, 0) : '—', [comp ? `<span>começaram o turno numa função diferente da do início do mesmo turno no dia anterior (${mudou}/${comp})</span>` : '<span>precisa do mapa do mesmo turno no dia anterior</span>']),
        ui.kpi('Polivalência', rows.length ? H.fmt.dec(rows.reduce((a, o) => a + o.poli, 0) / rows.length, 1) : '—', [`<span>funções diferentes por pessoa${nSingle ? ` · ${nSingle} sempre na mesma (3+ turnos)` : ''}</span>`]),
        ui.kpi('Diaristas', H.fmt.int(dwTotal), [`<span>média de ${H.fmt.dec(dwTotal / facts.length, 1)} por turno</span>`]),
        ui.kpi('Intervalos registrados', H.fmt.int(intTotal), [`<span>${H.fmt.pct(intTotal / Math.max(1, pessoasTurno.reduce((a, b) => a + b, 0)), 0)} das pessoas-turno</span>`]),
      ].join('')}</div>
      <div class="grid">
        ${ui.card('pdCh1', 'Pessoas por função por dia', 'Soma dos turnos do dia (cada pessoa conta uma vez em cada função que fez)', { w: 8 })}
        ${ui.card('pdCh2', 'Pessoas por turno', 'Média de pessoas em função', { w: 4 })}
        ${ui.card('pdCh3', 'Cobertura das vagas', 'Vagas preenchidas no início do turno, por função', { w: 6 })}
        ${ui.card('pdCh4', 'Movimentos no quadro por letra', '2º Sorting e Auditoria', { w: 6 })}
        ${ui.card('', 'Pessoas × funções', `${rows.length} pessoa(s) · turnos em cada função no período`, { w: 12,
          tools: '<input class="search" id="pdQ" type="search" placeholder="Buscar pessoa…">',
          body: `<div class="table-wrap"><table class="pc-table pd-matrix"><thead><tr><th class="left">Pessoa</th><th>Turnos</th>${FL.map(f => `<th>${esc(FUNCS[f])}</th>`).join('')}<th>Funções</th><th class="left">Mais frequente</th><th>Intervalos</th></tr></thead><tbody>
            ${rows.map(o => `<tr data-pdrow="${esc(nk(o.nome))}"><td class="left">${esc(o.nome)}</td><td><b>${o.turnos}</b></td>
              ${FL.map(f => `<td class="${o.f[f] ? 'pd-on' : 'muted'}">${o.f[f] || '·'}</td>`).join('')}
              <td>${o.poli}</td><td class="left">${o.main ? `${esc(FUNCS[o.main])} <span class="muted small">${H.fmt.pct(o.mainPct, 0)}</span>` : '—'}</td><td>${o.int || '·'}</td></tr>`).join('')}
          </tbody></table></div>` })}
      </div>`;
    const pal = [H.color(1), H.color(2), H.color(3), H.color(4), H.color(5), H.css('--good'), H.css('--warn'), H.css('--muted')];
    H.render('pdCh1', { labels: dates.map(H.dayLabel), stacked: true, totals: true, datasets: FL.map((f, i) => H.bar(FUNCS[f], perFuncDay(f), pal[i])).filter((d, i) => (!fF.size || fF.has(FL[i])) && d.data.some(Boolean)) });
    const tt = TURNOS.filter(t => facts.some(fa => fa.r.turno === t));
    H.render('pdCh2', { labels: tt, legend: false, datasets: [H.bar('Pessoas', tt.map(t => { const fs = facts.filter(fa => fa.r.turno === t); return +(fs.reduce((a, fa) => a + fa.funcs.size, 0) / fs.length).toFixed(1); }), H.color(2))] });
    const cf = Object.keys(cover).filter(f => cover[f][1] && (!fF.size || fF.has(f)));
    H.render('pdCh3', { labels: cf.map(f => FUNCS[f]), legend: false, yFormat: v => H.fmt.pct(v, 0), yMax: 1, datasets: [H.bar('Preenchidas', cf.map(f => +(cover[f][0] / cover[f][1]).toFixed(3)), H.color(3))] });
    H.render('pdCh4', { labels: letras, legend: false, datasets: [H.bar('Movimentos', letras.map(l => moves[l]), H.color(1))] });
    const q = $('pdQ');
    if (q) q.addEventListener('input', e => { const k = nk(e.target.value); document.querySelectorAll('[data-pdrow]').forEach(tr => { tr.hidden = !!k && !tr.dataset.pdrow.includes(k); }); });
  }

  // Texto da busca no SPX (vai para a observação do erro).
  const spxDesc = w => w.error ? `SPX: ${w.error}`
    : w.classe === 'etiq' ? `Bipado no SPX por ${w.raw} em ${brShort(w.day)} às ${w.time}.`
    : w.classe === 'semjanela' ? 'Turno sem janela de recebimento: sem etiquetador.'
    : w.classe === 'backlog' ? `Backlog: bipado por ${w.raw} em ${brShort(w.day)} às ${w.time}, antes da janela de recebimento do turno.`
    : w.raw ? `Não recebido na janela: bipado só em ${brShort(w.day)} às ${w.time}.` : 'Não recebido: o rastreio do SPX não mostra o recebimento no hub.';
  async function spxReceiver() {
    const code = se.code.trim().toUpperCase();
    if (!PC.CODE_RE.test(code)) { se.spxMsg = 'Código inválido.'; return drawErros(); }
    if (!janelaDe(se.turno)) { se.classe = 'semjanela'; se.recv = ''; se.opSpx = ''; se.spxMsg = spxDesc({ classe: 'semjanela' }); return drawErros(); }
    if (!(await window.SpxSession.has())) { se.spxMsg = ''; return window.SpxSession.open(() => spxReceiver()); }
    se.busy = true; se.spxMsg = ''; drawErros();
    const w = await lookupReceiver(code, se.date, se.turno);
    se.spxMsg = spxDesc(w);
    if (!w.error) { se.classe = w.classe; se.recv = w.name; se.opSpx = w.raw || ''; if (w.time) se.time = w.time; }
    se.busy = false; drawErros();
  }
  // Refaz os responsáveis de etiquetagem do período (para os registros gravados antes da regra atual).
  // Refaz os responsáveis do período com as regras atuais (sorting: 2º sorting + auditoria da letra em todo o turno;
  // etiquetagem: vaga Etiqueta da bancada do operador do SPX).
  async function recalcAll() {
    const rg = ui.range();
    const list = B().erroList().filter(x => x.date >= rg.from && x.date <= rg.to && (x.tipo !== 'etiq' ? x.rota : x.detail.recebeu && catOf(x) === 'etiq'));
    const changes = list.map(x => ({ x, r: respFor({ date: x.date, turno: x.turno, tipo: x.tipo, rota: x.rota, time: x.time, recv: x.detail.recebeu }) }))
      .filter(({ x, r }) => r.resp.length && r.resp.map(nk).sort().join('|') !== x.resp.map(nk).sort().join('|'));
    if (!changes.length) return ui.toast('Nenhum erro do período mudou de responsável.');
    const nS = changes.filter(c => c.x.tipo === 'sort').length;
    if (!(await uiConfirm(`${changes.length} erro(s) do período mudam de responsável com as regras atuais (${nS} de sorting, ${changes.length - nS} de etiquetagem). Atualizar?`, { ok: 'Atualizar' }))) return;
    for (const { x, r } of changes) await B().erroSave({ ...x, resp: r.resp, detail: { ...x.detail, letra: r.letra || x.detail.letra || '', posto: r.posto || x.detail.posto || '' } });
    ui.toast(`${changes.length} erro(s) atualizados`);
    drawErros();
  }
  // Registro feito no modo tela cheia sem responsável (sem Sessão SPX ou sem mapa): o líder completa depois.
  // Retorna { ok, msg, noSession }. quiet: não mostra aviso nem redesenha (usado no "buscar todos").
  async function completeErro(id, quiet = false) {
    const x = B().erroList().find(e => e.id === id);
    if (!x) return { ok: false, msg: 'Registro não encontrado.' };
    let recv = x.detail.recebeu || '', time = x.time, classe = x.detail.classe || '';
    if (x.tipo === 'etiq' && !recv && !['backlog', 'naorec', 'semjanela'].includes(classe)) {
      const w = await lookupReceiver(x.code, x.date, x.turno);
      if (w.noSession) { if (!quiet) window.SpxSession.open(() => completeErro(id)); return { ok: false, noSession: true, msg: w.error }; }
      if (w.error) {
        await B().erroSave({ ...x, detail: { ...x.detail, obs: spxDesc(w) } });
        if (!quiet) { ui.toast(w.error, true); drawErros(); }
        return { ok: false, msg: w.error };
      }
      recv = w.name; classe = w.classe; if (w.time) time = w.time;
      x.detail = { ...x.detail, spx: spxDesc(w), operadorSpx: w.raw || '' };
    }
    const r = respFor({ date: x.date, turno: x.turno, tipo: x.tipo, rota: x.rota, time, recv, classe });
    if (r.classe) {   // backlog / não recebido: classificado, sem etiquetador
      await B().erroSave({ ...x, time, resp: [], detail: { ...x.detail, classe: r.classe, recebeu: '', pendente: false, obs: x.detail.spx || r.note } });
      if (!quiet) { ui.toast(r.note); drawErros(); }
      return { ok: true };
    }
    if (!r.resp.length) {
      await B().erroSave({ ...x, time, detail: { ...x.detail, recebeu: recv, obs: [x.detail.spx, r.note].filter(Boolean).join(' ') } });   // guarda o operador achado e o motivo
      if (!quiet) ui.toast(r.note, true);
      return { ok: false, msg: r.note };
    }
    await B().erroSave({ ...x, time, resp: r.resp, detail: { ...x.detail, letra: r.letra || x.detail.letra || '', recebeu: recv, classe: x.tipo === 'etiq' ? 'etiq' : '', mapa: r.verFrom || '', posto: r.posto || '', pendente: false, obs: [x.detail.spx, r.note].filter(Boolean).join(' ') } });
    if (!quiet) { ui.toast(`Responsável encontrado: ${r.resp.join(', ')}`); drawErros(); }
    return { ok: true };
  }
  // Busca o responsável de todos os erros do turno que ainda estão sem responsável.
  async function completeAll() {
    const pend = B().erroList().filter(x => x.date === se.date && x.turno === se.turno && !x.resp.length && !semResp(x));
    if (!pend.length) return ui.toast('Todos os erros do turno já têm responsável.');
    if (pend.some(x => x.tipo === 'etiq' && !x.detail.recebeu) && api() && api().parcelTrack && !(await window.SpxSession.has()))
      return window.SpxSession.open(() => completeAll());
    se.fixing = { done: 0, total: pend.length }; drawErros();
    let ok = 0;
    const fail = [];
    for (const x of pend) {
      const r = await completeErro(x.id, true);
      if (r.ok) ok++; else fail.push(`${x.code}: ${r.msg}`);
      se.fixing.done++;
      const b = document.querySelector('[data-pe="fixall"]'); if (b) b.textContent = `Buscando… ${se.fixing.done}/${se.fixing.total}`;
    }
    se.fixing = null;
    drawErros();
    ui.toast(`${ok} de ${pend.length} erro(s) com responsável encontrado${fail.length ? ` · ${fail.length} sem (veja na lista)` : ''}`, !!fail.length && !ok);
    if (fail.length) console.info('Sem responsável:', fail);
  }
  async function saveErro() {
    const code = se.code.trim().toUpperCase();
    if (!code || !baseOn()) return;
    const r = responsaveis();
    if (!r.resp.length && !r.classe && !(await uiConfirm(`Nenhum responsável foi encontrado (${r.note}) Salvar mesmo assim?`))) return;
    try {
      await B().erroSave({ date: se.date, turno: se.turno, tipo: se.tipo, code, rota: se.tipo === 'xpt' ? xptBase(se.rota) : se.tipo !== 'etiq' ? se.rota.trim().toUpperCase() : '', time: se.time,
        resp: r.resp, detail: { letra: r.letra || '', recebeu: se.tipo === 'etiq' ? se.recv : '', operadorSpx: se.tipo === 'etiq' ? (se.opSpx || se.recv) : '', mapa: r.verFrom || '', posto: r.posto || '', classe: se.tipo === 'etiq' ? (se.classe || 'etiq') : '',
          obs: r.classe ? (se.spxMsg || r.note) : [se.tipo === 'etiq' && se.spxMsg ? se.spxMsg : '', r.note].filter((t, i, a) => t && a.indexOf(t) === i).join(' ') } });
      ui.toast(`Erro de ${se.tipo === 'sort' ? 'sorting' : 'etiquetagem'} salvo · ${code}`);
      se.code = ''; se.rota = ''; se.recv = ''; se.classe = ''; se.opSpx = ''; se.time = se.tipo === 'sort' ? nowHm() : ''; se.spxMsg = '';
      drawErros();
      const c = $('peCode'); if (c) c.focus();
    } catch (e) { ui.toast(String(e.message || e), true); }
  }
  async function onErrosClick(e) {
    const t = e.target.closest('[data-pe],[data-pe-tipo],[data-pe-del],[data-pe-fix],[data-pe-cat],[data-pe-view]');
    if (!t) return;
    const d = t.dataset;
    if (d.peTipo) { se.tipo = d.peTipo; ls.tipo = se.tipo; lsSave(); if (se.tipo !== 'etiq' && !se.time) se.time = nowHm(); drawErros(); return; }
    if (d.peView) { ls.eview = d.peView; lsSave(); drawErros(); return; }
    if (d.peCat) {
      if (d.peCat === 'all') se.cats.clear(); else if (!se.cats.delete(d.peCat)) se.cats.add(d.peCat);
      ls.cats = [...se.cats]; lsSave(); drawAnalise(); return;
    }
    if (d.peFix) { completeErro(d.peFix); return; }
    if (d.peDel) { if (await uiConfirm('Excluir este registro de erro?')) B().erroDelete(d.peDel).then(drawErros); return; }
    if (d.pe === 'kiosk') openKiosk();
    else if (d.pe === 'recalc') recalcAll();
    else if (d.pe === 'fixall') completeAll();
    else if (d.pe === 'spx') spxReceiver();
    else if (d.pe === 'save') saveErro();
    else if (d.pe === 'copy') copyText([`Erros de piso por pessoa — ${st.copyPer}`, '', ...(st.copyRows || []).map(o => `${o.nome}\tsorting ${o.sort}\tetiquetagem ${o.etiq}`)].join('\n'), 'Lista copiada');
  }
  function onErrosChange(e) {
    const t = e.target;
    if (t.id === 'peDate' && t.value) { se.date = t.value; drawErros(); }
    else if (t.id === 'peTurno') { se.turno = t.value; drawErros(); }
    else if (t.id === 'peTime') { se.time = t.value; drawErros(); }
    else if (t.id === 'peRecv') { se.recv = canon(t.value); se.opSpx = se.recv; se.classe = se.recv ? 'etiq' : ''; drawErros(); }
    else if (t.id === 'peRota') { se.rota = t.value.toUpperCase(); drawErros(); }
  }
  function onErrosInput(e) {
    const t = e.target;
    // Só guarda o texto: redesenhar a cada tecla tiraria o foco do campo.
    if (t.id === 'peCode') { se.code = t.value; const b = document.querySelector('[data-pe="save"]'); if (b) b.disabled = !(baseOn() && se.code.trim()); }
  }

  // ================= Modo registro (tela cheia) =================
  // Para os colaboradores: bipar o pacote, escolher o tipo de erro e (sorting) a gaiola onde o pacote estava. Não mostra responsáveis.
  // Os responsáveis são calculados e gravados por trás; sem Sessão SPX (etiquetagem), o líder completa depois.
  // Senha do líder para sair do modo registro (APP_CONFIG.KIOSK_PASSWORD).
  async function askKioskPassword() {
    const pass = String((window.APP_CONFIG && window.APP_CONFIG.KIOSK_PASSWORD) || '');
    if (!pass) return uiConfirm('Sair do modo registro?', { ok: 'Sair' });
    let erro = '';
    for (;;) {
      const r = await modal('Sair do modo registro', `<p class="muted">Digite a senha do líder para sair da tela cheia.</p>
        <input type="password" id="kPass" autocomplete="off" class="kiosk-pass" aria-label="Senha">
        <div class="settings-msg ${erro ? 'err' : ''}">${erro}</div>`,
        [['cancel', 'Cancelar', 'btn-ghost'], ['ok', 'Sair', 'btn-primary solid']],
        dlg => { const i = dlg.querySelector('#kPass'); i.focus(); i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); dlg.querySelector('[data-modal="ok"]').click(); } }); },
        dlg => dlg.querySelector('#kPass').value);
      if (!r || r.btn !== 'ok') return false;
      if (r.data === pass) return true;
      erro = 'Senha incorreta.';
    }
  }
  async function openKiosk() {
    if (!baseOn()) return ui.toast('Entre com a conta Google para registrar erros.', true);
    const r = await modal('🖥 Modo registro', `<p class="muted">Tela cheia para os colaboradores registrarem os erros. Eles só bipam o pacote e escolhem o tipo de erro — os responsáveis <b>não</b> aparecem.</p>
      <div class="pz-int-form"><label>Turno <select id="kTurno">${TURNOS.map(t => `<option ${t === se.turno ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
      ${api() && api().parcelTrack ? `<p class="muted small">${window.SpxSession.isActive() ? '✓ Sessão SPX ativa: o responsável pela etiquetagem é buscado na hora.' : '⚠ Sem Sessão SPX: os erros de etiquetagem ficam para você completar depois (botão "Buscar responsável").'}</p>` : ''}`,
      [['cancel', 'Cancelar', 'btn-ghost'], ['ok', 'Abrir em tela cheia', 'btn-primary solid']], null, dlg => ({ turno: dlg.querySelector('#kTurno').value }));
    if (!r || r.btn !== 'ok') return;
    const K = { turno: r.data.turno, date: todayIso(), tipo: '', busy: false, last: [] };
    const el = document.createElement('div');
    el.className = 'kiosk';
    el.innerHTML = `<div class="kiosk-top"><div><b>Registro de erros</b> · ${brShort(K.date)} · ${K.turno}</div><button class="kiosk-exit" data-k="exit">Sair</button></div>
      <div class="kiosk-body">
        <div class="kiosk-lbl">1. Bipe o pacote</div>
        <input id="kCode" class="kiosk-input" placeholder="BR…" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <div class="kiosk-lbl">2. Tipo de erro</div>
        <div class="kiosk-types">
          <button data-k="sort">Erro de sorting<small>pacote na gaiola errada</small></button>
          <button data-k="etiq">Erro de etiquetagem<small>etiqueta errada</small></button>
          <button data-k="xpt">Erro de XPT<small>pacote de XPT sem bipar</small></button>
        </div>
        <div id="kSortBox" hidden><div class="kiosk-lbl" id="kRotaLbl">3. Gaiola onde o pacote estava</div>
          <input id="kRota" class="kiosk-input" placeholder="C-12" list="kXptList" autocomplete="off" autocapitalize="characters" spellcheck="false">
          <datalist id="kXptList"></datalist></div>
        <button class="kiosk-save" data-k="save" disabled>Registrar</button>
        <div class="kiosk-msg" id="kMsg"></div>
      </div>
      <div class="kiosk-last"><div class="kiosk-lbl">Últimos registros</div><ul id="kLast"><li class="muted">Nenhum ainda</li></ul></div>`;
    document.body.appendChild(el);
    document.body.classList.add('kiosk-on');
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    const q = id => el.querySelector('#' + id);
    const code = () => q('kCode').value.trim().toUpperCase();
    const ready = () => PC.CODE_RE.test(code()) && K.tipo && (K.tipo === 'etiq' || (K.tipo === 'xpt' ? !!q('kRota').value.trim() : rotaLetra(q('kRota').value) && rotaNum(q('kRota').value)));
    const sync = () => {
      el.querySelectorAll('.kiosk-types button').forEach(b => b.classList.toggle('on', b.dataset.k === K.tipo));
      q('kSortBox').hidden = K.tipo !== 'sort' && K.tipo !== 'xpt';
      q('kRotaLbl').textContent = K.tipo === 'xpt' ? '3. XPT do pacote' : '3. Gaiola onde o pacote estava';
      q('kRota').placeholder = K.tipo === 'xpt' ? 'XPT-SMD' : 'C-12';
      q('kXptList').innerHTML = K.tipo === 'xpt' ? xptOfDay(K.date).map(d => `<option value="${esc(d)}">`).join('') : '';
      el.querySelector('[data-k="save"]').disabled = !ready() || K.busy;
    };
    const say = (t, ok) => { q('kMsg').textContent = t; q('kMsg').className = 'kiosk-msg ' + (ok ? 'ok' : t ? 'err' : ''); };
    const reset = () => { q('kCode').value = ''; q('kRota').value = ''; K.tipo = ''; sync(); q('kCode').focus(); };
    async function save() {
      if (!ready() || K.busy) return;
      K.busy = true; sync(); say('Registrando…', true);
      const c = code(), tipo = K.tipo, rota = tipo === 'xpt' ? xptBase(q('kRota').value) : tipo !== 'etiq' ? q('kRota').value.trim().toUpperCase() : '';
      let time = nowHm(), recv = '';
      let classe = '';
      let spx = '';
      let opSpx = '';
      if (tipo === 'etiq') { const w = await lookupReceiver(c, K.date, K.turno); spx = spxDesc(w); if (!w.error) { recv = w.name; opSpx = w.raw || ''; classe = w.classe; if (w.time) time = w.time; } }
      const rr = respFor({ date: K.date, turno: K.turno, tipo, rota, time, recv, classe });
      try {
        await B().erroSave({ date: K.date, turno: K.turno, tipo, code: c, rota, time, resp: rr.resp,
          detail: { letra: rr.letra || '', recebeu: recv, operadorSpx: opSpx, classe: rr.classe || (tipo === 'etiq' && recv ? 'etiq' : ''), mapa: rr.verFrom || '', posto: rr.posto || '', pendente: !rr.resp.length && !rr.classe, origem: 'quiosque',
            obs: rr.classe ? (spx || rr.note) : [spx, rr.note].filter((t, i, a) => t && a.indexOf(t) === i).join(' ') } });
        K.last.unshift(`${nowHm()} · ${c} · ${tipo === 'sort' ? `sorting · ${rota}` : tipo === 'xpt' ? `XPT · ${rota}` : 'etiquetagem'}`);
        q('kLast').innerHTML = K.last.slice(0, 8).map(t => `<li>${esc(t)}</li>`).join('');
        say(`✓ Registrado: ${c}`, true);
        K.busy = false; reset();
      } catch (e) { K.busy = false; sync(); say('Não foi possível registrar. Tente de novo.', false); }
    }
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      const k = b.dataset.k;
      if (k === 'exit') {
        if (!(await askKioskPassword())) { q('kCode').focus(); return; }
        el.remove(); document.body.classList.remove('kiosk-on');
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        if (ui.isActive('erros')) drawErros();
      } else if (k === 'save') save();
      else { K.tipo = k; say(''); sync(); if (k === 'sort') q('kRota').focus(); }
    });
    el.addEventListener('input', () => { say(''); sync(); });
    // Leitor de código: o código chega seguido de Enter.
    q('kCode').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (!PC.CODE_RE.test(code())) say('Código inválido. Bipe de novo.', false); else if (ready()) save(); } });
    q('kRota').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    sync(); q('kCode').focus();
  }

  // Um conjunto de eventos no <main>, ligado uma vez; cada tela só reage quando está ativa.
  let bound = false;
  function bind(ctx) {
    if (bound) return;
    bound = true;
    const main = ctx.main;
    main.addEventListener('click', e => { if (ui.isActive('mapa')) onMapaClick(e); else if (ui.isActive('erros')) onErrosClick(e); });
    main.addEventListener('change', e => { if (ui.isActive('mapa')) onMapaChange(e); else if (ui.isActive('erros')) onErrosChange(e); });
    main.addEventListener('input', e => { if (ui.isActive('mapa')) onMapaInput(e); else if (ui.isActive('erros')) onErrosInput(e); });
    // Quadro do 2º Sorting / Auditoria: arrastar cartões entre as colunas (leva junto os selecionados).
    main.addEventListener('dragstart', e => {
      const c = ui.isActive('mapa') && e.target.closest && e.target.closest('[data-bcard]');
      if (!c) return;
      const n = c.dataset.bcard, names = st.bsel.has(nk(n)) ? boardAll(st.bf).filter(x => st.bsel.has(nk(x.n))).map(x => x.n) : [n];
      e.dataTransfer.setData('text/plain', JSON.stringify(names)); e.dataTransfer.effectAllowed = 'move';
    });
    main.addEventListener('dragover', e => { const col = ui.isActive('mapa') && e.target.closest && e.target.closest('[data-bcol]'); if (col) { e.preventDefault(); col.classList.add('over'); } });
    main.addEventListener('dragleave', e => { const col = e.target.closest && e.target.closest('[data-bcol]'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); });
    main.addEventListener('drop', e => {
      const col = ui.isActive('mapa') && e.target.closest && e.target.closest('[data-bcol]');
      if (!col) return;
      e.preventDefault();
      let names = [];
      try { names = JSON.parse(e.dataTransfer.getData('text/plain')) || []; } catch (err) { return; }
      const to = col.dataset.bcol;
      const move = names.filter(n => (bStateAt(boardOf()[st.bf]).get(nk(n)) || {}).to !== to);
      if (move.length) { bMove(st.bf, move, to); st.bsel.clear(); drawMapa(); }
    });
  }

  return {
    // Usado pela tela Recebimento por hora para desenhar as bancadas do mapa.
    helpers: { slotsOf, bancadaNo, sameName, sortedVers, isDw, listKeys, xptWho, xptBase, destsOf },
    _board: { bStateAt },
    // Ao sair da tela (o app chama), o próximo acesso volta com o quadro recolhido.
    leave: () => { st.inMapa = false; },
    renderMapa: ctx => { bind(ctx); if (se.tipo === 'sort' && !se.time) se.time = nowHm(); renderMapa(ctx); },
    renderErros: ctx => { bind(ctx); if (se.tipo === 'sort' && !se.time) se.time = nowHm(); renderErros(ctx); },
    // Para testes.
    _: { nk, sameName, slotsOf, versionAt, parseLetras, slotDesc, bancadaNo, isDw, DEFAULT_LAYOUT, propagate, verDiff, xptBase, sameXpt, destsOf, mergeMaps, dividir, audRoutes, audWho, rotasDe, faixaLetra, totalRotas, parseRota },
  };
})();
