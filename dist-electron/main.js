import { app as E, ipcMain as r, BrowserWindow as y } from "electron";
import h from "node:path";
import { Client as _ } from "ssh2";
import f from "node:fs";
import { fileURLToPath as C } from "node:url";
import R from "node:os";
const S = h.dirname(C(import.meta.url)), u = h.join(R.homedir(), ".minissh_config.json"), g = {
  terminalFontName: "JetBrains Mono",
  terminalFontSize: 17,
  uiFontName: "JetBrains Mono",
  uiFontSize: 12,
  theme: "Gruvbox Light",
  favorites: []
};
function x() {
  if (f.existsSync(u))
    try {
      return JSON.parse(f.readFileSync(u, "utf-8"));
    } catch {
      return g;
    }
  return g;
}
function z(s) {
  f.writeFileSync(u, JSON.stringify(s, null, 2));
}
let o;
function F() {
  o = new y({
    width: 1254,
    height: 909,
    frame: !1,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: h.join(S, "preload.mjs"),
      nodeIntegration: !1,
      contextIsolation: !0
    },
    title: "YetAnotherSSHClient"
  }), process.env.VITE_DEV_SERVER_URL ? o.loadURL(process.env.VITE_DEV_SERVER_URL) : o.loadFile(h.join(S, "../dist/index.html"));
}
E.whenReady().then(F);
const d = /* @__PURE__ */ new Map(), c = /* @__PURE__ */ new Map();
r.handle("get-config", () => x());
r.handle("save-config", (s, e) => z(e));
r.on("ssh-connect", (s, { id: e, config: t, cols: n, rows: m }) => {
  const a = new _();
  d.set(e, a), a.on("ready", () => {
    s.reply(`ssh-status-${e}`, "SSH Connection Established");
    const i = {
      rows: m || 24,
      cols: n || 80,
      term: "xterm-256color"
    };
    a.shell(i, (l, p) => {
      if (l) {
        s.reply(`ssh-error-${e}`, l.message);
        return;
      }
      c.set(e, p), p.on("data", (w) => {
        s.reply(`ssh-output-${e}`, w.toString());
      }), p.on("close", () => {
        a.end(), s.reply(`ssh-status-${e}`, "SSH Connection Closed");
      });
    });
  }), a.on("error", (i) => {
    const l = i.message || "";
    if (i.code === "ECONNRESET" || l.includes("Connection lost before handshake") || l.includes("ECONNRESET") || l.includes("Socket is closed")) {
      console.warn("SSH client warning (suppressed):", l || i.code);
      return;
    }
    console.error("SSH client error:", i), s.reply(`ssh-error-${e}`, i.message);
  }), a.connect({
    host: t.host,
    port: parseInt(t.port) || 22,
    username: t.user,
    password: Buffer.from(t.password || "", "base64").toString("utf8"),
    readyTimeout: 2e4
  });
});
r.on("ssh-input", (s, { id: e, data: t }) => {
  var n;
  (n = c.get(e)) == null || n.write(t);
});
r.on("ssh-resize", (s, { id: e, cols: t, rows: n }) => {
  var m;
  (m = c.get(e)) == null || m.setWindow(n, t, 0, 0);
});
r.on("ssh-close", (s, e) => {
  var t, n;
  (t = c.get(e)) == null || t.end(), (n = d.get(e)) == null || n.end(), c.delete(e), d.delete(e);
});
r.on("window-minimize", () => {
  o == null || o.minimize();
});
r.on("window-maximize", () => {
  o != null && o.isMaximized() ? o.unmaximize() : o == null || o.maximize();
});
r.on("window-close", () => {
  o == null || o.close();
});
