// Adapted from school-shop/apps/api/src/rich-text.ts.
import sanitizeHtml from 'sanitize-html';
const inlineImage = value => {if(typeof value==='string'&&/^\/api\/public\/site-assets\/[a-f0-9-]{36}$/.test(value))return true;if(typeof value!=='string'||value.length>400000||!/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return false;const b=Buffer.from(value.split(',')[1],'base64');return b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'};
const httpUrl = (value) => {
  try { return ['http:', 'https:'].includes(new URL(value ?? '').protocol); }
  catch { return false; }
};

const urlAttributes = (tagName, attributes) => {
  const attribs = { ...attributes };
  if (!httpUrl(attribs.href)) {
    delete attribs.href;
    delete attribs.target;
    delete attribs.rel;
  } else if (attribs.target === '_blank') {
    attribs.rel = 'noopener noreferrer';
  } else if (attribs.target !== '_self') {
    delete attribs.target;
    delete attribs.rel;
  }
  return { tagName, attribs };
};

const mediaAttributes = (tagName, attributes, imageAllowed) => {
  const attribs = { ...attributes };
  if (tagName==='img'?!imageAllowed(attribs.src):!httpUrl(attribs.src)) delete attribs.src;
  if (attribs.poster && !httpUrl(attribs.poster)) delete attribs.poster;
  return { tagName, attribs };
};

export function sanitizeRichTextHtml(value, imageAllowed = value=>httpUrl(value)||inlineImage(value), allowVideo = true) {
  return sanitizeHtml(value, {
    allowedTags: [
      'hr', 'sup', 'sub', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'u', 's', 'blockquote',
      'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'code', 'a',
      'img', 'video', 'br', 'span', 'div',
    ].filter(tag=>allowVideo||tag!=='video'),
    allowedAttributes: {
      '*': ['style'],
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      video: ['src', 'poster', 'controls', 'width', 'height', 'playsinline'],
      ol: ['start'],
      li: ['value'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      pre: ['class'],
      code: ['class'],
    },
    allowedClasses: { pre: [/^language-[\w-]+$/u], code: [/^language-[\w-]+$/u] },
    allowedStyles: { '*': { 'text-align': [/^(?:left|right|center|justify)$/u], 'color': [/^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([0-9.,% ]+\))$/], 'background-color': [/^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([0-9.,% ]+\))$/], 'font-size': [/^[0-9.]+(?:px|em|rem|%)$/], 'font-family': [/^[a-zA-Z\u4e00-\u9fff0-9 ,"'-]{1,100}$/], 'line-height': [/^[0-9.]+(?:px|em|rem|%)?$/], 'text-indent': [/^[0-9.]+(?:px|em|rem)$/] } },
    allowedSchemes: ['http', 'https'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    transformTags: { a: urlAttributes, img: (tag,attrs)=>mediaAttributes(tag,attrs,imageAllowed), video: (tag,attrs)=>mediaAttributes(tag,attrs,imageAllowed) },
    exclusiveFilter: frame => frame.tag==='img'?!imageAllowed(frame.attribs.src):frame.tag==='video'&&!httpUrl(frame.attribs.src),
    nestingLimit: 100,
  });
}

export function richTextHasText(value) {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
    .replace(/[\s\u00a0\u200b]+/gu, '').length > 0;
}

export function optionalRichTextHtml(value) {
  if (!value) return null;
  const clean = sanitizeRichTextHtml(value);
  return richTextHasText(clean) ? clean : null;
}
