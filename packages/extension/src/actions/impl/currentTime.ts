import { z } from 'zod';
import { ActionDefinition } from '../types';

const inputSchema = z.object({
  timezone: z.string().optional(), // Optional timezone, e.g., 'America/New_York'
});

const outputSchema = z.object({
  timestamp: z.number(),
  formatted: z.string(), // ISO string or localized
});

export const CurrentTimeAction: ActionDefinition<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  id: 'org.page-agent.time.current',
  name: 'Get Current Time',
  description: 'Retrieves the current date and time',
  version: '1.0.0',
  capabilities: ['system.time'],
  triggers: ['what time', 'current time', 'what is the time', 'what\'s the time', 'time right now', 'today\'s date', 'current date', 'what day is it'],
  inputSchema,
  outputSchema,
  fallbackToLLM: false,
  execute: async (input, context) => {
    const now = new Date();
    let formatted: string;
    if (input.timezone) {
      // Basic timezone support; can enhance with library
      formatted = now.toLocaleString('en-US', { timeZone: input.timezone });
    } else {
      formatted = now.toISOString();
    }
    return {
      timestamp: now.getTime(),
      formatted,
    };
  },
};