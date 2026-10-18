import { z } from 'zod';
import { ActionDefinition } from '../types';
import { parseHtmlToMarkdown, buildMarkdown } from '../../lib/parseHtmlToMarkdown';

declare const chrome: any;

const inputSchema = z.object({
  tabId: z.number().int().optional(),
  html: z.string().optional(),
  url: z.string().optional(),
  removeImages: z.boolean().optional(),
  removeLinks: z.boolean().optional(),
  showMetadata: z.boolean().optional(),
  showSourceUrl: z.boolean().optional(),
  showPageMap: z.boolean().optional(),
}).refine(d => d.tabId !== undefined || d.html !== undefined, {
  message: 'Provide either tabId (Chrome tab ID) or html (raw HTML string)',
});

const outputSchema = z.object({
  markdown: z.string(),
  title: z.string(),
  author: z.string(),
  date: z.string(),
  url: z.string(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export const PageMarkdownAction: ActionDefinition<Input, Output> = {
  id: 'org.page-agent.page.extract-markdown',
  name: 'Page Content Extractor',
  description:
    'Extract web page content as clean markdown with title, author, date, and URL metadata. ' +
    'Provide tabId (number) to read from a live Chrome tab, or html (string) for raw HTML. ' +
    'Optional: url (string) source hint when using html; removeImages (boolean, default true); ' +
    'removeLinks (boolean, default false); showMetadata (boolean, default true) - prepends title/author/date; ' +
    'showSourceUrl (boolean, default true); showPageMap (boolean, default false) - prepends heading outline.',
  version: '1.0.0',
  capabilities: ['tabs.read', 'scripting'],
  inputSchema,
  outputSchema,
  fallbackToLLM: false,
  timeoutMs: 10_000, // tab scripting can take a moment on heavy pages
  execute: async (input, _context) => {
    const options = {
      removeImages: input.removeImages,
      removeLinks: input.removeLinks,
      showMetadata: input.showMetadata,
      showSourceUrl: input.showSourceUrl,
      showPageMap: input.showPageMap,
    };

    let rawHtml: string;
    let pageUrl: string;

    if (input.tabId !== undefined) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: input.tabId },
        func: () => ({ html: document.documentElement.outerHTML, url: window.location.href }),
      });
      ({ html: rawHtml, url: pageUrl } = results[0].result as { html: string; url: string });
    } else {
      rawHtml = input.html!;
      pageUrl = input.url ?? '';
    }

    const parsed = parseHtmlToMarkdown(rawHtml, pageUrl);
    const markdown = buildMarkdown(parsed, options);

    return {
      markdown,
      title: parsed.title,
      author: parsed.author,
      date: parsed.date,
      url: parsed.url,
    };
  },
};
