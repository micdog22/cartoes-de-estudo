// Algoritmo SM-2 (SuperMemo 2) e datas de calendário.
//
// Para cada resposta com qualidade q (0 a 5):
//   q >= 3 (lembrou): 1ª repetição -> intervalo 1 dia; 2ª -> 6 dias; depois, intervalo anterior × EF
//   q < 3 (esqueceu): recomeça as repetições, intervalo de 1 dia
//   EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), nunca abaixo de 1,3
// O intervalo usa o EF de antes da resposta, e o EF é atualizado em toda resposta
// (é a formulação mais difundida do SM-2).

export const MIN_EF = 1.3;
export const START_EF = 2.5;

/** Botões da interface e a qualidade SM-2 de cada um. */
export const BUTTONS = Object.freeze([
  { key: '1', id: 'errei', label: 'Errei', q: 1 },
  { key: '2', id: 'dificil', label: 'Difícil', q: 3 },
  { key: '3', id: 'bom', label: 'Bom', q: 4 },
  { key: '4', id: 'facil', label: 'Fácil', q: 5 },
]);

/** Novo fator de facilidade. Como os ajustes são múltiplos de 0,02, arredondar a 2 casas é exato. */
export function nextEF(ef, q) {
  if (!Number.isInteger(q) || q < 0 || q > 5) throw new RangeError('A qualidade vai de 0 a 5.');
  const d = 5 - q;
  const next = ef + (0.1 - d * (0.08 + d * 0.02));
  return Math.max(MIN_EF, Math.round(next * 100) / 100);
}

/** Próximo agendamento de um cartão { reps, interval, ef } para a qualidade q. */
export function schedule({ reps = 0, interval = 0, ef = START_EF } = {}, q) {
  let nextReps;
  let nextInterval;
  if (q >= 3) {
    if (reps === 0) nextInterval = 1;
    else if (reps === 1) nextInterval = 6;
    // EF em centésimos: 25 × 2,26 = 56,5 vira 57; em ponto flutuante daria 56,4999... e viraria 56
    else nextInterval = Math.max(1, Math.round((interval * Math.round(ef * 100)) / 100));
    nextReps = reps + 1;
  } else {
    nextReps = 0;
    nextInterval = 1;
  }
  return { reps: nextReps, interval: nextInterval, ef: nextEF(ef, q) };
}

// ---------------------------------------------------------------------------
// Datas como "AAAA-MM-DD" (dia do calendário local, sem horas, sem fuso)

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDate(s) {
  const m = DATE_RE.exec(String(s));
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return toDateString(new Date(t)) === s;
}

function toDateString(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Hoje no calendário local do usuário. */
export function todayString(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Soma dias a uma data (aritmética em UTC: horário de verão não atrapalha). */
export function addDays(date, n) {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`Data inválida: ${date}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + n * 86400000;
  return toDateString(new Date(t));
}

/** Diferença em dias: b - a. */
export function daysBetween(a, b) {
  const pa = DATE_RE.exec(a);
  const pb = DATE_RE.exec(b);
  const ta = Date.UTC(Number(pa[1]), Number(pa[2]) - 1, Number(pa[3]));
  const tb = Date.UTC(Number(pb[1]), Number(pb[2]) - 1, Number(pb[3]));
  return Math.round((tb - ta) / 86400000);
}

/** Texto curto do intervalo: "1 dia", "6 dias", "3 meses", "1,2 ano". */
export function intervalText(days) {
  if (days < 1) return 'hoje';
  if (days === 1) return '1 dia';
  if (days < 30) return `${days} dias`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return months === 1 ? '1 mês' : `${months} meses`;
  }
  const years = Math.round((days / 365) * 10) / 10;
  return `${years.toLocaleString('pt-BR')} ${years === 1 ? 'ano' : 'anos'}`;
}
