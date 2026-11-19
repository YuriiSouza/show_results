// HSE do mês (dentro de Lançar indicadores): o que antes era a guia HSE da planilha mensal. Colaboradores, checklists
// (Safety Walk, Cuidado ativo…), ginástica laboral por semana, DDS por dia e links. Grava o mês inteiro como um registro na
// guia HSE da planilha do hub (vale o mais recente do mês). "Copiar do mês anterior" traz a estrutura sem os status.
window.HseLanc = (() => {
  const H = window.Charts;
  const esc = H.esc;
  const B = () => window.Base;
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const STATUS = ['', 'Realizado', 'Pendente'];
  const isDone = s => /realizad|ok|conclu/i.test(s || '');
  const clone = o => JSON.parse(JSON.stringify(o));
  const st = { month: '', draft: null, base: 'null', tab: 'people', q: '' };
  let ui = null, onChange = () => {}, bound = false;

  const monthName = m => `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
  const prevMonth = m => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 2, 1)); return d.toISOString().slice(0, 7); };
  const daysOf = m => { const n = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(2, '0')}/${m.slice(5, 7)}/${m.slice(0, 4)}`); };
  const empty = m => ({ people: [], checklists: [], ginastica: [], dds: { dates: daysOf(m), rows: [] }, links: [] });
  // Garante a estrutura (registro importado pode vir com partes faltando) e o DDS com todos os dias do mês.
  function normalize(h, m) {
    const x = { ...empty(m), ...(h || {}) };
    x.people = x.people || []; x.checklists = x.checklists || []; x.ginastica = x.ginastica || []; x.links = x.links || [];
    const days = daysOf(m), dd = x.dds || { dates: [], rows: [] };
    x.dds = { dates: days, rows: (dd.rows || []).map(r => ({ turno: r.turno, values: days.map(d => { const k = (dd.dates || []).indexOf(d); return k >= 0 ? r.values[k] || '' : ''; }) })) };
    return x;
  }
  const sig = h => JSON.stringify(h);

  function load(month) {
    if (st.month === month && st.draft) return;
    st.month = month;
    const cur = B().hseGet(month);
    st.draft = normalize(cur ? clone(cur) : null, month);
    st.base = cur ? sig(normalize(clone(cur), month)) : sig(normalize(null, month));
  }
  const dirty = () => !!st.draft && sig(st.draft) !== st.base;

  // ---------- Edição genérica: caminho "people.3.nome" no rascunho ----------
  function setPath(path, v) {
    const k = path.split('.'), last = k.pop();
    const o = k.reduce((a, x) => a[x], st.draft);
    o[last] = v;
  }
  const getPath = path => path.split('.').reduce((a, x) => (a == null ? a : a[x]), st.draft);

  const sel = (path, v) => `<select class="hs-st ${isDone(v) ? 'ok' : v ? 'pend' : ''}" data-hs="${path}">${[...new Set([...STATUS, v || ''])].map(o => `<option ${o === (v || '') ? 'selected' : ''} value="${esc(o)}">${o || '—'}</option>`).join('')}</select>`;
  const inp = (path, v, ph = '', cls = '') => `<input class="hs-in ${cls}" data-hs="${path}" value="${esc(v || '')}" placeholder="${esc(ph)}" autocomplete="off">`;
  const del = (act, i, j) => `<button class="hs-del" data-hs-act="${act}" data-i="${i}" ${j != null ? `data-j="${j}"` : ''} title="Remover" aria-label="Remover">×</button>`;

  const TABS = [['people', 'Colaboradores'], ['checklists', 'Checklists'], ['gin', 'Ginástica laboral'], ['dds', 'DDS'], ['links', 'Links']];
  function panel(month, ro) {
    load(month);
    const h = st.draft, meta = B().hseMeta(month);
    const count = { people: h.people.length, checklists: h.checklists.length, gin: h.ginastica.length, dds: h.dds.rows.length, links: h.links.length };
    return `<header class="lc-mh"><div><h2>HSE · ${monthName(month)}</h2><p>Colaboradores, checklists, ginástica laboral, DDS e links do mês. O HSE é lançado por mês (o dia escolhido ao lado define o mês).</p></div>
        <div class="lc-last">${meta ? `Último lançamento<br><b>${esc(meta.user)}</b> · ${esc(new Date(meta.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}` : 'Nada lançado neste mês'}
        ${ro ? '' : `<br><button class="tool hs-copy" data-hs-act="copy" title="Traz colaboradores, checklists, turnos e links do mês anterior, sem os status">Copiar de ${monthName(prevMonth(month)).toLowerCase()}</button>`}</div></header>
      <div class="hs-tabs">${TABS.map(([k, l]) => `<button class="${st.tab === k ? 'on' : ''}" data-hs-tab="${k}">${l}<span>${count[k]}</span></button>`).join('')}</div>
      <div class="hs-body ${ro ? 'ro' : ''}">${({ people: peopleHtml, checklists: checkHtml, gin: ginHtml, dds: ddsHtml, links: linksHtml })[st.tab](h, ro)}</div>`;
  }
  function peopleHtml(h, ro) {
    const q = st.q.trim().toLowerCase();
    return `<div class="hs-tools"><input type="search" class="hs-search" id="hsQ" placeholder="Buscar nome, código, líder…" value="${esc(st.q)}">
        ${ro ? '' : '<button class="btn-ghost" data-hs-act="addPerson">+ Colaborador</button>'}</div>
      <div class="table-wrap hs-tw"><table class="hs-table"><thead><tr><th>Nome</th><th>Código</th><th>BPO</th><th>Contrato</th><th>Líder</th><th>Status</th><th></th></tr></thead><tbody>
      ${h.people.map((p, i) => (!q || Object.values(p).join(' ').toLowerCase().includes(q)) ? `<tr>
        <td>${inp(`people.${i}.nome`, p.nome, 'Nome', 'w-name')}</td><td>${inp(`people.${i}.codigo`, p.codigo, 'Código')}</td><td>${inp(`people.${i}.bpo`, p.bpo, 'BPO')}</td>
        <td>${inp(`people.${i}.contrato`, p.contrato, 'Contrato')}</td><td>${inp(`people.${i}.lider`, p.lider, 'Líder')}</td><td>${sel(`people.${i}.status`, p.status)}</td><td>${ro ? '' : del('delPerson', i)}</td></tr>` : '').join('')}
      </tbody></table></div>${h.people.length ? '' : '<p class="muted hs-empty">Nenhum colaborador. Use "Copiar do mês anterior" ou "+ Colaborador".</p>'}`;
  }
  function checkHtml(h, ro) {
    return `<div class="hs-tools"><span class="muted small">Ex.: Safety Walk, Cuidado ativo, Parada de segurança. Cada item com o seu status.</span>
        ${ro ? '' : '<button class="btn-ghost" data-hs-act="addCheck">+ Checklist</button>'}</div>
      <div class="hs-checks">${h.checklists.map((c, i) => {
        const done = c.items.filter(x => isDone(x.status)).length;
        return `<div class="hs-check"><div class="hs-check-h">${inp(`checklists.${i}.title`, c.title, 'Nome do checklist', 'hs-title')}<span class="muted small">${done}/${c.items.length}</span>${ro ? '' : del('delCheck', i)}</div>
          ${c.items.map((x, j) => `<div class="hs-item">${inp(`checklists.${i}.items.${j}.nome`, x.nome, 'Líder / turno')}${sel(`checklists.${i}.items.${j}.status`, x.status)}${ro ? '' : del('delItem', i, j)}</div>`).join('')}
          ${ro ? '' : `<button class="hs-add" data-hs-act="addItem" data-i="${i}">+ item</button>`}</div>`;
      }).join('')}</div>${h.checklists.length ? '' : '<p class="muted hs-empty">Nenhum checklist.</p>'}`;
  }
  function ginHtml(h, ro) {
    const weeks = (h.ginastica[0] && h.ginastica[0].semanas.map(s => s.semana)) || [];
    return `<div class="hs-tools"><span class="muted small">Status da ginástica laboral por turno em cada semana.</span>
        ${ro ? '' : '<button class="btn-ghost" data-hs-act="addWeek">+ Semana</button><button class="btn-ghost" data-hs-act="addTurno">+ Turno</button>'}</div>
      ${h.ginastica.length ? `<div class="table-wrap hs-tw"><table class="hs-table"><thead><tr><th>Turno</th>${weeks.map((w, k) => `<th>${inp(`gw.${k}`, w, 'Semana', 'hs-week')}</th>`).join('')}<th></th></tr></thead><tbody>
      ${h.ginastica.map((g, i) => `<tr><td>${inp(`ginastica.${i}.turno`, g.turno, 'Turno')}</td>${g.semanas.map((s, k) => `<td>${sel(`ginastica.${i}.semanas.${k}.status`, s.status)}</td>`).join('')}<td>${ro ? '' : del('delTurno', i)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted hs-empty">Nenhum turno. Clique em "+ Turno".</p>'}`;
  }
  function ddsHtml(h, ro) {
    const d = h.dds;
    return `<div class="hs-tools"><span class="muted small">Clique no dia para alternar: ✓ realizado → ! pendente → vazio.</span>
        ${ro ? '' : '<button class="btn-ghost" data-hs-act="addDds">+ Turno</button>'}</div>
      ${d.rows.length ? `<div class="hs-dds" style="--n:${d.dates.length}"><div></div>${d.dates.map(x => `<div class="hs-dh">${x.slice(0, 2)}</div>`).join('')}<div></div>
        ${d.rows.map((r, i) => `<div class="hs-dt">${inp(`dds.rows.${i}.turno`, r.turno, 'Turno')}</div>${r.values.map((v, k) => `<button class="hs-dc ${!v ? '' : isDone(v) ? 'ok' : 'pend'}" data-hs-act="ddsCycle" data-i="${i}" data-j="${k}" title="${esc(d.dates[k])}: ${esc(v || 'sem registro')}" ${ro ? 'disabled' : ''}>${!v ? '' : isDone(v) ? '✓' : '!'}</button>`).join('')}<div>${ro ? '' : del('delDds', i)}</div>`).join('')}
      </div>` : '<p class="muted hs-empty">Nenhum turno. Clique em "+ Turno".</p>'}`;
  }
  function linksHtml(h, ro) {
    return `<div class="hs-tools"><span class="muted small">Links que aparecem na tela HSE.</span>${ro ? '' : '<button class="btn-ghost" data-hs-act="addLink">+ Link</button>'}</div>
      ${h.links.map((l, i) => `<div class="hs-link">${inp(`links.${i}.label`, l.label, 'Nome')}${inp(`links.${i}.url`, l.url, 'https://…', 'w-url')}${ro ? '' : del('delLink', i)}</div>`).join('')}
      ${h.links.length ? '' : '<p class="muted hs-empty">Nenhum link.</p>'}`;
  }

  // ---------- Ações ----------
  function act(a, i, j) {
    const h = st.draft;
    const weeks = (h.ginastica[0] && h.ginastica[0].semanas.map(s => s.semana)) || ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'];
    switch (a) {
      case 'addPerson': h.people.unshift({ nome: '', codigo: '', bpo: '', contrato: '', lider: '', status: '' }); st.q = ''; break;
      case 'delPerson': h.people.splice(i, 1); break;
      case 'addCheck': h.checklists.push({ title: '', col: 'Lider', items: [] }); break;
      case 'delCheck': h.checklists.splice(i, 1); break;
      case 'addItem': h.checklists[i].items.push({ nome: '', status: '' }); break;
      case 'delItem': h.checklists[i].items.splice(j, 1); break;
      case 'addTurno': h.ginastica.push({ turno: '', semanas: weeks.map(w => ({ semana: w, status: '' })) }); break;
      case 'addWeek': if (!h.ginastica.length) h.ginastica.push({ turno: '', semanas: [] }); h.ginastica.forEach(g => g.semanas.push({ semana: `Semana ${g.semanas.length + 1}`, status: '' })); break;
      case 'delTurno': h.ginastica.splice(i, 1); break;
      case 'addDds': h.dds.rows.push({ turno: '', values: h.dds.dates.map(() => '') }); break;
      case 'delDds': h.dds.rows.splice(i, 1); break;
      case 'ddsCycle': { const v = h.dds.rows[i].values[j]; h.dds.rows[i].values[j] = !v ? 'Realizado' : isDone(v) ? 'Pendente' : ''; break; }
      case 'addLink': h.links.push({ label: '', url: '' }); break;
      case 'delLink': h.links.splice(i, 1); break;
      default: return false;
    }
    return true;
  }
  // Estrutura do mês anterior sem os status (colaboradores, checklists, turnos e links).
  async function copyPrev() {
    const pm = prevMonth(st.month), src = B().hseGet(pm);
    if (!src) return ui.toast(`Não há HSE lançado em ${monthName(pm).toLowerCase()}.`, true);
    const h = st.draft;
    const has = h.people.length || h.checklists.length || h.ginastica.length || h.dds.rows.length || h.links.length;
    if (has && !(await window.uiConfirm(`Substituir o que já está em ${monthName(st.month)} pela estrutura de ${monthName(pm).toLowerCase()}?`, { ok: 'Substituir' }))) return;
    const s = normalize(clone(src), pm);
    st.draft = normalize({
      people: s.people.map(p => ({ ...p, status: '' })),
      checklists: s.checklists.map(c => ({ ...c, items: c.items.map(x => ({ nome: x.nome, status: '' })) })),
      ginastica: s.ginastica.map(g => ({ turno: g.turno, semanas: g.semanas.map((w, k) => ({ semana: `Semana ${k + 1}`, status: '' })) })),
      dds: { dates: [], rows: s.dds.rows.map(r => ({ turno: r.turno, values: [] })) },
      links: s.links.map(l => ({ ...l })),
    }, st.month);
    onChange(true);
  }
  // Limpa linhas vazias antes de gravar.
  function cleaned() {
    const h = clone(st.draft);
    h.people = h.people.filter(p => String(p.nome || '').trim());
    h.checklists = h.checklists.filter(c => String(c.title || '').trim() || c.items.length).map(c => ({ ...c, items: c.items.filter(x => String(x.nome || '').trim()) }));
    h.ginastica = h.ginastica.filter(g => String(g.turno || '').trim());
    h.dds.rows = h.dds.rows.filter(r => String(r.turno || '').trim());
    h.links = h.links.filter(l => String(l.url || '').trim());
    return h;
  }
  async function save() {
    const h = cleaned();
    await B().hseSave(st.month, h);
    st.draft = normalize(clone(h), st.month); st.base = sig(st.draft);
  }
  function reset() { st.draft = null; st.month = ''; }

  function attach(ctx, changed) {
    ui = ctx; onChange = changed;
    if (bound) return;
    bound = true;
    const main = ui.main, on = () => ui.isActive() && st.draft && main.querySelector('.hs-body');
    main.addEventListener('click', e => {
      if (!on() && !e.target.closest('[data-hs-tab],[data-hs-act="copy"]')) return;
      const tb = e.target.closest('[data-hs-tab]');
      if (tb) { st.tab = tb.dataset.hsTab; onChange(true); return; }
      const b = e.target.closest('[data-hs-act]');
      if (!b) return;
      if (b.dataset.hsAct === 'copy') { copyPrev(); return; }
      if (act(b.dataset.hsAct, +b.dataset.i, +b.dataset.j)) {
        onChange(true);
        if (b.dataset.hsAct === 'addPerson') { const f = main.querySelector('[data-hs="people.0.nome"]'); if (f) f.focus(); }
      }
    });
    const edit = e => {
      const t = e.target;
      if (!on()) return;
      if (t.id === 'hsQ') { st.q = t.value; const pos = t.selectionStart; onChange(true); const n = document.getElementById('hsQ'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
      const path = t.dataset && t.dataset.hs;
      if (!path) return;
      if (path.startsWith('gw.')) { const k = +path.slice(3); st.draft.ginastica.forEach(g => { if (g.semanas[k]) g.semanas[k].semana = t.value; }); }
      else setPath(path, t.value);
      if (t.tagName === 'SELECT') t.className = `hs-st ${isDone(t.value) ? 'ok' : t.value ? 'pend' : ''}`;
      onChange(false);
    };
    main.addEventListener('input', edit);
    main.addEventListener('change', e => { if (e.target.tagName === 'SELECT') edit(e); });
  }

  return { panel, dirty, save, reset, attach, monthName, _: { normalize, getPath } };
})();
