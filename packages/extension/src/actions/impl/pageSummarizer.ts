import { z } from 'zod';
import { ActionDefinition } from '../types';

const inputSchema = z.object({
  url: z.string().optional(), // Optional URL to summarize, otherwise current page
  maxLength: z.number().optional(), // Max summary length
});

const outputSchema = z.object({
  summary: z.string(),
  title: z.string().optional(),
  url: z.string(),
});

// Simple page summarization - extracts basic info
function summarizePage(url?: string, maxLength?: number): { summary: string; title?: string; url: string } {
  // In practice, this would need to access page content via extension APIs
  // For now, return a placeholder
  return {
    summary: 'This is a placeholder summary. In a real implementation, this would analyze the page content and provide a meaningful summary.',
    title: document.title || 'Untitled Page',
    url: url || window.location.href,
  };
}

export const PageSummarizerAction: ActionDefinition<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  id: 'org.page-agent.page.summarize',
  name: 'Page Summarizer',
  description: 'Summarizes web page content',
  version: '1.0.0',
  capabilities: ['tabs.read', 'system.page'],
  triggers: ['summarize this page', 'summarize the page', 'summarize this article', 'what is this page about', 'tldr', 'tl;dr', 'give me a summary'],
  inputSchema,
  outputSchema,
  fallbackToLLM: true, // Can fall back to LLM for better summarization
  execute: async (input, context) => {
    // In a real implementation, this would need extension permissions to access page content
    const result = summarizePage(input.url, input.maxLength);
    
    if (input.maxLength && result.summary.length > input.maxLength) {
      result.summary = result.summary.substring(0, input.maxLength - 3) + '...';
    }
    
    return result;
  },
};