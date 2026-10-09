import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUTTONS, MIN_EF, START_EF, addDays, daysBetween, intervalText, isDate, nextEF, schedule, todayString,
} from '../src/sm2.js';

test('ajuste do fator de facilidade para cada nota', () => {
  // EF' = EF + (0,1 - (5 - q)(0,08 + (5 - q)0,02))
  const deltas = [0, 1, 2, 3, 4, 5].map((q) => Math.round((nextEF(2.5, q) - 2.5) * 100) / 100);
  assert.deepEqual(deltas, [-0.8, -0.54, -0.32, -0.14, 0, 0.1]);
  assert.throws(() => nextEF(2.5, 6), RangeError);
  assert.throws(() => nextEF(2.5, 2.5), RangeError);
});

test('EF nunca fica abaixo de 1,3', () => {
  let ef = START_EF;
  const seq = [];
  for (let i = 0; i < 5; i++) {
    ef = nextEF(ef, 1);
    seq.push(ef);
  }
  assert.deepEqual(seq, [1.96, 1.42, 1.3, 1.3, 1.3]);
  assert.equal(MIN_EF, 1.3);
});

test('sequência conhecida: Bom, Bom, Bom, Fácil, Difícil, Errei, Bom, Bom, Bom', () => {
  // Calculado à mão: intervalos 1 e 6, depois intervalo anterior × EF (EF de antes da resposta).
  const qs = [4, 4, 4, 5, 3, 1, 4, 4, 4];
  const expected = [
    { reps: 1, interval: 1, ef: 2.5 },
    { reps: 2, interval: 6, ef: 2.5 },
    { reps: 3, interval: 15, ef: 2.5 }, // 6 × 2,5
    { reps: 4, interval: 38, ef: 2.6 }, // 15 × 2,5 = 37,5 -> 38
    { reps: 5, interval: 99, ef: 2.46 }, // 38 × 2,6 = 98,8 -> 99
    { reps: 0, interval: 1, ef: 1.92 }, // errou: recomeça
    { reps: 1, interval: 1, ef: 1.92 },
    { reps: 2, interval: 6, ef: 1.92 },
    { reps: 3, interval: 12, ef: 1.92 }, // 6 × 1,92 = 11,52 -> 12
  ];
  let card = { reps: 0, interval: 0, ef: START_EF };
  qs.forEach((q, i) => {
    card = schedule(card, q);
    assert.deepEqual(card, expected[i], `resposta ${i + 1}`);
  });
});

test('só Fácil: 1, 6, 16, 45, 131 dias', () => {
  let card = { reps: 0, interval: 0, ef: START_EF };
  const intervals = [];
  for (let i = 0; i < 5; i++) {
    card = schedule(card, 5);
    intervals.push(card.interval);
  }
  assert.deepEqual(intervals, [1, 6, 16, 45, 131]);
  assert.equal(card.ef, 3);
});

test('arredondamento exato de x,5 (EF em centésimos)', () => {
  // 25 × 2,26 = 56,5; em ponto flutuante seria 56,4999... e arredondaria para 56
  assert.equal(schedule({ reps: 3, interval: 25, ef: 2.26 }, 4).interval, 57);
  assert.equal(schedule({ reps: 3, interval: 75, ef: 1.38 }, 4).interval, 104);
});

test('botões e notas', () => {
  assert.deepEqual(BUTTONS.map((b) => [b.key, b.label, b.q]), [['1', 'Errei', 1], ['2', 'Difícil', 3], ['3', 'Bom', 4], ['4', 'Fácil', 5]]);
  // Difícil (3) conta como acerto para o SM-2; Errei (1) recomeça
  assert.equal(schedule({ reps: 2, interval: 6, ef: 2.5 }, 3).reps, 3);
  assert.equal(schedule({ reps: 2, interval: 6, ef: 2.5 }, 1).reps, 0);
});

test('datas de calendário', () => {
  assert.equal(addDays('2026-10-09', 1), '2026-10-10');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-10-09', 365), '2027-10-09');
  assert.equal(daysBetween('2026-10-09', '2026-10-20'), 11);
  assert.equal(daysBetween('2026-10-20', '2026-10-09'), -11);
  // a virada de horário de verão não afeta (contas em UTC)
  assert.equal(addDays('2018-11-03', 1), '2018-11-04');
  assert.equal(todayString(new Date(2026, 9, 9, 23, 59)), '2026-10-09');
  assert.equal(todayString(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
  assert.ok(isDate('2024-02-29'));
  assert.ok(!isDate('2026-02-29'));
  assert.ok(!isDate('2026-13-01'));
  assert.ok(!isDate('ontem'));
  assert.throws(() => addDays('9/10/2026', 1), RangeError);
});

test('texto dos intervalos', () => {
  assert.equal(intervalText(0), 'hoje');
  assert.equal(intervalText(1), '1 dia');
  assert.equal(intervalText(6), '6 dias');
  assert.equal(intervalText(45), '2 meses');
  assert.equal(intervalText(30), '1 mês');
  assert.equal(intervalText(365), '1 ano');
  assert.equal(intervalText(550), '1,5 anos');
});

test('acerto nunca agenda para 0 dias', () => {
  assert.equal(schedule({ reps: 2, interval: 0, ef: 2.5 }, 4).interval, 1);
});
