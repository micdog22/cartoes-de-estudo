// Interface: rotas por hash, estudo com atalhos de teclado, editor de baralho, estatísticas e backup.
import { BUTTONS, daysBetween, intervalText, todayString } from './sm2.js';
import { decodeText, exportCards, importCards } from './csv.js';
import { escapeHtml, plainText, renderMarkdown } from './markdown.js';
import * as St from './store.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'cartoes-de-estudo:v1';

let state = St.emptyState();
let today = todayString();
let session = null;
let flipped = false;
let currentDeck = null;

// ---------------------------------------------------------------------------
// Armazenamento e avisos

function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return St.emptyState();
    return St.importBackup(raw);
  } catch {
    // guarda uma cópia do texto antes de qualquer gravação, para não perder dados por um bug
    try {
      if (raw) localStorage.setItem(`${STORAGE_KEY}:copia-ilegivel`, raw);
    } catch {
      // sem espaço para a cópia: segue assim mesmo
    }
    notice('Os dados salvos neste navegador não puderam ser lidos. Uma cópia foi guardada e o app começou vazio.', true);
    return St.emptyState();
  }
}

function persist() {
  try {
    St.pruneLog(state, today);
    localStorage.setItem(STORAGE_KEY, St.exportBackup(state, new Date().toISOString(), { pretty: false }));
    return true;
  } catch {
    notice('Não foi possível salvar neste navegador (modo privado ou armazenamento cheio). Baixe um backup para não perder o progresso.', true);
    return false;
  }
}

let noticeTimer = 0;
function notice(text, bad = false) {
  const el = $('notice');
  el.textContent = text;
  el.classList.toggle('bad', bad);
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.hidden = true; }, bad ? 9000 : 4000);
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'baralho';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pct = (x) => `${Math.round(x * 100)}%`;
const shortDate = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

// ---------------------------------------------------------------------------
// Rotas

const VIEWS = ['home', 'study', 'deck', 'stats', 'settings'];

function show(view) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  const navKey = view === 'study' || view === 'deck' ? 'home' : view;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function route() {
  today = todayString();
  let parts;
  try {
    parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    parts = []; // hash malformado: vai para o início
  }
  const deck = parts[1] ? state.decks.find((d) => d.id === parts[1]) : null;
  if (parts[0] === 'estudar' && deck) showStudy(deck);
  else if (parts[0] === 'baralho' && deck) showDeck(deck);
  else if (parts[0] === 'estatisticas') showStats();
  else if (parts[0] === 'ajustes') showSettings();
  else showHome();
}

// ---------------------------------------------------------------------------
// Início

function tilesHTML(items) {
  return items.map(([value, label]) => `<div class="tile"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join('');
}

function showHome() {
  show('home');
  session = null;
  const streak = St.streak(state, today);
  const ret = St.retention(state, today, 30);
  const answeredToday = state.log.filter((e) => e.date === today).length;
  let pending = 0;
  for (const d of state.decks) {
    const c = St.deckCounts(state, d.id, today);
    pending += c.due + c.newToday;
  }
  $('home-tiles').innerHTML = tilesHTML([
    [String(pending), 'cartões para hoje'],
    [String(answeredToday), 'respostas hoje'],
    [plural(streak, 'dia', 'dias'), 'de sequência'],
    [ret.rate === null ? 'sem dados' : pct(ret.rate), 'de acerto nas revisões (30 dias)'],
  ]);
  if (state.decks.length === 0) {
    $('deck-list').innerHTML = `<div class="empty"><p>Você ainda não tem baralhos.</p><button type="button" class="btn primary" id="sample">Criar um baralho de exemplo</button></div>`;
    $('sample').addEventListener('click', () => {
      St.sampleDeck(state, today);
      persist();
      showHome();
    });
    return;
  }
  const items = state.decks.map((d) => {
    const c = St.deckCounts(state, d.id, today);
    const nothing = c.due + c.newToday === 0;
    return `<li>
      <div><div class="deck-name">${escapeHtml(d.name)}</div>
        <div class="counts"><span><span class="n-new">${c.newToday}</span> novos hoje</span><span><span class="n-due">${c.due}</span> para revisar</span><span>${plural(c.total, 'cartão', 'cartões')}</span></div></div>
      <div class="row-actions">
        <a class="btn ${nothing ? '' : 'primary'}" href="#/estudar/${encodeURIComponent(d.id)}">${nothing ? 'Nada para hoje' : 'Estudar'}</a>
        <a class="btn" href="#/baralho/${encodeURIComponent(d.id)}">Editar</a>
      </div></li>`;
  });
  $('deck-list').innerHTML = `<ul class="decks">${items.join('')}</ul>`;
}

// ---------------------------------------------------------------------------
// Estudo

function showStudy(deck) {
  show('study');
  currentDeck = deck;
  session = St.startSession(state, deck.id, today);
  flipped = false;
  $('t-study').textContent = deck.name;
  renderStudy();
}

function renderStudy() {
  const body = $('study-body');
  const card = St.currentCard(state, session);
  $('study-progress').textContent = card ? `${plural(session.queue.length, 'cartão restante', 'cartões restantes')} · ${session.answered} ${session.answered === 1 ? 'resposta' : 'respostas'}` : '';
  if (!card) {
    renderSummary();
    return;
  }
  const repeat = session.graded.has(card.id);
  const tag = repeat ? 'revisão extra de hoje' : St.isNew(card) ? 'cartão novo' : 'revisão';
  const answerHTML = flipped ? `<div class="answer"><span class="tag">resposta</span>${renderMarkdown(card.back)}</div>` : '';
  let controls;
  if (!flipped) {
    controls = '<button type="button" class="btn primary flip" id="flip">Mostrar resposta <kbd>espaço</kbd></button>';
  } else {
    const prev = St.preview(card, session);
    const buttons = BUTTONS.map((b, i) => {
      let hint;
      if (repeat) hint = b.q >= 4 ? 'sai da fila de hoje' : 'repete hoje';
      else {
        const days = prev.find((p) => p.q === b.q).interval;
        hint = `${intervalText(days)}${b.q < 4 ? ', e repete hoje' : ''}`;
      }
      return `<button type="button" class="btn g${i + 1}" data-q="${b.q}"><span>${b.label} <kbd>${b.key}</kbd></span><small>${escapeHtml(hint)}</small></button>`;
    }).join('');
    controls = `<div class="grades" role="group" aria-label="Como foi?">${buttons}</div>${repeat ? '<p class="muted small center">Este cartão já foi avaliado hoje: estas respostas não mudam o agendamento, só decidem se ele repete de novo.</p>' : ''}`;
  }
  body.innerHTML = `<div class="flashcard" id="flashcard" tabindex="-1" aria-live="polite"><span class="tag">${tag}</span>${renderMarkdown(card.front)}${answerHTML}</div>${controls}`;
  if (!flipped) $('flip').addEventListener('click', flip);
  body.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => grade(Number(b.dataset.q))));
}

function flip() {
  if (flipped || !St.currentCard(state, session)) return;
  flipped = true;
  renderStudy();
  // o foco vai para o cartão (não para um botão), para que segurar o espaço não responda sozinho
  const fc = $('flashcard');
  if (fc) fc.focus();
}

function grade(q) {
  if (!flipped) return;
  today = todayString();
  St.answer(state, session, q, today);
  persist();
  flipped = false;
  renderStudy();
  const flipBtn = $('flip');
  if (flipBtn) flipBtn.focus();
}

function renderSummary() {
  const body = $('study-body');
  if (session.answered === 0) {
    const next = state.cards.filter((c) => c.deckId === session.deckId && !St.isNew(c)).map((c) => c.due).sort()[0];
    const newLeft = St.deckCounts(state, session.deckId, today).newTotal;
    let msg = 'Nada para estudar agora neste baralho.';
    if (next) msg += ` A próxima revisão é ${next <= today ? 'hoje' : `em ${shortDate(next)} (${intervalText(daysBetween(today, next))})`}.`;
    if (newLeft) msg += ` Há ${plural(newLeft, 'cartão novo', 'cartões novos')} esperando: o limite diário de novos já foi atingido.`;
    else if (state.cards.every((c) => c.deckId !== session.deckId)) msg = 'Este baralho ainda não tem cartões. Adicione alguns no editor.';
    body.innerHTML = `<div class="summary"><p>${escapeHtml(msg)}</p><div class="row-actions" style="justify-content:center"><a class="btn" href="#/baralho/${encodeURIComponent(session.deckId)}">Editar o baralho</a><a class="btn primary" href="#/">Voltar aos baralhos</a></div></div>`;
    return;
  }
  const rate = session.firstAnswers ? session.correctFirst / session.firstAnswers : 0;
  const fc = St.forecast(state, today, 8, session.deckId).slice(1).filter((d) => d.count > 0).slice(0, 3);
  const nextText = fc.length ? `Próximas revisões: ${fc.map((d) => `${shortDate(d.date)} (${d.count})`).join(', ')}.` : '';
  body.innerHTML = `<div class="summary">
      <p class="big">Pronto por hoje!</p>
      <p>Você respondeu ${plural(session.answered, 'vez', 'vezes')}, com ${plural(session.firstAnswers, 'cartão avaliado', 'cartões avaliados')} e ${pct(rate)} de acerto na primeira tentativa.</p>
      <p class="muted">${escapeHtml(nextText)}</p>
      <div class="row-actions" style="justify-content:center"><a class="btn primary" href="#/">Voltar aos baralhos</a></div>
    </div>`;
}

document.addEventListener('keydown', (ev) => {
  if ($('view-study').hidden || !session) return;
  const tag = (ev.target && ev.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.key === 'Escape') {
    location.hash = '#/';
    return;
  }
  if (!St.currentCard(state, session)) return;
  const isFlipKey = ev.key === ' ' || ev.key === 'Enter';
  const b = BUTTONS.find((x) => x.key === ev.key);
  if (ev.repeat && (isFlipKey || b)) {
    // tecla segurada: não vira nem responde de novo (e não aciona o botão que estiver em foco)
    ev.preventDefault();
    return;
  }
  if (isFlipKey && !flipped) {
    const t = ev.target;
    const onCard = t === document.body || t === document.documentElement || (t && (t.id === 'flip' || t.id === 'flashcard'));
    if (!onCard) return; // Enter num link (Sair, menu) continua navegando
    ev.preventDefault();
    flip();
    return;
  }
  if (b && flipped) {
    ev.preventDefault();
    grade(b.q);
  }
});

// ---------------------------------------------------------------------------
// Editor de baralho

function cardStatus(c) {
  if (St.isNew(c)) return 'novo';
  const d = daysBetween(today, c.due);
  const when = d < 0 ? `atrasado ${plural(-d, 'dia', 'dias')}` : d === 0 ? 'vence hoje' : `vence em ${intervalText(d)}`;
  return `${when} · intervalo ${intervalText(c.interval)} · facilidade ${c.ef.toLocaleString('pt-BR')}`;
}

function showDeck(deck) {
  show('deck');
  currentDeck = deck;
  $('t-deck').textContent = deck.name;
  $('rename-input').value = deck.name;
  $('deck-study').href = `#/estudar/${encodeURIComponent(deck.id)}`;
  $('delete-confirm').hidden = true;
  $('import-result').textContent = '';
  renderCards();
  updatePreview();
}

function renderCards() {
  const deck = currentDeck;
  const filter = $('card-filter').value.trim().toLowerCase();
  const all = state.cards.filter((c) => c.deckId === deck.id);
  const cards = filter ? all.filter((c) => `${c.front} ${c.back}`.toLowerCase().includes(filter)) : all;
  $('t-cards').textContent = `Cartões (${all.length})`;
  if (all.length === 0) {
    $('card-list').innerHTML = '<p class="muted">Nenhum cartão ainda. Adicione acima ou importe uma lista.</p>';
    return;
  }
  const items = cards.slice(0, 300).map((c) => `<li data-id="${escapeHtml(c.id)}">
      <div class="qa"><div><strong>${escapeHtml(plainText(c.front))}</strong></div><div>${escapeHtml(plainText(c.back))}</div></div>
      <div><div class="meta">${escapeHtml(cardStatus(c))}</div>
      <div class="actions"><button type="button" class="btn small" data-edit="${escapeHtml(c.id)}">Editar</button><button type="button" class="btn small danger-outline" data-del="${escapeHtml(c.id)}">Excluir</button></div></div>
    </li>`);
  $('card-list').innerHTML = `<ul class="cards">${items.join('')}</ul>${cards.length > 300 ? `<p class="muted small">Mostrando 300 de ${cards.length}. Use o filtro para achar os outros.</p>` : ''}${cards.length === 0 ? '<p class="muted">Nenhum cartão bate com o filtro.</p>' : ''}`;
}

function startEdit(li, card) {
  li.innerHTML = `<form class="edit-form">
      <div class="two-col">
        <div><label for="ef-${escapeHtml(card.id)}">Frente</label><textarea id="ef-${escapeHtml(card.id)}" rows="3" data-f></textarea></div>
        <div><label for="eb-${escapeHtml(card.id)}">Verso</label><textarea id="eb-${escapeHtml(card.id)}" rows="3" data-b></textarea></div>
      </div>
      <div class="row-actions"><button type="submit" class="btn primary small">Salvar</button><button type="button" class="btn small" data-cancel>Cancelar</button></div>
    </form>`;
  const f = li.querySelector('[data-f]');
  const b = li.querySelector('[data-b]');
  f.value = card.front;
  b.value = card.back;
  f.focus();
  li.querySelector('form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      St.editCard(state, card.id, f.value, b.value);
      persist();
      renderCards();
      notice('Cartão atualizado.');
    } catch (err) {
      notice(err.message, true);
    }
  });
  li.querySelector('[data-cancel]').addEventListener('click', renderCards);
}

function updatePreview() {
  $('prev-front').innerHTML = renderMarkdown($('card-front').value);
  $('prev-back').innerHTML = renderMarkdown($('card-back').value);
}

function addCardFromForm() {
  try {
    St.addCard(state, currentDeck.id, $('card-front').value, $('card-back').value, today);
    persist();
    $('card-front').value = '';
    $('card-back').value = '';
    updatePreview();
    renderCards();
    $('card-front').focus();
    notice('Cartão adicionado.');
  } catch (err) {
    notice(err.message, true);
  }
}

function runImport(text) {
  try {
    const { cards, invalid, merged, delimiter } = importCards(text);
    if (cards.length === 0 && invalid.length === 0) {
      $('import-result').textContent = 'Nada para importar.';
      return;
    }
    const { added, duplicates } = St.importIntoDeck(state, currentDeck.id, cards, today);
    persist();
    renderCards();
    const sepName = { ';': 'ponto e vírgula', ',': 'vírgula', '\t': 'tab' }[delimiter];
    const parts = [`${plural(added, 'cartão importado', 'cartões importados')} (separador: ${sepName})`];
    if (duplicates) parts.push(`${plural(duplicates, 'repetido ignorado', 'repetidos ignorados')}`);
    if (merged.length) parts.push(`${merged.length === 1 ? 'na linha' : 'nas linhas'} ${merged.slice(0, 10).join(', ')}${merged.length > 10 ? '…' : ''}, as colunas além da segunda foram juntadas à resposta`);
    if (invalid.length) parts.push(`linhas ignoradas (sem pergunta, sem resposta ou longas demais): ${invalid.slice(0, 10).join(', ')}${invalid.length > 10 ? '…' : ''}`);
    $('import-result').textContent = `${parts.join('; ')}.`;
    if (added) $('import-text').value = '';
  } catch (err) {
    $('import-result').textContent = err.message;
  }
}

function initDeckEditor() {
  $('rename-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      St.renameDeck(state, currentDeck.id, $('rename-input').value);
      persist();
      $('t-deck').textContent = currentDeck.name;
      notice('Baralho renomeado.');
    } catch (err) {
      notice(err.message, true);
    }
  });
  $('delete-deck').addEventListener('click', () => { $('delete-confirm').hidden = false; });
  $('delete-no').addEventListener('click', () => { $('delete-confirm').hidden = true; });
  $('delete-yes').addEventListener('click', () => {
    St.deleteDeck(state, currentDeck.id);
    persist();
    notice('Baralho excluído.');
    location.hash = '#/';
  });
  $('card-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    addCardFromForm();
  });
  for (const id of ['card-front', 'card-back']) {
    $(id).addEventListener('input', updatePreview);
    $(id).addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        addCardFromForm();
      }
    });
  }
  $('card-filter').addEventListener('input', renderCards);
  $('card-list').addEventListener('click', (ev) => {
    const edit = ev.target.closest('[data-edit]');
    const del = ev.target.closest('[data-del]');
    if (edit) {
      const card = state.cards.find((c) => c.id === edit.dataset.edit);
      if (card) startEdit(edit.closest('li'), card);
    } else if (del) {
      if (del.dataset.armed !== '1') {
        del.dataset.armed = '1';
        del.textContent = 'Confirmar exclusão';
        setTimeout(() => {
          if (del.isConnected) {
            del.dataset.armed = '';
            del.textContent = 'Excluir';
          }
        }, 4000);
        return;
      }
      St.deleteCard(state, del.dataset.del);
      persist();
      renderCards();
      notice('Cartão excluído.');
    }
  });
  $('import-go').addEventListener('click', () => runImport($('import-text').value));
  $('import-file').addEventListener('change', async () => {
    const file = $('import-file').files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      $('import-result').textContent = 'Arquivo grande demais (máximo de 5 MB).';
      return;
    }
    runImport(decodeText(await file.arrayBuffer()));
    $('import-file').value = '';
  });
  const exportAs = (sep, ext, type) => {
    const cards = state.cards.filter((c) => c.deckId === currentDeck.id);
    download(`${safeName(currentDeck.name)}.${ext}`, `\ufeff${exportCards(cards, sep)}`, type);
  };
  $('export-csv').addEventListener('click', () => exportAs(';', 'csv', 'text/csv;charset=utf-8'));
  $('export-tsv').addEventListener('click', () => exportAs('\t', 'tsv', 'text/tab-separated-values;charset=utf-8'));
}

// ---------------------------------------------------------------------------
// Estatísticas

function barChart(data, unit) {
  const W = 640;
  const H = 210;
  const L = 8;
  const R = 8;
  const T = 22;
  const B = 30;
  const max = Math.max(1, ...data.map((d) => d.count));
  const bw = (W - L - R) / data.length;
  const parts = [`<line class="base" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`];
  data.forEach((d, i) => {
    const h = (d.count / max) * (H - T - B);
    const x = L + i * bw + bw * 0.18;
    const w = bw * 0.64;
    const y = H - B - h;
    const r = Math.min(4, w / 2, h);
    if (d.count > 0) {
      parts.push(`<path class="bar" d="M${x},${H - B} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${H - B} Z"><title>${shortDate(d.date)}: ${plural(d.count, unit[0], unit[1])}</title></path>`);
      parts.push(`<text class="val" x="${x + w / 2}" y="${y - 5}" text-anchor="middle">${d.count}</text>`);
    }
    if (data.length <= 14 || i % 2 === 0) parts.push(`<text x="${x + w / 2}" y="${H - B + 16}" text-anchor="middle">${shortDate(d.date)}</text>`);
  });
  const rows = data.map((d) => `<tr><td>${shortDate(d.date)}</td><td>${d.count}</td></tr>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras: ${escapeHtml(unit[1])} por dia">${parts.join('')}</svg>
    <table class="sr-only"><caption>${escapeHtml(unit[1])} por dia</caption><thead><tr><th>dia</th><th>quantidade</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function showStats() {
  show('stats');
  const ret = St.retention(state, today, 30);
  const learned = state.cards.filter((c) => !St.isNew(c));
  const avgEf = learned.length ? learned.reduce((s, c) => s + c.ef, 0) / learned.length : null;
  $('stats-tiles').innerHTML = tilesHTML([
    [plural(St.streak(state, today), 'dia', 'dias'), 'de sequência'],
    [String(state.log.filter((e) => e.date === today).length), 'respostas hoje'],
    [ret.rate === null ? 'sem dados' : pct(ret.rate), `de acerto nas revisões (30 dias${ret.count ? `, ${ret.count}` : ''})`],
    [String(state.cards.length), 'cartões no total'],
    [String(learned.length), 'já estudados'],
    [avgEf === null ? '-' : avgEf.toLocaleString('pt-BR', { maximumFractionDigits: 2 }), 'facilidade média (EF)'],
  ]);
  $('chart-history').innerHTML = barChart(St.reviewsPerDay(state, today, 14), ['resposta', 'respostas']);
  $('chart-forecast').innerHTML = barChart(St.forecast(state, today, 14), ['revisão', 'revisões']);
  if (state.decks.length === 0) {
    $('stats-decks').innerHTML = '<p class="muted">Sem baralhos ainda.</p>';
    return;
  }
  const rows = state.decks.map((d) => {
    const c = St.deckCounts(state, d.id, today);
    const r = St.retention(state, today, 30, d.id);
    return `<tr><td class="l">${escapeHtml(d.name)}</td><td>${c.total}</td><td>${c.newTotal}</td><td>${c.due}</td><td>${r.rate === null ? '-' : pct(r.rate)}</td></tr>`;
  }).join('');
  $('stats-decks').innerHTML = `<table><thead><tr><th class="l">Baralho</th><th>Cartões</th><th>Novos</th><th>Para revisar</th><th>Acerto (30 dias)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// Ajustes e backup

let pendingRestore = null;

function showSettings() {
  show('settings');
  $('new-per-day').value = String(state.settings.newPerDay);
  $('restore-confirm').hidden = true;
  $('wipe-confirm').hidden = true;
  $('backup-result').textContent = '';
}

function initSettings() {
  $('settings-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const raw = $('new-per-day').value.trim();
    const v = Number(raw);
    if (raw === '' || !Number.isInteger(v) || v < 0 || v > 999) {
      notice('Use um número inteiro de 0 a 999.', true);
      return;
    }
    state.settings.newPerDay = v;
    if (persist()) notice('Ajuste salvo.');
  });
  $('backup-download').addEventListener('click', () => {
    download(`cartoes-de-estudo-backup-${today}.json`, St.exportBackup(state), 'application/json');
  });
  $('backup-file').addEventListener('change', async () => {
    const file = $('backup-file').files[0];
    $('backup-file').value = '';
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Arquivo grande demais.');
      pendingRestore = St.importBackup(await file.text());
      $('restore-summary').textContent = `O backup tem ${plural(pendingRestore.decks.length, 'baralho', 'baralhos')}, ${plural(pendingRestore.cards.length, 'cartão', 'cartões')} e ${plural(pendingRestore.log.length, 'resposta', 'respostas')} no histórico. Substituir os dados atuais?`;
      $('restore-confirm').hidden = false;
      $('backup-result').textContent = '';
    } catch (err) {
      pendingRestore = null;
      $('backup-result').textContent = err.message;
    }
  });
  $('restore-yes').addEventListener('click', () => {
    if (!pendingRestore) return;
    state = pendingRestore;
    pendingRestore = null;
    $('restore-confirm').hidden = true;
    $('new-per-day').value = String(state.settings.newPerDay);
    $('backup-result').textContent = persist()
      ? 'Backup restaurado.'
      : 'Backup carregado nesta aba, mas não foi possível salvar no navegador.';
  });
  $('restore-no').addEventListener('click', () => {
    pendingRestore = null;
    $('restore-confirm').hidden = true;
  });
  $('wipe').addEventListener('click', () => { $('wipe-confirm').hidden = false; });
  $('wipe-no').addEventListener('click', () => { $('wipe-confirm').hidden = true; });
  $('wipe-yes').addEventListener('click', () => {
    state = St.emptyState();
    $('wipe-confirm').hidden = true;
    $('new-per-day').value = String(state.settings.newPerDay);
    if (persist()) notice('Todos os dados foram apagados.');
  });
}

// ---------------------------------------------------------------------------

function init() {
  state = loadState();
  $('new-deck-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      const deck = St.addDeck(state, $('new-deck-name').value);
      persist();
      $('new-deck-name').value = '';
      location.hash = `#/baralho/${encodeURIComponent(deck.id)}`;
    } catch (err) {
      notice(err.message, true);
    }
  });
  initDeckEditor();
  initSettings();
  window.addEventListener('hashchange', route);
  // outra aba mexeu nos dados: recarrega para não sobrescrever o progresso de lá
  window.addEventListener('storage', (ev) => {
    if (ev.key === STORAGE_KEY) {
      state = loadState();
      route();
    }
  });
  route();
}

init();
