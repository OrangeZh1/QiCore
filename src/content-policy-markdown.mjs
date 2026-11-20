import { marked } from 'marked'
import { sanitizeRichTextHtml } from './content-rich-text.mjs'

export function renderPolicyMarkdown(source, imageAllowed) {
  return sanitizeRichTextHtml(marked.parse(source, { async: false }), imageAllowed, false)
}
