const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  start: (kph) => ipcRenderer.invoke("start", kph),
  stop: () => ipcRenderer.invoke("stop"),
  closeBrowser: () => ipcRenderer.invoke("closeBrowser"),
  onProgress: (cb) => ipcRenderer.on("progress", (e, d) => cb(d)),
  onRealtime: (cb) => ipcRenderer.on("realtime", (e, d) => cb(d)),
  onStatus: (cb) => ipcRenderer.on("status", (e, d) => cb(d)),
  onDone: (cb) => ipcRenderer.on("done", (e, d) => cb(d)),
  onLog: (cb) => ipcRenderer.on("log", (e, msg) => cb(msg)),
  onError: (cb) => ipcRenderer.on("error", (e, msg) => cb(msg)),
  minimizeWindow: () => ipcRenderer.send("window-minimize"),
  closeWindow: () => ipcRenderer.send("window-close"),
});