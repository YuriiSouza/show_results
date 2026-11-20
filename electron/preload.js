// Ponte segura entre a tela e o processo principal (sem acesso direto ao Node na tela).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hubApi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: cfg => ipcRenderer.invoke('config:save', cfg),
  fetchSheets: (sheets, override) => ipcRenderer.invoke('sheets:fetch', { sheets, override }),
  cacheGet: month => ipcRenderer.invoke('cache:get', month),
  cacheSet: (month, data) => ipcRenderer.invoke('cache:set', month, data),
  cacheClear: () => ipcRenderer.invoke('cache:clear'),
  baseEnsure: id => ipcRenderer.invoke('base:ensure', id),
  baseCreate: title => ipcRenderer.invoke('base:create', title),
  baseRead: id => ipcRenderer.invoke('base:read', id),
  baseReadAll: id => ipcRenderer.invoke('base:readAll', id),
  baseReadTab: (id, tab) => ipcRenderer.invoke('base:readTab', id, tab),
  logWrite: entry => ipcRenderer.invoke('log:write', entry),
  logTake: () => ipcRenderer.invoke('log:take'),
  logOpen: () => ipcRenderer.invoke('log:open'),
  baseAppend: (id, tab, rows) => ipcRenderer.invoke('base:append', id, tab, rows),
  centralEnsure: id => ipcRenderer.invoke('central:ensure', id),
  centralRead: id => ipcRenderer.invoke('central:read', id),
  centralAppend: (id, tab, rows) => ipcRenderer.invoke('central:append', id, tab, rows),
  reportsListLocal: () => ipcRenderer.invoke('reports:listLocal'),
  platform: 'desktop',
  os: process.platform, // 'win32' | 'linux' | 'darwin'
  openExternal: url => ipcRenderer.invoke('app:openExternal', url),
  reportGet: date => ipcRenderer.invoke('reports:get', date),
  reportSet: (date, data) => ipcRenderer.invoke('reports:set', date, data),
  auditList: () => ipcRenderer.invoke('audit:list'),
  auditSave: rep => ipcRenderer.invoke('audit:save', rep),
  auditDelete: (date, shift) => ipcRenderer.invoke('audit:delete', { date, shift }),
  parcelSetSession: curl => ipcRenderer.invoke('parcel:setSession', curl),
  parcelClearSession: () => ipcRenderer.invoke('parcel:clearSession'),
  parcelHasSession: () => ipcRenderer.invoke('parcel:hasSession'),
  parcelTrack: code => ipcRenderer.invoke('parcel:track', code),
  parcelAt: at => ipcRenderer.invoke('parcel:at', at),
  parcelStatus: () => ipcRenderer.invoke('parcel:status'),
  spxWfm: () => ipcRenderer.invoke('spx:wfm'),
});

// Login Google de quem usa o app.
contextBridge.exposeInMainWorld('auth', {
  getState: () => ipcRenderer.invoke('auth:state'),
  signIn: () => ipcRenderer.invoke('auth:sign-in'),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
});

// Atualização automática: cada on* devolve uma função que cancela a inscrição.
const listen = channel => fn => {
  const h = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};
contextBridge.exposeInMainWorld('updater', {
  check: () => ipcRenderer.invoke('updater:check'),
  download: () => ipcRenderer.invoke('updater:download'),
  install: () => ipcRenderer.invoke('updater:install'),
  onAvailable: listen('updater:available'),
  onNotAvailable: listen('updater:not-available'),
  onProgress: listen('updater:progress'),
  onDownloaded: listen('updater:downloaded'),
  onError: listen('updater:error'),
});
