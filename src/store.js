// Dados do app (baralhos, cartões e histórico), fila de estudo do dia, sessão com reaprendizado,
// estatísticas e backup em JSON. Tudo puro: quem chama passa a data de "hoje".
import {
  START_EF, addDays, daysBetween, isDate, schedule,
} from './sm2.js';

export const APP_ID = 'cartoes-de-estudo';
export const VERSION = 1;
export const MAX_TEXT = 5000;

export class StoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreError';
  }
}

export function emptyState() {
  return { version: VERSION, settings: { newPerDay: 20 }, decks: [], cards: [], log: [] };
}

let counter = 0;
/** Identificador curto e único (aleatório do crypto quando disponível). */
export function newId(prefix) {
  counter = (counter + 1) % 1679616;
  let rand = '';
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    const b = new Uint32Array(2);
    globalThis.crypto.getRandomValues(b);
    rand = b[0].toString(36) + b[1].toString(36);
  } else {
    rand = Math.floor(Math.random() * 1e12).toString(36);
  }
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${rand}`.slice(0, 24);
}

// ---------------------------------------------------------------------------
// Baralhos e cartões

export function addDeck(state, name) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new StoreError('Dê um nome ao baralho.');
  if (clean.length > 80) throw new StoreError('Use até 80 caracteres no nome.');
  const deck = { id: newId('d'), name: clean };
  state.decks.push(deck);
  return deck;
}

export function renameDeck(state, deckId, name) {
  const deck = getDeck(state, deckId);
  const clean = String(name ?? '').trim();
  if (!clean) throw new StoreError('Dê um nome ao baralho.');
  deck.name = clean.slice(0, 80);
}

export function deleteDeck(state, deckId) {
  getDeck(state, deckId);
  state.decks = state.decks.filter((d) => d.id !== deckId);
  state.cards = state.cards.filter((c) => c.deckId !== deckId);
  state.log = state.log.filter((e) => e.deckId !== deckId);
}

export function getDeck(state, deckId) {
  const deck = state.decks.find((d) => d.id === deckId);
  if (!deck) throw new StoreError('Baralho não encontrado.');
  return deck;
}

function checkText(text, what) {
  const s = String(text ?? '').trim();
  if (!s) throw new StoreError(`Preencha a ${what} do cartão.`);
  if (s.length > MAX_TEXT) throw new StoreError(`A ${what} passou de ${MAX_TEXT} caracteres.`);
  return s;
}

export function addCard(state, deckId, front, back, today) {
  getDeck(state, deckId);
  const card = {
    id: newId('c'),
    deckId,
    front: checkText(front, 'frente'),
    back: checkText(back, 'resposta'),
    created: today,
    reps: 0,
    interval: 0,
    ef: START_EF,
    due: null,
    lapses: 0,
    last: null,
  };
  state.cards.push(card);
  return card;
}

export function editCard(state, cardId, front, back) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) throw new StoreError('Cartão não encontrado.');
  card.front = checkText(front, 'frente');
  card.back = checkText(back, 'resposta');
}

export function deleteCard(state, cardId) {
  state.cards = state.cards.filter((c) => c.id !== cardId);
  state.log = state.log.filter((e) => e.cardId !== cardId);
}

/** Importa cartões { front, back } num baralho, ignorando os que já existem (mesma frente e verso). */
export function importIntoDeck(state, deckId, cards, today) {
  getDeck(state, deckId);
  // valida tudo antes de mexer no estado: ou entra a lista inteira, ou nada
  cards.forEach((c, i) => {
    try {
      checkText(c.front, 'frente');
      checkText(c.back, 'resposta');
    } catch (err) {
      throw new StoreError(`Cartão ${i + 1} da lista: ${err.message}`);
    }
  });
  const key = (f, b) => JSON.stringify([f.trim(), b.trim()]);
  const existing = new Set(state.cards.filter((c) => c.deckId === deckId).map((c) => key(c.front, c.back)));
  let added = 0;
  let duplicates = 0;
  for (const c of cards) {
    const k = key(c.front, c.back);
    if (existing.has(k)) {
      duplicates++;
      continue;
    }
    addCard(state, deckId, c.front, c.back, today);
    existing.add(k);
    added++;
  }
  return { added, duplicates };
}

// ---------------------------------------------------------------------------
// Fila do dia

export const isNew = (card) => card.due === null;

/** Cartões novos que já entraram hoje neste baralho (para o limite diário). */
export function newIntroducedToday(state, deckId, today) {
  return state.log.filter((e) => e.deckId === deckId && e.date === today && e.wasNew && !e.repeat).length;
}

/**
 * Fila do dia: revisões vencidas (da mais atrasada para a menos) e, depois, cartões novos
 * até o limite diário (na ordem em que foram criados).
 */
export function dueQueue(state, deckId, today) {
  const cards = state.cards.filter((c) => c.deckId === deckId);
  const reviews = cards
    .filter((c) => !isNew(c) && c.due <= today)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const allowed = Math.max(0, state.settings.newPerDay - newIntroducedToday(state, deckId, today));
  const fresh = cards.filter(isNew).slice(0, allowed);
  return { reviews, fresh, newAvailable: cards.filter(isNew).length };
}

export function deckCounts(state, deckId, today) {
  const cards = state.cards.filter((c) => c.deckId === deckId);
  const q = dueQueue(state, deckId, today);
  return {
    total: cards.length,
    newTotal: q.newAvailable,
    newToday: q.fresh.length,
    due: q.reviews.length,
    learned: cards.filter((c) => !isNew(c)).length,
  };
}

// ---------------------------------------------------------------------------
// Sessão de estudo

/**
 * Sessão do dia para um baralho. A primeira resposta de cada cartão aplica o SM-2; quem
 * recebe nota abaixo de 4 (Errei ou Difícil) volta para o fim da fila e repete até sair com
 * Bom ou Fácil, sem mexer de novo no agendamento (passo 7 da descrição original do SM-2).
 */
export function startSession(state, deckId, today) {
  const { reviews, fresh } = dueQueue(state, deckId, today);
  // Cartões já avaliados hoje (por exemplo, antes de recarregar a página): a primeira nota do dia
  // vale para o agendamento, e quem terminou abaixo de 4 continua na fila de reaprendizado.
  const graded = new Map();
  const lastQ = new Map();
  for (const e of state.log) {
    if (e.deckId !== deckId || e.date !== today) continue;
    if (!e.repeat && !graded.has(e.cardId)) graded.set(e.cardId, e.q);
    lastQ.set(e.cardId, e.q);
  }
  const exists = new Set(state.cards.filter((c) => c.deckId === deckId).map((c) => c.id));
  const relearn = [...lastQ].filter(([id, q]) => q < 4 && exists.has(id)).map(([id]) => id);
  const queue = [...reviews, ...fresh].map((c) => c.id).filter((id) => !graded.has(id));
  return {
    deckId,
    today,
    queue: [...queue, ...relearn],
    graded,
    answered: 0,
    firstAnswers: 0,
    correctFirst: 0,
    total: queue.length + relearn.length,
  };
}

export function currentCard(state, session) {
  if (session.queue.length === 0) return null;
  return state.cards.find((c) => c.id === session.queue[0]) || null;
}

/** Como ficaria o cartão para cada botão (para mostrar "Bom: 6 dias" antes de responder). */
export function preview(card, session) {
  if (session.graded.has(card.id)) return null;
  return [1, 3, 4, 5].map((q) => ({ q, interval: schedule(card, q).interval }));
}

/**
 * Registra a resposta. `today` é a data no momento da resposta (uma sessão pode passar da
 * meia-noite); por padrão, a do começo da sessão.
 */
export function answer(state, session, q, today = session.today) {
  const card = currentCard(state, session);
  if (!card) throw new StoreError('Não há cartão para responder.');
  session.today = today;
  session.queue.shift();
  session.answered++;
  const first = !session.graded.has(card.id);
  if (first) {
    const wasNew = isNew(card);
    const next = schedule(card, q);
    if (q < 3 && !wasNew) card.lapses++;
    card.reps = next.reps;
    card.interval = next.interval;
    card.ef = next.ef;
    card.due = addDays(today, next.interval);
    card.last = today;
    session.graded.set(card.id, q);
    session.firstAnswers++;
    if (q >= 3) session.correctFirst++;
    state.log.push({ cardId: card.id, deckId: card.deckId, date: today, q, wasNew, interval: next.interval, ef: next.ef });
  } else {
    state.log.push({ cardId: card.id, deckId: card.deckId, date: today, q, wasNew: false, repeat: true });
  }
  if (q < 4) session.queue.push(card.id);
  return { card, first, requeued: q < 4 };
}

// ---------------------------------------------------------------------------
// Estatísticas

/**
 * Retenção: entre as revisões (cartões que já não eram novos) dos últimos `days` dias,
 * a fração respondida com nota 3 ou mais. Repetições do mesmo dia não contam.
 */
export function retention(state, today, days = 30, deckId = null) {
  const since = addDays(today, -(days - 1));
  const reviews = state.log.filter((e) => !e.repeat && !e.wasNew && e.date >= since && e.date <= today && (!deckId || e.deckId === deckId));
  if (reviews.length === 0) return { rate: null, count: 0 };
  return { rate: reviews.filter((e) => e.q >= 3).length / reviews.length, count: reviews.length };
}

/** Dias seguidos com estudo, terminando hoje (ou ontem, se hoje ainda não estudou). */
export function streak(state, today) {
  const days = new Set(state.log.map((e) => e.date));
  let day = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

/** Respostas por dia nos últimos `days` dias (inclui repetições). */
export function reviewsPerDay(state, today, days = 14) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    out.push({ date: d, count: state.log.filter((e) => e.date === d).length });
  }
  return out;
}

/** Quantos cartões vencem em cada um dos próximos dias (os atrasados entram em hoje). */
export function forecast(state, today, days = 14, deckId = null) {
  const out = Array.from({ length: days }, (_, i) => ({ date: addDays(today, i), count: 0 }));
  for (const c of state.cards) {
    if (isNew(c) || (deckId && c.deckId !== deckId)) continue;
    const k = Math.max(0, daysBetween(today, c.due));
    if (k < days) out[k].count++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Backup

/** JSON do backup. `pretty` deixa legível (para baixar); sem ele, compacto (para o localStorage). */
export function exportBackup(state, exportedAt = new Date().toISOString(), { pretty = true } = {}) {
  const data = { app: APP_ID, version: VERSION, exportedAt, settings: state.settings, decks: state.decks, cards: state.cards, log: state.log };
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

/**
 * Repetições do mesmo dia só servem para o gráfico dos últimos 14 dias e para a fila de hoje;
 * as mais antigas que `keepDays` saem do histórico para ele não crescer sem limite.
 */
export function pruneLog(state, today, keepDays = 30) {
  const since = addDays(today, -keepDays);
  const before = state.log.length;
  state.log = state.log.filter((e) => !e.repeat || e.date >= since);
  return before - state.log.length;
}

const isInt = (x, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isInteger(x) && x >= min && x <= max;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_INTERVAL = 36500;

/** Lê e valida um backup. Lança StoreError com o motivo, em português. */
export function importBackup(json) {
  let data;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw new StoreError('O arquivo não é um JSON válido.');
  }
  if (!data || typeof data !== 'object' || data.app !== APP_ID) throw new StoreError('Este arquivo não é um backup dos Cartões de Estudo.');
  if (data.version !== VERSION) throw new StoreError(`Versão de backup não suportada: ${data.version}.`);
  for (const k of ['decks', 'cards', 'log']) if (!Array.isArray(data[k])) throw new StoreError(`Backup incompleto: falta a lista "${k}".`);
  const state = emptyState();
  const perDay = data.settings && data.settings.newPerDay;
  state.settings.newPerDay = isInt(perDay) && perDay <= 999 ? perDay : 20;
  const deckIds = new Set();
  for (const d of data.decks) {
    if (!d || typeof d.id !== 'string' || !ID_RE.test(d.id) || typeof d.name !== 'string' || !d.name.trim() || deckIds.has(d.id)) throw new StoreError('Backup com baralho inválido.');
    deckIds.add(d.id);
    state.decks.push({ id: d.id, name: d.name.slice(0, 80) });
  }
  const cardIds = new Set();
  for (const c of data.cards) {
    const ok = c && typeof c.id === 'string' && ID_RE.test(c.id) && !cardIds.has(c.id) && deckIds.has(c.deckId)
      && typeof c.front === 'string' && typeof c.back === 'string' && c.front.trim() !== '' && c.back.trim() !== ''
      && isInt(c.reps, 0, 100000) && isInt(c.interval, 0, MAX_INTERVAL) && isInt(c.lapses, 0, 100000)
      && (c.reps === 0 || c.interval >= 1)
      && typeof c.ef === 'number' && c.ef >= 1.3 && c.ef <= 10
      && (c.due === null || isDate(c.due)) && (c.last === null || isDate(c.last))
      && (c.created === undefined || c.created === null || isDate(c.created));
    if (!ok) throw new StoreError('Backup com cartão inválido.');
    cardIds.add(c.id);
    state.cards.push({
      id: c.id,
      deckId: c.deckId,
      front: c.front.slice(0, MAX_TEXT),
      back: c.back.slice(0, MAX_TEXT),
      created: c.created ?? null,
      reps: c.reps,
      interval: c.interval,
      ef: c.ef,
      due: c.due,
      lapses: c.lapses,
      last: c.last,
    });
  }
  for (const e of data.log) {
    const ok = e && cardIds.has(e.cardId) && deckIds.has(e.deckId) && isDate(e.date) && isInt(e.q) && e.q <= 5;
    if (!ok) throw new StoreError('Backup com histórico inválido.');
    const entry = { cardId: e.cardId, deckId: e.deckId, date: e.date, q: e.q, wasNew: Boolean(e.wasNew) };
    if (e.repeat) entry.repeat = true;
    else {
      if (isInt(e.interval, 0, MAX_INTERVAL)) entry.interval = e.interval;
      if (typeof e.ef === 'number') entry.ef = e.ef;
    }
    state.log.push(entry);
  }
  return state;
}

/** Baralho de exemplo para quem chega pela primeira vez. */
export function sampleDeck(state, today) {
  const deck = addDeck(state, 'Exemplo: lógica e programação');
  const cards = [
    ['Qual é a negação de **p ∧ q**?', '**¬p ∨ ¬q** (lei de De Morgan)'],
    ['O que `git stash` faz?', 'Guarda as mudanças ainda não commitadas numa pilha e deixa a pasta limpa.'],
    ['Complexidade da busca binária', '*O(log n)*: a cada passo, metade dos elementos é descartada.'],
    ['Quando **p → q** é falso?', 'Só quando *p* é verdadeiro e *q* é falso.'],
    ['Para que serve o `const` em JavaScript?', 'Declara uma variável que não pode ser **reatribuída** (o objeto ainda pode mudar por dentro).'],
    ['O que é um número primo?', 'Um inteiro maior que 1 cujos únicos divisores positivos são 1 e ele mesmo.'],
  ];
  for (const [f, b] of cards) addCard(state, deck.id, f, b, today);
  return deck;
}
