import { z } from 'zod';
import { ActionDefinition } from '../types';

const inputSchema = z.object({
  text: z.string(),
  maxLength: z.number().optional(), // Optional character limit
  style: z.enum(['professional', 'casual', 'concise', 'detailed']).optional(),
});

const outputSchema = z.object({
  rephrased: z.string(),
  originalLength: z.number(),
  newLength: z.number(),
});

// Simple rephrasing - in practice this could use NLP libraries
function rephraseText(text: string, maxLength?: number, style?: string): string {
  let result = text;
  
  // Basic length trimming if needed
  if (maxLength && text.length > maxLength) {
    result = text.substring(0, maxLength - 3) + '...';
  }
  
  // Basic style adjustments
  switch (style) {
    case 'professional':
      // Could add more formal language
      break;
    case 'casual':
      // Could make more conversational
      break;
    case 'concise':
      // Remove unnecessary words
      result = result.replace(/\s+/g, ' ').trim();
      break;
    case 'detailed':
      // Could expand with more context
      break;
  }
  
  return result;
}

export const TextRephraserAction: ActionDefinition<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  id: 'org.page-agent.text.rephrase',
  name: 'Text Rephraser',
  description: 'Rephrases text to fit length constraints or style preferences',
  version: '1.0.0',
  capabilities: ['system.text'],
  inputSchema,
  outputSchema,
  fallbackToLLM: true, // Can fall back to LLM for better rephrasing
  execute: async (input, context) => {
    const rephrased = rephraseText(input.text, input.maxLength, input.style);
    
    return {
      rephrased,
      originalLength: input.text.length,
      newLength: rephrased.length,
    };
  },
};