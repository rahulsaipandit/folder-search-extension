import { Defuddle } from 'defuddle-js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedPage {
  markdown: string
  title: string
  author: string
  date: string
  url: string
}

export interface BuildOptions {
  removeImages?: boolean
  removeLinks?: boolean
  showMetadata?: boolean
  showSourceUrl?: boolean
  showPageMap?: boolean
}

// Defaults match the original markdown.tsx initial toggle state
const DEFAULTS: Required<BuildOptions> = {
  removeImages: true,
  removeLinks: false,
  showMetadata: true,
  showSourceUrl: true,
  showPageMap: false,
}

// ─── Core extraction ──────────────────────────────────────────────────────────

/**
 * Parse raw HTML into structured page data.
 * Uses Defuddle (browser build) to extract the main article content.
 * Pure: no Chrome APIs, no DOM side effects beyond the DOMParser.
 */
export function parseHtmlToMarkdown(html: string, url?: string): ParsedPage {
  let article: any = null
  try {
    article = Defuddle.parse(html, { url: url ?? '' })
  } catch (err) {
    console.warn('[parseHtmlToMarkdown] Defuddle failed:', err)
  }

  return {
    markdown: (article?.contentMarkdown ?? article?.content ?? '') as string,
    title: (article?.title ?? '') as string,
    author: (article?.author ?? '') as string,
    date: (article?.datePublished ?? '') as string,
    url: url ?? '',
  }
}

// ─── Post-processing ──────────────────────────────────────────────────────────

/**
 * Apply formatting options to a ParsedPage and return the final markdown string.
 * Callers may override any option; unset keys fall back to the defaults.
 */
export function buildMarkdown(parsed: ParsedPage, options?: BuildOptions): string {
  const opts: Required<BuildOptions> = { ...DEFAULTS, ...options }

  let md = parsed.markdown

  if (opts.removeImages) {
    md = md.replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    md = md.replace(/<img[^>]*>/gi, '')
  }

  if (opts.removeLinks) {
    md = md.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    md = md.replace(/<a[^>]*>(.*?)<\/a>/gi, '$1')
  }

  // Build metadata / page-map header
  let header = ''
  const meta: string[] = []

  if (opts.showMetadata) {
    if (parsed.title) meta.push(`**Title:** ${parsed.title}`)
    if (parsed.author) meta.push(`**Author:** ${parsed.author}`)
    if (parsed.date) {
      try {
        meta.push(`**Date:** ${new Date(parsed.date).toLocaleDateString()}`)
      } catch {
        meta.push(`**Date:** ${parsed.date}`)
      }
    }
  }
  if (opts.showSourceUrl && parsed.url) {
    meta.push(`**Source:** [${parsed.url}](${parsed.url})`)
  }
  if (meta.length > 0) {
    header += meta.join('\n\n') + '\n\n---\n\n'
  }

  if (opts.showPageMap) {
    const map = generatePageMap(md, parsed.title || 'Page Structure')
    if (map) header += map + '\n---\n\n'
  }

  let result = header + md

  // Clean up: lone dashes/dots on their own line, trailing whitespace, 3+ blank lines
  result = result.replace(/^[ \t]*[-·][ \t]*$/gm, '')
  result = result.replace(/^[ \t]+$/gm, '')
  result = result.replace(/\n{3,}/g, '\n\n').trim()

  return result
}

// ─── Page map ─────────────────────────────────────────────────────────────────

interface HeadingNode {
  text: string
  level: number
  children: HeadingNode[]
}

/**
 * Generate an ASCII heading-tree from a markdown string.
 * Returns a fenced code block ready to prepend to the document.
 */
export function generatePageMap(markdown: string, title = 'Document Structure'): string {
  const headings: { level: number; text: string }[] = []
  for (const line of markdown.split('\n')) {
    const m = line.match(/^(#{1,6})\s+(.+)$/)
    if (m) headings.push({ level: m[1].length, text: m[2].trim() })
  }
  if (headings.length === 0) return ''

  const root: HeadingNode = { text: title, level: 0, children: [] }
  const stack: HeadingNode[] = [root]
  for (const h of headings) {
    const node: HeadingNode = { text: h.text, level: h.level, children: [] }
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop()
    stack[stack.length - 1].children.push(node)
    stack.push(node)
  }

  let out = `${title}\n`
  function renderNode(node: HeadingNode, prefix: string, isLast: boolean, isRoot: boolean) {
    if (!isRoot) {
      out += `${prefix}${isLast ? '└── ' : '├── '}${node.text}\n`
      const childPrefix = prefix + (isLast ? '    ' : '│   ')
      node.children.forEach((c, i) => renderNode(c, childPrefix, i === node.children.length - 1, false))
    } else {
      node.children.forEach((c, i) => renderNode(c, '', i === node.children.length - 1, false))
    }
  }
  renderNode(root, '', true, true)
  out = out.replace(/│\n$/g, '').trimEnd()

  return `# Page Structure Map\n\`\`\`text\n${out}\n\`\`\`\n`
}

// ─── Agent / widget helper (needs Chrome context) ────────────────────────────

declare const chrome: any

async function getTabContent(tabId: number): Promise<{ html: string; url: string }> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ html: document.documentElement.outerHTML, url: window.location.href }),
  })
  return results[0].result as { html: string; url: string }
}

/**
 * Extract and return formatted markdown from a tab. Used by agent steps.
 */
export async function getPageMarkdown(tabId: number, options?: BuildOptions): Promise<string> {
  const { html, url } = await getTabContent(tabId)
  return buildMarkdown(parseHtmlToMarkdown(html, url), options)
}
