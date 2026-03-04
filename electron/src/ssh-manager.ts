import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2'
import * as net from 'node:net'

/** Хранилище активных SSH-клиентов по ID сессии */
export const sshClients = new Map<string, Client>()

/** Хранилище открытых потоков оболочки (shell) по ID сессии */
export const shellStreams = new Map<string, ClientChannel>()

/** Хранилище активных SFTP-клиентов по ID сессии */
export const sftpClients = new Map<string, SFTPWrapper>()

/** Хранилище TCP-сокетов для SSH-соединений по ID сессии */
export const sshSockets = new Map<string, net.Socket>()

/**
 * Закрывает и удаляет конкретное SSH-соединение по его ID.
 *
 * @param {string} id - Уникальный идентификатор сессии.
 */
export function cleanupConnection(id: string): void {
    sftpClients.get(id)?.end()
    shellStreams.get(id)?.destroy()
    sshClients.get(id)?.destroy()
    sshSockets.get(id)?.destroy()
    sftpClients.delete(id)
    shellStreams.delete(id)
    sshClients.delete(id)
    sshSockets.delete(id)
}

/**
 * Закрывает все активные SSH-соединения и очищает хранилища.
 * Используется при выходе из приложения.
 */
export function cleanupAll(): void {
    sftpClients.forEach(s => s.end())
    shellStreams.forEach(s => s.destroy())
    sshClients.forEach(c => c.destroy())
    sshSockets.forEach(s => s.destroy())
    sftpClients.clear()
    shellStreams.clear()
    sshClients.clear()
    sshSockets.clear()
}
