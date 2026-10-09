import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, plainText, renderMarkdown } from '../src/markdown.js';

test('negrito, itálico, código e quebras de linha', () => {
  assert.equal(renderMarkdown('**negrito**'), '<strong>negrito</strong>');
  assert.equal(renderMarkdown('*itálico* e _também_'), '<em>itálico</em> e <em>também</em>');
  assert.equal(renderMarkdown('use `git stash`'), 'use <code>git stash</code>');
  assert.equal(renderMarkdown('linha 1\nlinha 2'), 'linha 1<br>linha 2');
  assert.equal(renderMarkdown('***os dois***'), '<em><strong>os dois</strong></em>');
});

test('o que não é marcação fica como está', () => {
  assert.equal(renderMarkdown('snake_case_var'), 'snake_case_var');
  assert.equal(renderMarkdown('2*3*4'), '2*3*4');
  assert.equal(renderMarkdown('a * b * c'), 'a * b * c');
  assert.equal(renderMarkdown('**sem fechar'), '**sem fechar');
  assert.equal(renderMarkdown('`**dentro do código**`'), '<code>**dentro do código**</code>');
});

test('HTML do usuário é sempre escapado (sem XSS)', () => {
  assert.equal(renderMarkdown('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(renderMarkdown('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(renderMarkdown('**<b>x</b>**'), '<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
  assert.equal(renderMarkdown('`<svg onload=alert(1)>`'), '<code>&lt;svg onload=alert(1)&gt;</code>');
  assert.equal(renderMarkdown("it's & <ok>"), 'it&#39;s &amp; &lt;ok&gt;');
  // nenhuma tag sai da saída além das que o próprio renderizador cria
  const nasty = '<a href="javascript:alert(1)">x</a> **<iframe>** _<style>_ `</code><script>`';
  const out = renderMarkdown(nasty);
  const tags = [...out.matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]);
  assert.ok(tags.every((t) => ['strong', 'em', 'code', 'br'].includes(t)), out);
});

test('texto puro para as listas', () => {
  assert.equal(plainText('**Qual** é a `saída`?'), 'Qual é a saída?');
  assert.equal(plainText('a'.repeat(100), 10), `${'a'.repeat(9)}…`);
  assert.equal(escapeHtml('"<&>\''), '&quot;&lt;&amp;&gt;&#39;');
});

test('sem lookbehind nas expressões (compatível com Safari antigo)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/markdown.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('(?<=') && !src.includes('(?<!'));
  assert.equal(renderMarkdown('**a** b **c**'), '<strong>a</strong> b <strong>c</strong>');
  assert.equal(renderMarkdown('** a**'), '** a**');
});
