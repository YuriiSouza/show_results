// Ponte segura entre a tela e o processo principal (sem acesso direto ao Node na tela).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hubApi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: cfg => ipcRenderer.invoke('config:save', cfg),
  pickKey: () => ipcRenderer.invoke('config:pickKey'),
  removeKey: () => ipcRenderer.invoke('config:removeKey'),
  fetchSheets: (sheets, override) => ipcRenderer.invoke('sheets:fetch', { sheets, override }),
  cacheGet: month => ipcRenderer.invoke('cache:get', month),
  cacheSet: (month, data) => ipcRenderer.invoke('cache:set', month, data),
  cacheClear: () => ipcRenderer.invoke('cache:clear'),
  baseEnsure: id => ipcRenderer.invoke('base:ensure', id),
  baseRead: id => ipcRenderer.invoke('base:read', id),
  baseAppend: (id, tab, rows) => ipcRenderer.invoke('base:append', id, tab, rows),
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
