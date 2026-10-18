/**
 * Advanced tool implementations for widgets
 */
export declare class AdvancedTools {
    private opfsStorage;
    /**
     * Read file from OPFS storage
     */
    readFile(instanceId: string, path: string): Promise<Uint8Array>;
    /**
     * Read file as text from OPFS storage
     */
    readFileAsText(instanceId: string, path: string): Promise<string>;
    /**
     * Write file to OPFS storage
     */
    writeFile(instanceId: string, path: string, content: Uint8Array | string): Promise<void>;
    /**
     * List files in OPFS directory
     */
    listFiles(instanceId: string, path?: string): Promise<string[]>;
    /**
     * Delete file from OPFS storage
     */
    deleteFile(instanceId: string, path: string): Promise<void>;
    /**
     * Check if file exists in OPFS
     */
    fileExists(instanceId: string, path: string): Promise<boolean>;
    /**
     * Get file metadata
     */
    getFileInfo(instanceId: string, path: string): Promise<{
        size: number;
        lastModified: number;
    } | null>;
    /**
     * Execute a bash-like command using JavaScript (simplified simulation)
     * This is a basic implementation - full bash would require WebVM
     */
    executeBash(command: string, cwd?: string): Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>;
    /**
     * Fetch URL content (with CORS considerations)
     */
    fetchUrl(url: string, options?: RequestInit): Promise<{
        status: number;
        headers: Record<string, string>;
        body: string;
    }>;
    /**
     * Update persistent memory/context for the widget
     */
    updateMemory(instanceId: string, key: string, content: string): Promise<void>;
    /**
     * Read persistent memory/context
     */
    readMemory(instanceId: string, key: string): Promise<string | null>;
}
export declare function getAdvancedTools(): AdvancedTools;
