// File kind detection, text extraction (for search) and simplified Office previews.
// Extracted: DOCX, PPTX, XLSX, HTML, TXT/MD/code. NOT extracted: PDF, images, legacy .doc/.ppt/.xls.
import { readZip } from './zip.js';

const EXT_KIND = {
  pdf: 'pdf', pptx: 'slides', ppt: 'slides', docx: 'doc', doc: 'doc', xlsx: 'sheet', xls: 'sheet', csv: 'text',
  html: 'html', htm: 'html', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  txt: 'text', md: 'md', markdown: 'md', js: 'code', ts: 'code', json: 'code', py: 'code', sql: 'code', css: 'code',
};
const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  html: 'text/html', htm: 'text/html', txt: 'text/plain', md: 'text/plain', markdown: 'text/plain', csv: 'text/plain',
  js: 'text/plain', ts: 'text/plain', json: 'text/plain', py: 'text/plain', sql: 'text/plain', css: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
export const extOf = name => (/\.([a-z0-9]+)$/i.exec(name || '')?.[1] || '').toLowerCase();
export const kindOf = name => EXT_KIND[extOf(name)] || 'other';
export const mimeOf = name => MIME[extOf(name)] || 'application/octet-stream';

const ent = s => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k];
});
const texts = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, 'g'))].map(m => ent(m[1]));
const byNum = (a, b) => parseInt(/(\d+)\.xml$/.exec(a)[1]) - parseInt(/(\d+)\.xml$/.exec(b)[1]);

function docx(z) {
  const xml = z.read('word/document.xml')?.toString('utf8') || '';
  return xml.split(/<w:p[ >]/).slice(1).map(p => ({
    style: /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] || '',
    text: p.replace(/<w:tab\/>/g, '<w:t>\t</w:t>').match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g)?.map(t => ent(t.replace(/<[^>]+>/g, ''))).join('') || '',
  })).filter(p => p.text.trim());
}
function pptx(z) {
  return z.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(byNum).map(n => {
    const xml = z.read(n).toString('utf8');
    return xml.split(/<a:p>|<a:p /).slice(1).map(p => texts(p, 'a:t').join('')).filter(t => t.trim());
  });
}
function xlsx(z) {
  const shared = (z.read('xl/sharedStrings.xml')?.toString('utf8') || '').split(/<si>/).slice(1).map(si => texts(si, 't').join(''));
  // ponytail: assumes sheetN.xml order matches workbook order (true for Excel-saved files); read workbook rels if names ever mismatch.
  const sheetNames = [...(z.read('xl/workbook.xml')?.toString('utf8') || '').matchAll(/<sheet [^>]*name="([^"]*)"/g)].map(m => ent(m[1]));
  return z.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(byNum).map((n, i) => {
    const xml = z.read(n).toString('utf8');
    const rows = [];
    for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= 300) break;
      const row = [];
      for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const col = [...cm[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const type = /t="(\w+)"/.exec(cm[2])?.[1];
        const v = /<v>([^<]*)<\/v>/.exec(cm[3] || '')?.[1];
        const f = /<f[^>]*>([^<]*)<\/f>/.exec(cm[3] || '')?.[1];
        let val = type === 's' ? shared[+v] ?? '' : type === 'inlineStr' ? texts(cm[3] || '', 't').join('') : ent(v ?? '');
        if (f && !val) val = '=' + ent(f);
        if (col < 60) row[col] = val;
      }
      rows.push(Array.from(row, x => x ?? ''));
    }
    return { name: sheetNames[i] || `גיליון ${i + 1}`, rows };
  });
}

export function htmlToText(html) {
  return ent(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

// Returns { preview, text, status } — status: 'extracted' | 'unsupported' | 'failed'
export function extract(file, name, buf) {
  const ext = extOf(name);
  try {
    if (ext === 'docx') { const z = readZip(file, { budget: 64 * 1048576 }); try { const p = docx(z); return { preview: { type: 'doc', paragraphs: p }, text: p.map(x => x.text).join('\n'), status: 'extracted' }; } finally { z.close(); } }
    if (ext === 'pptx') { const z = readZip(file, { budget: 64 * 1048576 }); try { const s = pptx(z); return { preview: { type: 'slides', slides: s }, text: s.map(x => x.join('\n')).join('\n\n'), status: 'extracted' }; } finally { z.close(); } }
    if (ext === 'xlsx') { const z = readZip(file, { budget: 64 * 1048576 }); try { const s = xlsx(z); return { preview: { type: 'sheet', sheets: s }, text: s.map(x => x.name + '\n' + x.rows.map(r => r.join(' ')).join('\n')).join('\n'), status: 'extracted' }; } finally { z.close(); } }
    if (ext === 'html' || ext === 'htm') return { preview: null, text: htmlToText(buf().toString('utf8')), status: 'extracted' };
    if (['txt', 'md', 'markdown', 'csv', 'js', 'ts', 'json', 'py', 'sql', 'css'].includes(ext)) return { preview: null, text: buf().toString('utf8'), status: 'extracted' };
    return { preview: null, text: null, status: 'unsupported' };
  } catch (e) {
    return { preview: null, text: null, status: 'failed', error: e.message };
  }
}

// Lists external (network) dependencies an HTML file references; they are blocked in the viewer by default.
export function externalDeps(html) {
  return [...new Set([...html.matchAll(/<(?:script|link|img|iframe)[^>]+(?:src|href)=["'](https?:)?\/\/([^"'/]+)/gi)].map(m => m[2]))];
}
