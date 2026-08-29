// 预加载脚本：通过 contextBridge 把安全的 IPC 接口暴露给渲染进程（window.electronAPI）
// 不在渲染进程中直接暴露 ipcRenderer，避免安全风险。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  dbLoad: (userId) => ipcRenderer.invoke('db:load', userId),
  dbSave: (payload) => ipcRenderer.invoke('db:save', payload),
  dbReplace: (payload) => ipcRenderer.invoke('db:replace', payload),
  // 桌面端本地用户管理
  userList: () => ipcRenderer.invoke('user:list'),
  userCreate: (payload) => ipcRenderer.invoke('user:create', payload),
  userVerify: (payload) => ipcRenderer.invoke('user:verify', payload), // payload: { username, password }
  userUpdate: (payload) => ipcRenderer.invoke('user:update', payload),
  userChangePassword: (payload) => ipcRenderer.invoke('user:changePassword', payload),
  userDelete: (id) => ipcRenderer.invoke('user:delete', id),
  updateUserPeriod: (id, period) => ipcRenderer.invoke('db:updateUserPeriod', id, period),
  readImage: (id) => ipcRenderer.invoke('img:read', id),
  writeImage: (id, base64) => ipcRenderer.invoke('img:write', id, base64),
  deleteImage: (id) => ipcRenderer.invoke('img:delete', id),
  baiduOcr: (imageB64, apiKey, secretKey) => ipcRenderer.invoke('baidu:ocr', imageB64, apiKey, secretKey),
  baiduValidateKey: (apiKey, secretKey) => ipcRenderer.invoke('baidu:validateKey', apiKey, secretKey),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  // 共享百度 OCR：主进程代调 Supabase Edge Function（规避 app:// 下的 CORS 限制）
  ocrShared: (body) => ipcRenderer.invoke('ocr:shared', body),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
});
