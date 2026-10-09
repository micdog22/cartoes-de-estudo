import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../src/sm2.js';
import * as St from '../src/store.js';

const DAY0 = '2026-10-09';

function deckWith(n, newPerDay = 20) {
  const state = St.emptyState();
  state.settings.newPerDay = newPerDay;
  const deck = St.addDeck(state, 'Teste');
  for (let i = 0; i < n; i++) St.addCard(state, deck.id, `pergunta ${i}`, `resposta ${i}`, DAY0);
  return { state, deck };
}

function study(state, deckId, today, grades) {
  const s = St.startSession(state, deckId, today);
  let i = 0;
  while (St.currentCard(state, s)) {
    const g = typeof grades === 'function' ? grades(St.currentCard(state, s), s) : grades[i] ?? 4;
    St.answer(state, s, g);
    i++;
    if (i > 500) throw new Error('sessão não terminou');
  }
  return s;
}

test('validação de baralhos e cartões', () => {
  const state = St.emptyState();
  assert.throws(() => St.addDeck(state, '   '), /nome/);
  const deck = St.addDeck(state, '  Inglês  ');
  assert.equal(deck.name, 'Inglês');
  assert.throws(() => St.addCard(state, deck.id, '', 'x', DAY0), /frente/);
  assert.throws(() => St.addCard(state, deck.id, 'x', ' ', DAY0), /resposta/);
  assert.throws(() => St.addCard(state, 'nao-existe', 'x', 'y', DAY0), /não encontrado/);
  const card = St.addCard(state, deck.id, 'dog', 'cachorro', DAY0);
  assert.deepEqual([card.reps, card.interval, card.ef, card.due, card.lapses], [0, 0, 2.5, null, 0]);
  St.editCard(state, card.id, 'dog ', ' cão');
  assert.deepEqual([card.front, card.back], ['dog', 'cão']);
  assert.notEqual(St.newId('c'), St.newId('c'));
});

test('importação ignora repetidos', () => {
  const { state, deck } = deckWith(1);
  const r = St.importIntoDeck(state, deck.id, [
    { front: 'pergunta 0', back: 'resposta 0' },
    { front: 'nova', back: 'carta' },
    { front: 'nova', back: 'carta' },
  ], DAY0);
  assert.deepEqual(r, { added: 1, duplicates: 2 });
  assert.equal(state.cards.length, 2);
});

test('limite diário de cartões novos', () => {
  const { state, deck } = deckWith(5, 2);
  let q = St.dueQueue(state, deck.id, DAY0);
  assert.equal(q.fresh.length, 2);
  assert.equal(q.newAvailable, 5);
  study(state, deck.id, DAY0, [4, 4]);
  q = St.dueQueue(state, deck.id, DAY0);
  assert.equal(q.fresh.length, 0, 'limite de hoje já usado');
  assert.equal(St.newIntroducedToday(state, deck.id, DAY0), 2);
  // no dia seguinte: 2 revisões vencidas e mais 2 novos
  const day1 = addDays(DAY0, 1);
  q = St.dueQueue(state, deck.id, day1);
  assert.equal(q.reviews.length, 2);
  assert.equal(q.fresh.length, 2);
  assert.deepEqual(St.deckCounts(state, deck.id, day1), { total: 5, newTotal: 3, newToday: 2, due: 2, learned: 2 });
});

test('agenda ao longo dos dias: 1, 6 e 15 dias', () => {
  const { state, deck } = deckWith(1);
  const card = state.cards[0];
  study(state, deck.id, DAY0, [4]);
  assert.equal(card.due, addDays(DAY0, 1));
  assert.equal(St.dueQueue(state, deck.id, DAY0).reviews.length, 0, 'não vence de novo hoje');
  const day1 = addDays(DAY0, 1);
  study(state, deck.id, day1, [4]);
  assert.equal(card.due, addDays(day1, 6));
  const day7 = addDays(day1, 6);
  assert.equal(St.dueQueue(state, deck.id, addDays(day7, -1)).reviews.length, 0);
  study(state, deck.id, day7, [4]);
  assert.equal(card.interval, 15);
  assert.equal(card.due, addDays(day7, 15));
});

test('revisões atrasadas vêm primeiro, da mais antiga para a mais nova', () => {
  const { state, deck } = deckWith(3);
  state.cards[0].due = '2026-10-05';
  state.cards[1].due = '2026-10-01';
  state.cards[2].due = '2026-10-20';
  for (const c of state.cards) c.reps = 2;
  const q = St.dueQueue(state, deck.id, DAY0);
  assert.deepEqual(q.reviews.map((c) => c.due), ['2026-10-01', '2026-10-05']);
});

test('sessão: errar ou achar difícil repete o cartão até sair com Bom ou Fácil', () => {
  const { state, deck } = deckWith(2);
  const [a, b] = state.cards;
  // A: Errei, B: Bom, A (repetição): Difícil, A (repetição): Bom
  const s = study(state, deck.id, DAY0, [1, 4, 3, 4]);
  assert.equal(s.answered, 4);
  assert.equal(s.firstAnswers, 2);
  assert.equal(s.correctFirst, 1);
  // o agendamento de A vem só da primeira resposta (Errei)
  assert.deepEqual([a.reps, a.interval, a.ef], [0, 1, 1.96]);
  assert.deepEqual([b.reps, b.interval, b.ef], [1, 1, 2.5]);
  assert.equal(state.log.length, 4);
  assert.equal(state.log.filter((e) => e.repeat).length, 2);
  assert.equal(a.lapses, 0, 'cartão novo que erra não conta lapso');
});

test('lapso: revisão esquecida volta para 1 dia', () => {
  const { state, deck } = deckWith(1);
  const c = state.cards[0];
  Object.assign(c, { reps: 3, interval: 15, ef: 2.5, due: DAY0 });
  study(state, deck.id, DAY0, [1, 4]);
  assert.deepEqual([c.reps, c.interval, c.lapses, c.due], [0, 1, 1, addDays(DAY0, 1)]);
});

test('prévia dos intervalos de cada botão', () => {
  const { state, deck } = deckWith(1);
  const c = state.cards[0];
  Object.assign(c, { reps: 2, interval: 6, ef: 2.5, due: DAY0 });
  const s = St.startSession(state, deck.id, DAY0);
  assert.deepEqual(St.preview(c, s), [{ q: 1, interval: 1 }, { q: 3, interval: 15 }, { q: 4, interval: 15 }, { q: 5, interval: 15 }]);
  St.answer(state, s, 1);
  assert.equal(St.preview(c, s), null, 'repetição do dia não tem agendamento');
});

test('retenção, sequência de dias, histórico e previsão', () => {
  const { state, deck } = deckWith(4);
  const [a, b, c, d] = state.cards;
  const log = (card, date, q, extra = {}) => state.log.push({ cardId: card.id, deckId: deck.id, date, q, wasNew: false, ...extra });
  log(a, '2026-10-09', 4);
  log(b, '2026-10-09', 1);
  log(b, '2026-10-09', 4, { repeat: true });
  log(c, '2026-10-08', 5);
  log(d, '2026-10-07', 3, { wasNew: true });
  log(a, '2026-09-01', 1); // fora da janela de 30 dias
  const r = St.retention(state, DAY0, 30);
  assert.deepEqual(r, { rate: 2 / 3, count: 3 });
  assert.deepEqual(St.retention(St.emptyState(), DAY0), { rate: null, count: 0 });
  assert.equal(St.streak(state, DAY0), 3);
  assert.equal(St.streak(state, '2026-10-10'), 3, 'hoje sem estudo: conta até ontem');
  assert.equal(St.streak(state, '2026-10-11'), 0);
  const hist = St.reviewsPerDay(state, DAY0, 3);
  assert.deepEqual(hist, [{ date: '2026-10-07', count: 1 }, { date: '2026-10-08', count: 1 }, { date: '2026-10-09', count: 3 }]);
  a.due = '2026-10-05'; // atrasado conta hoje
  b.due = '2026-10-09';
  c.due = '2026-10-11';
  d.due = '2026-12-01';
  const fc = St.forecast(state, DAY0, 3);
  assert.deepEqual(fc.map((x) => x.count), [2, 0, 1]);
});

test('excluir baralho e cartão limpa o histórico', () => {
  const { state, deck } = deckWith(2);
  study(state, deck.id, DAY0, [4, 4]);
  St.deleteCard(state, state.cards[0].id);
  assert.equal(state.cards.length, 1);
  assert.equal(state.log.length, 1);
  St.deleteDeck(state, deck.id);
  assert.deepEqual([state.decks.length, state.cards.length, state.log.length], [0, 0, 0]);
});

test('backup: ida e volta preserva tudo', () => {
  const { state, deck } = deckWith(3);
  St.addDeck(state, 'Outro');
  study(state, deck.id, DAY0, [1, 4, 5, 4]);
  state.settings.newPerDay = 7;
  const json = St.exportBackup(state, '2026-10-09T12:00:00.000Z');
  const back = St.importBackup(json);
  assert.deepEqual(back, state);
  assert.equal(JSON.parse(json).exportedAt, '2026-10-09T12:00:00.000Z');
  assert.equal(St.exportBackup(back, '2026-10-09T12:00:00.000Z'), json);
});

test('backup inválido é recusado com o motivo', () => {
  const { state } = deckWith(1);
  const good = JSON.parse(St.exportBackup(state));
  const bad = (mutate, re) => {
    const copy = JSON.parse(JSON.stringify(good));
    mutate(copy);
    assert.throws(() => St.importBackup(JSON.stringify(copy)), re);
  };
  assert.throws(() => St.importBackup('{oops'), /JSON válido/);
  bad((x) => { x.app = 'outro'; }, /não é um backup/);
  bad((x) => { x.version = 99; }, /Versão/);
  bad((x) => { delete x.cards; }, /falta a lista "cards"/);
  bad((x) => { x.cards[0].ef = 0.5; }, /cartão inválido/);
  bad((x) => { x.cards[0].deckId = 'fantasma'; }, /cartão inválido/);
  bad((x) => { x.cards[0].due = '2026-02-30'; }, /cartão inválido/);
  bad((x) => { x.decks.push({ ...x.decks[0] }); }, /baralho inválido/);
  bad((x) => { x.log.push({ cardId: 'nada', deckId: x.decks[0].id, date: '2026-10-09', q: 4 }); }, /histórico inválido/);
  // campos extras e texto gigante não passam para o estado
  const copy = JSON.parse(JSON.stringify(good));
  copy.cards[0].front = 'x'.repeat(St.MAX_TEXT + 50);
  copy.cards[0].hack = '<script>';
  const st = St.importBackup(JSON.stringify(copy));
  assert.equal(st.cards[0].front.length, St.MAX_TEXT);
  assert.ok(!('hack' in st.cards[0]));
});

test('baralho de exemplo', () => {
  const state = St.emptyState();
  const deck = St.sampleDeck(state, DAY0);
  assert.equal(state.cards.filter((c) => c.deckId === deck.id).length, 6);
});

test('reabrir a sessão no mesmo dia traz de volta quem errou, sem reagendar', () => {
  const { state, deck } = deckWith(2);
  const [a] = state.cards;
  const s1 = St.startSession(state, deck.id, DAY0);
  St.answer(state, s1, 1); // A: Errei (vai para o fim da fila)
  St.answer(state, s1, 4); // B: Bom
  // a pessoa sai (Esc) ou recarrega a página antes de repetir A
  const s2 = St.startSession(state, deck.id, DAY0);
  assert.deepEqual(s2.queue, [a.id]);
  assert.equal(St.preview(a, s2), null, 'A já foi avaliado hoje');
  const before = { ...a };
  St.answer(state, s2, 4);
  assert.deepEqual([a.reps, a.interval, a.ef, a.due], [before.reps, before.interval, before.ef, before.due]);
  assert.equal(St.startSession(state, deck.id, DAY0).queue.length, 0, 'saiu com Bom: acabou por hoje');
});

test('sessão que passa da meia-noite agenda pela data da resposta', () => {
  const { state, deck } = deckWith(1);
  const s = St.startSession(state, deck.id, DAY0);
  const next = addDays(DAY0, 1);
  St.answer(state, s, 4, next);
  assert.equal(state.cards[0].due, addDays(next, 1));
  assert.equal(state.log[0].date, next);
});

test('ids "estranhos" (como constructor) funcionam na sessão', () => {
  const state = St.emptyState();
  state.decks.push({ id: 'constructor', name: 'X' });
  state.cards.push({ id: 'constructor', deckId: 'constructor', front: 'f', back: 'b', created: DAY0, reps: 0, interval: 0, ef: 2.5, due: null, lapses: 0, last: null });
  const s = St.startSession(state, 'constructor', DAY0);
  St.answer(state, s, 4);
  assert.equal(state.cards[0].due, addDays(DAY0, 1));
});

test('importação é atômica: um cartão inválido não deixa metade importada', () => {
  const { state, deck } = deckWith(0);
  assert.throws(() => St.importIntoDeck(state, deck.id, [{ front: 'ok', back: 'ok' }, { front: 'x', back: 'y'.repeat(St.MAX_TEXT + 1) }], DAY0), /Cartão 2 da lista/);
  assert.equal(state.cards.length, 0);
});

test('backup: ids, intervalos e estados impossíveis são recusados', () => {
  const { state } = deckWith(1);
  const good = JSON.parse(St.exportBackup(state));
  const bad = (mutate) => {
    const copy = JSON.parse(JSON.stringify(good));
    mutate(copy);
    assert.throws(() => St.importBackup(JSON.stringify(copy)), St.StoreError);
  };
  bad((x) => { x.cards[0].id = 'id com espaço'; });
  bad((x) => { x.decks[0].id = '<script>'; x.cards[0].deckId = '<script>'; });
  bad((x) => { Object.assign(x.cards[0], { reps: 3, interval: 3000000, due: '2026-10-10' }); });
  bad((x) => { Object.assign(x.cards[0], { reps: 2, interval: 0, due: '2026-10-10' }); });
  bad((x) => { x.cards[0].front = '   '; });
});

test('armazenamento compacto e limpeza das repetições antigas', () => {
  const { state, deck } = deckWith(1);
  study(state, deck.id, DAY0, [1, 4]);
  assert.equal(state.log.filter((e) => e.repeat).length, 1);
  const compact = St.exportBackup(state, 'x', { pretty: false });
  assert.ok(!compact.includes('\n'));
  assert.deepEqual(St.importBackup(compact), state);
  assert.equal(St.pruneLog(state, addDays(DAY0, 10)), 0, 'repetição recente fica');
  assert.equal(St.pruneLog(state, addDays(DAY0, 40)), 1, 'repetição antiga sai');
  assert.equal(state.log.length, 1);
});

test('previsão filtrada por baralho', () => {
  const { state, deck } = deckWith(1);
  const other = St.addDeck(state, 'Outro');
  St.addCard(state, other.id, 'x', 'y', DAY0);
  for (const c of state.cards) { c.reps = 1; c.interval = 1; c.due = addDays(DAY0, 1); }
  assert.equal(St.forecast(state, DAY0, 3)[1].count, 2);
  assert.equal(St.forecast(state, DAY0, 3, deck.id)[1].count, 1);
});
