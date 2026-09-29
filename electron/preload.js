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
  reportGet: date => ipcRenderer.invoke('reports:get', date),
  reportSet: (date, data) => ipcRenderer.invoke('reports:set', date, data),
  auditList: () => ipcRenderer.invoke('audit:list'),
  auditSave: rep => ipcRenderer.invoke('audit:save', rep),
  auditDelete: (date, shift) => ipcRenderer.invoke('audit:delete', { date, shift }),
});
