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
    letras: 'ABCDEFGHIJKL'.split(''), s2: 2, aud: 2, desc: 4, xpt: 2, s5: 2,
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
  // Colaboradores da guia HSE do mês atual (só para sugerir nomes; o mapa grava o nome como texto).
  function people() {
    const m = ui.model();
    if (!m) return [];
    const by = m.hseByMonth || {}, keys = Object.keys(by).sort();
    const hse = by[ui.ym(new Date())] || (keys.length ? by[keys[keys.length - 1]] : null) || m.hse;
    const seen = new Set();
    return ((hse && hse.people) || []).map(p => String(p.nome || '').trim()).filter(n => n && !seen.has(nk(n)) && seen.add(nk(n)))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
  // Nome digitado -> nome da lista, quando bate; senão, o texto como foi digitado.
  const canon = v => { v = String(v || '').trim().replace(/\s+/g, ' '); if (!v) return ''; const p = people().find(n => nk(n) === nk(v)); return p || v.toUpperCase(); };

  // ---------- Layout e vagas ----------
  function slotsOf(L) {
    const out = [];
    L.mesas.forEach(m => {
      for (let k = 0; k < m.ind; k++) out.push({ key: `${m.id}.ind.${k}`, func: 'ind', mesa: m.id });
      for (let s = 0; s < m.rec; s++) for (let k = 0; k < REC_SIZE; k++) out.push({ key: `${m.id}.rec.${s}.${k}`, func: 'rec', mesa: m.id, posto: `${m.id}.rec.${s}` });
      for (let k = 0; k < m.sort; k++) out.push({ key: `${m.id}.sort.${k}`, func: 'sort', mesa: m.id });
    });
    L.letras.forEach(l => {
      for (let k = 0; k < L.s2; k++) out.push({ key: `s2.${l}.${k}`, func: 's2', letra: l });
      for (let k = 0; k < L.aud; k++) out.push({ key: `aud.${l}.${k}`, func: 'aud', letra: l });
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
  // Onde fica uma vaga, em texto: "Mesa 1 · Indução", "2º Sorting letra C", "Descarga"…
  function slotDesc(key, L) {
    const p = key.split('.');
    if (p[0] === 'int') return 'Intervalo';
    if (p[0] === 's2' || p[0] === 'aud') return `${FUNCS[p[0]]} letra ${p[1]}`;
    if (FUNCS[p[0]]) return FUNCS[p[0]];
    const ms = (L.mesas || []).find(m => m.id === p[0]);
    return `${ms ? ms.nome : 'Mesa'} · ${p[1] === 'rec' ? `Receb./Etiq. posto ${+p[2] + 1} (${p[3] === '0' ? 'recebe' : 'etiqueta'})` : FUNCS[p[1]]}`;
  }

  // ================= Mapa de piso =================
  const st = { date: todayIso(), turno: TURNOS.includes(ls.turno) ? ls.turno : 'AM', ver: 0, map: null, dirty: false, locks: new Set(), undo: null };

  function loadMap() {
    const key = `${st.date}|${st.turno}`;
    const draft = (ls.drafts || {})[key];
    const saved = baseOn() ? B().mapaGet(st.date, st.turno) : null;
    if (draft && (!saved || draft.at > saved.at)) { st.map = clone(draft.map); st.dirty = true; }
    else if (saved) { st.map = clone(saved.map); st.dirty = false; }
    else {
      // Mapa novo: layout do último mapa salvo (o líder ajusta o layout uma vez e ele segue valendo).
      const last = baseOn() ? B().mapaList().pop() : null;
      st.map = { layout: clone((last && last.map.layout) || DEFAULT_LAYOUT), versions: [{ from: '', slots: {} }] };
      st.dirty = false;
    }
    if (!st.map.layout.mesas) st.map.layout = clone(DEFAULT_LAYOUT);
    if (st.map.layout.xpt == null) st.map.layout.xpt = DEFAULT_LAYOUT.xpt;   // mapas de antes da função XPT
    st.ver = Math.min(st.ver, st.map.versions.length - 1);
    st.undo = null;
  }
  function touch() {
    st.dirty = true;
    ls.drafts = ls.drafts || {};
    ls.drafts[`${st.date}|${st.turno}`] = { at: new Date().toISOString(), map: st.map };
    lsSave();
  }
  const cur = () => st.map.versions[st.ver];

  function renderMapa(ctx) {
    ui = ctx;
    if (!st.map || st.loadedKey !== `${st.date}|${st.turno}`) { loadMap(); st.loadedKey = `${st.date}|${st.turno}`; }
    drawMapa();
    if (baseOn()) B().load().then(() => { if (ui.isActive('mapa') && !st.dirty) { loadMap(); drawMapa(); } });
  }

  function drawMapa() {
    const m = ui.main, L = st.map.layout, v = cur();
    vacMap = vacated();
    const saved = baseOn() ? B().mapaGet(st.date, st.turno) : null;
    const vers = sortedVers(st.map);
    m.innerHTML = ui.head('Mapa de piso', 'Quem está em cada função · por dia e turno') + `
      <div class="au-bar pz-bar">
        <label>Dia <input type="date" id="pzDate" value="${st.date}"></label>
        <label>Turno <select id="pzTurno">${TURNOS.map(t => `<option ${t === st.turno ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <span class="pz-state ${st.dirty ? 'warn' : saved ? 'ok' : ''}">${st.dirty ? '● Alterações não salvas' : saved ? `✓ Salvo por ${esc(saved.user)} · ${new Date(saved.at).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Mapa novo'}</span>
        <div class="au-bar-right pz-actions">
          ${!saved && !st.dirty ? '<button class="tool" data-pz="copy-last" title="Copia o último mapa salvo deste turno">Copiar último mapa</button>' : ''}
          <button class="tool" data-pz="layout">Editar layout</button>
          <button class="tool" data-pz="text">Copiar texto</button>
          <button class="btn-primary solid" data-pz="save" ${baseOn() ? '' : 'disabled title="Salvar precisa do login Google e da planilha-base"'}>Salvar mapa</button>
        </div>
      </div>
      <div class="pz-vers">
        <span class="muted small">Mudanças no turno:</span>
        ${vers.map(x => `<button class="chip ${x.i === st.ver ? 'active' : ''}" data-pz-ver="${x.i}">${esc(verChip(x))}</button>`).join('')}
        <button class="tool" data-pz="add-ver" title="Nova mudança: copia o mapa atual e você altera só quem mudou de função">+ Mudança</button>
        ${st.ver > 0 ? `<label class="pz-from">Vale a partir das <input type="time" id="pzFrom" value="${esc(v.from || '')}"></label>
          <button class="tool danger" data-pz="del-ver">Excluir esta mudança</button>` : ''}
        <span class="pz-sep"></span>
        <button class="btn-ghost" data-pz="intervalo" title="Sugere quem vai para o intervalo e cria a mudança">☕ Intervalo</button>
        <button class="btn-ghost" data-pz="rodizio" title="Coloca as pessoas em funções diferentes das que fizeram nos últimos ${HIST_DAYS} dias">🔄 Rodízio</button>
        ${st.undo ? '<button class="tool" data-pz="undo">Desfazer rodízio</button>' : ''}
      </div>
      ${v.tipo === 'intervalo' ? `<div class="pz-int-hint">☕ <b>Mudança de intervalo (${esc(v.from)})</b>: ${vacMap.size} vaga(s) ficaram livres (em destaque). Você pode mudar a função de quem não foi para o intervalo para cobrir essas vagas — vale a partir das ${esc(v.from)}.
        ${st.map.versions.some(x => x.tipo === 'volta') ? 'Na <b>Volta</b>, todos retornam às funções de antes do intervalo; se alguma troca deve continuar, ajuste também a Volta.' : ''}</div>` : ''}
      <datalist id="pzPeople">${people().map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="pz-grid ${ls.sideOff ? 'side-off' : ''}" id="pzGrid">
        <div class="pz-main">
          <div class="pz-mesas">${L.mesas.map(mesaCard).join('')}</div>
          ${lettersCard()}
          <div class="pz-mesas">${simpleCard('desc', 'Descarga', L.desc)}${simpleCard('xpt', 'XPT', L.xpt || 0)}${simpleCard('s5', '5S', L.s5)}${intCard()}</div>
        </div>
        <aside class="pz-side" id="pzSide"></aside>
      </div>`;
    drawSide();
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
  const slotInput = (key, ph = '') => {
    const v = cur().slots[key] || '';
    const vac = !v && vacMap.get(key);
    if (vac) ph = `☕ ${vac} (intervalo) · quem cobre?`;
    return `<div class="pz-slot${vac ? ' vac' : ''}"><input list="pzPeople" data-slot="${key}" value="${esc(v)}" placeholder="${esc(ph)}" aria-label="${esc(ph || 'Vaga')}" autocomplete="off">
      <button class="pz-lock ${st.locks.has(key) ? 'on' : ''}" data-lock="${key}" title="${st.locks.has(key) ? 'Fixo no rodízio (clique para soltar)' : 'Fixar esta vaga no rodízio'}">${st.locks.has(key) ? '🔒' : '🔓'}</button></div>`;
  };
  const range = n => Array.from({ length: n }, (_, i) => i);
  function mesaCard(ms) {
    return `<section class="card pz-card"><div class="pz-title">${esc(ms.nome)}</div>
      ${ms.ind ? `<div class="pz-sub">Indução</div>${range(ms.ind).map(k => slotInput(`${ms.id}.ind.${k}`)).join('')}` : ''}
      ${ms.rec ? `<div class="pz-sub">Recebimento / Etiquetagem</div>${range(ms.rec).map(s => `<div class="pz-posto"><span class="muted small">Posto ${s + 1}</span>
        ${range(REC_SIZE).map(k => slotInput(`${ms.id}.rec.${s}.${k}`, k === 0 ? 'Recebe' : 'Etiqueta')).join('')}</div>`).join('')}` : ''}
      ${ms.sort ? `<div class="pz-sub">Sorting</div>${range(ms.sort).map(k => slotInput(`${ms.id}.sort.${k}`)).join('')}` : ''}
    </section>`;
  }
  function lettersCard() {
    const L = st.map.layout;
    if (!L.letras.length) return '';
    return `<section class="card pz-card"><div class="pz-title">2º Sorting e Auditoria por letra</div>
      <div class="table-wrap"><table class="pz-letters"><thead><tr><th>Letra</th><th class="left">2º Sorting</th><th class="left">Auditoria</th></tr></thead><tbody>
      ${L.letras.map(l => `<tr><td><b>${esc(l)}</b></td><td class="left"><div class="pz-row">${range(L.s2).map(k => slotInput(`s2.${l}.${k}`)).join('')}</div></td>
        <td class="left"><div class="pz-row">${range(L.aud).map(k => slotInput(`aud.${l}.${k}`)).join('')}</div></td></tr>`).join('')}
      </tbody></table></div></section>`;
  }
  const intCard = () => { const ks = intKeys(cur()); return ks.length ? `<section class="card pz-card pz-int"><div class="pz-title">☕ Intervalo</div>${ks.map(k => slotInput(k)).join('')}</section>` : ''; };
  const simpleCard = (f, title, n) => (n ? `<section class="card pz-card"><div class="pz-title">${title}</div>${range(n).map(k => slotInput(`${f}.${k}`)).join('')}</section>` : '');

  function layoutEditor() {
    const L = st.map.layout;
    const num = (name, v, extra = '') => `<input type="number" min="0" max="20" data-lay="${name}" value="${v}" ${extra}>`;
    return `<p class="muted small">Vale para este mapa e para os próximos (o mapa novo usa o layout do último salvo).</p>
      <div class="table-wrap"><table><thead><tr><th class="left">Mesa</th><th>Indução</th><th>Postos receb./etiq. (2 pessoas)</th><th>Sorting</th><th></th></tr></thead><tbody>
        ${L.mesas.map((ms, i) => `<tr><td class="left"><input type="text" data-lay="mesa.${i}.nome" value="${esc(ms.nome)}"></td>
          <td>${num(`mesa.${i}.ind`, ms.ind)}</td><td>${num(`mesa.${i}.rec`, ms.rec)}</td><td>${num(`mesa.${i}.sort`, ms.sort)}</td>
          <td><button class="tool danger" data-pz-delmesa="${i}" title="Remover mesa">Remover</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="pz-lay-row">
        <button class="tool" data-pz="add-mesa">+ Mesa</button>
        <label>Letras <input type="text" data-lay="letras" value="${esc(L.letras.length > 2 && L.letras.join('') === 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(L.letras[0].charCodeAt(0) - 65, L.letras[0].charCodeAt(0) - 65 + L.letras.length) ? `${L.letras[0]}-${L.letras[L.letras.length - 1]}` : L.letras.join(', '))}" placeholder="A-L ou A, B, C"></label>
        <label>2º Sorting por letra ${num('s2', L.s2)}</label>
        <label>Auditoria por letra ${num('aud', L.aud)}</label>
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
    dlg.addEventListener('click', e => {
      const t = e.target.closest('[data-pzl],[data-pz],[data-pz-delmesa]');
      if (!t) return;
      const d = t.dataset, L = st.map.layout;
      if (d.pzl === 'close') close();
      else if (d.pzl === 'reset') { if (confirm('Voltar ao layout padrão (4 mesas, letras A-L)?')) { st.map.layout = clone(DEFAULT_LAYOUT); redraw(); } }
      else if (d.pzDelmesa != null) { if (confirm(`Remover ${L.mesas[+d.pzDelmesa].nome}?`)) { L.mesas.splice(+d.pzDelmesa, 1); redraw(); } }
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
      else L[p[0]] = n;
      redraw();
    });
    dlg.showModal();
  }

  // Painel lateral: quem está sem função, quem está em mais de uma vaga, e quantos por função.
  function drawSide() {
    const el = $('pzSide');
    if (!el) return;
    const slots = slotsOf(st.map.layout), v = cur();
    const filled = slots.filter(s => v.slots[s.key]);
    const byName = new Map();
    filled.forEach(s => { const k = nk(v.slots[s.key]); byName.set(k, [...(byName.get(k) || []), s]); });
    const dup = [...byName.entries()].filter(([, a]) => a.length > 1);
    const inInt = new Set(intKeys(v).map(k => nk(v.slots[k])));
    const free = people().filter(n => !byName.has(nk(n)) && !inInt.has(nk(n)));
    const perFunc = Object.keys(FUNCS).map(f => [f, filled.filter(s => s.func === f).length, slots.filter(s => s.func === f).length]).filter(x => x[2]);
    document.querySelectorAll('.pz-slot input').forEach(i => {
      const k = nk(i.value);
      i.classList.toggle('dup', !!k && (byName.get(k) || []).length > 1);
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
        ${inInt.size ? `<div class="pz-kv"><span>Em intervalo</span><b>${inInt.size}</b></div>` : ''}
        ${perFunc.map(([f, n, t]) => `<div class="pz-kv"><span>${FUNCS[f]}</span><b>${n}/${t}</b></div>`).join('')}
      </section>
      ${dup.length ? `<section class="card pz-card"><div class="pz-title">Em mais de uma vaga</div>
        ${dup.map(([, a]) => `<div class="pz-warn">⚠ ${esc(v.slots[a[0].key])} <span class="muted small">(${a.map(s => FUNCS[s.func]).join(', ')})</span></div>`).join('')}
        <div class="muted small">Se a pessoa mudou de função durante o turno, use <b>+ Mudança</b> com o horário.</div></section>` : ''}
      <section class="card pz-card"><div class="pz-title">Sem função <span class="muted">(${free.length})</span></div>
        <input class="search" id="pzFree" type="search" placeholder="Buscar…">
        <div class="pz-free" id="pzFreeList">${free.map(n => `<div>${esc(n)}</div>`).join('') || '<span class="muted small">Todos da lista HSE estão no mapa.</span>'}</div>
        <div class="muted small">Lista da guia HSE do mês atual.</div></section>`;
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
        if (!name || f === 'int') return;
        const k = nk(name);
        if (!did.has(k)) did.set(k, new Set());
        did.get(k).add(f);
        if (r.turno === st.turno) { pool.set(k, name); useSlot.set(key, (useSlot.get(key) || 0) + 1); }
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
  function rodizio() {
    const v = cur(), slots = slotsOf(st.map.layout);
    const { cnt, last, pool: hPool, useSlot } = history();
    const locked = new Set(slots.filter(s => st.locks.has(s.key) && v.slots[s.key]).map(s => nk(v.slots[s.key])));
    intKeys(v).forEach(k => locked.add(nk(v.slots[k])));
    let target = slots.filter(s => v.slots[s.key] && !st.locks.has(s.key));
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
    const now = new Map(target.filter(s => v.slots[s.key]).map(s => [nk(v.slots[s.key]), s.func]));
    st.undo = clone(v.slots);
    const left = new Set(pool);
    target.slice().sort(() => Math.random() - 0.5).forEach(s => {
      let best = null, bestScore = Infinity;
      left.forEach(n => {
        const k = nk(n);
        const score = ((cnt.get(k) || {})[s.func] || 0) * 2 + (last.get(k) === s.func ? 6 : 0) + (now.get(k) === s.func ? 3 : 0) + Math.random() * 0.5;
        if (score < bestScore) { bestScore = score; best = n; }
      });
      if (best != null) { v.slots[s.key] = best; left.delete(best); } else delete v.slots[s.key];
    });
    const changed = target.filter(s => nk(st.undo[s.key]) !== nk(v.slots[s.key])).length;
    touch(); drawMapa();
    ui.toast(mode === 'preencher'
      ? `Rodízio: ${target.length - left.size} pessoa(s) do turno ${st.turno} (últimos ${HIST_DAYS} dias) colocadas em funções diferentes. Confira quem veio hoje e salve.`
      : `Rodízio: ${changed} vaga(s) mudaram. Confira e clique em Salvar mapa.`);
  }

  // ---------- Intervalo ----------
  // 1ª leva: volumoso, descarga e 1º sorting primeiro; 2ª leva: recebimento/etiquetagem primeiro.
  // Cada pessoa tira um intervalo por dia (vale para todos os turnos do dia).
  function intervaloHoje() {
    const done = new Set();
    const maps = (baseOn() ? B().mapaList() : []).filter(r => r.date === st.date && r.turno !== st.turno).map(r => r.map).concat([st.map]);
    maps.forEach(m => m.versions.forEach(v => intKeys(v).forEach(k => done.add(nk(v.slots[k])))));
    return done;
  }
  function intervaloSugestao(n) {
    const v = cur(), L = st.map.layout, slots = slotsOf(L);
    const leva = st.map.versions.some(x => x.tipo === 'intervalo') ? 2 : 1;
    const done = intervaloHoje();
    const volum = new Set(L.mesas.filter(m => /volum/i.test(m.nome)).map(m => m.id));
    const prio = s => {
      if (leva === 1) return volum.has(s.mesa) || s.func === 'desc' ? 0 : s.func === 'sort' ? 1 : s.func === 'rec' ? 5 : 3;
      return s.func === 'rec' ? 0 : 2;
    };
    const cands = slots.filter(s => v.slots[s.key]).map(s => ({ key: s.key, name: v.slots[s.key], func: s.func, where: slotDesc(s.key, L), prio: prio(s), done: done.has(nk(v.slots[s.key])) }));
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
    const v = cur(), slots = slotsOf(st.map.layout);
    const alocados = new Set(slots.filter(s => v.slots[s.key]).map(s => nk(v.slots[s.key]))).size;
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
    const go = new Set(r.data.names.map(nk));
    const base = clone(v.slots);
    const slotsInt = {};
    Object.entries(base).forEach(([k, name]) => { if (!go.has(nk(name)) && !k.startsWith('int.')) slotsInt[k] = name; });
    r.data.names.forEach((name, i) => { slotsInt[`int.${i}`] = name; });
    st.map.versions.push({ from: r.data.at, tipo: 'intervalo', slots: slotsInt });
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
      range(ms.rec).forEach(s => lines.push(`Receb./Etiq. posto ${s + 1}: ${get(`${ms.id}.rec.${s}.0`)} (recebe) + ${get(`${ms.id}.rec.${s}.1`)} (etiqueta)`));
      if (ms.sort) lines.push(`Sorting: ${list(range(ms.sort).map(k => `${ms.id}.sort.${k}`))}`);
      lines.push('');
    });
    if (L.letras.length) {
      lines.push('2º SORTING'); L.letras.forEach(l => lines.push(`${l}: ${list(range(L.s2).map(k => `s2.${l}.${k}`))}`)); lines.push('');
      lines.push('AUDITORIA'); L.letras.forEach(l => lines.push(`${l}: ${list(range(L.aud).map(k => `aud.${l}.${k}`))}`)); lines.push('');
    }
    if (L.desc) lines.push(`Descarga: ${list(range(L.desc).map(k => `desc.${k}`))}`);
    if (L.xpt) lines.push(`XPT: ${list(range(L.xpt).map(k => `xpt.${k}`))}`);
    if (L.s5) lines.push(`5S: ${list(range(L.s5).map(k => `s5.${k}`))}`);
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
    // Só grava as vagas que existem no layout atual.
    const keys = new Set(slotsOf(st.map.layout).map(s => s.key));
    st.map.versions.forEach(v => Object.keys(v.slots).forEach(k => { if ((!keys.has(k) && !k.startsWith('int.')) || !v.slots[k]) delete v.slots[k]; }));
    try {
      await B().mapaSave(st.date, st.turno, clone(st.map));
      if (ls.drafts) { delete ls.drafts[`${st.date}|${st.turno}`]; lsSave(); }
      st.dirty = false;
      ui.toast(`Mapa de ${brShort(st.date)} · ${st.turno} salvo`);
      drawMapa();
    } catch (e) { ui.toast(String(e.message || e), true); }
  }

  function onMapaClick(e) {
    const t = e.target.closest('[data-pz],[data-pz-ver],[data-lock]');
    if (!t) return;
    const d = t.dataset;
    if (d.lock) { if (!st.locks.delete(d.lock)) st.locks.add(d.lock); t.classList.toggle('on', st.locks.has(d.lock)); t.textContent = st.locks.has(d.lock) ? '🔒' : '🔓'; return; }
    if (d.pzVer != null) { st.ver = +d.pzVer; st.undo = null; drawMapa(); return; }
    const a = d.pz;
    if (a === 'save') saveMap();
    else if (a === 'text') copyText(mapText(), 'Mapa copiado');
    else if (a === 'side') { ls.sideOff = !ls.sideOff; lsSave(); const g = $('pzGrid'); if (g) g.classList.toggle('side-off', !!ls.sideOff); drawSide(); }
    else if (a === 'layout') openLayout(); else if (a === 'add-ver') {
      st.map.versions.push({ from: nowHm(), slots: clone(cur().slots) });
      st.ver = st.map.versions.length - 1; st.undo = null; touch(); drawMapa();
      ui.toast('Mudança criada com o horário de agora: ajuste o horário e quem mudou de função.');
    } else if (a === 'del-ver') {
      if (st.ver === 0) return;   // o início do turno não pode ser excluído
      if (!confirm(`Excluir a mudança "${verLabel(cur())}"?`)) return;
      st.map.versions.splice(st.ver, 1); st.ver = 0; touch(); drawMapa();
    } else if (a === 'rodizio') {
      const vazio = !slotsOf(st.map.layout).some(s => cur().slots[s.key] && !st.locks.has(s.key));
      if (confirm(vazio
        ? `Preencher o mapa com o rodízio? Entram as pessoas que trabalharam no turno ${st.turno} nos últimos ${HIST_DAYS} dias, cada uma numa função diferente das que fez. Depois confira quem veio hoje.`
        : `Fazer o rodízio desta mudança? As pessoas do mapa vão para funções diferentes das que fizeram nos últimos ${HIST_DAYS} dias. Vagas com 🔒 ficam como estão.`)) rodizio();
    } else if (a === 'intervalo') { intervalo();
    } else if (a === 'undo') { if (st.undo) { cur().slots = st.undo; st.undo = null; touch(); drawMapa(); } }
    else if (a === 'copy-last') {
      const last = baseOn() ? B().mapaList().filter(r => r.turno === st.turno && `${r.date}|${r.turno}` !== `${st.date}|${st.turno}`).pop() : null;
      if (!last) return ui.toast(`Nenhum mapa salvo do turno ${st.turno} para copiar.`, true);
      st.map = { layout: clone(last.map.layout), versions: [{ from: '', slots: clone(sortedVers(last.map).pop().slots) }] };
      st.ver = 0; touch(); drawMapa();
      ui.toast(`Copiado o mapa de ${brShort(last.date)} (última mudança). Ajuste e salve.`);
    }
  }
  function onMapaChange(e) {
    const t = e.target, d = t.dataset;
    if (t.id === 'pzDate' || t.id === 'pzTurno') {
      if (st.dirty && !confirm('Há alterações não salvas neste mapa. Elas ficam guardadas neste aparelho como rascunho. Trocar mesmo assim?')) { t.value = t.id === 'pzDate' ? st.date : st.turno; return; }
      if (t.id === 'pzDate' && t.value) st.date = t.value;
      if (t.id === 'pzTurno') { st.turno = t.value; ls.turno = t.value; lsSave(); }
      st.ver = 0; loadMap(); st.loadedKey = `${st.date}|${st.turno}`; drawMapa(); return;
    }
    if (t.id === 'pzFrom') { if (st.ver === 0) return; cur().from = t.value; touch(); drawMapa(); return; }
    if (d.slot) { setSlot(t, d.slot); return; }
  }
  // Colocar alguém numa vaga. Se a pessoa já está em outra vaga desta mudança, pergunta se é para tirar de lá.
  async function setSlot(input, key) {
    const v = cur(), name = canon(input.value), prev = v.slots[key] || '';
    if (name) {
      const other = Object.keys(v.slots).filter(k => k !== key && v.slots[k] && nk(v.slots[k]) === nk(name));
      if (other.length) {
        const where = other.map(k => slotDesc(k, st.map.layout)).join(', ');
        const r = await modal('Colaborador já está em outra função', `<p><b>${esc(name)}</b> está em <b>${esc(where)}</b> nesta mudança (${esc(verLabel(v))}).</p>
          <p class="muted">Deseja retirá-lo de lá e colocar aqui? Se a troca é só a partir de um horário, cancele e use <b>+ Mudança</b>.</p>`,
          [['cancel', 'Cancelar', 'btn-ghost'], ['keep', 'Manter nas duas', 'btn-ghost'], ['move', 'Retirar de lá', 'btn-primary solid']]);
        if (r.btn === 'cancel') { input.value = prev; return; }
        if (r.btn === 'move') other.forEach(k => { delete v.slots[k]; const el = document.querySelector(`[data-slot="${k}"]`); if (el) el.value = ''; });
      }
    }
    if (name) v.slots[key] = name; else delete v.slots[key];
    input.value = name; touch(); drawSide();
    const s = document.querySelector('.pz-state'); if (s) { s.className = 'pz-state warn'; s.textContent = '● Alterações não salvas'; }
  }
  function onMapaInput(e) {
    if (e.target.id !== 'pzFree') return;
    const q = nk(e.target.value);
    document.querySelectorAll('#pzFreeList > div').forEach(x => { x.hidden = !!q && !nk(x.textContent).includes(q); });
  }

  // ================= Erros de piso =================
  const se = { date: todayIso(), turno: st.turno, tipo: ls.tipo === 'etiq' ? 'etiq' : 'sort', code: '', rota: '', time: '', recv: '', busy: false, spxMsg: '' };
  const rotaLetra = r => { const m = String(r || '').toUpperCase().trim().match(/^([A-Z]{1,2})\s*-?\s*\d*/); return m ? m[1] : ''; };
  const mapOfDay = (iso, turno) => (baseOn() ? B().mapaGet(iso, turno) : null);

  // Responsáveis pelo erro, a partir do mapa que valia no horário.
  function responsaveis() {
    const rec = mapOfDay(se.date, se.turno);
    if (!rec) return { resp: [], note: `Sem mapa de piso salvo para ${brShort(se.date)} · ${se.turno}.` };
    const v = versionAt(rec.map, se.time), slots = slotsOf(rec.map.layout);
    const at = `mapa ${verLabel(v)}`;
    if (se.tipo === 'sort') {
      const l = rotaLetra(se.rota);
      if (!l) return { resp: [], note: 'Informe a rota do pacote (ex.: C-12).' };
      const resp = slots.filter(s => s.func === 's2' && s.letra === l).map(s => v.slots[s.key]).filter(Boolean);
      return { resp, letra: l, verFrom: v.from || '', note: resp.length ? `Possíveis responsáveis: 2º Sorting letra ${l} (${at}).` : `Ninguém no 2º Sorting da letra ${l} (${at}).` };
    }
    if (!se.recv) return { resp: [], note: 'Informe quem recebeu o pacote (ou busque no SPX).' };
    const mine = slots.find(s => s.func === 'rec' && sameName(v.slots[s.key], se.recv));
    if (!mine) return { resp: [], verFrom: v.from || '', note: `${se.recv} não está em nenhum posto de recebimento/etiquetagem (${at}).` };
    const resp = slots.filter(s => s.posto === mine.posto && s.key !== mine.key).map(s => v.slots[s.key]).filter(Boolean);
    const mesa = rec.map.layout.mesas.find(ms => ms.id === mine.mesa);
    return { resp, verFrom: v.from || '', posto: `${mesa ? mesa.nome : ''} · posto ${+mine.posto.split('.')[2] + 1}`,
      note: resp.length ? `${v.slots[mine.key]} recebeu; quem etiquetava no mesmo posto (${mesa ? mesa.nome : ''}, ${at}).` : `Posto de ${v.slots[mine.key]} sem par de etiquetagem (${at}).` };
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
    m.innerHTML = ui.head('Erros de piso', 'Sorting e etiquetagem · responsáveis pelo mapa de piso') + `
      ${baseOn() ? '' : '<div class="au-demo">Para registrar erros é preciso entrar com a conta Google (planilha-base).</div>'}
      <div class="au-bar pz-bar">
        <label>Dia <input type="date" id="peDate" value="${se.date}"></label>
        <label>Turno <select id="peTurno">${TURNOS.map(t => `<option ${t === se.turno ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <span class="muted small">${recMap ? `Mapa de piso: ${recMap.map.versions.length} mudança(s)` : '⚠ Sem mapa de piso salvo para este dia e turno'}</span>
      </div>
      <div class="grid">
        <section class="card"><div class="card-head"><div><div class="card-title">Registrar erro</div><div class="card-sub">Durante a operação, quando o erro aparece</div></div></div>
          <div class="pe-form">
            <div class="chips">${[['sort', 'Erro de sorting'], ['etiq', 'Erro de etiquetagem']].map(([k, l]) => `<button class="chip ${se.tipo === k ? 'active' : ''}" data-pe-tipo="${k}">${l}</button>`).join('')}</div>
            <label>Código do pacote (BR) <input id="peCode" type="text" value="${esc(se.code)}" placeholder="BR264457056294A" autocomplete="off"></label>
            ${se.tipo === 'sort' ? `
              <label>Rota certa do pacote <input id="peRota" type="text" value="${esc(se.rota)}" placeholder="C-12" autocomplete="off"></label>
              <label>Horário aproximado <input id="peTime" type="time" value="${esc(se.time)}"></label>
              <div class="muted small">O pacote foi para a gaiola errada: os possíveis responsáveis são todos do 2º Sorting da letra da rota.</div>` : `
              <div class="pe-row">
                <button class="tool" data-pe="spx" ${canSpx && !se.busy ? '' : 'disabled'} title="${canSpx ? 'Busca no rastreio do SPX quem recebeu o pacote no hub' : 'A busca no SPX só funciona no app do computador'}">${se.busy ? 'Buscando…' : 'Buscar quem recebeu (SPX)'}</button>
                ${se.spxMsg ? `<span class="muted small">${esc(se.spxMsg)}</span>` : ''}
              </div>
              <label>Quem recebeu <input id="peRecv" list="peRecvList" value="${esc(se.recv)}" placeholder="Nome do operador" autocomplete="off"></label>
              <datalist id="peRecvList">${recNames.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
              <label>Horário do recebimento <input id="peTime" type="time" value="${esc(se.time)}"></label>
              <div class="muted small">O responsável é quem etiquetava no mesmo posto de quem recebeu, no horário do recebimento.</div>`}
            <div class="pe-resp ${r.resp.length ? 'ok' : ''}"><b>${r.resp.length ? r.resp.map(esc).join(', ') : 'Sem responsável definido'}</b><div class="muted small">${esc(r.note)}</div></div>
            <button class="btn-primary solid" data-pe="save" ${baseOn() && se.code.trim() ? '' : 'disabled'}>Salvar erro</button>
          </div></section>
        <section class="card"><div class="card-head"><div><div class="card-title">Erros do turno</div><div class="card-sub">${brShort(se.date)} · ${se.turno} · ${today.length} erro(s)</div></div></div>
          ${today.length ? `<div class="table-wrap"><table class="pc-table"><thead><tr><th class="left">Hora</th><th class="left">Tipo</th><th class="left">Pacote</th><th class="left">Rota / quem recebeu</th><th class="left">Responsáveis</th><th></th></tr></thead><tbody>
            ${today.map(x => `<tr><td class="left">${esc(x.time) || '—'}</td><td class="left"><span class="pill ${x.tipo === 'sort' ? 'warn' : 'info'}">${x.tipo === 'sort' ? 'Sorting' : 'Etiquetagem'}</span></td>
              <td class="left pc-code">${esc(x.code)}</td><td class="left">${esc(x.tipo === 'sort' ? x.rota : (x.detail.recebeu || ''))}</td>
              <td class="left">${x.resp.length ? x.resp.map(esc).join(', ') : '<span class="muted">—</span>'}</td>
              <td><button class="tool danger" data-pe-del="${esc(x.id)}" title="Excluir este registro">Excluir</button></td></tr>`).join('')}
          </tbody></table></div>` : ui.empty('Nenhum erro registrado neste turno.')}</section>
      </div>
      <div class="section-sub pc-sec">Análise do período</div>
      <div id="peAnal"></div>`;
    drawAnalise();
  }

  function drawAnalise() {
    const el = $('peAnal');
    if (!el) return;
    const rg = ui.range();
    const list = (baseOn() ? B().erroList() : []).filter(x => x.date >= rg.from && x.date <= rg.to);
    const per = rg.from === rg.to ? brShort(rg.from) : `${brShort(rg.from)} a ${brShort(rg.to)}`;
    if (!list.length) { el.innerHTML = ui.empty(`Nenhum erro registrado em ${per}. Mude o período no filtro do topo para ver outros dias.`); return; }
    const ppl = new Map();
    list.forEach(x => x.resp.forEach(n => {
      const k = nk(n), o = ppl.get(k) || { nome: n, sort: 0, etiq: 0, days: new Set() };
      o[x.tipo === 'sort' ? 'sort' : 'etiq']++; o.days.add(x.date); ppl.set(k, o);
    }));
    const rows = [...ppl.values()].sort((a, b) => (b.sort + b.etiq) - (a.sort + a.etiq) || a.nome.localeCompare(b.nome, 'pt-BR'));
    const nS = list.filter(x => x.tipo === 'sort').length, nE = list.length - nS;
    const days = [...new Set(list.map(x => x.date))].sort();
    const byL = new Map(); list.filter(x => x.tipo === 'sort').forEach(x => { const l = x.detail.letra || rotaLetra(x.rota) || '?'; byL.set(l, (byL.get(l) || 0) + 1); });
    const letras = [...byL.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    el.innerHTML = `<div class="kpis">${[
        ui.kpi('Erros registrados', H.fmt.int(list.length), [`<span>${per}</span>`]),
        ui.kpi('Erros de sorting', H.fmt.int(nS), ['<span>gaiola errada</span>']),
        ui.kpi('Erros de etiquetagem', H.fmt.int(nE), ['<span>etiqueta errada</span>']),
        ui.kpi('Pessoas envolvidas', H.fmt.int(rows.length), ['<span>responsáveis ou possíveis</span>']),
      ].join('')}</div>
      <div class="grid">
        ${ui.card('peCh1', 'Erros por dia', 'Por tipo', { w: 8 })}
        ${ui.card('peCh2', 'Sorting por letra', 'Letra da rota do pacote', { w: 4 })}
        ${ui.card('', 'Pessoas', 'Sorting: todos do 2º Sorting da letra contam como possíveis responsáveis · Etiquetagem: quem etiquetava no posto', { w: 12,
          tools: '<button class="tool" data-pe="copy">Copiar lista</button>',
          body: `<div class="table-wrap"><table class="pc-table"><thead><tr><th class="left">Pessoa</th><th>Sorting (possível)</th><th>Etiquetagem</th><th>Total</th><th>Dias</th></tr></thead><tbody>
            ${rows.map(o => `<tr><td class="left">${esc(o.nome)}</td><td>${o.sort}</td><td>${o.etiq}</td><td><b>${o.sort + o.etiq}</b></td><td>${o.days.size}</td></tr>`).join('')}
          </tbody></table></div>` })}
      </div>`;
    H.render('peCh1', { labels: days.map(H.dayLabel), stacked: true, totals: true, datasets: [
      H.bar('Sorting', days.map(d => list.filter(x => x.date === d && x.tipo === 'sort').length || null), H.color(1)),
      H.bar('Etiquetagem', days.map(d => list.filter(x => x.date === d && x.tipo !== 'sort').length || null), H.color(2)),
    ] });
    H.render('peCh2', { labels: letras.map(x => x[0]), legend: false, datasets: [H.bar('Erros', letras.map(x => x[1]), H.color(1))] });
    st.copyRows = rows; st.copyPer = per;
  }

  async function spxReceiver() {
    const code = se.code.trim().toUpperCase();
    if (!PC.CODE_RE.test(code)) { se.spxMsg = 'Código inválido.'; return drawErros(); }
    if (!(await window.SpxSession.has())) { se.spxMsg = ''; return window.SpxSession.open(() => spxReceiver()); }
    se.busy = true; se.spxMsg = ''; drawErros();
    try {
      const r = await api().parcelTrack(code);
      if (!r.ok) se.spxMsg = r.error || 'Falha na consulta.';
      else {
        const who = PC.receiver(r.data, (window.APP_CONFIG && window.APP_CONFIG.PARCEL) || {});
        if (!who) se.spxMsg = 'O rastreio não mostra quem recebeu no hub.';
        else {
          se.recv = canon(who.name); se.time = hmOf(who.ts);
          const day = new Date(who.ts * 1000).toLocaleDateString('sv-SE', { timeZone: TZ });
          se.spxMsg = `Recebido por ${who.name} em ${brShort(day)} às ${se.time}.` + (day !== se.date ? ' (dia diferente do selecionado)' : '');
        }
      }
    } catch (e) { se.spxMsg = 'Falha na consulta.'; }
    se.busy = false; drawErros();
  }
  async function saveErro() {
    const code = se.code.trim().toUpperCase();
    if (!code || !baseOn()) return;
    const r = responsaveis();
    if (!r.resp.length && !confirm(`Nenhum responsável foi encontrado (${r.note}) Salvar mesmo assim?`)) return;
    try {
      await B().erroSave({ date: se.date, turno: se.turno, tipo: se.tipo, code, rota: se.tipo === 'sort' ? se.rota.trim().toUpperCase() : '', time: se.time,
        resp: r.resp, detail: { letra: r.letra || '', recebeu: se.tipo === 'etiq' ? se.recv : '', mapa: r.verFrom || '', posto: r.posto || '' } });
      ui.toast(`Erro de ${se.tipo === 'sort' ? 'sorting' : 'etiquetagem'} salvo · ${code}`);
      se.code = ''; se.rota = ''; se.recv = ''; se.time = se.tipo === 'sort' ? nowHm() : ''; se.spxMsg = '';
      drawErros();
      const c = $('peCode'); if (c) c.focus();
    } catch (e) { ui.toast(String(e.message || e), true); }
  }
  function onErrosClick(e) {
    const t = e.target.closest('[data-pe],[data-pe-tipo],[data-pe-del]');
    if (!t) return;
    const d = t.dataset;
    if (d.peTipo) { se.tipo = d.peTipo; ls.tipo = se.tipo; lsSave(); if (se.tipo === 'sort' && !se.time) se.time = nowHm(); drawErros(); return; }
    if (d.peDel) { if (confirm('Excluir este registro de erro?')) B().erroDelete(d.peDel).then(drawErros); return; }
    if (d.pe === 'spx') spxReceiver();
    else if (d.pe === 'save') saveErro();
    else if (d.pe === 'copy') copyText([`Erros de piso por pessoa — ${st.copyPer}`, '', ...(st.copyRows || []).map(o => `${o.nome}\tsorting ${o.sort}\tetiquetagem ${o.etiq}`)].join('\n'), 'Lista copiada');
  }
  function onErrosChange(e) {
    const t = e.target;
    if (t.id === 'peDate' && t.value) { se.date = t.value; drawErros(); }
    else if (t.id === 'peTurno') { se.turno = t.value; drawErros(); }
    else if (t.id === 'peTime') { se.time = t.value; drawErros(); }
    else if (t.id === 'peRecv') { se.recv = canon(t.value); drawErros(); }
    else if (t.id === 'peRota') { se.rota = t.value.toUpperCase(); drawErros(); }
  }
  function onErrosInput(e) {
    const t = e.target;
    // Só guarda o texto: redesenhar a cada tecla tiraria o foco do campo.
    if (t.id === 'peCode') { se.code = t.value; const b = document.querySelector('[data-pe="save"]'); if (b) b.disabled = !(baseOn() && se.code.trim()); }
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
  }

  return {
    renderMapa: ctx => { bind(ctx); if (se.tipo === 'sort' && !se.time) se.time = nowHm(); renderMapa(ctx); },
    renderErros: ctx => { bind(ctx); if (se.tipo === 'sort' && !se.time) se.time = nowHm(); renderErros(ctx); },
    // Para testes.
    _: { nk, sameName, slotsOf, versionAt, parseLetras, slotDesc, DEFAULT_LAYOUT },
  };
})();
