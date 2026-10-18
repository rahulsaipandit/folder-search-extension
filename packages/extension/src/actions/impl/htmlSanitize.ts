import DOMPurify from 'dompurify';
import { z } from 'zod';
import { ActionDefinition } from '../types';

const inputSchema = z.object({
  html: z.string(),
  mode: z.enum(['html', 'svg', 'svg+svgFilters']).optional(),
});

const outputSchema = z.object({
  sanitized: z.string(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const HTMLSanitizeAction: ActionDefinition<Input, Output> = {
  id: 'org.page-agent.html.sanitize',
  name: 'HTML/SVG Sanitizer',
  description:
    'Remove XSS vectors and dangerous elements from HTML or SVG markup. ' +
    'Provide html (string) and an optional mode: "html" (default) for general HTML, ' +
    '"svg" for SVG content, or "svg+svgFilters" to also allow SVG filter primitives. ' +
    'Returns sanitized markup safe for rendering in the browser.',
  version: '1.0.0',
  capabilities: ['system.html'],
  inputSchema,
  outputSchema,
  fallbackToLLM: false,
  execute: async (input, _context) => {
    let sanitized: string;

    switch (input.mode) {
      case 'svg':
        sanitized = DOMPurify.sanitize(input.html, { USE_PROFILES: { svg: true } });
        break;
      case 'svg+svgFilters':
        sanitized = DOMPurify.sanitize(input.html, { USE_PROFILES: { svg: true, svgFilters: true } });
        break;
      default:
        sanitized = DOMPurify.sanitize(input.html);
    }

    return { sanitized };
  },
};
