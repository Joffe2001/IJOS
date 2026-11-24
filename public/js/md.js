// Small Markdown renderer for notes/summaries. All text is HTML-escaped; only safe link targets are emitted.
// Supports: # headings, lists (incl. [ ] checkboxes), > quotes, ``` code ```, tables, ---, **bold**, *italic*, `code`, [link](url), $math$ and $$math$$ (KaTeX).
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function math(src, display) {
  const k = globalThis.katex;
  if (!k) return `<code dir="ltr">${esc(src)}</code>`;
  try { return k.renderToString(src, { displayMode: display, throwOnError: false, output: 'html' }); }
  catch { return `<code dir="ltr" class="math-err">${esc(src)}</code>`; }
}
const safeUrl = u => /^(https?:|mailto:|#)/i.test(u.trim()) ? u.trim() : null;

export function inline(s) {
  const stash = [];
  const keep = h => `\u0000${stash.push(h) - 1}\u0000`;
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code dir="ltr">${esc(c)}</code>`));
  s = s.replace(/\$\$([^$]+)\$\$/g, (_, m) => keep(math(m, true)));
  s = s.replace(/(^|[^\\\w])\$(?=\S)([^$\n]*?\S)\$(?!\d)/g, (_, pre, m) => pre + keep(`<span dir="ltr">${math(m, false)}</span>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, t, u) => { const url = safeUrl(u); return url ? keep(`<a href="${esc(url)}"${url.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"'}>${inline(t)}</a>`) : all; });
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[i]);
}

export const slug = (t, i) => 'h-' + i + '-' + t.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40);

export function render(src, opts = {}) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const headings = [];
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out.push(`<p dir="auto">${para.map(inline).join('<br>')}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if ((m = /^```\s*([\w+-]*)\s*$/.exec(l))) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre dir="ltr" class="code"${m[1] ? ` data-lang="${esc(m[1])}"` : ''}><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\$\$\s*$/.test(l)) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !/^\$\$\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<div class="math-block" dir="ltr">${math(body.join('\n'), true)}</div>`);
      continue;
    }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) {
      flush();
      const lvl = Math.min(m[1].length + (opts.shift || 0), 6), id = slug(m[2], headings.length);
      headings.push({ level: m[1].length, text: m[2], id });
      out.push(`<h${lvl} id="${id}" dir="auto">${inline(m[2])}</h${lvl}>`);
      i++; continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(l)) {
      flush();
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${render(q.join('\n')).html}</blockquote>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(l) && /^\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      flush();
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map(c => `<th dir="auto">${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td dir="auto">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*]|\d+[.)])\s+/.test(l)) {
      flush();
      const ordered = /^\s*\d/.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
        let t = lines[i++].replace(/^\s*([-*]|\d+[.)])\s+/, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i])) t += '\n' + lines[i++].trim();
        const cb = /^\[( |x|X)\]\s+/.exec(t);
        items.push(cb ? `<li class="task" dir="auto"><span class="cb" aria-hidden="true">${cb[1] === ' ' ? '☐' : '☑'}</span> ${inline(t.slice(cb[0].length))}</li>` : `<li dir="auto">${t.split('\n').map(inline).join('<br>')}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l);
    i++;
  }
  flush();
  return { html: out.join('\n'), headings };
}

export const md = (src, opts) => render(src, opts).html;
