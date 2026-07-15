const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Clients
  clients: {
    getAll: () => ipcRenderer.invoke('clients:getAll'),
    getAllSorted: (opts) => ipcRenderer.invoke('clients:getAllSorted', opts),
    search: (term) => ipcRenderer.invoke('clients:search', term),
    add: (data) => ipcRenderer.invoke('clients:add', data),
    delete: (id) => ipcRenderer.invoke('clients:delete', id),
    getById: (id) => ipcRenderer.invoke('clients:getById', id),
    update: (data) => ipcRenderer.invoke('clients:update', data),
  },
  // Transactions
  transactions: {
    getByClient: (clientId) => ipcRenderer.invoke('transactions:getByClient', clientId),
    add: (data) => ipcRenderer.invoke('transactions:add', data),
    update: (data) => ipcRenderer.invoke('transactions:update', data),
    delete: (id) => ipcRenderer.invoke('transactions:delete', id),
  },
  // Settings
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    set: (data) => ipcRenderer.invoke('settings:set', data),
  },
  // Dashboard
  dashboard: {
    summary: () => ipcRenderer.invoke('dashboard:summary'),
    dayDetails: (day) => ipcRenderer.invoke('dashboard:dayDetails', day),
  },
  // Backup
  backup: {
    create: () => ipcRenderer.invoke('backup:create'),
    restore: (filePath) => ipcRenderer.invoke('backup:restore', filePath),
  },
  // Folder selection
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  // Focus restoration
  restoreFocus: () => ipcRenderer.invoke('window:restoreFocus'),
  // PDF Export
  exportClientPdf: (clientId) => ipcRenderer.invoke('client:exportPdf', clientId),
});
