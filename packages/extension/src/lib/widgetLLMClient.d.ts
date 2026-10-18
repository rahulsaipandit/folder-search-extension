import { z } from 'zod';
/**
 * Enhanced encryption utilities for secure storage of sensitive data
 */
declare class SecureStorage {
    private key;
    initialize(): Promise<void>;
    encrypt(data: string): Promise<string>;
    decrypt(encryptedData: string): Promise<string>;
}
declare const secureStorage: SecureStorage;
/**
 * Bridge for widgets to access the extension's existing LLM integration
 */
export declare class WidgetLLMBridge {
    private llm;
    private config;
    initialize(): Promise<void>;
    complete(prompt: string): Promise<string>;
    extract<T>(content: string, schema: z.ZodType<T>): Promise<T>;
}
export declare function getWidgetLLMBridge(): WidgetLLMBridge;
export { secureStorage };
