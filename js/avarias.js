// Avarias (grupo Qualidade): registro das avarias de pacotes, histórico com tratativa e dashboard.
// - Registrar: bipa/digita a BR; o responsável é quem RECEBEU o pacote pela primeira vez no hub (rastreio do SPX,
//   ParcelCore.firstReceipt). O usuário informa origem, tipo, setor e observação.
// - Pacote que nunca passou pelo hub (avaria vista antes de receber): o responsável é quem nos enviou — a última estação
//   do rastreio (SOC/XPT). A avaria é salva normalmente.
// - Sem SPX (celular, ou sem Sessão SPX) a avaria é salva com o responsável pendente; "Buscar responsáveis" completa no PC.
// - Tudo fica na planilha-base (guia Avarias); vale a gravação mais recente de cada ID.
window.Avarias = (() => {
  const H = window.Charts;
  const esc = H.esc;
  const PC = window.ParcelCore;
  const TZ = 'America/Sao_Paulo';
  const ORIGENS = ['Hub', 'XPT', 'SOC'];
  const TIPOS = ['Líquida', 'Cortante', 'Outra'];
  const SETORES = ['Recebimento', 'Triagem', 'Staging', 'Expedição', 'Doca', 'Carregamento', 'Qualidade', 'Outro'];
  const TRATS = ['Aberto', 'Em análise', 'Concluído'];
  const PAGE = 50;
  const $ = id => document.getElementById(id);
  const api = () => window.hubApi || null;
  const B = () => window.Base;
  const baseOn = () => !!(B() && B().enabled());
  const canSpx = () => !!(api() && api().parcelTrack);
  const cfg = () => (window.APP_CONFIG && window.APP_CONFIG.PARCEL) || {};
  const LSK = 'hub.avarias';
  const ls = (() => { try { return JSON.parse(localStorage.getItem(LSK)) || {}; } catch (e) { return {}; } })();
  const lsSave = () => { try { localStorage.setItem(LSK, JSON.stringify(ls)); } catch (e) { /* sem armazenamento */ } };
  const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
  const brDate = iso => (iso ? iso.split('-').reverse().join('/') : '');
  const brShort = iso => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '');
  const dmhOf = ts => new Date(ts * 1000).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
  const normBr = v => String(v || '').trim().toUpperCase();
  const dash = '<span class="muted">—</span>';
  const PILL_TRAT = { Aberto: 'bad', 'Em análise': 'warn', Concluído: 'good' };

  let ui = null, bound = false;
  const emptyForm = () => ({ br: '', origem: '', tipo: '', setor: '', obs: '' });
  const st = {
    date: todayIso(), form: emptyForm(), look: null, saving: false, fixing: null,
    page: 0, open: '', q: '',
  };
  const view = () => (['reg', 'hist', 'dash'].includes(ls.view) ? ls.view : 'reg');
  const subTabs = () => `<div class="pc-tabs" role="tablist">${[['reg', 'Registrar avaria'], ['hist', 'Histórico'], ['dash', 'Dashboard']].map(([k, l]) =>
    `<button role="tab" aria-selected="${k === view()}" class="${k === view() ? 'active' : ''}" data-av-view="${k}">${l}</button>`).join('')}</div>`;
  const opts = (list, cur, all = '') => (all ? `<option value="">${all}</option>` : '') + list.map(v => `<option ${cur === v ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const list = () => (baseOn() ? B().avariaList() : []);
  const inRange = () => { const rg = ui.range(); return list().filter(a => a.date >= rg.from && a.date <= rg.to); };
  const pendente = a => !a.resp && ['pendente', 'erro', ''].includes((a.detail || {}).lookup || '');
  const respTxt = a => {
    const d = a.detail || {};
    if (a.resp && d.lookup === 'naohub') return `${esc(a.resp)} <span class="pill warn">enviou avariado</span>`;
    if (a.resp) return `${esc(a.resp)}${d.system ? ' <span class="muted small">(conta de sistema)</span>' : ''}`;
    if (d.lookup === 'semrastreio') return '<span class="pill bad">sem rastreio</span>';
    if (d.lookup === 'semreceb') return '<span class="pill warn">sem recebimento no hub</span>';
    return '<span class="pill warn">pendente</span>';
  };

  // ---------- Busca do responsável (SPX) ----------
  // Resultado: { state: ok | naohub | semreceb | pendente | erro, name, ts, system, msg, noSession }
  async function lookup(br) {
    if (!canSpx()) return { state: 'pendente', msg: 'A busca no SPX só funciona no app do computador: o responsável fica pendente.' };
    if (!(await window.SpxSession.has())) return { state: 'pendente', noSession: true, msg: 'Sem Sessão SPX: o responsável fica pendente (use "Buscar responsáveis" depois).' };
    try {
      const r = await api().parcelTrack(br);
      if (!r.ok) return r.noSession ? { state: 'pendente', noSession: true, msg: 'Sessão SPX expirada: o responsável fica pendente.' } : { state: 'erro', msg: r.error || 'Falha na consulta ao SPX.' };
      const fr = PC.firstReceipt(r.data, cfg());
      const hub = cfg().stationName || 'hub';
      if (!fr) {
        // Nunca passou pelo hub: a avaria foi vista antes de receber. Responsável = quem nos enviou (última estação do rastreio).
        const last = PC.flatten(r.data).filter(e => e.station).pop();
        if (!last) return { state: 'semrastreio', msg: 'Rastreio sem eventos: confira o código.' };
        return { state: 'naohub', name: last.station, ts: last.ts, msg: `Não passou pelo ${hub}: avaria identificada antes do recebimento. Responsável: quem enviou (${last.station}).` };
      }
      if (!fr.ts) return { state: 'semreceb', msg: `Passou pelo ${hub}, mas sem evento de recebimento (LMHub_Recebido).` };
      return { state: 'ok', name: fr.name || fr.operator, ts: fr.ts, system: fr.system, msg: '' };
    } catch (e) { return { state: 'erro', msg: 'Falha na consulta ao SPX.' }; }
  }
  const found = lk => lk.state === 'ok' || lk.state === 'naohub';
  const applyLook = (a, lk) => ({ ...a, resp: found(lk) ? lk.name : '', recebidoEm: found(lk) ? dmhOf(lk.ts) : '',
    detail: { ...(a.detail || {}), lookup: lk.state, recTs: lk.ts || null, system: !!lk.system, lookMsg: lk.msg || '' } });

  async function runLookup() {
    const br = normBr(st.form.br);
    if (!br) return;
    st.look = { br, state: 'busy' };
    drawReg();
    const lk = await lookup(br);
    if (normBr(st.form.br) !== br) return;   // o código mudou durante a busca
    st.look = { br, ...lk };
    // Não passou pelo hub: a origem vem da estação que enviou (troca um "Hub" que ficou da avaria anterior).
    if (suggestOrigem(st.look) && (!st.form.origem || st.form.origem === 'Hub')) st.form.origem = suggestOrigem(st.look);
    if (!ui.isActive()) return;
    drawReg();
    // Tudo preenchido (ex.: "Manter origem, tipo e setor"): o foco vai para Salvar, e o próximo Enter salva.
    if (!missing().length && $('avSave') && !$('avSave').disabled) $('avSave').focus();
  }

  // ---------- Telas ----------
  function render(ctx) {
    ui = ctx;
    if (!bound) { bound = true; bind(); }
    draw();
    if (baseOn()) B().load().then(() => { if (ui.isActive()) draw(); });
  }
  function draw() {
    const v = view();
    // O registro não usa o filtro de período: escondê-lo deixa o formulário inteiro numa tela só.
    const fb = $('filters'); if (fb) fb.classList.toggle('hidden', v === 'reg');
    if (v === 'hist') return drawHist();
    if (v === 'dash') return drawDash();
    return drawReg();
  }
  const noBase = () => (baseOn() ? '' : '<div class="au-demo">Para registrar e consultar avarias é preciso entrar com a conta Google (planilha-base).</div>');

  // Quadro do responsável, logo abaixo da BR.
  function lookBox() {
    const lk = st.look, br = normBr(st.form.br);
    const box = (cls, icon, title, sub) => `<div class="av-who ${cls}"><span class="av-who-ic">${icon}</span><span class="av-who-t">${title}</span>${sub ? `<span class="av-who-s" title="${sub.replace(/<[^>]+>/g, '')}">${sub}</span>` : ''}</div>`;
    if (!br) return box('', '👤', 'Responsável', 'Aparece aqui depois de bipar a BR: quem recebeu o pacote pela primeira vez no hub.');
    if (!lk || lk.br !== br) return box('', '👤', 'Responsável ainda não buscado', 'Tecle <b>Enter</b> no campo da BR (o leitor já faz isso) ou clique em Buscar.');
    if (lk.state === 'busy') return box('busy', '⏳', 'Buscando no SPX…', '');
    if (lk.state === 'ok') return box('ok', '✓', `${esc(lk.name)}${lk.system ? ' <span class="muted small">(conta de sistema)</span>' : ''}`, `recebeu no hub em ${esc(dmhOf(lk.ts))}`);
    if (lk.state === 'naohub') return box('warn', '↩', `${esc(lk.name)} <span class="pill warn">enviou avariado</span>`, 'não passou pelo hub: fica no nome de quem enviou');
    if (lk.state === 'semrastreio') return box('bad', '⚠', 'BR sem rastreio no SPX', 'Confira o código: sem rastreio a avaria não é salva.');
    if (lk.state === 'semreceb') return box('warn', '⚠', 'Sem recebimento no hub', esc(lk.msg || ''));
    return box('warn', '…', 'Responsável fica pendente', esc(lk.msg || ''));
  }
  // Origem sugerida pela estação que enviou (só quando o pacote não passou pelo hub).
  const suggestOrigem = lk => (lk && lk.state === 'naohub' ? (/xpt/i.test(lk.name) ? 'XPT' : /soc/i.test(lk.name) ? 'SOC' : '') : '');
  const missing = () => { const f = st.form; return [!normBr(f.br) && 'BR', !f.origem && 'origem', !f.tipo && 'tipo', !f.setor && 'setor'].filter(Boolean); };
  const step = (n, title, done, body, hint = '') => `<div class="av-step ${done ? 'done' : ''}">
    <div class="av-step-t"><span class="av-step-n">${done ? '✓' : n}</span>${title}${hint ? ` <span class="muted small">${hint}</span>` : ''}</div>${body}</div>`;
  const seg = (name, items, cur) => `<div class="av-seg av-seg-${name}">${items.map(v => `<button type="button" class="${cur === v ? 'active' : ''}" data-av-set="${name}" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div>`;

  function drawReg() {
    const f = st.form;
    const day = list().filter(a => a.date === st.date).reverse();
    const pend = day.filter(pendente).length;
    const busy = st.look && st.look.state === 'busy';
    const act = document.activeElement, fid = act && ui.main.contains(act) && act.id, sel = fid && act.selectionStart != null ? [act.selectionStart, act.selectionEnd] : null;
    const falta = missing();
    const ok = baseOn() && !falta.length && !busy && !st.saving;
    const spx = canSpx() ? (window.SpxSession.isActive() ? '<span class="pill good">SPX ativo</span>' : '<span class="pill warn" title="Sem Sessão SPX: o responsável fica pendente">Sem SPX</span>') : '<span class="pill warn" title="No celular o responsável fica pendente: complete no app do computador">Responsável depois, no PC</span>';
    const isToday = st.date === todayIso();
    const summary = [normBr(f.br), f.origem, f.tipo, f.setor].filter(Boolean).map(esc).join(' · ');
    ui.main.innerHTML = ui.head('Avarias', 'Responsável = quem recebeu o pacote no hub') + subTabs() + noBase() + `
      <div class="av-reg">
        <section class="card av-card">
          <div class="av-card-head">
            <div class="card-title">Nova avaria</div>
            <div class="av-card-meta">${spx}
              <label class="av-date ${isToday ? '' : 'retro'}" title="Data da ocorrência (mude só para lançamento retroativo)">📅 <input type="date" id="avDate" value="${st.date}" max="${todayIso()}">${isToday ? '' : '<span class="pill warn">retroativo</span>'}</label></div>
          </div>
          ${step(1, 'BR do pacote', !!(normBr(f.br) && st.look && st.look.br === normBr(f.br) && st.look.state !== 'busy'), `
            <div class="av-br"><input id="avBr" type="text" value="${esc(f.br)}" placeholder="Bipe ou digite a BR" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text">
              <button class="tool" data-av="look" ${normBr(f.br) && !busy ? '' : 'disabled'}>Buscar</button></div>
            ${lookBox()}`)}
          <div class="av-pair">
          ${step(2, 'Origem', !!f.origem, seg('origem', ORIGENS, f.origem))}
          ${step(3, 'Tipo', !!f.tipo, seg('tipo', TIPOS, f.tipo))}
          </div>
          ${step(4, 'Setor onde foi identificada', !!f.setor, seg('setor', SETORES, f.setor))}
          <div class="av-step av-step-inline ${f.obs.trim() ? 'done' : ''}"><div class="av-step-t"><span class="av-step-n">${f.obs.trim() ? '✓' : 5}</span>Observação</div>
            <input id="avObs" type="text" value="${esc(f.obs)}" placeholder="Opcional · ex.: caixa molhada, fita rompida" autocomplete="off"></div>
          <div class="av-foot">
            <div class="av-foot-info">
              <div class="av-sum">${summary || '<span class="muted">Nada preenchido ainda</span>'}</div>
              <div class="muted small">${falta.length ? `Falta: ${falta.join(', ')}` : busy ? 'Aguardando o SPX…' : 'Pronto para salvar · Enter salva'}</div>
            </div>
            <label class="av-keep" title="Depois de salvar, mantém origem, tipo e setor para a próxima BR (bom para várias avarias iguais)"><input type="checkbox" id="avKeep" ${ls.keep ? 'checked' : ''}> Manter origem, tipo e setor</label>
            <button class="btn-primary solid av-save" id="avSave" data-av="save" ${ok ? '' : 'disabled'}>${st.saving ? 'Salvando…' : 'Salvar avaria'}</button>
          </div>
        </section>
        <section class="card av-today"><div class="card-head"><div><div class="card-title">Avarias ${isToday ? 'de hoje' : `de ${brShort(st.date)}`}</div><div class="card-sub">${day.length} registro(s)${pend ? ` · ${pend} com responsável pendente` : ''}</div></div>
          ${pend ? `<div class="card-tools"><button class="tool" data-av="fixall" ${st.fixing || !canSpx() ? 'disabled' : ''} title="${canSpx() ? 'Busca no SPX o responsável das avarias pendentes' : 'Só no app do computador'}">${st.fixing ? `Buscando… ${st.fixing.done}/${st.fixing.total}` : `🔎 Buscar responsáveis (${pend})`}</button></div>` : ''}</div>
          ${day.length ? `<div class="av-feed">${day.map(a => `<div class="av-item">
              <div class="av-item-top"><span class="pc-code">${esc(a.br)}</span><button class="tool danger av-del" data-av-del="${esc(a.id)}" title="Excluir esta avaria">✕</button></div>
              <div class="av-item-tags"><span class="pill">${esc(a.origem)}</span><span class="pill">${esc(a.tipo)}</span><span class="pill">${esc(a.setor)}</span></div>
              <div class="av-item-who">${respTxt(a)}</div>
              ${a.obs ? `<div class="muted small">${esc(a.obs)}</div>` : ''}
              <div class="muted small">por ${esc(a.user)}${a.at ? ` · ${esc(new Date(a.at).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }))}` : ''}</div>
            </div>`).join('')}</div>` : ui.empty('Nenhuma avaria registrada neste dia.')}</section>
      </div>`;
    // Mantém o foco onde estava (a tela é redesenhada ao buscar o responsável); sem foco, volta para o campo da BR.
    const back = fid && $(fid);
    if (back) { back.focus(); if (sel && back.setSelectionRange) try { back.setSelectionRange(sel[0], sel[1]); } catch (e) { /* campo sem seleção */ } }
    else if (!st.saving && $('avBr') && !document.activeElement.matches('input,textarea,select,button')) $('avBr').focus();
  }

  async function save() {
    const f = st.form, br = normBr(f.br);
    if (!baseOn() || st.saving) return;
    if (!PC.CODE_RE.test(br)) return ui.toast('Código inválido: confira a BR.', true);
    if (!f.origem || !f.tipo || !f.setor) return ui.toast('Informe origem, tipo e setor.', true);
    let lk = st.look && st.look.br === br && st.look.state !== 'busy' ? st.look : null;
    st.saving = true; drawReg();
    try {
      if (!lk) { lk = await lookup(br); st.look = { br, ...lk }; }
      if (lk.state === 'semrastreio') { ui.toast('BR sem rastreio no SPX: a ocorrência não foi salva. Confira o código.', true); return; }
      const dup = list().filter(a => a.br === br && a.date === st.date);
      if (dup.length && !(await window.uiConfirm(`A BR ${br} já tem ${dup.length} avaria(s) registrada(s) em ${brDate(st.date)}. É uma nova ocorrência?`, { ok: 'Salvar mesmo assim' }))) return;
      const a = applyLook({ date: st.date, br, origem: f.origem, tipo: f.tipo, setor: f.setor, obs: f.obs.trim(), trat: 'Aberto', detail: { hist: [] } }, lk);
      await B().avariaSave(a);
      ui.toast(found(lk) ? `Avaria salva · responsável: ${lk.name}` : 'Avaria salva · responsável pendente');
      st.form = ls.keep ? { ...emptyForm(), origem: f.origem, tipo: f.tipo, setor: f.setor } : emptyForm(); st.look = null;
    } catch (e) { ui.toast(String(e.message || e), true); }
    finally { st.saving = false; if (ui.isActive()) { drawReg(); const i = $('avBr'); if (i && !normBr(st.form.br)) i.focus(); } }
  }

  async function fixAll() {
    if (st.fixing || !canSpx()) return;
    if (!(await window.SpxSession.has())) return window.SpxSession.open(() => fixAll());
    const pend = list().filter(a => a.date === st.date && pendente(a));
    st.fixing = { done: 0, total: pend.length }; drawReg();
    let ok = 0;
    for (const a of pend) {
      const lk = await lookup(a.br);
      if (lk.noSession) break;
      if (lk.state !== 'pendente' && lk.state !== 'erro') { await B().avariaSave(applyLook(a, lk)); ok++; }
      st.fixing.done++;
      if (ui.isActive() && view() === 'reg') drawReg();
    }
    st.fixing = null;
    ui.toast(`${ok} de ${pend.length} avaria(s) atualizada(s)`);
    if (ui.isActive()) draw();
  }

  // ---------- Histórico ----------
  const histFilter = () => {
    const fl = ls.hf || {}, q = st.q.trim().toLowerCase();
    return inRange().filter(a => (!fl.origem || a.origem === fl.origem) && (!fl.tipo || a.tipo === fl.tipo) && (!fl.setor || a.setor === fl.setor)
      && (!fl.trat || a.trat === fl.trat) && (!q || a.br.toLowerCase().includes(q) || (a.resp || '').toLowerCase().includes(q)))
      .sort((a, b) => (ls.hSort === 'asc' ? 1 : -1) * (a.date + a.at).localeCompare(b.date + b.at));
  };
  function drawHist() {
    const fl = ls.hf || {};
    const all = histFilter();
    const pages = Math.max(1, Math.ceil(all.length / PAGE));
    st.page = Math.min(st.page, pages - 1);
    const rows = all.slice(st.page * PAGE, (st.page + 1) * PAGE);
    const rg = ui.range();
    const opened = st.open && list().find(a => a.id === st.open);
    ui.main.innerHTML = ui.head('Avarias', `Histórico · ${brShort(rg.from)} a ${brShort(rg.to)} (filtro do topo)`) + subTabs() + noBase() + `
      <div class="pc-filters av-filters">
        <input type="search" class="search" id="avQ" placeholder="Buscar BR ou colaborador" value="${esc(st.q)}">
        <select data-av-hf="origem">${opts(ORIGENS, fl.origem, 'Origem: todas')}</select>
        <select data-av-hf="tipo">${opts(TIPOS, fl.tipo, 'Tipo: todos')}</select>
        <select data-av-hf="setor">${opts(SETORES, fl.setor, 'Setor: todos')}</select>
        <select data-av-hf="trat">${opts(TRATS, fl.trat, 'Tratativa: todas')}</select>
        <button class="tool" data-av="sort">${ls.hSort === 'asc' ? 'Mais antigas primeiro' : 'Mais recentes primeiro'}</button>
        <button class="tool" data-av="export" ${all.length ? '' : 'disabled'}>Exportar CSV</button>
      </div>
      ${opened ? `<section class="card w12 av-open"><div class="card-head"><div><div class="card-title">Ocorrência ${esc(opened.br)}</div><div class="card-sub">${brDate(opened.date)} · ${esc(opened.origem)} · ${esc(opened.tipo)} · ${esc(opened.setor)}</div></div>
        <div class="card-tools"><button class="tool" data-av-open="${esc(opened.id)}">Fechar</button></div></div>${detailForm(opened)}</section>` : ''}
      <section class="card w12"><div class="card-head"><div><div class="card-title">Ocorrências</div><div class="card-sub">${all.length} avaria(s)${pages > 1 ? ` · página ${st.page + 1} de ${pages}` : ''}</div></div>
        ${pages > 1 ? `<div class="card-tools"><button class="tool" data-av-page="-1" ${st.page ? '' : 'disabled'}>‹ Anterior</button><button class="tool" data-av-page="1" ${st.page < pages - 1 ? '' : 'disabled'}>Próxima ›</button></div>` : ''}</div>
        ${rows.length ? `<div class="table-wrap"><table class="pc-table av-table"><thead><tr><th class="left">BR</th><th class="left">Data</th><th class="left">Colaborador</th><th class="left">Origem</th><th class="left">Tipo</th><th class="left">Setor</th><th class="left">Observação</th><th class="left">Tratativa</th><th class="left">Registrado em</th><th></th></tr></thead><tbody>
          ${rows.map(a => `<tr><td class="left pc-code">${esc(a.br)}</td><td class="left">${brDate(a.date)}</td><td class="left">${respTxt(a)}</td><td class="left">${esc(a.origem)}</td><td class="left">${esc(a.tipo)}</td><td class="left">${esc(a.setor)}</td>
            <td class="left pc-obs" title="${esc(a.obs)}">${esc(a.obs.length > 40 ? a.obs.slice(0, 40) + '…' : a.obs) || dash}</td><td class="left"><span class="pill ${PILL_TRAT[a.trat] || ''}">${esc(a.trat)}</span></td>
            <td class="left muted small">${a.at ? esc(new Date(a.at).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' })) : ''}</td>
            <td><button class="tool ${st.open === a.id ? 'active' : ''}" data-av-open="${esc(a.id)}">${st.open === a.id ? 'Aberta' : 'Detalhes'}</button></td></tr>
`).join('')}
        </tbody></table></div>` : ui.empty(baseOn() ? 'Nenhuma avaria no período com esses filtros. Mude o período no filtro do topo.' : 'Entre com a conta Google para ver o histórico.')}</section>`;
  }
  function detailForm(a) {
    const d = a.detail || {};
    const hist = (d.hist || []).slice().reverse();
    return `<div class="av-det">
      <div class="av-det-info">
        <div><span class="muted small">${d.lookup === 'naohub' ? 'Responsável (enviou o pacote ao hub)' : 'Responsável (recebeu no hub)'}</span><br>${respTxt(a)}${a.recebidoEm ? ` <span class="muted small">em ${esc(a.recebidoEm)}</span>` : ''}${d.lookMsg ? `<div class="muted small">${esc(d.lookMsg)}</div>` : ''}</div>
        <div><span class="muted small">Registrado por</span><br>${esc(a.user)}</div>
        ${a.obs ? `<div class="av-det-obs"><span class="muted small">Observação</span><br>${esc(a.obs)}</div>` : ''}
      </div>
      <div class="av-det-form">
        <label>Tratativa <select id="avTrat">${opts(TRATS, a.trat)}</select></label>
        <label>Ação tomada <textarea id="avAcao" rows="2">${esc(a.acao)}</textarea></label>
        <label>Evidência de conclusão <textarea id="avEvid" rows="2" placeholder="Ex.: feedback aplicado em 05/11, foto no grupo">${esc(a.evid)}</textarea></label>
        <div class="pe-row"><button class="btn-primary solid" data-av-tsave="${esc(a.id)}">Salvar tratativa</button>
          ${!a.resp && canSpx() ? `<button class="tool" data-av-relook="${esc(a.id)}">Buscar responsável</button>` : ''}
          <button class="tool danger" data-av-del="${esc(a.id)}">Excluir avaria</button></div>
      </div>
      ${hist.length ? `<div class="av-det-hist"><span class="muted small">Histórico da tratativa</span>${hist.map(h => `<div class="small">${esc(new Date(h.at).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }))} · ${esc(h.user)} · <b>${esc(h.trat)}</b>${h.acao ? ` — ${esc(h.acao)}` : ''}</div>`).join('')}</div>` : ''}
    </div>`;
  }
  async function saveTrat(id) {
    const a = list().find(x => x.id === id);
    if (!a) return;
    const trat = $('avTrat').value, acao = $('avAcao').value.trim(), evid = $('avEvid').value.trim();
    const hist = [...((a.detail || {}).hist || []), { at: new Date().toISOString(), user: B().user() || '', trat, acao }].slice(-20);
    await B().avariaSave({ ...a, trat, acao, evid, detail: { ...(a.detail || {}), hist } });
    ui.toast(`Tratativa de ${a.br} salva`);
    drawHist();
  }
  function exportCsv() {
    const cell = v => { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const head = ['BR', 'Data', 'Responsável (recebeu no hub ou enviou avariado)', 'Recebido / enviado em', 'Origem', 'Tipo', 'Setor', 'Observação', 'Tratativa', 'Ação tomada', 'Evidência', 'Registrado por', 'Registrado em'];
    const rows = histFilter().map(a => [a.br, brDate(a.date), a.resp, a.recebidoEm, a.origem, a.tipo, a.setor, a.obs, a.trat, a.acao, a.evid, a.user, a.at ? new Date(a.at).toLocaleString('pt-BR', { timeZone: TZ }) : '']);
    const blob = new Blob(['﻿' + [head, ...rows].map(l => l.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const el = document.createElement('a');
    el.href = URL.createObjectURL(blob);
    el.download = `avarias-${todayIso()}.csv`;
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(el.href), 2000);
  }

  // ---------- Dashboard ----------
  const countBy = (arr, get) => { const m = new Map(); arr.forEach(x => { const k = get(x); if (k) m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt-BR')); };
  const shortName = n => { const t = String(n || '').trim().split(/\s+/).filter(w => !/^(d[aeo]s?|e)$/i.test(w)); return t.length > 2 ? `${t[0]} ${t[t.length - 1]}` : t.join(' '); };
  function drawDash() {
    const fl = ls.df || {};
    const all = inRange();
    const people = [...new Set(all.map(a => a.resp).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const L = all.filter(a => (!fl.origem || a.origem === fl.origem) && (!fl.tipo || a.tipo === fl.tipo) && (!fl.setor || a.setor === fl.setor) && (!fl.resp || a.resp === fl.resp));
    const rg = ui.range();
    const per = rg.from === rg.to ? brShort(rg.from) : `${brShort(rg.from)} a ${brShort(rg.to)}`;
    const filters = `<div class="pc-filters av-filters">
        <select data-av-df="origem">${opts(ORIGENS, fl.origem, 'Origem: todas')}</select>
        <select data-av-df="tipo">${opts(TIPOS, fl.tipo, 'Tipo: todos')}</select>
        <select data-av-df="setor">${opts(SETORES, fl.setor, 'Setor: todos')}</select>
        <select data-av-df="resp">${opts(people, fl.resp, 'Colaborador: todos')}</select>
      </div>`;
    const head = ui.head('Avarias', `Dashboard · ${per} (filtro do topo)`) + subTabs() + noBase() + filters;
    if (!L.length) { ui.main.innerHTML = head + ui.empty(baseOn() ? `Nenhuma avaria em ${per} com esses filtros.` : 'Entre com a conta Google para ver o dashboard.'); return; }
    const n = (k, v) => L.filter(a => a[k] === v).length;
    const abertas = L.filter(a => a.trat !== 'Concluído').length, concl = L.length - abertas;
    const days = [...new Set(L.map(a => a.date))].sort();
    const months = [...new Set(L.map(a => a.date.slice(0, 7)))].sort();
    const bySetor = countBy(L, a => a.setor), byResp = countBy(L, a => a.resp).slice(0, 15), byOrig = countBy(L, a => a.origem);
    ui.main.innerHTML = head + `<div class="kpis">${[
        ui.kpi('Total de avarias', H.fmt.int(L.length), [`<span>média ${H.fmt.dec(L.length / Math.max(1, days.length), 1)} por dia com avaria</span>`]),
        ui.kpi('Tratativas em aberto', H.fmt.int(abertas), [abertas ? `<span class="pill warn">${H.fmt.pct(abertas / L.length, 0)} pendentes</span>` : '<span class="pill good">✓ todas concluídas</span>']),
        ui.kpi('Hub / XPT / SOC', `${n('origem', 'Hub')} / ${n('origem', 'XPT')} / ${n('origem', 'SOC')}`, ['<span>origem da avaria</span>']),
        ui.kpi('Líquidas', H.fmt.int(n('tipo', 'Líquida')), [`<span>${H.fmt.pct(n('tipo', 'Líquida') / L.length, 0)} do total</span>`]),
        ui.kpi('Cortantes', H.fmt.int(n('tipo', 'Cortante')), [`<span>${H.fmt.pct(n('tipo', 'Cortante') / L.length, 0)} do total</span>`]),
        ui.kpi('Concluídas', H.fmt.pct(concl / L.length, 0), [`<span>${concl} de ${L.length}</span>`]),
      ].join('')}</div>
      <div class="grid">
        ${ui.card('avCh1', 'Evolução diária', 'Avarias por dia, por origem', { w: 8 })}
        ${ui.card('avCh2', 'Por origem', 'Hub, XPT e SOC', { w: 4 })}
        ${ui.card('avCh3', 'Por setor', 'Onde a avaria foi identificada', { w: 6 })}
        ${ui.card('avCh4', 'Líquidas × cortantes', 'Por tipo de avaria', { w: 6 })}
        ${ui.card('avCh5', 'Responsáveis com mais avarias', 'Quem recebeu no hub, ou a estação que enviou avariado (top 15)', { w: 8, h: 'tall' })}
        ${ui.card('avCh6', 'Tratativas', 'Concluídas e pendentes', { w: 4 })}
        ${ui.card('avCh7', 'Evolução mensal', 'Avarias por mês, por origem', { w: 12 })}
      </div>`;
    const colO = { Hub: H.color(1), XPT: H.color(2), SOC: H.color(3) };
    H.render('avCh1', { labels: days.map(H.dayLabel), stacked: true, totals: true, datasets: ORIGENS.map(o => H.bar(o, days.map(d => L.filter(a => a.date === d && a.origem === o).length || null), colO[o])) });
    H.render('avCh2', { labels: byOrig.map(x => x[0]), legend: false, datasets: [H.bar('Avarias', byOrig.map(x => x[1]), H.color(1))] });
    H.render('avCh3', { labels: bySetor.map(x => x[0]), horizontal: true, legend: false, datasets: [H.bar('Avarias', bySetor.map(x => x[1]), H.color(2))] });
    H.render('avCh4', { labels: days.map(H.dayLabel), stacked: true, datasets: TIPOS.map((t, i) => H.bar(t, days.map(d => L.filter(a => a.date === d && a.tipo === t).length || null), H.color(i + 4))) });
    H.render('avCh5', { labels: byResp.map(x => shortName(x[0])), horizontal: true, legend: false, datasets: [H.bar('Avarias', byResp.map(x => x[1]), H.color(1))] });
    H.render('avCh6', { labels: TRATS, legend: false, datasets: [H.bar('Avarias', TRATS.map(t => L.filter(a => a.trat === t).length), H.color(3))] });
    H.render('avCh7', { labels: months.map(m => m.split('-').reverse().join('/')), stacked: true, totals: true, datasets: ORIGENS.map(o => H.bar(o, months.map(m => L.filter(a => a.date.startsWith(m) && a.origem === o).length || null), colO[o])) });
  }

  // ---------- Eventos ----------
  function bind() {
    const main = ui.main;
    main.addEventListener('click', async e => {
      if (!ui.isActive()) return;
      const t = e.target.closest('[data-av-view],[data-av-set],[data-av],[data-av-del],[data-av-open],[data-av-tsave],[data-av-relook],[data-av-page]');
      if (!t) return;
      const d = t.dataset;
      if (d.avView) { ls.view = d.avView; lsSave(); st.open = ''; window.Charts.destroyAll(); draw(); return; }
      if (d.avSet) { st.form[d.avSet] = st.form[d.avSet] === d.v ? '' : d.v; drawReg(); if (!missing().length && $('avSave') && !$('avSave').disabled) $('avSave').focus(); return; }
      if (d.avPage) { st.page += Number(d.avPage); drawHist(); return; }
      if (d.avOpen) { st.open = st.open === d.avOpen ? '' : d.avOpen; drawHist(); const c = ui.main.querySelector('.av-open'); if (c) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      if (d.avTsave) { saveTrat(d.avTsave); return; }
      if (d.avRelook) {
        const a = list().find(x => x.id === d.avRelook);
        if (!a) return;
        if (!(await window.SpxSession.has())) return window.SpxSession.open(() => draw());
        t.disabled = true; t.textContent = 'Buscando…';
        const lk = await lookup(a.br);
        if (lk.state !== 'pendente' && lk.state !== 'erro') { await B().avariaSave(applyLook(a, lk)); ui.toast(found(lk) ? `Responsável: ${lk.name}` : lk.msg); }
        else ui.toast(lk.msg, true);
        draw(); return;
      }
      if (d.avDel) {
        const a = list().find(x => x.id === d.avDel);
        if (a && await window.uiConfirm(`Excluir a avaria da BR ${a.br} (${brDate(a.date)})?`, { ok: 'Excluir' })) { await B().avariaDelete(a.id); st.open = ''; draw(); }
        return;
      }
      const a = d.av;
      if (a === 'look') runLookup();
      else if (a === 'save') save();
      else if (a === 'fixall') fixAll();
      else if (a === 'sort') { ls.hSort = ls.hSort === 'asc' ? 'desc' : 'asc'; lsSave(); drawHist(); }
      else if (a === 'export') exportCsv();
    });
    main.addEventListener('keydown', e => {
      if (ui.isActive() && e.target.id === 'avObs' && e.key === 'Enter') { e.preventDefault(); st.form.obs = e.target.value; if (!missing().length) save(); return; }
      if (!ui.isActive() || e.target.id !== 'avBr' || e.key !== 'Enter') return;
      e.preventDefault();
      st.form.br = normBr(e.target.value);
      runLookup();
    });
    main.addEventListener('input', e => {
      if (!ui.isActive()) return;
      const t = e.target;
      if (t.id === 'avBr') {
        st.form.br = t.value;
        const b = main.querySelector('[data-av="look"]'); if (b) b.disabled = !normBr(t.value);
        const s = main.querySelector('[data-av="save"]'); if (s) s.disabled = !(baseOn() && !missing().length);
      } else if (t.id === 'avObs') st.form.obs = t.value;
      else if (t.id === 'avQ') { st.q = t.value; st.page = 0; const pos = t.selectionStart; drawHist(); const q = $('avQ'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }
    });
    main.addEventListener('change', e => {
      if (!ui.isActive()) return;
      const t = e.target;
      if (t.id === 'avKeep') { ls.keep = t.checked; lsSave(); return; }
      if (t.id === 'avDate' && t.value) { st.date = t.value; drawReg(); }
      else if (t.id === 'avBr') { const br = normBr(t.value); st.form.br = br; t.value = br; if (br && (!st.look || st.look.br !== br)) runLookup(); }
      else if (t.dataset.avHf) { ls.hf = { ...(ls.hf || {}), [t.dataset.avHf]: t.value }; lsSave(); st.page = 0; drawHist(); }
      else if (t.dataset.avDf) { ls.df = { ...(ls.df || {}), [t.dataset.avDf]: t.value }; lsSave(); drawDash(); }
    });
  }

  return { render, _: { ORIGENS, TIPOS, SETORES } };
})();
