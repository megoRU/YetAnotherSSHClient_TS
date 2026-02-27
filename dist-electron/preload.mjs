"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  send: (channel, data) => electron.ipcRenderer.send(channel, data),
  on: (channel, func) => {
    const subscription = (_event, ...args) => func(...args);
    electron.ipcRenderer.on(channel, subscription);
    return () => electron.ipcRenderer.removeListener(channel, subscription);
  },
  invoke: (channel, data) => electron.ipcRenderer.invoke(channel, data),
  removeAllListeners: (channel) => electron.ipcRenderer.removeAllListeners(channel)
});
