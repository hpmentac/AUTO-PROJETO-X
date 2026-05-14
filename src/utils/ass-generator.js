import { writeFileSync } from 'node:fs';
import config from '../config.js';
import { parseSRT } from './srt-parser.js';
import { logger } from './logger.js';

/**
 * Formata segundos para timestamp ASS: H:MM:SS.cc (centesimos).
 */
function formatAssTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Gera header do arquivo ASS com estilos de karaoke profissional.
 */
function generateAssHeader() {
  const {
    SUB_FONT_NAME: font,
    SUB_FONT_SIZE: size,
    SUB_PRIMARY_COLOR: primary,
    SUB_SECONDARY_COLOR: secondary,
    SUB_OUTLINE_COLOR: outline,
    SUB_BACK_COLOR: back,
    SUB_OUTLINE_SIZE: outlineSize,
    SUB_MARGIN_V: marginV,
    VIDEO_WIDTH: resX,
    VIDEO_HEIGHT: resY,
  } = config;

  // BorderStyle=4 = fundo opaco com contorno
  // Bold=1, Shadow=1 para profundidade
  return `[Script Info]
Title: Karaoke Narration
ScriptType: v4.00+
PlayResX: ${resX}
PlayResY: ${resY}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${font},${size},${primary},${secondary},${outline},${back},1,0,0,0,100,100,1,0,3,${outlineSize},1.5,2,20,20,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/**
 * Encontra palavras do SRT word-level que caem dentro do intervalo de um grupo.
 */
function findWordsInRange(words, groupStart, groupEnd) {
  return words.filter(w => w.start >= groupStart - 0.05 && w.start < groupEnd + 0.05);
}

/**
 * Gera arquivo ASS com legendas karaoke a partir de SRT word-level + grouped.
 * Usa \kf (fill karaoke) para efeito de preenchimento suave palavra por palavra.
 */
export function generateKaraokeASS(wordSrtPath, groupedSrtPath, outputAssPath) {
  const words = parseSRT(wordSrtPath);
  const groups = parseSRT(groupedSrtPath);

  logger.info(`ASS karaoke: ${words.length} palavras, ${groups.length} grupos`);

  let assContent = generateAssHeader();
  let dialogueCount = 0;

  for (const group of groups) {
    const groupWords = findWordsInRange(words, group.start, group.end);

    if (groupWords.length === 0) {
      const totalCs = Math.round((group.end - group.start) * 100);
      assContent += `Dialogue: 0,${formatAssTime(group.start)},${formatAssTime(group.end)},Default,,0,0,0,,{\\kf${totalCs}}${group.text.toUpperCase()}\n`;
      dialogueCount++;
      continue;
    }

    // Construir linha com tags \kf por palavra — texto em maiusculas para legibilidade
    let karaokeLine = '';
    for (const word of groupWords) {
      const durationCs = Math.max(1, Math.round((word.end - word.start) * 100));
      karaokeLine += `{\\kf${durationCs}}${word.text.toUpperCase()} `;
    }

    assContent += `Dialogue: 0,${formatAssTime(group.start)},${formatAssTime(group.end)},Default,,0,0,0,,${karaokeLine.trim()}\n`;
    dialogueCount++;
  }

  writeFileSync(outputAssPath, assContent, 'utf-8');
  logger.info(`ASS karaoke gerado: ${outputAssPath} (${dialogueCount} linhas)`);
}
