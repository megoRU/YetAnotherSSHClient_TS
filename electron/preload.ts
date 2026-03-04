import {contextBridge, ipcRenderer, webUtils} from 'electron'

contextBridge.exposeInMainWorld('ipcRenderer', {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  send: (channel: string, data: unknown) => ipcRenderer.send(channel, data),
  on: (channel: string, func: (...args: unknown[]) => void) => {
    const subscription = (_event: unknown, ...args: unknown[]) => func(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
  invoke: (channel: string, data: unknown) => ipcRenderer.invoke(channel, data),
  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel),
  platform: process.platform,
})
