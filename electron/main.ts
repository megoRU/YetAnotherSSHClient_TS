import { app, BrowserWindow, ipcMain, shell, IpcMainEvent, dialog } from 'electron'
import * as path from 'node:path'
import { Client, PseudoTtyOptions, type ClientChannel, type ConnectConfig } from 'ssh2'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as os from 'node:os'
import * as net from 'node:net'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = (cmd: string) => promisify(exec)(cmd, { maxBuffer: 1024 * 1024 * 10 })

/* ================= TYPES ================= */

interface SSHConfig {
    id?: string
    name: string
    user: string
    host: string
    port: number
    password?: string
    authType?: 'password' | 'key'
    privateKeyPath?: string
    osPrettyName?: string
}

interface AppConfig {
    terminalFontName: string
    terminalFontSize: number
    uiFontName: string
    uiFontSize: number
    theme: string
    favorites: SSHConfig[]
    x: number
    y: number
    width: number
    height: number
    maximized: boolean
    lastUpdateCheck?: number
}

interface SshConnectPayload {
    id: string
    config: SSHConfig
    cols?: number
    rows?: number
}

/* ================= INIT ================= */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const configPath = path.join(os.homedir(), '.minissh_config.json')

let mainWindow: BrowserWindow | null = null

const sshClients = new Map<string, Client>()
const shellStreams = new Map<string, ClientChannel>()
const sshSockets = new Map<string, net.Socket>()

/* ================= CONFIG ================= */

const DEFAULT_CONFIG: AppConfig = {
    terminalFontName: 'JetBrains Mono',
    terminalFontSize: 17,
    uiFontName: 'JetBrains Mono',
    uiFontSize: 12,
    theme: 'Gruvbox Light',
    favorites: [],
    x: 353,
    y: 141,
    width: 1254,
    height: 909,
    maximized: false,
    lastUpdateCheck: 0
}

function loadConfig(): AppConfig {
    if (!fs.existsSync(configPath)) return DEFAULT_CONFIG
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AppConfig
    } catch {
        return DEFAULT_CONFIG
    }
}

function saveConfig(config: AppConfig): void {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

async function getSystemFonts(): Promise<string[]> {
    const fallbacks = [
        'JetBrains Mono', 'Consolas', 'Courier New', 'Segoe UI',
        'Roboto', 'Ubuntu Mono', 'Arial', 'monospace', 'sans-serif'
    ]
    try {
        let fonts: string[] = []
        if (process.platform === 'win32') {
            const cmd = `powershell -NoProfile -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Drawing') | Out-Null; (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name"`
            const { stdout } = await execAsync(cmd)
            fonts = stdout.split(/\r?\n/)
                .map(s => s.trim())
                .filter(Boolean)
        } else if (process.platform === 'darwin') {
            try {
                const { stdout } = await execAsync('atsutil font -list | grep "^\\s*Family:" | awk -F ": " \'{print $2}\'')
                fonts = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
            } catch {
                const { stdout } = await execAsync('system_profiler SPFontsDataType | grep "Family:" | awk -F ": " \'{print $2}\'')
                fonts = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
            }
        } else {
            const { stdout } = await execAsync('fc-list : family')
            fonts = stdout.split(/\r?\n/)
                .flatMap(s => s.split(','))
                .map(s => s.trim())
                .filter(Boolean)
        }
        return Array.from(new Set([...fallbacks, ...fonts])).sort()
    } catch (e) {
        console.error('Failed to get system fonts:', e)
        return fallbacks.sort()
    }
}

/* ================= WINDOW ================= */

function getThemeColor(theme: string): string {
    switch (theme) {
        case 'Dark': return '#1e1e1e'
        case 'Gruvbox Light': return '#fbf1c7'
        default: return '#ffffff'
    }
}

function createWindow(): void {
    const config = loadConfig()

    mainWindow = new BrowserWindow({
        x: config.x,
        y: config.y,
        width: config.width,
        height: config.height,
        backgroundColor: getThemeColor(config.theme),
        show: false,
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            preload: path.join(__dirname, 'preload.mjs'),
            contextIsolation: true,
            nodeIntegration: false
        },
        title: 'YetAnotherSSHClient'
    })

    if (config.maximized) mainWindow.maximize()

    let saveTimeout: NodeJS.Timeout | null = null

    const saveWindowState = () => {
        if (saveTimeout) clearTimeout(saveTimeout)
        saveTimeout = setTimeout(() => {
            if (!mainWindow) return
            const bounds = mainWindow.getBounds()
            const isMaximized = mainWindow.isMaximized()
            const current = loadConfig()

            if (!isMaximized) {
                current.x = bounds.x
                current.y = bounds.y
                current.width = bounds.width
                current.height = bounds.height
            }
            current.maximized = isMaximized
            saveConfig(current)
        }, 500)
    }

    mainWindow.on('resize', saveWindowState)
    mainWindow.on('move', saveWindowState)
    mainWindow.on('maximize', saveWindowState)
    mainWindow.on('unmaximize', saveWindowState)

    mainWindow.once('ready-to-show', () => mainWindow?.show())

    const themeParam = `?theme=${encodeURIComponent(config.theme)}`
    if (process.env.VITE_DEV_SERVER_URL)
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL + themeParam)
    else
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), { query: { theme: config.theme } })
}

/* ================= APP LIFECYCLE ================= */

if (!app.requestSingleInstanceLock()) {
    app.quit()
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
        }
    })

    app.whenReady().then(() => {
        if (process.platform === 'win32') {
            app.setAppUserModelId('com.yash.client')
        }
        createWindow()
        setTimeout(checkUpdates, 5000)
    })

    app.on('before-quit', cleanupAll)

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit()
    })
}

function cleanupAll(): void {
    shellStreams.forEach(s => s.destroy())
    sshClients.forEach(c => c.destroy())
    sshSockets.forEach(s => s.destroy())
    shellStreams.clear()
    sshClients.clear()
    sshSockets.clear()
}

/* ================= IPC ================= */

ipcMain.handle('get-config', () => loadConfig())
ipcMain.handle('get-system-fonts', () => getSystemFonts())
ipcMain.handle('save-config', (_, config: AppConfig) => saveConfig(config))

ipcMain.handle('select-key-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'Keys', extensions: ['*', 'pem', 'ppk'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    })
    if (canceled) return null
    return filePaths[0]
})

ipcMain.on('ssh-connect', (event: IpcMainEvent, payload: SshConnectPayload) => {
    const { id, config, cols = 80, rows = 24 } = payload

    sshSockets.get(id)?.destroy()
    sshClients.get(id)?.destroy()
    shellStreams.delete(id)
    sshClients.delete(id)
    sshSockets.delete(id)

    const sshClient = new Client()
    sshClients.set(id, sshClient)

    const socket = net.connect(config.port || 22, config.host)
    sshSockets.set(id, socket)

    socket.on('connect', () => {
        socket.setNoDelay(true)

        const connectConfig: ConnectConfig = {
            sock: socket,
            username: config.user,
            readyTimeout: 20000
        }

        if (config.authType === 'key' && config.privateKeyPath) {
            try {
                connectConfig.privateKey = fs.readFileSync(config.privateKeyPath)
            } catch (err: any) {
                event.reply(`ssh-error-${id}`, `Failed to read private key: ${err.message}`)
                cleanupConnection(id)
                return
            }
        } else {
            connectConfig.password = Buffer.from(config.password ?? '', 'base64').toString('utf8')
        }

        sshClient.connect(connectConfig)
    })

    socket.on('error', (err: Error) => {
        event.reply(`ssh-error-${id}`, `Socket error: ${err.message}`)
        cleanupConnection(id)
    })

    sshClient.on('ready', () => {
        event.reply(`ssh-status-${id}`, 'Установлено SSH-соединение')

        const pty: PseudoTtyOptions = { rows, cols, term: 'xterm-256color' }

        sshClient.shell(pty, (err, stream) => {
            if (err || !stream) {
                event.reply(`ssh-error-${id}`, err?.message ?? 'Shell error')
                return
            }

            shellStreams.set(id, stream)

            stream.on('data', (chunk: Buffer) => {
                event.reply(`ssh-output-${id}`, chunk)
            })

            stream.on('close', () => {
                sshClient.end()
                event.reply(`ssh-status-${id}`, 'SSH-соединение закрыто')
            })
        })
    })

    sshClient.on('error', (err: Error) => {
        event.reply(`ssh-error-${id}`, err.message)
        cleanupConnection(id)
    })
})

ipcMain.on('ssh-input', (_, payload: { id: string; data: string }) => {
    shellStreams.get(payload.id)?.write(payload.data)
})

ipcMain.on('ssh-resize', (_, payload: { id: string; cols: number; rows: number }) => {
    shellStreams.get(payload.id)?.setWindow(payload.rows, payload.cols, 0, 0)
})

ipcMain.on('ssh-get-os-info', (event: IpcMainEvent, id: string) => {
    const client = sshClients.get(id)
    if (client) {
        client.exec('cat /etc/os-release', (err, stream) => {
            if (err) return
            let output = ''
            stream.on('data', (data: Buffer) => {
                output += data.toString()
            }).on('close', () => {
                event.reply(`ssh-os-info-${id}`, output)
            })
        })
    }
})

ipcMain.on('ssh-close', (_, id: string) => cleanupConnection(id))

function cleanupConnection(id: string): void {
    shellStreams.get(id)?.destroy()
    sshClients.get(id)?.destroy()
    sshSockets.get(id)?.destroy()
    shellStreams.delete(id)
    sshClients.delete(id)
    sshSockets.delete(id)
}

ipcMain.on('window-minimize', () => mainWindow?.minimize())
ipcMain.on('window-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize())
ipcMain.on('window-close', () => {
    cleanupAll()
    mainWindow?.destroy()
    app.exit(0)
})

ipcMain.on('open-external', (_, url: string) => shell.openExternal(url))

async function checkUpdates() {
    const config = loadConfig()
    const now = Date.now()
    const ONE_DAY = 24 * 60 * 60 * 1000

    if (config.lastUpdateCheck && (now - config.lastUpdateCheck < ONE_DAY)) {
        return
    }

    try {
        const GITHUB_API_URL = "https://api.github.com/repos/megoRU/YetAnotherSSHClient/releases/latest"
        const response = await fetch(GITHUB_API_URL, {
            headers: { 'User-Agent': 'YetAnotherSSHClient' }
        })
        if (!response.ok) return

        const data: any = await response.json()
        const latestVersion = data.tag_name.replace(/^v/, '')
        const currentVersion = app.getVersion()

        if (isNewerVersion(latestVersion, currentVersion)) {
            mainWindow?.webContents.send('update-available', {
                version: latestVersion,
                url: data.html_url
            })
        }

        config.lastUpdateCheck = now
        saveConfig(config)
    } catch (err) {
        console.error('Failed to check for updates:', err)
    }
}

function isNewerVersion(latest: string, current: string): boolean {
    const l = latest.split('.').map(Number)
    const c = current.split('.').map(Number)
    for (let i = 0; i < 3; i++) {
        if (l[i] > (c[i] || 0)) return true
        if (l[i] < (c[i] || 0)) return false
    }
    return false
}