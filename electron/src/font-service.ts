import { exec } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * Обертка над exec для использования с async/await.
 * Увеличивает лимит буфера для вывода команд с большим количеством данных (например, список шрифтов).
 */
export const execAsync = (cmd: string) => promisify(exec)(cmd, { maxBuffer: 1024 * 1024 * 10 })

/**
 * Получает список шрифтов, установленных в системе.
 * Поддерживает Windows (через PowerShell), macOS (через atsutil/system_profiler) и Linux (через fc-list).
 *
 * @returns {Promise<string[]>} Отсортированный массив названий шрифтов с базовым набором фолбеков.
 */
export async function getSystemFonts(): Promise<string[]> {
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
