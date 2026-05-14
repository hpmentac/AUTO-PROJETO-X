import { validateEnvironment } from './config.js';
import { generateAudio } from './pipeline/02-tts.js';
import { buildLayout } from './pipeline/03-layout.js';
import { buildVideo } from './pipeline/04-video.js';
import { ensureDirs } from './utils/ffmpeg-helpers.js';
import { loadState, saveState, isStageComplete } from './utils/state.js';
import { logger } from './utils/logger.js';

/**
 * Executa pipeline para um unico video.
 * Suporta checkpointing: retoma de onde parou.
 *
 * Espera que state.script ja esteja preenchido (webhook recebe roteiro pronto).
 *
 * @param {string} title
 * @param {{ pngPath?: string, pngDir?: string, backgroundsDir: string, channel?: string }} opts
 * @returns {Promise<string>} Caminho do .mp4 gerado
 */
async function runSingle(title, opts) {
  const startTime = Date.now();
  const { pngPath, pngDir, backgroundsDir, channel = 'default' } = opts || {};

  if (!pngPath && !pngDir) throw new Error('runSingle: pngPath ou pngDir obrigatorio');
  if (!backgroundsDir)      throw new Error('runSingle: backgroundsDir obrigatorio');

  logger.info(`Iniciando: "${title}"`);

  const { slug } = ensureDirs(title);
  const state = loadState(title);
  state.slug = slug;

  if (!state.script) {
    throw new Error('state.script ausente — webhook deve preencher antes de runSingle');
  }
  if (!isStageComplete(state, 'script_done')) {
    state.stage = 'script_done';
    saveState(state);
  }

  // ── Etapa 2: TTS ──────────────────────────────────────────────────────────
  if (!isStageComplete(state, 'tts_done')) {
    logger.info('[2/4] Gerando audio e legendas...');
    const audio = await generateAudio(state.script, title, channel, {
      voiceId: state.webhookVoiceId || null,
      voiceEffects: state.webhookVoiceEffects || null,
    });
    state.audioPath      = audio.audioPath;
    state.srtGroupedPath = audio.srtGroupedPath;
    state.srtWordPath    = audio.srtWordPath;
    state.durationSec    = audio.durationSec;
    state.stage          = 'tts_done';
    saveState(state);
    logger.info(`[2/4] Audio: ${audio.durationSec.toFixed(1)}s`);
  } else {
    logger.info('[2/4] Audio ja existe (checkpoint). Pulando...');
  }

  // ── Etapa 3: Layout ───────────────────────────────────────────────────────
  if (!isStageComplete(state, 'images_done')) {
    logger.info('[3/4] Montando layout (backgrounds + PNG)...');
    const layout = await buildLayout({
      durationSec:    state.durationSec,
      pngPath:        state.webhookPngPath  || pngPath  || null,
      pngDir:         state.webhookPngDir   || pngDir   || null,
      backgroundsDir: state.webhookBackgroundsDir || backgroundsDir,
    });
    state.pngPath            = layout.pngPath;
    state.backgroundSegments = layout.backgroundSegments;
    state.stage              = 'images_done';
    saveState(state);
    logger.info(`[3/4] ${layout.backgroundSegments.length} segmento(s) de background`);
  } else {
    logger.info('[3/4] Layout ja existe (checkpoint). Pulando...');
  }

  // ── Etapa 4: Video ────────────────────────────────────────────────────────
  if (!isStageComplete(state, 'video_done')) {
    logger.info('[4/4] Renderizando video...');
    const outputPath = await buildVideo({
      audioPath:          state.audioPath,
      srtGroupedPath:     state.srtGroupedPath,
      srtWordPath:        state.srtWordPath,
      pngPath:            state.pngPath,
      backgroundSegments: state.backgroundSegments,
      title,
    });
    state.outputPath = outputPath;
    state.stage      = 'video_done';
    saveState(state);
  } else {
    logger.info('[4/4] Video ja existe (checkpoint). Pulando...');
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  logger.info(`Pronto em ${elapsed} min: ${state.outputPath}`);
  return state.outputPath;
}

export { runSingle, validateEnvironment };
