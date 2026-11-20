// Administração (modo multi-hub): usuários (e-mail Google, papel, hubs) e hubs (dados do hub e planilha de dados de cada
// ano). Tudo fica na planilha Central (js/central.js).
// - Quem entra pela primeira vez já aparece aqui, sem hub ("aguardando hub").
// - Admin, Gerente, Site líder e Líder liberam acesso: só os hubs que eles têm e no máximo o próprio papel. Hubs e
//   Registros são só do Admin.
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
  const tabs = () => !CT().isAdmin() ? '' : `<div class="pc-tabs" role="tablist">${[['users', 'Usuários'], ['hubs', 'Hubs'], ['logs', 'Registros']].map(([k, l]) =>
    `<button role="tab" class="${st.view === k ? 'active' : ''}" aria-selected="${st.view === k}" data-ad-view="${k}">${l}</button>`).join('')}</div>`;
  function draw() {
    if (!CT() || !CT().canManage()) { ui.main.innerHTML = ui.head('Administração') + ui.empty('Só administrador, gerente, site líder e líder acessam esta tela.'); return; }
    if (!CT().isAdmin()) st.view = 'users';
    if (st.view === 'hubs') return drawHubs();
    if (st.view === 'logs') return drawLogs();
    return drawUsers();
  }
  const fileLinks = hubIds => CT().files().filter(f => f.status !== 'inativo' && (hubIds.includes('*') || hubIds.includes(f.hub)))
    .map(f => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.hub)} ${esc(f.ano)}</a>`).join(' · ');

  // ---------- Usuários ----------
  function drawUsers() {
    const u = st.user || emptyUser();
    const admin = CT().isAdmin(), mine = CT().grantHubs();
    const hubs = CT().hubs().filter(h => mine.includes(h.id));
    const others = u.hubs.filter(h => h !== '*' && !mine.includes(h));
    const roles = CT().grantRoles();
    const multi = CT().MULTI.includes(u.papel);
    const q = st.q.trim().toLowerCase();
    const all = CT().visibleUsers(), waiting = CT().pending().length;
    const list = all.filter(x => !q || `${x.email} ${x.nome} ${x.papel} ${x.hubs.join(' ')}`.toLowerCase().includes(q));
    ui.main.innerHTML = ui.head(admin ? 'Administração' : 'Liberar acessos', admin ? `Planilha Central · <a href="${esc(CT().sheetUrl())}" target="_blank" rel="noopener">abrir</a>`
      : `Você libera os hubs ${esc(mine.join(', ') || '—')} com papel até ${esc(CT().role())}`) + tabs() + (waiting ? `
      <div class="ns-alert adm-wait">🔔 ${waiting} pessoa(s) entraram no app e aguardam a liberação de um hub. Clique em <b>Editar</b>, escolha o papel e o hub e salve.</div>` : '') + `
      <div class="grid">
        <section class="card w5 adm-card"><div class="card-head"><div><div class="card-title">${u.isNew ? 'Novo usuário' : 'Editar usuário'}</div>
          <div class="card-sub">O usuário entra com a conta Google do e-mail informado.</div></div>
          ${u.isNew ? '' : '<div class="card-tools"><button class="tool" data-ad="newuser">+ Novo</button></div>'}</div>
          <form class="adm-form" id="adUserForm" autocomplete="off">
            <label>E-mail (conta Google)<input id="adEmail" type="email" value="${esc(u.email)}" ${u.isNew ? '' : 'readonly'} placeholder="nome@empresa.com" required></label>
            <label>Nome<input id="adNome" type="text" value="${esc(u.nome)}" placeholder="Como aparece nos registros"></label>
            <div class="adm-pair">
              <label>Papel<select id="adPapel">${opts(roles.includes(u.papel) ? roles : [u.papel, ...roles], u.papel)}</select></label>
              <label>Status<select id="adStatus">${opts(['ativo', 'inativo'], u.status)}</select></label>
            </div>
            <div class="adm-hubs"><div class="adm-lbl">Hubs ${u.papel === 'Admin' ? '<span class="muted small">(Admin vê todos)</span>' : multi ? '<span class="muted small">(pode ter vários)</span>' : '<span class="muted small">(um hub só)</span>'}</div>
              ${hubs.length ? hubs.map(h => `<label class="adm-chk"><input type="${multi ? 'checkbox' : 'radio'}" name="adHub" value="${esc(h.id)}" ${u.papel === 'Admin' ? 'disabled checked' : u.hubs.includes(h.id) ? 'checked' : ''}> ${esc(h.id)} <span class="muted small">${esc(h.nome)}</span></label>`).join('') : '<span class="muted small">Cadastre um hub primeiro.</span>'}
              ${others.length ? `<div class="muted small">Também tem acesso a: ${esc(others.join(', '))} (você não altera estes)</div>` : ''}
            </div>
            <div class="adm-note">${CT().READONLY.includes(u.papel) ? '🔒 Papel só de consulta: o app não deixa esta pessoa gravar nada.' : 'A pessoa passa a ver o hub na próxima vez que abrir o app (ou em “Tentar de novo”).'}
              ${admin && fileLinks(u.papel === 'Admin' ? ['*'] : u.hubs) ? `<br>Planilhas: ${fileLinks(u.papel === 'Admin' ? ['*'] : u.hubs)}` : ''}</div>
            <div class="adm-actions"><button type="submit" class="btn-primary solid" id="adUserSave">Salvar usuário</button></div>
          </form></section>
        <section class="card w7"><div class="card-head"><div><div class="card-title">Usuários</div><div class="card-sub">${list.length} de ${all.length}</div></div>
          <div class="card-tools"><input type="search" id="adQ" class="adm-search" placeholder="Buscar e-mail, nome, hub…" value="${esc(st.q)}"></div></div>
          <div class="table-wrap"><table class="pc-table adm-table"><thead><tr><th class="left">E-mail</th><th class="left">Nome</th><th class="left">Papel</th><th class="left">Hubs</th><th class="left">Status</th><th class="left">Atualizado</th><th></th></tr></thead><tbody>
          ${list.map(x => `<tr class="${x.status === 'inativo' ? 'adm-off' : ''}"><td class="left">${esc(x.email)}${x.email === CT().email() ? ' <span class="pill">você</span>' : ''}</td><td class="left">${esc(x.nome)}</td>
            <td class="left"><span class="pill ${x.papel === 'Admin' ? 'good' : CT().READONLY.includes(x.papel) ? 'warn' : ''}">${esc(x.papel)}</span></td>
            <td class="left">${x.hubs.includes('*') ? 'Todos' : x.hubs.length ? esc(x.hubs.join(', ')) : '<span class="pill warn">aguardando hub</span>'}</td><td class="left">${esc(x.status)}</td>
            <td class="left muted small">${esc(when(x.at))}<br>${esc(x.by)}</td>
            <td>${CT().canEdit(x) ? `<button class="tool" data-ad-edit="${esc(x.email)}">Editar</button>` : ''}</td></tr>`).join('')}
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
          ${h.id === ((window.APP_CONFIG.CENTRAL_SEED || {}).hub || '') && window.APP_CONFIG.BASE_SHEET_URL ? `<div class="adm-files"><div class="adm-lbl">Migrar a planilha-base antiga</div>
            <p class="muted small">Copia tudo o que está na planilha-base antiga (reports, Audit, Parcel, mapa de piso, erros de piso,
              recebimento por hora e avarias) para a planilha de dados do hub de ${esc(CT().year())}. A planilha antiga é <b>só lida</b>,
              nada é alterado nela. Pode repetir: linhas que já foram copiadas não entram de novo.
              <a href="${esc(window.APP_CONFIG.BASE_SHEET_URL)}" target="_blank" rel="noopener">abrir a planilha antiga</a></p>
            <div class="muted small" id="adMigMsg">${esc(st.migMsg || '')}</div>
            <div class="adm-actions"><button type="button" class="btn-primary" data-ad="migrate" ${st.migrating ? 'disabled' : ''}>${st.migrating ? 'Migrando…' : 'Migrar para a planilha do hub'}</button></div>
          </div>` : ''}
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

  // Copia as guias da planilha-base antiga (só leitura) para a planilha de dados do hub, sem repetir linhas já copiadas.
  async function migrateLegacy() {
    const h = st.hub, api = window.hubApi, C = window.APP_CONFIG;
    if (!h || st.migrating) return;
    const src = (String(C.BASE_SHEET_URL || '').match(/\/d\/([a-zA-Z0-9-_]+)/) || [])[1];
    const file = CT().files().find(f => f.hub === h.id && f.ano === CT().year() && f.status !== 'inativo' && f.id);
    if (!src) return ui.toast('Planilha-base antiga não configurada.', true);
    if (!file) return ui.toast(`O hub ${h.id} não tem planilha de dados de ${CT().year()}: vincule uma antes.`, true);
    if (file.id === src) return ui.toast('A planilha do hub não pode ser a planilha-base antiga.', true);
    if (!(await window.uiConfirm(`Copiar os dados da planilha-base antiga para a planilha ${h.id} ${file.ano}? A planilha antiga só é lida.`, { ok: 'Migrar' }))) return;
    const say = t => { st.migMsg = t; const el = $('adMigMsg'); if (el) el.textContent = t; };
    const clean = e => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    // Linha comparável: tudo como texto, sem as células vazias do fim (a API do Google não devolve as do fim).
    const key = r => { const c = (r || []).map(x => (x == null ? '' : String(x))); while (c.length && c[c.length - 1] === '') c.pop(); return JSON.stringify(c); };
    st.migrating = true; draw();
    try {
      say('Lendo a planilha-base antiga (só leitura)…');
      const old = await api.baseReadAll(src);
      say('Lendo a planilha do hub…');
      await api.baseEnsure(file.id);
      const cur = await api.baseReadAll(file.id);
      const done = [];
      for (const [tab, rows] of Object.entries(old.tabs)) {
        const have = new Set((cur.tabs[tab] || []).map(key));
        const add = rows.filter(r => { const k = key(r); if (k === '[]' || have.has(k)) return false; have.add(k); return true; });
        if (!add.length) { done.push(`${tab}: 0`); continue; }
        // Envia em lotes de até ~1,5 MB (linhas do mapa e do Parcel podem ser grandes).
        let batch = [], size = 0, sent = 0;
        const send = async () => { if (!batch.length) return; await api.baseAppend(file.id, tab, batch); sent += batch.length; say(`${tab}: ${sent} de ${add.length} linha(s)…`); batch = []; size = 0; };
        for (const r of add) { const n = JSON.stringify(r).length; if (size + n > 1.5e6) await send(); batch.push(r); size += n; }
        await send();
        done.push(`${tab}: ${add.length}`);
      }
      const msg = `Migração concluída para ${h.id} ${file.ano} · linhas novas — ${done.join(' · ')}`;
      say(msg); ui.toast(msg);
      if (CT().hub() && CT().hub().id === h.id && ui.refresh) ui.refresh();
    } catch (e) { say('Parou com erro: ' + clean(e) + ' (pode clicar de novo: o que já foi copiado não repete)'); ui.toast(clean(e), true); }
    finally { st.migrating = false; draw(); }
  }

  // ---------- Registros (erros e alertas enviados pelos aparelhos para a guia Logs da planilha de cada hub) ----------
  const lg = { hub: '', level: '', rows: null, loading: false, err: '' };
  async function loadLogs() {
    const h = CT().hubs().find(x => x.id === lg.hub) || CT().hub() || CT().hubs()[0];
    if (!h) return;
    lg.hub = h.id;
    const f = CT().dataFile(h);
    if (!f) { lg.rows = []; lg.err = `O hub ${h.id} não tem planilha de dados.`; return; }
    lg.loading = true; lg.err = '';
    try { lg.rows = (await window.hubApi.baseReadTab(f.id, 'Logs')).map(r => r.map(x => (x == null ? '' : x))); }
    catch (e) { lg.rows = []; lg.err = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
    lg.loading = false;
  }
  function drawLogs() {
    if (lg.rows == null && !lg.loading) { loadLogs().then(() => { if (ui.isActive() && st.view === 'logs') draw(); }); }
    const rows = (lg.rows || []).slice().reverse().filter(r => !lg.level || r[1] === lg.level);
    const since = Date.now() - 7 * 864e5, week = (lg.rows || []).filter(r => Date.parse(r[0]) >= since);
    const n = lv => week.filter(r => r[1] === lv).reduce((s, r) => s + (Number(r[9]) || 1), 0);
    const local = window.AppLog ? window.AppLog.recent().slice().reverse() : [];
    const when2 = t => (t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
    ui.main.innerHTML = ui.head('Administração', 'Erros e alertas enviados pelos aparelhos') + tabs() + `
      <div class="adm-logbar"><label>Hub <select id="adLogHub">${CT().hubs().map(h => `<option value="${esc(h.id)}" ${h.id === lg.hub ? 'selected' : ''}>${esc(h.id)}</option>`).join('')}</select></label>
        <label>Nível <select id="adLogLv"><option value="">Todos</option><option value="error" ${lg.level === 'error' ? 'selected' : ''}>Erros</option><option value="warn" ${lg.level === 'warn' ? 'selected' : ''}>Alertas</option></select></label>
        <button class="tool" data-ad="logsReload">↻ Ler de novo</button>
        ${window.AppLog && window.hubApi && window.hubApi.logOpen ? '<button class="tool" data-ad="logsFolder" title="Arquivos de registro deste computador (um por dia, 30 dias)">Abrir pasta deste computador</button>' : ''}</div>
      <div class="kpis">${[
        ui.kpi('Erros (7 dias)', H.fmt.int(n('error')), [`<span class="pill ${n('error') ? 'bad' : 'good'}">${n('error') ? '⚠ verificar' : '✓ nenhum'}</span>`]),
        ui.kpi('Alertas de lentidão/falha (7 dias)', H.fmt.int(n('warn')), ['<span>demora acima do esperado ou resposta com erro</span>']),
        ui.kpi('Aparelhos que enviaram', H.fmt.int(new Set(week.map(r => `${r[6]}|${r[8]}`)).size), ['<span>usuário + tipo de aparelho</span>']),
      ].join('')}</div>
      <section class="card w12"><div class="card-head"><div><div class="card-title">Registros do hub ${esc(lg.hub)}</div><div class="card-sub">${lg.loading ? 'Lendo…' : lg.err ? esc(lg.err) : `${rows.length} linha(s) · os mais recentes primeiro · os aparelhos enviam a cada 5 minutos`}</div></div></div>
        <div class="table-wrap"><table class="pc-table adm-table"><thead><tr><th class="left">Quando</th><th class="left">Nível</th><th class="left">Tipo</th><th class="left">Mensagem</th><th>Duração</th><th>Vezes</th><th class="left">Tela</th><th class="left">Usuário</th><th class="left">Versão</th></tr></thead><tbody>
        ${rows.slice(0, 500).map(r => `<tr><td class="left nowrap">${esc(when2(r[0]))}</td><td class="left"><span class="pill ${r[1] === 'error' ? 'bad' : 'warn'}">${r[1] === 'error' ? 'erro' : 'alerta'}</span></td><td class="left">${esc(r[2])}</td>
          <td class="left adm-msg" title="${esc(r[10])}">${esc(r[3])}</td><td>${r[4] !== '' ? (Number(r[4]) / 1000).toFixed(1) + ' s' : ''}</td><td>${esc(r[9])}</td><td class="left">${esc(r[5])}</td><td class="left">${esc(r[6])}</td><td class="left">${esc(r[7])} ${esc(r[8])}</td></tr>`).join('')}
        </tbody></table></div></section>
      <section class="card w12" style="margin-top:16px"><div class="card-head"><div><div class="card-title">Desta sessão, neste aparelho</div><div class="card-sub">${local.length} registro(s) desde que o app abriu (inclui os ainda não enviados)</div></div></div>
        ${local.length ? `<div class="table-wrap"><table class="pc-table adm-table"><tbody>${local.slice(0, 100).map(e => `<tr><td class="left nowrap">${esc(when2(e.t))}</td><td class="left"><span class="pill ${e.level === 'error' ? 'bad' : e.level === 'warn' ? 'warn' : ''}">${esc(e.level)}</span></td><td class="left">${esc(e.tipo)}</td><td class="left adm-msg">${esc(e.msg)}</td><td>${e.ms != null ? (e.ms / 1000).toFixed(1) + ' s' : ''}</td></tr>`).join('')}</tbody></table></div>` : ui.empty('Nada registrado nesta sessão. ✓')}</section>`;
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
      if (d.adHub) { st.impLinks = null; st.impMsg = ''; st.migMsg = ''; st.hub = CT().hubs().find(x => x.id === d.adHub) || null; draw(); main.querySelector('.adm-card').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      if (d.ad === 'newuser') { st.user = null; draw(); }
      else if (d.ad === 'newhub') { st.hub = null; draw(); }
      else if (d.ad === 'migrate') migrateLegacy();
      else if (d.ad === 'logsReload') { lg.rows = null; draw(); }
      else if (d.ad === 'logsFolder') window.AppLog.openFolder();
    });
    main.addEventListener('submit', e => {
      if (!ui.isActive()) return;
      if (e.target.id === 'adUserForm') { e.preventDefault(); saveUser(); }
      else if (e.target.id === 'adHubForm') { e.preventDefault(); saveHub(); }
      else if (e.target.id === 'adFileForm') { e.preventDefault(); saveFile(); }
      else if (e.target.id === 'adImpForm') { e.preventDefault(); importMonthly(); }
    });
    main.addEventListener('change', e => {
      if (ui.isActive() && e.target.id === 'adLogHub') { lg.hub = e.target.value; lg.rows = null; draw(); return; }
      if (ui.isActive() && e.target.id === 'adLogLv') { lg.level = e.target.value; draw(); return; }
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
