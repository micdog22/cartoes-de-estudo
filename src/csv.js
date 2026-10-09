// Importação e exportação de cartões em CSV/TSV.
// Formato: uma linha por cartão, "pergunta;resposta". Aceita ponto e vírgula, vírgula ou tab
// (detectado automaticamente), campos entre aspas com "" para aspas literais e quebras de linha
// dentro das aspas, como no RFC 4180.

export class CsvError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CsvError';
  }
}

/**
 * Separador mais provável: lê as primeiras linhas com cada candidato (tab, ponto e vírgula,
 * vírgula), usando as mesmas regras de aspas do leitor, e fica com o que dá mais linhas
 * de pelo menos duas colunas. Empate vai para a ordem tab, ponto e vírgula, vírgula.
 */
export function detectDelimiter(text) {
  const sample = String(text).split('\n').slice(0, 50).join('\n');
  let best = ';';
  let bestScore = -1;
  for (const sep of ['\t', ';', ',']) {
    let score = 0;
    try {
      for (const r of parseCsv(sample, sep).rows) if (r.fields.length >= 2) score++;
    } catch {
      score = 0; // aspas sem fechar no trecho: este separador não ganha pontos
    }
    if (score > bestScore) {
      best = sep;
      bestScore = score;
    }
  }
  return best;
}

/** Lê o texto em linhas de campos. */
export function parseCsv(input, delimiter = null) {
  let text = String(input);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM do Excel
  text = text.replace(/\r\n?/g, '\n'); // quebras de linha do Windows e do Mac antigo
  const sep = delimiter || detectDelimiter(text);
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let quotedField = false;
  let afterQuote = false;
  let line = 1;
  let rowStart = 1;
  let quoteStartLine = 1;
  const endField = () => {
    if (!quotedField) row.push(field.trim());
    else row.push(afterQuote ? field.replace(/\s+$/, '') : field);
    field = '';
    quotedField = false;
    afterQuote = false;
  };
  const endRow = () => {
    endField();
    if (row.some((f) => f !== '')) rows.push({ fields: row, line: rowStart });
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      inQuotes = true;
      quotedField = true;
      field = '';
      quoteStartLine = line;
    } else if (ch === sep) endField();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      line++;
      rowStart = line;
    } else if (quotedField) {
      // texto depois das aspas de fechamento ("Dom Casmurro" foi escrito por quem?): junta como está
      field += ch;
      afterQuote = true;
    } else field += ch;
  }
  if (inQuotes) throw new CsvError(`Aspas abertas na linha ${quoteStartLine} não foram fechadas.`);
  if (field !== '' || row.length) endRow();
  return { rows, delimiter: sep };
}

const HEADERS = new Set(['pergunta', 'frente', 'front', 'question', 'perguntas']);

export const MAX_FIELD = 5000;

/**
 * Converte linhas em cartões { front, back }. A primeira linha é ignorada se parecer cabeçalho.
 * Colunas além da segunda são juntadas à resposta (comum em "dog,cachorro, cão"); linhas sem
 * pergunta ou resposta, ou com texto longo demais, entram em `invalid`.
 */
export function rowsToCards(rows, delimiter = ';') {
  const cards = [];
  const invalid = [];
  const merged = [];
  rows.forEach((r, i) => {
    const front = (r.fields[0] ?? '').trim();
    let back = (r.fields[1] ?? '').trim();
    if (i === 0 && HEADERS.has(front.toLowerCase())) return;
    if (r.fields.length > 2) {
      const extra = r.fields.slice(2).join(delimiter).trim();
      if (extra) {
        back = r.fields.slice(1).filter((f) => f.trim()).join(delimiter === '\t' ? ' ' : `${delimiter} `).trim();
        merged.push(r.line);
      }
    }
    if (!front || !back || front.length > MAX_FIELD || back.length > MAX_FIELD) {
      invalid.push(r.line);
      return;
    }
    cards.push({ front, back });
  });
  return { cards, invalid, merged };
}

export function importCards(text) {
  const { rows, delimiter } = parseCsv(text);
  return { ...rowsToCards(rows, delimiter), delimiter };
}

/**
 * Decodifica os bytes de um arquivo: UTF-8 quando for válido; senão Windows-1252, que é o
 * padrão do Excel em português ao salvar "CSV (separado por vírgulas)".
 */
export function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function quote(value, sep) {
  const s = String(value);
  return s.includes('"') || s.includes(sep) || /[\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Exporta com cabeçalho "pergunta;resposta" (ou tab), linhas terminadas em CRLF. */
export function exportCards(cards, delimiter = ';') {
  const lines = [`pergunta${delimiter}resposta`];
  for (const c of cards) lines.push(`${quote(c.front, delimiter)}${delimiter}${quote(c.back, delimiter)}`);
  return `${lines.join('\r\n')}\r\n`;
}
