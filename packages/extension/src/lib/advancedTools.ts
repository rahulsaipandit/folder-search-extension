import { getOPFSStorage, isOPFSSupported } from './widgetWorker'
import { getDB } from './db'

/**
 * Advanced tool implementations for widgets
 */
export class AdvancedTools {
  private opfsStorage = getOPFSStorage()

  /**
   * Read file from OPFS storage
   */
  async readFile(instanceId: string, path: string): Promise<Uint8Array> {
    if (!isOPFSSupported()) {
      throw new Error('OPFS not supported in this browser')
    }
    return await this.opfsStorage.readFile(instanceId, path)
  }

  /**
   * Read file as text from OPFS storage
   */
  async readFileAsText(instanceId: string, path: string): Promise<string> {
    if (!isOPFSSupported()) {
      throw new Error('OPFS not supported in this browser')
    }
    return await this.opfsStorage.readFileAsText(instanceId, path)
  }

  /**
   * Write file to OPFS storage
   */
  async writeFile(instanceId: string, path: string, content: Uint8Array | string): Promise<void> {
    if (!isOPFSSupported()) {
      throw new Error('OPFS not supported in this browser')
    }
    return await this.opfsStorage.writeFile(instanceId, path, content)
  }

  /**
   * List files in OPFS directory
   */
  async listFiles(instanceId: string, path: string = ''): Promise<string[]> {
    if (!isOPFSSupported()) {
      throw new Error('OPFS not supported in this browser')
    }
    return await this.opfsStorage.listEntries(instanceId, path)
  }

  /**
   * Delete file from OPFS storage
   */
  async deleteFile(instanceId: string, path: string): Promise<void> {
    if (!isOPFSSupported()) {
      throw new Error('OPFS not supported in this browser')
    }
    return await this.opfsStorage.deleteEntry(instanceId, path)
  }

  /**
   * Check if file exists in OPFS
   */
  async fileExists(instanceId: string, path: string): Promise<boolean> {
    if (!isOPFSSupported()) {
      return false
    }
    return await this.opfsStorage.fileExists(instanceId, path)
  }

  /**
   * Get file metadata
   */
  async getFileInfo(instanceId: string, path: string): Promise<{ size: number; lastModified: number } | null> {
    if (!isOPFSSupported()) {
      return null
    }
    return await this.opfsStorage.getFileInfo(instanceId, path)
  }

  /**
   * Execute a bash-like command using JavaScript (simplified simulation)
   * This is a basic implementation - full bash would require WebVM
   */
  async executeBash(command: string, cwd: string = '/'): Promise<{ stdout: string, stderr: string, exitCode: number }> {
    try {
      // Parse basic commands
      const parts = command.trim().split(/\s+/)
      const cmd = parts[0]
      const args = parts.slice(1)

      switch (cmd) {
        case 'echo':
          return { stdout: args.join(' ') + '\n', stderr: '', exitCode: 0 }

        case 'ls': {
          const dir = args[0] || cwd
          try {
            const files = await this.listFiles('_bash', dir)
            return { stdout: files.join('\n') + '\n', stderr: '', exitCode: 0 }
          } catch {
            return { stdout: '', stderr: `ls: cannot access '${dir}': No such file or directory\n`, exitCode: 1 }
          }
        }

        case 'pwd':
          return { stdout: cwd + '\n', stderr: '', exitCode: 0 }

        case 'cat': {
          if (!args[0]) {
            return { stdout: '', stderr: 'cat: missing file operand\n', exitCode: 1 }
          }
          try {
            const content = await this.readFileAsText('_bash', args[0])
            return { stdout: content, stderr: '', exitCode: 0 }
          } catch {
            return { stdout: '', stderr: `cat: ${args[0]}: No such file or directory\n`, exitCode: 1 }
          }
        }

        case 'grep':
          return { stdout: '', stderr: 'grep: not supported in this environment\n', exitCode: 1 }

        default:
          return { stdout: '', stderr: `${cmd}: command not found\n`, exitCode: 127 }
      }
    } catch (error) {
      return { stdout: '', stderr: `bash: ${error}\n`, exitCode: 1 }
    }
  }

  /**
   * Fetch URL content (with CORS considerations)
   */
  async fetchUrl(url: string, options: RequestInit = {}): Promise<{ status: number, headers: Record<string, string>, body: string }> {
    try {
      const response = await fetch(url, {
        ...options,
        // Ensure CORS-safe defaults
        mode: 'cors',
        credentials: 'omit'
      })

      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key] = value
      })

      const body = await response.text()

      return {
        status: response.status,
        headers,
        body
      }
    } catch (error) {
      throw new Error(`Fetch failed: ${error}`)
    }
  }

  /**
   * Update persistent memory/context for the widget
   */
  async updateMemory(instanceId: string, key: string, content: string): Promise<void> {
    if (!isOPFSSupported()) {
      throw new Error('OPFS not supported for memory storage')
    }

    const memoryPath = `memory/${key}.md`
    await this.opfsStorage.writeFile(instanceId, memoryPath, content)
  }

  /**
   * Read persistent memory/context
   */
  async readMemory(instanceId: string, key: string): Promise<string | null> {
    if (!isOPFSSupported()) {
      return null
    }

    try {
      const memoryPath = `memory/${key}.md`
      return await this.opfsStorage.readFileAsText(instanceId, memoryPath)
    } catch {
      return null
    }
  }
}

// Global advanced tools instance
let advancedTools: AdvancedTools | null = null

export function getAdvancedTools(): AdvancedTools {
  if (!advancedTools) {
    advancedTools = new AdvancedTools()
  }
  return advancedTools
}