// Administração (só Admin, modo multi-hub): usuários (e-mail Google, papel, hubs) e hubs (dados do hub e planilha de dados
// de cada ano). Tudo fica na planilha Central (js/central.js). Lembrete: o acesso de verdade é o compartilhamento das
// planilhas do hub no Google Drive; a tela mostra os links para compartilhar.
window.Admin = (() => {
  const H = window.Charts;
  const esc = H.esc;
  const CT = () => window.Central;
  let ui = null, bound = false;
  const st = { view: 'users', user: null, hub: null, q: '' };
  const $ = id => document.getElementById(id);
  const when = iso => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const opts = (list, cur) => list.map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const emptyUser = () => ({ email: '', nome: '', papel: 'Analista', hubs: [], status: 'ativo', isNew: true });
  // Metas do hub: [chave, rótulo, é percentual].
  const METAS = [['absMax', '% ABS máximo', true], ['dsMin', '% DS mínimo', true], ['dsD0Min', '% DS D0 mínimo', true],
    ['aderenciaMin', '% Aderência mínima (real ÷ projetado)', true], ['missingMax', '% Missing máximo', true], ['phd', 'PHD (pacotes por pessoa)', false],
    ['tempoConferenciaMin', 'Conferência por AT (minutos)', false]];
  const JAN = [['AM', 'inicio', 'AM: início'], ['AM', 'fim', 'AM: fim'], ['PM1', 'inicio', 'PM1: início'], ['PM1', 'fim', 'PM1: fim'],
    ['PM1', 'backlogAntes', 'PM1: backlog antes de'], ['PM2', 'inicio', 'PM2: início'], ['PM2', 'fim', 'PM2: fim']];
  const emptyHub = () => ({ id: '', nome: '', cidade: '', status: 'ativo', cfg: { PARCEL: {} }, isNew: true });

  function render(ctx) {
    ui = ctx;
    if (!bound) { bound = true; bind(); }
    draw();
  }
  const tabs = () => `<div class="pc-tabs" role="tablist">${[['users', 'Usuários'], ['hubs', 'Hubs']].map(([k, l]) =>
    `<button role="tab" class="${st.view === k ? 'active' : ''}" aria-selected="${st.view === k}" data-ad-view="${k}">${l}</button>`).join('')}</div>`;
  function draw() {
    if (!CT() || !CT().isAdmin()) { ui.main.innerHTML = ui.head('Administração') + ui.empty('Só o administrador acessa esta tela.'); return; }
    if (st.view === 'hubs') return drawHubs();
    return drawUsers();
  }
  const fileLinks = hubIds => CT().files().filter(f => f.status !== 'inativo' && (hubIds.includes('*') || hubIds.includes(f.hub)))
    .map(f => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.hub)} ${esc(f.ano)}</a>`).join(' · ');

  // ---------- Usuários ----------
  function drawUsers() {
    const u = st.user || emptyUser();
    const hubs = CT().hubs();
    const multi = CT().MULTI.includes(u.papel);
    const q = st.q.trim().toLowerCase();
    const list = CT().users().filter(x => !q || `${x.email} ${x.nome} ${x.papel} ${x.hubs.join(' ')}`.toLowerCase().includes(q));
    ui.main.innerHTML = ui.head('Administração', `Planilha Central · <a href="${esc(CT().sheetUrl())}" target="_blank" rel="noopener">abrir</a>`) + tabs() + `
      <div class="grid">
        <section class="card w5 adm-card"><div class="card-head"><div><div class="card-title">${u.isNew ? 'Novo usuário' : 'Editar usuário'}</div>
          <div class="card-sub">O usuário entra com a conta Google do e-mail informado.</div></div>
          ${u.isNew ? '' : '<div class="card-tools"><button class="tool" data-ad="newuser">+ Novo</button></div>'}</div>
          <form class="adm-form" id="adUserForm" autocomplete="off">
            <label>E-mail (conta Google)<input id="adEmail" type="email" value="${esc(u.email)}" ${u.isNew ? '' : 'readonly'} placeholder="nome@empresa.com" required></label>
            <label>Nome<input id="adNome" type="text" value="${esc(u.nome)}" placeholder="Como aparece nos registros"></label>
            <div class="adm-pair">
              <label>Papel<select id="adPapel">${opts(CT().ROLES, u.papel)}</select></label>
              <label>Status<select id="adStatus">${opts(['ativo', 'inativo'], u.status)}</select></label>
            </div>
            <div class="adm-hubs"><div class="adm-lbl">Hubs ${u.papel === 'Admin' ? '<span class="muted small">(Admin vê todos)</span>' : multi ? '<span class="muted small">(pode ter vários)</span>' : '<span class="muted small">(um hub só)</span>'}</div>
              ${hubs.length ? hubs.map(h => `<label class="adm-chk"><input type="${multi ? 'checkbox' : 'radio'}" name="adHub" value="${esc(h.id)}" ${u.papel === 'Admin' ? 'disabled checked' : u.hubs.includes(h.id) ? 'checked' : ''}> ${esc(h.id)} <span class="muted small">${esc(h.nome)}</span></label>`).join('') : '<span class="muted small">Cadastre um hub primeiro.</span>'}
            </div>
            <div class="adm-note">${CT().READONLY.includes(u.papel) ? '🔒 Papel só de consulta: compartilhe as planilhas do hub como <b>Leitor</b>.' : 'Compartilhe as planilhas do hub com este e-mail como <b>Editor</b>.'}
              ${fileLinks(u.papel === 'Admin' ? ['*'] : u.hubs) ? `<br>Planilhas: ${fileLinks(u.papel === 'Admin' ? ['*'] : u.hubs)}` : ''}</div>
            <div class="adm-actions"><button type="submit" class="btn-primary solid" id="adUserSave">Salvar usuário</button></div>
          </form></section>
        <section class="card w7"><div class="card-head"><div><div class="card-title">Usuários</div><div class="card-sub">${list.length} de ${CT().users().length}</div></div>
          <div class="card-tools"><input type="search" id="adQ" class="adm-search" placeholder="Buscar e-mail, nome, hub…" value="${esc(st.q)}"></div></div>
          <div class="table-wrap"><table class="pc-table adm-table"><thead><tr><th class="left">E-mail</th><th class="left">Nome</th><th class="left">Papel</th><th class="left">Hubs</th><th class="left">Status</th><th class="left">Atualizado</th><th></th></tr></thead><tbody>
          ${list.map(x => `<tr class="${x.status === 'inativo' ? 'adm-off' : ''}"><td class="left">${esc(x.email)}${x.email === CT().email() ? ' <span class="pill">você</span>' : ''}</td><td class="left">${esc(x.nome)}</td>
            <td class="left"><span class="pill ${x.papel === 'Admin' ? 'good' : CT().READONLY.includes(x.papel) ? 'warn' : ''}">${esc(x.papel)}</span></td>
            <td class="left">${esc(x.hubs.includes('*') ? 'Todos' : x.hubs.join(', '))}</td><td class="left">${esc(x.status)}</td>
            <td class="left muted small">${esc(when(x.at))}<br>${esc(x.by)}</td>
            <td><button class="tool" data-ad-edit="${esc(x.email)}">Editar</button></td></tr>`).join('')}
          </tbody></table></div></section>
      </div>`;
  }
  async function saveUser() {
    const u = st.user || emptyUser();
    const papel = $('adPapel').value;
    const hubs = [...ui.main.querySelectorAll('input[name="adHub"]:checked')].map(i => i.value);
    const rec = { email: u.isNew ? $('adEmail').value : u.email, nome: $('adNome').value.trim(), papel, status: $('adStatus').value, hubs };
    const btn = $('adUserSave');
    btn.disabled = true; btn.textContent = 'Salvando…';
    try {
      await CT().saveUser(rec);
      ui.toast(`Usuário ${rec.email.trim().toLowerCase()} salvo`);
      st.user = null; draw();
    } catch (e) { ui.toast(String(e.message || e), true); btn.disabled = false; btn.textContent = 'Salvar usuário'; }
  }

  // ---------- Hubs ----------
  function drawHubs() {
    const h = st.hub || emptyHub();
    const P = (h.cfg && h.cfg.PARCEL) || {};
    // Hub novo começa com as metas e janelas do hub atual.
    const M = { ...(h.isNew ? window.APP_CONFIG.METAS : {}), ...((h.cfg || {}).METAS || {}) };
    const J = { ...(h.isNew ? window.APP_CONFIG.RECEB_JANELAS : {}), ...((h.cfg || {}).RECEB_JANELAS || {}) };
    const files = CT().files().filter(f => f.hub === h.id);
    const nUsers = id => CT().users().filter(u => u.status !== 'inativo' && (u.hubs.includes(id) || u.hubs.includes('*'))).length;
    ui.main.innerHTML = ui.head('Administração', `Planilha Central · <a href="${esc(CT().sheetUrl())}" target="_blank" rel="noopener">abrir</a>`) + tabs() + `
      <div class="grid">
        <section class="card w5 adm-card"><div class="card-head"><div><div class="card-title">${h.isNew ? 'Novo hub' : `Hub ${esc(h.id)}`}</div>
          <div class="card-sub">Dados do hub e a estação usada nas buscas do SPX.</div></div>
          ${h.isNew ? '' : '<div class="card-tools"><button class="tool" data-ad="newhub">+ Novo</button></div>'}</div>
          <form class="adm-form" id="adHubForm" autocomplete="off">
            <div class="adm-pair">
              <label>ID<input id="adHid" type="text" value="${esc(h.id)}" ${h.isNew ? '' : 'readonly'} placeholder="LGO03" required></label>
              <label>Status<select id="adHstatus">${opts(['ativo', 'inativo'], h.status)}</select></label>
            </div>
            <label>Nome<input id="adHnome" type="text" value="${esc(h.nome)}" placeholder="HUB LGO 03" required></label>
            <label>Cidade<input id="adHcid" type="text" value="${esc(h.cidade)}" placeholder="Anápolis"></label>
            <div class="adm-pair">
              <label>Estação no SPX<input id="adHst" type="text" value="${esc(P.stationName || '')}" placeholder="LM Hub_GO_Anápolis"></label>
              <label>ID da estação<input id="adHsid" type="number" value="${esc(P.stationId || '')}" placeholder="9657"></label>
            </div>
            <label>Código no Sort Code<input id="adHcode" type="text" value="${esc(P.hubCode || '')}" placeholder="HUB-LGO-03"></label>
            <details class="adm-sec" open><summary>Metas</summary>
              <div class="adm-grid3">${METAS.map(([k, l, pct]) => { const v = M[k]; return `<label>${l}<input data-meta="${k}" type="number" step="any" value="${v == null || v === '' ? '' : pct ? +(v * 100).toFixed(4) : v}"></label>`; }).join('')}</div>
            </details>
            <details class="adm-sec"><summary>Janelas de recebimento (erros de etiquetagem) e Parcel</summary>
              <div class="adm-grid3">${JAN.map(([t, k, l]) => `<label>${l}<input data-jan="${t}.${k}" type="time" value="${esc(((J[t] || {})[k]) || '')}"></label>`).join('')}
                <label>AT do Parcel a partir de (hora da véspera)<input id="adHat" type="number" min="0" max="23" value="${esc(P.atFromHour != null ? P.atFromHour : 21)}"></label></div>
              <p class="muted small">Turno sem início e fim fica sem janela (o erro de etiquetagem fica sem etiquetador).</p>
            </details>
            <div class="adm-actions"><button type="submit" class="btn-primary solid" id="adHubSave">Salvar hub</button></div>
          </form>
          ${h.isNew ? '' : `<div class="adm-files"><div class="adm-lbl">Planilha de dados por ano</div>
            ${files.length ? `<ul>${files.map(f => `<li><b>${esc(f.ano)}</b> · <a href="${esc(f.url)}" target="_blank" rel="noopener">abrir</a> ${f.status === 'inativo' ? '<span class="pill warn">inativa</span>' : ''} <span class="muted small">${esc(when(f.at))}</span></li>`).join('')}</ul>` : '<p class="muted small">Nenhuma planilha vinculada: o hub não grava nada até ter uma.</p>'}
            <form class="adm-form adm-file" id="adFileForm">
              <div class="adm-pair adm-pair-f"><label>Ano<input id="adFano" type="text" inputmode="numeric" value="${esc(CT().year())}" maxlength="4"></label>
              <label>Link da planilha<input id="adFurl" type="url" placeholder="https://docs.google.com/spreadsheets/d/…"></label></div>
              <p class="muted small">Crie a planilha no Drive do hub, compartilhe com você como Editor e cole o link: o app cria as guias.</p>
              <div class="adm-actions"><button type="submit" class="btn-primary" id="adFileSave">Vincular planilha</button></div>
            </form></div>
          <div class="adm-files"><div class="adm-lbl">Importar planilhas mensais</div>
            <p class="muted small">Copia os indicadores do dia (Recebimento, HC, Inventário, Reversa, Transporte, Gerencial) e o HSE de cada
              planilha mensal para a planilha de dados do hub. As planilhas mensais são <b>só lidas</b>, nada é alterado nelas. Pode repetir:
              só entra o que mudou.</p>
            <form class="adm-form" id="adImpForm"><label>Links das planilhas mensais (um por linha)
              <textarea id="adImpLinks" rows="5" spellcheck="false">${esc(st.impLinks != null ? st.impLinks : h.id === ((window.APP_CONFIG.CENTRAL_SEED || {}).hub || '') ? Object.values(window.APP_CONFIG.MONTHLY_SHEETS_IMPORT || {}).join('\n') : '')}</textarea></label>
              <div class="muted small" id="adImpMsg">${esc(st.impMsg || '')}</div>
              <div class="adm-actions"><button type="submit" class="btn-primary" id="adImpGo" ${st.importing ? 'disabled' : ''}>${st.importing ? 'Importando…' : 'Importar para a planilha do hub'}</button></div>
            </form></div>`}
        </section>
        <section class="card w7"><div class="card-head"><div><div class="card-title">Hubs</div><div class="card-sub">${CT().hubs().length} cadastrado(s)</div></div></div>
          <div class="table-wrap"><table class="pc-table adm-table"><thead><tr><th class="left">ID</th><th class="left">Nome</th><th class="left">Estação SPX</th><th class="left">Planilha ${esc(CT().year())}</th><th>Usuários</th><th class="left">Status</th><th></th></tr></thead><tbody>
          ${CT().hubs().map(x => { const f = CT().dataFile(x); return `<tr class="${x.status === 'inativo' ? 'adm-off' : ''}"><td class="left"><b>${esc(x.id)}</b></td><td class="left">${esc(x.nome)}<br><span class="muted small">${esc(x.cidade)}</span></td>
            <td class="left">${esc(((x.cfg || {}).PARCEL || {}).stationName || '—')}</td>
            <td class="left">${f ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.ano)}</a>${f.ano !== CT().year() ? ' <span class="pill warn">ano anterior</span>' : ''}` : '<span class="pill bad">sem planilha</span>'}</td>
            <td>${nUsers(x.id)}</td><td class="left">${esc(x.status)}</td><td><button class="tool" data-ad-hub="${esc(x.id)}">Editar</button></td></tr>`; }).join('')}
          </tbody></table></div></section>
      </div>`;
  }
  async function saveHub() {
    const h = st.hub || emptyHub();
    const sid = $('adHsid').value.trim();
    const PARCEL = { ...((h.cfg || {}).PARCEL || {}), stationName: $('adHst').value.trim(), hubCode: $('adHcode').value.trim(), ...(sid ? { stationId: Number(sid) } : {}) };
    if (!PARCEL.stationName) delete PARCEL.stationName;
    if (!PARCEL.hubCode) delete PARCEL.hubCode;
    const at = $('adHat').value.trim();
    if (at !== '') PARCEL.atFromHour = Math.max(0, Math.min(23, Number(at)));
    const METASv = {};
    ui.main.querySelectorAll('[data-meta]').forEach(i => {
      const def = METAS.find(x => x[0] === i.dataset.meta), v = i.value.trim();
      if (v !== '' && isFinite(Number(v))) METASv[i.dataset.meta] = def[2] ? Number(v) / 100 : Number(v);
    });
    const JANv = {};
    ['AM', 'PM1', 'PM2'].forEach(t => {
      const g = k => { const i = ui.main.querySelector(`[data-jan="${t}.${k}"]`); return i ? i.value : ''; };
      JANv[t] = g('inicio') && g('fim') ? { inicio: g('inicio'), fim: g('fim'), ...(g('backlogAntes') ? { backlogAntes: g('backlogAntes') } : {}) } : null;
    });
    const rec = { id: h.isNew ? $('adHid').value : h.id, nome: $('adHnome').value.trim(), cidade: $('adHcid').value.trim(), status: $('adHstatus').value,
      cfg: { ...(h.cfg || {}), PARCEL, METAS: METASv, RECEB_JANELAS: JANv } };
    const btn = $('adHubSave');
    btn.disabled = true; btn.textContent = 'Salvando…';
    try {
      await CT().saveHub(rec);
      ui.toast(`Hub ${rec.id.toUpperCase()} salvo`);
      st.hub = CT().hubs().find(x => x.id === rec.id.trim().toUpperCase()) || null; draw();
    } catch (e) { ui.toast(String(e.message || e), true); btn.disabled = false; btn.textContent = 'Salvar hub'; }
  }
  async function saveFile() {
    const h = st.hub;
    if (!h) return;
    const btn = $('adFileSave');
    btn.disabled = true; btn.textContent = 'Conferindo a planilha…';
    try {
      await CT().saveFile({ hub: h.id, ano: $('adFano').value.trim(), url: $('adFurl').value.trim() });
      ui.toast('Planilha vinculada: as guias do app foram criadas');
      draw();
    } catch (e) { ui.toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); btn.disabled = false; btn.textContent = 'Vincular planilha'; }
  }

  // Importa as planilhas mensais (só leitura) para a guia Indicadores (e HSE) da planilha de dados do hub, por ano.
  async function importMonthly() {
    const h = st.hub, api = window.hubApi, B = window.Base, C = window.APP_CONFIG;
    if (!h || st.importing) return;
    const links = $('adImpLinks').value.split(/\s+/).map(x => x.trim()).filter(x => /\/spreadsheets\/d\//.test(x));
    st.impLinks = $('adImpLinks').value;
    if (!links.length) return ui.toast('Cole pelo menos um link de planilha mensal.', true);
    const say = t => { st.impMsg = t; const el = $('adImpMsg'); if (el) el.textContent = t; };
    st.importing = true; draw();
    const who = (CT().me() || {}).nome || CT().email(), at = new Date().toISOString();
    const targets = new Map();   // ano -> { file, existing, rows, hse }
    const target = async ano => {
      if (targets.has(ano)) return targets.get(ano);
      const f = CT().files().find(x => x.hub === h.id && x.ano === ano && x.status !== 'inativo' && x.id);
      if (!f) throw new Error(`O hub ${h.id} não tem planilha de dados de ${ano}: vincule uma antes de importar.`);
      const t = { file: f, existing: B.parseExisting(await api.baseRead(f.id)), rows: [], hse: [] };
      targets.set(ano, t);
      return t;
    };
    const clean = e => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    let months = 0;
    const errors = [];
    try {
      for (const [i, link] of links.entries()) {
        say(`Lendo planilha ${i + 1} de ${links.length}…`);
        let data;
        try { data = await api.fetchSheets(Object.values(C.SHEETS), { spreadsheetUrl: link }); }
        catch (e) { errors.push(`planilha ${i + 1}: ${clean(e)}`); continue; }
        const m = window.buildModel(data);
        if (!m.dates.length) { errors.push(`${data.spreadsheet || 'planilha ' + (i + 1)}: nenhuma data encontrada`); continue; }
        months++;
        const items = window.modelRows(m);
        const byYear = new Map();
        items.forEach(x => { const y = x.iso.slice(0, 4); byYear.set(y, [...(byYear.get(y) || []), x]); });
        for (const [ano, list] of byYear) { const t = await target(ano); t.rows.push(...B.indDiff(t.existing.indic, list, who, at, 'Planilha mensal')); }
        if (m.hse) {
          const cnt = new Map();
          m.dates.forEach(d => { const k = `${d.slice(6)}-${d.slice(3, 5)}`; cnt.set(k, (cnt.get(k) || 0) + 1); });
          const month = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
          const t = await target(month.slice(0, 4)), cur = t.existing.hses.get(month);
          if (!cur || JSON.stringify(cur.hse) !== JSON.stringify(m.hse)) { t.hse.push(B.hseRow(month, m.hse, who, at, 'Planilha mensal')); t.existing.hses.set(month, { hse: m.hse }); }
        }
      }
      let total = 0;
      for (const [ano, t] of targets) {
        if (!t.rows.length && !t.hse.length) continue;
        say(`Gravando ${t.rows.length} valor(es) na planilha ${h.id} ${ano}…`);
        await api.baseEnsure(t.file.id);
        for (let k = 0; k < t.rows.length; k += 5000) await api.baseAppend(t.file.id, 'Indicadores', t.rows.slice(k, k + 5000));
        if (t.hse.length) await api.baseAppend(t.file.id, 'HSE', t.hse);
        total += t.rows.length;
      }
      const msg = `${months} planilha(s) lida(s) · ${total} valor(es) novo(s) ou alterado(s) gravado(s)${errors.length ? ` · ${errors.length} com erro: ${errors.join('; ')}` : ''}`;
      say(msg); ui.toast(msg, !!errors.length);
      if (CT().hub() && CT().hub().id === h.id && ui.refresh) ui.refresh();
    } catch (e) { say(clean(e)); ui.toast(clean(e), true); }
    finally { st.importing = false; draw(); }
  }

  function bind() {
    const main = ui.main;
    main.addEventListener('click', e => {
      if (!ui.isActive()) return;
      const t = e.target.closest('[data-ad-view],[data-ad],[data-ad-edit],[data-ad-hub]');
      if (!t) return;
      const d = t.dataset;
      if (d.adView) { st.view = d.adView; draw(); return; }
      if (d.adEdit) { const u = CT().users().find(x => x.email === d.adEdit); st.user = u ? { ...u, hubs: u.hubs.slice() } : null; draw(); main.querySelector('.adm-card').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      if (d.adHub) { st.impLinks = null; st.impMsg = ''; st.hub = CT().hubs().find(x => x.id === d.adHub) || null; draw(); main.querySelector('.adm-card').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      if (d.ad === 'newuser') { st.user = null; draw(); }
      else if (d.ad === 'newhub') { st.hub = null; draw(); }
    });
    main.addEventListener('submit', e => {
      if (!ui.isActive()) return;
      if (e.target.id === 'adUserForm') { e.preventDefault(); saveUser(); }
      else if (e.target.id === 'adHubForm') { e.preventDefault(); saveHub(); }
      else if (e.target.id === 'adFileForm') { e.preventDefault(); saveFile(); }
      else if (e.target.id === 'adImpForm') { e.preventDefault(); importMonthly(); }
    });
    main.addEventListener('change', e => {
      if (!ui.isActive() || e.target.id !== 'adPapel') return;
      // Trocar o papel muda as regras de hubs (um ou vários): redesenha o formulário mantendo o que já foi digitado.
      const u = st.user || emptyUser();
      st.user = { ...u, email: $('adEmail').value, nome: $('adNome').value, status: $('adStatus').value, papel: e.target.value,
        hubs: [...main.querySelectorAll('input[name="adHub"]:checked')].map(i => i.value) };
      if (!CT().MULTI.includes(st.user.papel)) st.user.hubs = st.user.hubs.slice(0, 1);
      draw();
    });
    main.addEventListener('input', e => {
      if (!ui.isActive() || e.target.id !== 'adQ') return;
      st.q = e.target.value; const pos = e.target.selectionStart; draw();
      const q = $('adQ'); if (q) { q.focus(); q.setSelectionRange(pos, pos); }
    });
  }

  return { render };
})();
