/**
 * Конфигурация SSH-сервера
 */
export interface SSHConfig {
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

/**
 * Основная конфигурация приложения
 */
export interface AppConfig {
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

/**
 * Данные для SSH-подключения, передаваемые через IPC
 */
export interface SshConnectPayload {
    id: string
    config: SSHConfig
    cols?: number
    rows?: number
}

/**
 * Данные для SFTP-подключения
 */
export interface SftpConnectPayload {
    id: string;
    config: SSHConfig;
}
