import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CsvError, MAX_FIELD, decodeText, detectDelimiter, exportCards, importCards, parseCsv,
} from '../src/csv.js';

test('ponto e vírgula com cabeçalho', () => {
  const r = importCards('pergunta;resposta\nCapital do Brasil;Brasília\n2 + 2;4\n');
  assert.equal(r.delimiter, ';');
  assert.deepEqual(r.cards, [{ front: 'Capital do Brasil', back: 'Brasília' }, { front: '2 + 2', back: '4' }]);
  assert.deepEqual(r.invalid, []);
});

test('detecção do separador: tab, ponto e vírgula, vírgula', () => {
  assert.equal(detectDelimiter('a\tb\n'), '\t');
  assert.equal(detectDelimiter('a;b,c\n'), ';');
  assert.equal(detectDelimiter('a,b\n'), ',');
  assert.equal(detectDelimiter('"x;y",z\n'), ',');
  assert.equal(detectDelimiter('\n\na;b'), ';');
  assert.deepEqual(importCards('cat\tgato\ndog\tcão').cards, [{ front: 'cat', back: 'gato' }, { front: 'dog', back: 'cão' }]);
  assert.deepEqual(importCards('front,back\nsun,sol').cards, [{ front: 'sun', back: 'sol' }]);
});

test('aspas: separador dentro, aspas duplicadas e quebra de linha', () => {
  const text = '"2 + 2; quanto dá?";4\n"Ele disse ""oi""";cumprimento\n"várias\nlinhas";ok\n';
  const r = importCards(text);
  assert.deepEqual(r.cards, [
    { front: '2 + 2; quanto dá?', back: '4' },
    { front: 'Ele disse "oi"', back: 'cumprimento' },
    { front: 'várias\nlinhas', back: 'ok' },
  ]);
});

test('BOM, CRLF, linhas vazias e linhas incompletas (com o número da linha)', () => {
  const text = `${String.fromCharCode(0xfeff)}pergunta;resposta\r\nA;1\r\n\r\nsó pergunta;\r\n"multi\r\nlinha";x\r\n;sem pergunta\r\n`;
  const r = importCards(text);
  assert.deepEqual(r.cards, [{ front: 'A', back: '1' }, { front: 'multi\nlinha', back: 'x' }]);
  assert.deepEqual(r.invalid, [4, 7]);
});

test('aspas não fechadas dão erro com a linha', () => {
  assert.throws(() => parseCsv('a;b\n"aberta;c\nd;e'), (err) => err instanceof CsvError && /linha 2/.test(err.message));
});

test('espaços em volta são ignorados, mas não dentro de aspas', () => {
  const { rows } = parseCsv('  a  ;  b  \n"  c  ";d');
  assert.deepEqual(rows.map((r) => r.fields), [['a', 'b'], ['  c  ', 'd']]);
});

test('exportação e ida e volta com textos difíceis', () => {
  const cards = [
    { front: 'simples', back: 'texto' },
    { front: 'com ; ponto e vírgula', back: 'e "aspas"' },
    { front: 'duas\nlinhas', back: 'tab\taqui' },
    { front: '  espaços  ', back: '**negrito**' },
  ];
  const csv = exportCards(cards);
  assert.ok(csv.startsWith('pergunta;resposta\r\n'));
  assert.ok(csv.includes('"com ; ponto e vírgula";"e ""aspas"""'));
  assert.deepEqual(importCards(csv).cards, cards.map((c) => ({ front: c.front.trim(), back: c.back.trim() })));
  const tsv = exportCards(cards, '\t');
  assert.ok(tsv.startsWith('pergunta\tresposta\r\n'));
  assert.deepEqual(importCards(tsv).cards, cards.map((c) => ({ front: c.front.trim(), back: c.back.trim() })));
});

test('texto depois das aspas de fechamento é mantido', () => {
  const r = importCards('"Dom Casmurro" foi escrito por quem?;Machado de Assis');
  assert.deepEqual(r.cards, [{ front: 'Dom Casmurro foi escrito por quem?', back: 'Machado de Assis' }]);
});

test('aspas soltas no meio do campo não confundem a detecção do separador', () => {
  const r = importCards('Tela de 5" polegadas,screen\nmouse,rato');
  assert.equal(r.delimiter, ',');
  assert.deepEqual(r.cards, [{ front: 'Tela de 5" polegadas', back: 'screen' }, { front: 'mouse', back: 'rato' }]);
});

test('colunas além da segunda vão para a resposta, com aviso', () => {
  const r = importCards('dog,cachorro, cão\ncat,gato');
  assert.deepEqual(r.cards[0], { front: 'dog', back: 'cachorro, cão' });
  assert.deepEqual(r.merged, [1]);
  const t = importCards('a\tb\tc');
  assert.deepEqual(t.cards, [{ front: 'a', back: 'b c' }]);
});

test('texto longo demais vira linha inválida em vez de quebrar a importação', () => {
  const r = importCards(`curta;ok\nlonga;${'x'.repeat(MAX_FIELD + 1)}\noutra;ok`);
  assert.deepEqual(r.cards.map((c) => c.front), ['curta', 'outra']);
  assert.deepEqual(r.invalid, [2]);
});

test('arquivo do Excel em Windows-1252 é decodificado', () => {
  // "Brasília;Coração" em Windows-1252
  const bytes = Uint8Array.from([0x42, 0x72, 0x61, 0x73, 0xed, 0x6c, 0x69, 0x61, 0x3b, 0x43, 0x6f, 0x72, 0x61, 0xe7, 0xe3, 0x6f]);
  assert.equal(decodeText(bytes), 'Brasília;Coração');
  assert.equal(decodeText(new TextEncoder().encode('ação;ônibus')), 'ação;ônibus');
});
