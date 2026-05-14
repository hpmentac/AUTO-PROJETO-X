import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import { slugify } from './ffmpeg-helpers.js';
import { logger } from './logger.js';

/**
 * Checkpointing: salva e carrega estado de cada video no pipeline.
 *
 * Estado fica em temp/{slug}/state.json
 * Permite retomar pipeline apos crash sem refazer etapas completas.
 *
 * Stages: 'pending' | 'script_done' | 'tts_done' | 'images_done' | 'video_done' | 'error'
 */

function statePath(slug) {
  return path.join(config.TEMP, slug, 'state.json');
}

/**
 * Carrega estado salvo de um video, ou retorna estado inicial.
 */
export function loadState(title) {
  const slug = slugify(title);
  const fp = statePath(slug);

  if (existsSync(fp)) {
    try {
      const data = JSON.parse(readFileSync(fp, 'utf-8'));
      logger.debug(`Estado carregado para "${title}": ${data.stage}`);
      return data;
    } catch {
      logger.warn(`Estado corrompido para "${title}", reiniciando`);
    }
  }

  return {
    title,
    slug,
    stage: 'pending',
    script: null,
    audioPath: null,
    srtGroupedPath: null,
    srtWordPath: null,
    durationSec: 0,
    segments: null,
    outputPath: null,
    error: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Salva estado de um video.
 */
export function saveState(state) {
  const fp = statePath(state.slug);
  state.updatedAt = new Date().toISOString();

  try {
    writeFileSync(fp, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    logger.error(`Falha ao salvar estado: ${err.message}`);
  }
}

/**
 * Verifica se uma etapa ja foi completada.
 */
export function isStageComplete(state, targetStage) {
  const order = ['pending', 'script_done', 'tts_done', 'images_done', 'video_done'];
  const currentIdx = order.indexOf(state.stage);
  const targetIdx = order.indexOf(targetStage);
  return currentIdx >= targetIdx;
}
