// school-shop policy rendering: existing Markdown and visual-editor HTML share one safe renderer.
import {marked} from 'marked';
import {sanitizeRichTextHtml,richTextHasText} from './rich-text.mjs';
export const renderPolicyMarkdown=source=>sanitizeRichTextHtml(marked.parse(source,{async:false}));
export const policyHasText=source=>richTextHasText(renderPolicyMarkdown(source));
