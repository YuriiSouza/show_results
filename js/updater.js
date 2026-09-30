// Ao abrir o app, verifica na pasta do Google Drive (DRIVE_FOLDER_URL, fixa em js/config.js) se existe uma versão mais nova do app
// para este sistema, pelo nome dos arquivos:
//   Dashboard-HUB-LGO03-1.2.0-Windows-Instalador.exe  (ou -Windows-Portatil.exe)
//   Dashboard-HUB-LGO03-1.2.0-Linux-x86_64.AppImage   (ou -Linux-amd64.deb)
//   Dashboard-HUB-LGO03-1.2.0-Android.apk
// Se houver, mostra um aviso no topo com o botão para baixar.
window.Updater = (() => {
  const C = window.APP_CONFIG;
  const api = window.hubApi || null;
  const current = window.APP_VERSION || '0.0.0';
  const folderId = (String(C.DRIVE_FOLDER_URL || '').match(/folders\/([a-zA-Z0-9-_]+)/) || [])[1]
    || (/^[a-zA-Z0-9-_]{20,}$/.test(C.DRIVE_FOLDER_URL || '') ? C.DRIVE_FOLDER_URL : '');
  let last = null;

  const parse = v => String(v).split('.').map(n => parseInt(n, 10) || 0);
  const newer = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

  // Arquivos que servem para este aparelho, na ordem de preferência.
  function wanted() {
    const os = api && api.os;
    if (os === 'win32') return [/windows.*instalador.*\.exe$/i, /windows.*\.exe$/i];
    if (os === 'linux') return [/linux.*\.appimage$/i, /linux.*\.deb$/i];
    if (os === 'android') return [/\.apk$/i];
    return [];
  }

  async function check({ manual = false } = {}) {
    if (!api || !api.driveList || !folderId) {
      if (manual) show({ error: folderId ? 'Verificação disponível só no aplicativo.' : 'Pasta de atualizações não configurada (DRIVE_FOLDER_URL em js/config.js).' });
      return null;
    }
    const pats = wanted();
    if (!pats.length) { if (manual) show({ error: 'Atualização automática não disponível neste sistema.' }); return null; }
    try {
      const files = await api.driveList(folderId);
      let best = null;
      files.forEach(f => {
        const m = f.name.match(/(\d+\.\d+\.\d+)/);
        if (!m) return;
        const rank = pats.findIndex(p => p.test(f.name));
        if (rank < 0) return;
        if (!best || newer(m[1], best.version) || (m[1] === best.version && rank < best.rank)) best = { version: m[1], rank, file: f };
      });
      last = best;
      if (best && newer(best.version, current)) show({ update: best });
      else { hide(); if (manual) show({ ok: `Você já está na versão mais recente (${current}).` }); }
      return best;
    } catch (err) {
      if (manual) show({ error: 'Não foi possível verificar atualizações: ' + String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
      return null;
    }
  }

  const el = () => document.getElementById('updateBanner');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function show({ update, ok, error }) {
    const b = el();
    if (!b) return;
    if (update) {
      if (sessionStorage.getItem('hub.updDismiss') === update.version) return;
      const isApk = /\.apk$/i.test(update.file.name);
      b.className = 'update-banner';
      b.innerHTML = `<span>🚀 <b>Nova versão ${esc(update.version)} disponível</b> <span class="muted-w">(você está na ${esc(current)})</span> ·
        baixe e instale: <i>${esc(update.file.name)}</i>${isApk ? '' : ' — feche o app antes de instalar.'}</span>
        <span class="update-actions"><button class="btn-primary" data-upd-open>Baixar</button><button class="icon-close" data-upd-close aria-label="Fechar">✕</button></span>`;
      b.querySelector('[data-upd-open]').onclick = () => api.openExternal(update.file.webViewLink || `https://drive.google.com/file/d/${update.file.id}/view`);
      b.querySelector('[data-upd-close]').onclick = () => { sessionStorage.setItem('hub.updDismiss', update.version); hide(); };
    } else {
      b.className = 'update-banner ' + (error ? 'err' : 'ok');
      b.innerHTML = `<span>${esc(error || ok)}</span><span class="update-actions"><button class="icon-close" data-upd-close aria-label="Fechar">✕</button></span>`;
      b.querySelector('[data-upd-close]').onclick = hide;
      setTimeout(() => { if (!b.querySelector('[data-upd-open]')) hide(); }, 6000);
    }
    b.hidden = false;
  }
  function hide() { const b = el(); if (b) b.hidden = true; }

  // Verifica uma única vez, logo depois que o app abre.
  function start() {
    setTimeout(() => check(), 4000);
  }

  return { start, check, current: () => current, last: () => last, folderId: () => folderId };
})();
