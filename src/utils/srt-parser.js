import { readFileSync } from 'node:fs';

/**
 * Converte timestamp SRT "HH:MM:SS,mmm" para segundos (float).
 */
function srtTimeToSec(str) {
  const [hms, ms] = str.trim().split(',');
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s + parseInt(ms, 10) / 1000;
}

/**
 * Parseia um arquivo SRT e retorna array de objetos.
 * @param {string} filePath  Caminho para o .srt
 * @returns {{ index: number, start: number, end: number, text: string }[]}
 */
export function parseSRT(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const blocks = raw.replace(/\r\n/g, '\n').trim().split(/\n\n+/);
  const entries = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;

    const index = parseInt(lines[0], 10);
    if (Number.isNaN(index)) continue;

    const timeLine = lines[1];
    const match = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!match) continue;

    const start = srtTimeToSec(match[1]);
    const end = srtTimeToSec(match[2]);
    const text = lines.slice(2).join(' ').trim();

    entries.push({ index, start, end, text });
  }

  return entries;
}

// ============================================================
// API em milissegundos (usada pelo batch-splitter).
// Trabalha com texto direto em vez de path, pra facilitar testes e slicing.
// ============================================================

function parseTimestampMs(ts) {
  const m = ts.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!m) throw new Error(`Timestamp SRT invalido: "${ts}"`);
  return Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4]);
}

function formatTimestampMs(ms) {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = Math.floor(ms % 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

/**
 * Parseia texto SRT em array de cues com timestamps em ms.
 * @param {string} text  Conteudo do arquivo SRT
 * @returns {Array<{index:number, startMs:number, endMs:number, text:string}>}
 */
export function parseSrtText(text) {
  if (!text || !text.trim()) return [];
  const blocks = text.replace(/\r\n/g, '\n').trim().split(/\n\n+/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;

    const idx = Number(lines[0].trim());
    if (!Number.isFinite(idx)) continue;

    const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!timeMatch) continue;

    cues.push({
      index: idx,
      startMs: parseTimestampMs(timeMatch[1]),
      endMs: parseTimestampMs(timeMatch[2]),
      text: lines.slice(2).join('\n').trim(),
    });
  }

  return cues;
}

/**
 * Serializa array de cues em texto SRT. Re-numera a partir de 1 por default.
 */
export function serializeSrt(cues, { renumber = true } = {}) {
  const out = [];
  cues.forEach((c, i) => {
    const idx = renumber ? (i + 1) : c.index;
    out.push(`${idx}`);
    out.push(`${formatTimestampMs(c.startMs)} --> ${formatTimestampMs(c.endMs)}`);
    out.push(c.text);
    out.push('');
  });
  return out.join('\n').trimEnd() + '\n';
}

/**
 * Retorna cues contidos em [startMs, endMs], com timestamps re-offset pra zero.
 * Cues que cruzam a borda sao descartados (defensivo).
 */
export function sliceCues(cues, startMs, endMs) {
  return cues
    .filter(c => c.startMs >= startMs && c.endMs <= endMs)
    .map(c => ({
      index: c.index,
      startMs: c.startMs - startMs,
      endMs: c.endMs - startMs,
      text: c.text,
    }));
}

export { parseTimestampMs, formatTimestampMs };
