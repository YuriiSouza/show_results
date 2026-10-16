// Atualização automática pelo GitHub Releases (electron-updater lê o latest.yml da Release mais recente).
// O download só começa quando o usuário confirma na tela; a instalação acontece ao reiniciar
// (ou sozinha ao fechar o app, se ele já tiver baixado).
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

const RELEASES_URL = 'https://github.com/YuriiSouza/show_results/releases/latest';
// O .exe portátil não se instala: nele a "atualização" é abrir a página da Release.
const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_DIR;

let win = null;
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

function register(ipcMain) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', info => send('updater:available', { version: info.version, releaseNotes: info.releaseNotes || '' }));
  autoUpdater.on('update-not-available', info => send('updater:not-available', { version: info.version }));
  autoUpdater.on('download-progress', p => send('updater:progress', { percent: p.percent, transferred: p.transferred, total: p.total }));
  autoUpdater.on('update-downloaded', info => send('updater:downloaded', { version: info.version }));
  autoUpdater.on('error', err => send('updater:error', { message: String((err && err.message) || err) }));

  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) return { dev: true };
    const r = await autoUpdater.checkForUpdates();
    return { portable: isPortable(), version: r && r.updateInfo ? r.updateInfo.version : null, releasesUrl: RELEASES_URL };
  });
  ipcMain.handle('updater:download', async () => { await autoUpdater.downloadUpdate(); return true; });
  ipcMain.handle('updater:install', () => { autoUpdater.quitAndInstall(false, true); });
}

module.exports = { register, setWindow: w => { win = w; } };
