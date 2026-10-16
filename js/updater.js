// Janela de atualização do app.
// - Computador: electron-updater lê a Release mais recente do GitHub (window.updater, exposto em electron/preload.js).
//   Estados: disponível → baixando (%) → baixado ("Reiniciar e instalar") → erro.
// - Android: consulta a Release mais recente pela API pública do GitHub e oferece o .apk para baixar.
// Se a verificação inicial falhar (sem internet etc.), nada aparece.
window.Updater = (() => {
  const REPO = 'YuriiSouza/show_results';
  const api = window.hubApi || null;
  const upd = window.updater || null;
  const current = window.APP_VERSION || '0.0.0';
  const unsubs = [];
  let phase = 'idle'; // idle | available | downloading | downloaded | error
  let info = {};      // { version, releasesUrl, apkUrl, portable }

  const parse = v => String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const newer = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clean = err => String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const dlg = () => document.getElementById('updateDlg');

  function render(extra = {}) {
    const d = dlg();
    if (!d) return;
    const v = esc(info.version || '');
    let body = '', actions = '';
    if (phase === 'available') {
      body = `<p>A versão <b>${v}</b> está disponível (você está na ${esc(current)}).</p>`;
      actions = `<button type="button" class="btn-ghost" data-upd="later">Agora não</button>
        <button type="button" class="btn-primary" data-upd="download">${info.portable || info.apkUrl ? 'Baixar' : 'Atualizar agora'}</button>`;
    } else if (phase === 'downloading') {
      const pct = Math.max(0, Math.min(100, Math.round(extra.percent || 0)));
      body = `<p>Baixando a versão <b>${v}</b>… ${pct}%</p><div class="progress"><span style="width:${pct}%"></span></div>
        <p class="muted small">Pode continuar usando o app enquanto baixa.</p>`;
      actions = `<button type="button" class="btn-ghost" data-upd="later">Continuar em segundo plano</button>`;
    } else if (phase === 'downloaded') {
      body = `<p>A versão <b>${v}</b> foi baixada. O app vai fechar, instalar e abrir de novo.</p>
        <p class="muted small">Se preferir, ela é instalada sozinha da próxima vez que você fechar o app.</p>`;
      actions = `<button type="button" class="btn-ghost" data-upd="later">Depois</button>
        <button type="button" class="btn-primary" data-upd="install">Reiniciar e instalar</button>`;
    } else if (phase === 'error') {
      body = `<p>Não foi possível atualizar: ${esc(extra.message || 'erro desconhecido')}</p>`;
      actions = `<button type="button" class="btn-ghost" data-upd="later">Fechar</button>
        <button type="button" class="btn-primary" data-upd="page">Baixar pela página</button>`;
    }
    d.querySelector('.upd-body').innerHTML = body;
    d.querySelector('.settings-actions').innerHTML = actions;
    if (!d.open) d.showModal();
  }

  const close = () => { const d = dlg(); if (d && d.open) d.close(); };
  const openPage = () => api && api.openExternal && api.openExternal(info.releasesUrl || `https://github.com/${REPO}/releases/latest`);

  async function onAction(act) {
    if (act === 'later') return close();
    if (act === 'page') { openPage(); return close(); }
    if (act === 'install') return upd.install();
    if (act === 'download') {
      if (info.apkUrl) { api.openExternal(info.apkUrl); return close(); }
      if (info.portable) { openPage(); return close(); }
      phase = 'downloading'; render({ percent: 0 });
      try { await upd.download(); } catch (err) { phase = 'error'; render({ message: clean(err) }); }
    }
  }

  // Computador (electron-updater).
  async function checkDesktop() {
    unsubs.push(
      upd.onAvailable(i => { info = { ...info, version: i.version }; if (phase === 'idle') { phase = 'available'; } }),
      upd.onProgress(p => { if (phase === 'downloading') render(p); }),
      upd.onDownloaded(i => { info = { ...info, version: i.version }; phase = 'downloaded'; render(); }),
      upd.onError(e => { if (phase === 'downloading') { phase = 'error'; render(e); } }),
    );
    try {
      const r = await upd.check();
      if (!r || r.dev) return;
      info = { ...info, portable: !!r.portable, releasesUrl: r.releasesUrl, version: info.version || r.version };
      if (phase === 'available' && newer(info.version, current)) render();
      else if (phase === 'available') phase = 'idle';
    } catch (e) { phase = 'idle'; /* verificação inicial: sem aviso */ }
  }

  // Android (API pública do GitHub, sem login).
  async function checkAndroid() {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) return;
      const rel = await res.json();
      const apk = (rel.assets || []).find(a => /\.apk$/i.test(a.name));
      if (!apk || !newer(rel.tag_name, current)) return;
      info = { version: String(rel.tag_name).replace(/^v/, ''), apkUrl: apk.browser_download_url, releasesUrl: rel.html_url };
      phase = 'available';
      render();
    } catch (e) { /* sem aviso */ }
  }

  function start() {
    const d = dlg();
    if (d) d.addEventListener('click', e => { const b = e.target.closest('[data-upd]'); if (b) onAction(b.dataset.upd); });
    if (upd) checkDesktop();
    else if (api && api.os === 'android') setTimeout(checkAndroid, 4000);
  }

  return { start, current: () => current, stop: () => unsubs.splice(0).forEach(fn => fn()) };
})();
