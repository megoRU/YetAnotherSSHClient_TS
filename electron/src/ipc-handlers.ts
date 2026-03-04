import { ipcMain, dialog, shell, app, type IpcMainEvent, BrowserWindow } from 'electron'
import { Client, PseudoTtyOptions, type ConnectConfig } from 'ssh2'
import * as net from 'node:net'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { loadConfig, saveConfig } from './config.js'
import { getSystemFonts } from './font-service.js'
import { sshClients, shellStreams, sshSockets, sftpClients, cleanupConnection, cleanupAll } from './ssh-manager.js'
import { AppConfig, SshConnectPayload, SftpConnectPayload } from './types.js'

/**
 * Регистрирует все IPC-обработчики приложения.
 *
 * @param {() => BrowserWindow | null} getMainWindow - Функция для получения актуального экземпляра главного окна.
 */
export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null) {
    // Конфигурация
    ipcMain.handle('get-config', () => loadConfig())
    ipcMain.handle('save-config', (_, config: AppConfig) => {
        const win = getMainWindow()
        if (win) {
            const isMaximized = win.isMaximized()
            const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
            config.x = Math.round(bounds.x)
            config.y = Math.round(bounds.y)
            config.width = Math.round(bounds.width)
            config.height = Math.round(bounds.height)
            config.maximized = isMaximized
        }
        saveConfig(config)
    })

    // Системные ресурсы
    ipcMain.handle('get-system-fonts', () => getSystemFonts())
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

    // SSH Соединения
    ipcMain.on('ssh-connect', (event: IpcMainEvent, payload: SshConnectPayload) => {
        const { id, config, cols = 80, rows = 24 } = payload

        // Предварительная очистка если сессия с таким ID уже была
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
                readyTimeout: 20000,
                keepaliveInterval: 10000,
                keepaliveCountMax: 3
            }

            if (config.authType === 'key' && config.privateKeyPath) {
                try {
                    connectConfig.privateKey = fs.readFileSync(config.privateKeyPath)
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err)
                    event.reply(`ssh-error-${id}`, `Failed to read private key: ${message}`)
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

    // SFTP Соединения
    ipcMain.on('sftp-connect', (event: IpcMainEvent, payload: SftpConnectPayload) => {
        const { id, config } = payload

        cleanupConnection(id)

        const sshClient = new Client()
        sshClients.set(id, sshClient)

        const socket = net.connect(config.port || 22, config.host)
        sshSockets.set(id, socket)

        socket.on('connect', () => {
            socket.setNoDelay(true)
            const connectConfig: ConnectConfig = {
                sock: socket,
                username: config.user,
                readyTimeout: 20000,
                keepaliveInterval: 10000,
                keepaliveCountMax: 3
            }

            if (config.authType === 'key' && config.privateKeyPath) {
                try {
                    connectConfig.privateKey = fs.readFileSync(config.privateKeyPath)
                } catch (err) {
                    event.reply(`sftp-error-${id}`, `Ошибка чтения ключа: ${err}`)
                    cleanupConnection(id)
                    return
                }
            } else {
                connectConfig.password = Buffer.from(config.password ?? '', 'base64').toString('utf8')
            }

            sshClient.connect(connectConfig)
        })

        socket.on('error', (err: Error) => {
            event.reply(`sftp-error-${id}`, `Ошибка сокета: ${err.message}`)
            cleanupConnection(id)
        })

        sshClient.on('ready', () => {
            sshClient.sftp((err, sftp) => {
                if (err) {
                    event.reply(`sftp-error-${id}`, `Ошибка SFTP: ${err.message}`)
                    return
                }
                sftpClients.set(id, sftp)
                event.reply(`sftp-status-${id}`, 'SFTP-сессия готова')
            })
        })

        sshClient.on('error', (err: Error) => {
            event.reply(`sftp-error-${id}`, err.message)
            cleanupConnection(id)
        })

        sshClient.on('end', () => {
            event.reply(`sftp-status-${id}`, 'SFTP-соединение завершено')
            cleanupConnection(id)
        })

        sshClient.on('close', () => {
            event.reply(`sftp-status-${id}`, 'SFTP-соединение закрыто')
            cleanupConnection(id)
        })
    })

    ipcMain.handle('sftp-realpath', async (_, payload: { id: string; path: string }) => {
        const { id, path } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) throw new Error('SFTP-клиент не найден')

        return new Promise((resolve, reject) => {
            sftp.realpath(path, (err, resolvedPath) => {
                if (err) reject(err)
                else resolve(resolvedPath)
            })
        })
    })

    ipcMain.handle('sftp-download-multiple-files', async (event, payload: { id: string; files: { remotePath: string; filename: string }[] }) => {
        const { id, files } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) throw new Error('SFTP-клиент не найден')

        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Выберите папку для сохранения'
        })

        if (canceled || filePaths.length === 0) return null
        const destDir = filePaths[0]

        const results = []
        for (const file of files) {
            const localPath = path.join(destDir, file.filename)
            const result = await new Promise((resolve, reject) => {
                sftp.fastGet(file.remotePath, localPath, {
                    step: (total_transferred, chunk, total) => {
                        const progress = Math.round((total_transferred / total) * 100)
                        const win = getMainWindow()
                        if (win) win.webContents.send(`sftp-progress-${id}`, { remotePath: file.remotePath, progress })
                    }
                }, (err) => {
                    if (err) reject(err)
                    else resolve(localPath)
                })
            })
            results.push(result)
        }
        return results
    })

    ipcMain.handle('sftp-chmod', async (_, payload: { id: string; path: string; mode: number | string }) => {
        const { id, path, mode } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) throw new Error('SFTP-клиент не найден')

        return new Promise((resolve, reject) => {
            sftp.chmod(path, mode, (err) => {
                if (err) reject(err)
                else resolve(true)
            })
        })
    })

    ipcMain.handle('sftp-readdir', async (_, payload: { id: string; path: string }) => {
        const { id, path } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) throw new Error('SFTP client not found')

        return new Promise((resolve, reject) => {
            sftp.readdir(path, (err, list) => {
                if (err) reject(err)
                else resolve(list)
            })
        })
    })

    ipcMain.handle('sftp-download-file', async (event, payload: { id: string; remotePath: string; filename: string }) => {
        const { id, remotePath, filename } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) throw new Error('SFTP-клиент не найден')

        const { canceled, filePath } = await dialog.showSaveDialog({
            defaultPath: filename,
            title: 'Сохранить файл'
        })

        if (canceled || !filePath) return null

        return new Promise((resolve, reject) => {
            sftp.fastGet(remotePath, filePath, {
                step: (total_transferred, chunk, total) => {
                    const progress = Math.round((total_transferred / total) * 100)
                    const win = getMainWindow()
                    if (win) win.webContents.send(`sftp-progress-${id}`, { remotePath, progress })
                }
            }, (err) => {
                if (err) reject(err)
                else resolve(filePath)
            })
        })
    })

    ipcMain.handle('sftp-upload-file', async (event, payload: { id: string; remoteDir: string }) => {
        const { id, remoteDir } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) throw new Error('SFTP-клиент не найден')

        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            title: 'Выберите файлы для загрузки'
        })

        if (canceled || filePaths.length === 0) return null

        const results = []
        for (const localPath of filePaths) {
            const filename = path.basename(localPath)
            const remotePath = `${remoteDir}/${filename}`.replace(/\/+/g, '/')

            const result = await new Promise((resolve, reject) => {
                sftp.fastPut(localPath, remotePath, {
                    step: (total_transferred, chunk, total) => {
                        const progress = Math.round((total_transferred / total) * 100)
                        const win = getMainWindow()
                        if (win) win.webContents.send(`sftp-progress-${id}`, { remotePath, progress })
                    }
                }, (err) => {
                    if (err) reject(err)
                    else resolve(remotePath)
                })
            })
            results.push(result)
        }
        return results
    })

    ipcMain.handle('sftp-upload-files-from-paths', async (event, payload: { id: string; remoteDir: string; filePaths: string[] }) => {
        const { id, remoteDir, filePaths } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) throw new Error('SFTP-клиент не найден')

        const results = []
        for (const localPath of filePaths) {
            // Check if it's a file (sftp.fastPut only works for files)
            try {
                const stats = fs.statSync(localPath)
                if (!stats.isFile()) continue
            } catch (e) {
                continue
            }

            const filename = path.basename(localPath)
            const remotePath = `${remoteDir}/${filename}`.replace(/\/+/g, '/')

            const result = await new Promise((resolve, reject) => {
                sftp.fastPut(localPath, remotePath, {
                    step: (total_transferred, chunk, total) => {
                        const progress = Math.round((total_transferred / total) * 100)
                        const win = getMainWindow()
                        if (win) win.webContents.send(`sftp-progress-${id}`, { remotePath, progress })
                    }
                }, (err) => {
                    if (err) reject(err)
                    else resolve(remotePath)
                })
            })
            results.push(result)
        }
        return results
    })

    ipcMain.handle('sftp-open-in-editor', async (event, payload: { id: string; remotePath: string; filename: string }) => {
        const { id, remotePath, filename } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) throw new Error('SFTP-клиент не найден')

        const tmpDir = app.getPath('temp')
        const localPath = path.join(tmpDir, `yash_${Date.now()}_${filename}`)

        await new Promise((resolve, reject) => {
            sftp.fastGet(remotePath, localPath, (err) => {
                if (err) reject(err)
                else resolve(localPath)
            })
        })

        await shell.openPath(localPath)
        return true
    })

    ipcMain.handle('sftp-rm', async (_, payload: { id: string; path: string; isDir: boolean }) => {
        const { id, path, isDir } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) throw new Error('SFTP client not found')

        return new Promise((resolve, reject) => {
            if (isDir) {
                sftp.rmdir(path, (err) => {
                    if (err) reject(err)
                    else resolve(true)
                })
            } else {
                sftp.unlink(path, (err) => {
                    if (err) reject(err)
                    else resolve(true)
                })
            }
        })
    })

    ipcMain.handle('sftp-mkdir', async (_, payload: { id: string; path: string }) => {
        const { id, path } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) throw new Error('SFTP client not found')

        return new Promise((resolve, reject) => {
            sftp.mkdir(path, (err) => {
                if (err) reject(err)
                else resolve(true)
            })
        })
    })

    ipcMain.handle('sftp-rename', async (_, payload: { id: string; oldPath: string; newPath: string }) => {
        const { id, oldPath, newPath } = payload
        const sftp = sftpClients.get(id)
        if (!sftp) throw new Error('SFTP client not found')

        return new Promise((resolve, reject) => {
            sftp.rename(oldPath, newPath, (err) => {
                if (err) reject(err)
                else resolve(true)
            })
        })
    })

    // Управление окном
    ipcMain.on('window-minimize', () => getMainWindow()?.minimize())
    ipcMain.on('window-maximize', () => {
        const win = getMainWindow()
        if (win) {
            if (win.isMaximized()) {
                win.unmaximize()
            } else {
                win.maximize()
            }
        }
    })
    ipcMain.on('window-close', () => {
        cleanupAll()
        const win = getMainWindow()
        if (win) win.destroy()
        app.exit(0)
    })

    // Внешние ссылки
    ipcMain.on('open-external', (_, url: string) => shell.openExternal(url))
}
