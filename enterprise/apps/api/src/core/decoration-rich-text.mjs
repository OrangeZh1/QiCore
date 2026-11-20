import {sanitizeRichTextHtml} from './rich-text.mjs';
// Decoration images always resolve through the current tenant/application media authorization.
export function sanitizeDecorationHtml(value){return sanitizeRichTextHtml(value||'',src=>/^\/decoration-media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(src||''),false)}
