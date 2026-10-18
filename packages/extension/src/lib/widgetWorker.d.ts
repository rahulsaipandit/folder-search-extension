/**
 * OPFS (Origin Private File System) storage for widgets
 * Provides high-performance file storage beyond IndexedDB limits
 */
export declare class OPFSStorage {
    private root;
    initialize(): Promise<void>;
    /**
     * Get or create directory for a widget instance
     */
    private getInstanceDir;
    /**
     * Write file to widget instance directory
     */
    writeFile(instanceId: string, path: string, content: Uint8Array | string): Promise<void>;
    /**
     * Read file from widget instance directory
     */
    readFile(instanceId: string, path: string): Promise<Uint8Array>;
    /**
     * Read file as text
     */
    readFileAsText(instanceId: string, path: string): Promise<string>;
    /**
     * List files in directory
     */
    listFiles(instanceId: string, path?: string): Promise<string[]>;
    /**
     * Delete file or directory
     */
    deleteFile(instanceId: string, path: string): Promise<void>;
    /**
     * Get file metadata
     */
    getFileInfo(instanceId: string, path: string): Promise<{
        size: number;
        lastModified: number;
    } | null>;
    /**
     * Check if file exists
     */
    fileExists(instanceId: string, path: string): Promise<boolean>;
}
export declare function getOPFSStorage(): OPFSStorage;
export declare function isOPFSSupported(): boolean;
