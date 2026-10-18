/**
 * Origin Private File System (OPFS) storage utility.
 *
 * Browser-only: requires the File System Access API (navigator.storage.getDirectory).
 * Not available in Node.js or non-browser runtimes.
 *
 * Namespace convention:
 *   skills/<skill-name>          → SKILL.md, scripts/, references/
 *   widgets/<instance-id>        → arbitrary widget files
 *
 * Both skills and widgets share one OPFSStorage singleton via getOPFSStorage().
 */
export class OPFSStorage {
  private root: FileSystemDirectoryHandle | null = null

  async initialize(): Promise<void> {
    if (this.root) return
    try {
      this.root = await navigator.storage.getDirectory()
    } catch (error) {
      throw new Error(`Failed to initialize OPFS: ${error}`)
    }
  }

  /**
   * Get or create a directory handle for the given namespace.
   * Namespace may contain slashes for sub-directories, e.g. 'skills/my-skill'.
   */
  async getNamespaceDir(namespace: string): Promise<FileSystemDirectoryHandle> {
    await this.initialize()
    if (!this.root) throw new Error('OPFS not initialized')

    const parts = namespace.split('/').filter(Boolean)
    let dir: FileSystemDirectoryHandle = this.root
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true })
    }
    return dir
  }

  /** Write a file under the given namespace. Intermediate path segments are created automatically. */
  async writeFile(namespace: string, path: string, content: Uint8Array | string): Promise<void> {
    const dir = await this.getNamespaceDir(namespace)
    const pathParts = path.split('/')
    const fileName = pathParts.pop()!
    let currentDir = dir
    for (const part of pathParts) {
      if (part) currentDir = await currentDir.getDirectoryHandle(part, { create: true })
    }
    const fileHandle = await currentDir.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    await (writable as any).write(content)
    await writable.close()
  }

  /** Read a file as raw bytes. */
  async readFile(namespace: string, path: string): Promise<Uint8Array> {
    const dir = await this.getNamespaceDir(namespace)
    const pathParts = path.split('/')
    const fileName = pathParts.pop()!
    let currentDir = dir
    for (const part of pathParts) {
      if (part) currentDir = await currentDir.getDirectoryHandle(part)
    }
    const fileHandle = await currentDir.getFileHandle(fileName)
    const file = await fileHandle.getFile()
    return new Uint8Array(await file.arrayBuffer())
  }

  /** Read a file as a UTF-8 string. */
  async readFileAsText(namespace: string, path: string): Promise<string> {
    return new TextDecoder().decode(await this.readFile(namespace, path))
  }

  /** List names of entries directly inside the namespace (or a sub-path within it). */
  async listEntries(namespace: string, subPath = ''): Promise<string[]> {
    const dir = await this.getNamespaceDir(namespace)
    let currentDir = dir
    if (subPath) {
      for (const part of subPath.split('/').filter(Boolean)) {
        currentDir = await currentDir.getDirectoryHandle(part)
      }
    }
    const names: string[] = []
    for await (const [name] of currentDir.entries()) {
      names.push(name)
    }
    return names
  }

  /** Delete a file or directory (recursive). Silently ignores missing entries. */
  async deleteEntry(namespace: string, path: string): Promise<void> {
    const dir = await this.getNamespaceDir(namespace)
    const pathParts = path.split('/')
    const entryName = pathParts.pop()!
    let currentDir = dir
    for (const part of pathParts) {
      if (part) currentDir = await currentDir.getDirectoryHandle(part)
    }
    try {
      await currentDir.removeEntry(entryName, { recursive: true })
    } catch {
      // Entry does not exist — no-op
    }
  }

  /** Delete the entire namespace directory and all its contents. */
  async deleteNamespace(namespace: string): Promise<void> {
    await this.initialize()
    if (!this.root) throw new Error('OPFS not initialized')
    const parts = namespace.split('/').filter(Boolean)
    if (parts.length === 0) throw new Error('Cannot delete OPFS root')
    const entryName = parts.pop()!
    let parentDir: FileSystemDirectoryHandle = this.root
    for (const part of parts) {
      parentDir = await parentDir.getDirectoryHandle(part)
    }
    try {
      await parentDir.removeEntry(entryName, { recursive: true })
    } catch {
      // Namespace does not exist — no-op
    }
  }

  /** Return size and last-modified timestamp for a file, or null if it does not exist. */
  async getFileInfo(namespace: string, path: string): Promise<{ size: number; lastModified: number } | null> {
    try {
      const dir = await this.getNamespaceDir(namespace)
      const pathParts = path.split('/')
      const fileName = pathParts.pop()!
      let currentDir = dir
      for (const part of pathParts) {
        if (part) currentDir = await currentDir.getDirectoryHandle(part)
      }
      const fileHandle = await currentDir.getFileHandle(fileName)
      const file = await fileHandle.getFile()
      return { size: file.size, lastModified: file.lastModified }
    } catch {
      return null
    }
  }

  /** Returns true if the file exists. */
  async fileExists(namespace: string, path: string): Promise<boolean> {
    return (await this.getFileInfo(namespace, path)) !== null
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton — shared across skills and widgets in the same origin
// ---------------------------------------------------------------------------

let _instance: OPFSStorage | null = null

export function getOPFSStorage(): OPFSStorage {
  if (!_instance) _instance = new OPFSStorage()
  return _instance
}

/** Returns true when the current runtime supports OPFS. */
export function isOPFSSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    typeof (navigator.storage as any).getDirectory === 'function'
  )
}
