import { z } from 'zod';
import { ActionDefinition } from '../types';

const encodeInputSchema = z.object({
  text: z.string(),
});

const encodeOutputSchema = z.object({
  encoded: z.string(),
});

export const URLEncoderAction: ActionDefinition<z.infer<typeof encodeInputSchema>, z.infer<typeof encodeOutputSchema>> = {
  id: 'org.page-agent.url.encode',
  name: 'URL Encoder',
  description: 'Encodes text for safe use in URLs',
  version: '1.0.0',
  capabilities: ['system.url'],
  inputSchema: encodeInputSchema,
  outputSchema: encodeOutputSchema,
  fallbackToLLM: false,
  execute: async (input, context) => {
    return {
      encoded: encodeURIComponent(input.text),
    };
  },
};

const decodeInputSchema = z.object({
  text: z.string(),
});

const decodeOutputSchema = z.union([
  z.object({ decoded: z.string() }),
  z.object({ error: z.string() }),
]);

export const URLDecoderAction: ActionDefinition<z.infer<typeof decodeInputSchema>, z.infer<typeof decodeOutputSchema>> = {
  id: 'org.page-agent.url.decode',
  name: 'URL Decoder',
  description: 'Decodes URL-encoded text',
  version: '1.0.0',
  capabilities: ['system.url'],
  inputSchema: decodeInputSchema,
  outputSchema: decodeOutputSchema,
  fallbackToLLM: false,
  execute: async (input, context) => {
    try {
      return {
        decoded: decodeURIComponent(input.text),
      };
    } catch (error) {
      return {
        error: (error as Error).message,
      };
    }
  },
};