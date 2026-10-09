// Markdown mínimo e seguro para os cartões: **negrito**, *itálico* (ou _itálico_), `código`
// e quebras de linha. Todo o resto é escapado: não existe HTML, link ou imagem vindo do texto.

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function inline(text) {
  let s = escapeHtml(text);
  // sem lookbehind (Safari antes do 16.4 não entende): o conteúdo começa e termina sem espaço
  s = s.replace(/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\p{L}\p{N}])\*([^*\s](?:[^*]*[^*\s])?)\*(?![*\p{L}\p{N}])/gu, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\p{L}\p{N}])_([^_\s](?:[^_]*[^_\s])?)_(?![_\p{L}\p{N}])/gu, '$1<em>$2</em>');
  return s;
}

/** Converte o texto do cartão em HTML seguro. */
export function renderMarkdown(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const parts = [];
  let last = 0;
  const re = /`([^`\n]+)`/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    parts.push(inline(src.slice(last, m.index)));
    parts.push(`<code>${escapeHtml(m[1])}</code>`);
    last = m.index + m[0].length;
  }
  parts.push(inline(src.slice(last)));
  return parts.join('').replace(/\n/g, '<br>');
}

/** Texto puro (sem marcações), para listas e prévias. */
export function plainText(text, max = 80) {
  const s = String(text ?? '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
