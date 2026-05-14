import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import { loadBackgrounds } from '../utils/ffmpeg-helpers.js';
import { logger } from '../utils/logger.js';

/**
 * Resolve o PNG a usar: arquivo direto ou sorteia um da pasta.
 * Prioridade: pngPath (arquivo especifico) > pngDir (sorteia um da pasta).
 */
function resolvePng(pngPath, pngDir) {
  if (pngPath && existsSync(pngPath)) return pngPath;

  if (pngDir && existsSync(pngDir)) {
    const files = readdirSync(pngDir).filter(f => /\.(png|webp)$/i.test(f));
    if (files.length === 0) throw new Error(`Nenhum PNG encontrado em: ${pngDir}`);
    const chosen = files[Math.floor(Math.random() * files.length)];
    return path.join(pngDir, chosen);
  }

  throw new Error(`PNG nao encontrado. pngPath="${pngPath}" pngDir="${pngDir}"`);
}

/**
 * Monta o layout do video: seleciona backgrounds do banco e resolve o PNG overlay.
 *
 * @param {{ durationSec: number, pngPath?: string, pngDir?: string, backgroundsDir: string }} opts
 * @returns {{ pngPath: string, backgroundSegments: Array<{path: string, type: string, durationSec: number}> }}
 */
export async function buildLayout({ durationSec, pngPath, pngDir, backgroundsDir }) {
  const resolvedPng = resolvePng(pngPath, pngDir);

  const allBgs = loadBackgrounds(backgroundsDir);
  if (allBgs.length === 0) {
    throw new Error(`Nenhum background encontrado em: ${backgroundsDir}`);
  }

  // Embaralha para variar a ordem a cada render
  const shuffled = [...allBgs].sort(() => Math.random() - 0.5);

  // Divide a duracao total em segmentos de BG_SEGMENT_DURATION segundos
  const segDur = config.BG_SEGMENT_DURATION;
  const segments = [];
  let remaining = durationSec;
  let idx = 0;

  while (remaining > 0.01) {
    const dur = parseFloat(Math.min(segDur, remaining).toFixed(3));
    const bg  = shuffled[idx % shuffled.length];
    segments.push({
      path:        bg.path,
      type:        bg.type,
      durationSec: dur,
    });
    remaining -= dur;
    idx++;
  }

  const types = [...new Set(segments.map(s => s.type))].join('+');
  logger.info(`Layout: ${segments.length} background(s) [${types}] de ate ${segDur}s | PNG: ${path.basename(resolvedPng)}`);
  return { pngPath: resolvedPng, backgroundSegments: segments };
}
