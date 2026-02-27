import { app, ipcMain, BrowserWindow } from "electron";
import path from "node:path";
import { Client } from "ssh2";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(os.homedir(), ".minissh_config.json");
const DEFAULT_CONFIG = {
  "terminalFontName": "JetBrains Mono",
  "terminalFontSize": 17,
  "uiFontName": "JetBrains Mono",
  "uiFontSize": 12,
  "theme": "Gruvbox Light",
  "favorites": []
};
function loadConfig() {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (e) {
      return DEFAULT_CONFIG;
    }
  }
  return DEFAULT_CONFIG;
}
function saveConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1254,
    height: 909,
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true
    },
    title: "YetAnotherSSHClient"
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname$1, "../dist/index.html"));
  }
}
app.whenReady().then(createWindow);
const sshClients = /* @__PURE__ */ new Map();
const shellStreams = /* @__PURE__ */ new Map();
ipcMain.handle("get-config", () => loadConfig());
ipcMain.handle("save-config", (_, config) => saveConfig(config));
ipcMain.on("ssh-connect", (event, { id, config, cols, rows }) => {
  const sshClient = new Client();
  sshClients.set(id, sshClient);
  sshClient.on("ready", () => {
    event.reply(`ssh-status-${id}`, "SSH Connection Established");
    const pty = {
      rows: rows || 24,
      cols: cols || 80,
      term: "xterm-256color"
    };
    sshClient.shell(pty, (err, stream) => {
      if (err) {
        event.reply(`ssh-error-${id}`, err.message);
        return;
      }
      shellStreams.set(id, stream);
      stream.on("data", (chunk) => {
        event.reply(`ssh-output-${id}`, chunk.toString());
      });
      stream.on("close", () => {
        sshClient.end();
        event.reply(`ssh-status-${id}`, "SSH Connection Closed");
      });
    });
  });
  sshClient.on("error", (err) => {
    console.error("SSH client error:", err);
    if (err.code === "ECONNRESET") {
      return;
    }
    event.reply(`ssh-error-${id}`, err.message);
  });
  sshClient.connect({
    host: config.host,
    port: parseInt(config.port) || 22,
    username: config.user,
    password: Buffer.from(config.password || "", "base64").toString("utf8"),
    readyTimeout: 2e4
  });
});
ipcMain.on("ssh-input", (_, { id, data }) => {
  var _a;
  (_a = shellStreams.get(id)) == null ? void 0 : _a.write(data);
});
ipcMain.on("ssh-resize", (_, { id, cols, rows }) => {
  var _a;
  (_a = shellStreams.get(id)) == null ? void 0 : _a.setWindow(rows, cols, 0, 0);
});
ipcMain.on("ssh-close", (_, id) => {
  var _a, _b;
  (_a = shellStreams.get(id)) == null ? void 0 : _a.end();
  (_b = sshClients.get(id)) == null ? void 0 : _b.end();
  shellStreams.delete(id);
  sshClients.delete(id);
});
ipcMain.on("window-minimize", () => {
  mainWindow == null ? void 0 : mainWindow.minimize();
});
ipcMain.on("window-maximize", () => {
  if (mainWindow == null ? void 0 : mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow == null ? void 0 : mainWindow.maximize();
  }
});
ipcMain.on("window-close", () => {
  mainWindow == null ? void 0 : mainWindow.close();
});
