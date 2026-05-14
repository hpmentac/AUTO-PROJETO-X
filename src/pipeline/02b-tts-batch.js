/**
 * TTS em modo batch: empacota N roteiros num unico job Talkify,
 * baixa artefatos brutos, chama o splitter e fatia o MP3 com ffmpeg.
 *
 * Design fail-safe:
 *   - Artefatos brutos persistidos IMEDIATAMENTE em temp/batch_{id}/raw/
 *     (permite re-rodar o splitter sem gastar credito novo)
 *   - Commit atomico: retorna N pacotes validos OU lanca erro, nunca parcial
 *   - Validacao cruzada: duracao do MP3 cortado bate com duracao da fatia no SRT
 */

import { writeFileSync, readFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import config from '../config.js';
import { retry, sleep } from '../utils/retry.js';
import { talkifyLimiter } from '../utils/rate-limiter.js';
import { slugify } from '../utils/ffmpeg-helpers.js';
import { logger } from '../utils/logger.js';
import {
  buildSuperScript, pickSentinels, splitBatchSrt, BatchSplitError,
} from '../utils/batch-splitter.js';

const MAX_BATCH_CHARS = 140_000;  // margem de 10k do limite Talkify de 150k
const AUDIO_DURATION_TOLERANCE_MS = 500;

class TalkifyCreditsExhausted extends Error {
  constructor() {
    super('Talkify: creditos esgotados (409). Batch interrompido.');
    this.fatal = true;
    this.status = 409;
  }
}

function getVoiceIdFallback(channel) {
  if (channel === 'lcf') return config.TALKIFY_VOICE_ID_ES;
  return config.TALKIFY_VOICE_ID_PT;
}

async function downloadFile(url, destPath, apiKey) {
  const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Download ${res.status}: ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  mkdirSync(path.dirname(destPath), { recursive: true });
  writeFileSync(destPath, buffer);
  return buffer.length;
}

/**
 * Corta um MP3 com ffmpeg. Re-encoda pra garantir corte preciso (MP3 frames
 * nao alinham exatamente com ms arbitrarios, mas como cortamos em zonas de
 * silencio a qualidade perdida eh irrelevante).
 */
function cortarAudio(srcPath, startMs, endMs, destPath) {
  const startSec = (startMs / 1000).toFixed(3);
  const durationSec = ((endMs - startMs) / 1000).toFixed(3);
  mkdirSync(path.dirname(destPath), { recursive: true });
  execFileSync('ffmpeg', [
    '-y',
    '-i', srcPath,
    '-ss', startSec,
    '-t', durationSec,
    '-acodec', 'libmp3lame',
    '-q:a', '2',
    destPath,
  ], { stdio: 'pipe' });
}

/**
 * Le duracao de um MP3 via ffprobe.
 */
function lerDuracaoAudio(mp3Path) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    mp3Path,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  return parseFloat(out.toString().trim()) * 1000;  // ms
}

/**
 * Cria job Talkify com polling ate conclusao.
 */
async function executarJobTalkify(texto, audioName, voiceId, voiceEffects) {
  logger.info(`Talkify batch: criando job (${texto.length} chars, voiceId=${voiceId.slice(0, 8)}...)`);
  await talkifyLimiter.waitForSlot();

  const job = await retry(async () => {
    const res = await fetch(`${config.TALKIFY_URL}/tts/jobs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.TALKIFY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audioName,
        audio: {
          text: texto,
          voiceId,
          effects: voiceEffects,
        },
      }),
    });
    if (res.status === 409) throw new TalkifyCreditsExhausted();
    if (!res.ok) throw Object.assign(new Error(`Talkify create ${res.status}`), { status: res.status });
    return res.json();
  }, { name: 'Talkify-batch-create', maxAttempts: 2 });

  const jobId = job.id;
  logger.info(`Talkify batch: job ${jobId} criado`);

  const startTime = Date.now();
  let status = 'queued';
  let durationSec = 0;
  let resultPath = null;

  while (status !== 'success') {
    if (Date.now() - startTime > config.TALKIFY_TIMEOUT) {
      throw new Error(`Talkify batch: timeout apos ${config.TALKIFY_TIMEOUT / 1000}s (job ${jobId})`);
    }
    await sleep(config.TALKIFY_POLL_INTERVAL);
    const check = await fetch(`${config.TALKIFY_URL}/tts/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${config.TALKIFY_API_KEY}` },
    });
    if (!check.ok) { logger.warn(`Polling ${check.status}`); continue; }
    const data = await check.json();
    status = data.status;
    durationSec = data.resultDurationSec || 0;
    resultPath = data.resultPath || null;
    if (status === 'error') throw new Error(`Talkify batch: job ${jobId} erro`);
    logger.debug(`Polling: ${status} (${((Date.now() - startTime) / 1000).toFixed(0)}s)`);
  }

  logger.info(`Talkify batch: job ${jobId} concluido (${durationSec.toFixed(1)}s de audio)`);
  return { jobId, durationSec, resultPath };
}

/**
 * Gera audio em modo batch.
 *
 * @param {Array<{title:string, script:string, channel:string}>} jobs
 * @returns {Promise<Array<{
 *   title: string,
 *   audioPath: string,
 *   srtGroupedPath: string,
 *   srtWordPath: string,
 *   durationSec: number
 * }>>}
 * @throws Em qualquer falha. Nunca retorna parcial.
 */
export async function generateAudioBatch(jobs) {
  if (!Array.isArray(jobs) || jobs.length < 2) {
    throw new Error(`generateAudioBatch precisa de >= 2 jobs, recebido ${jobs?.length}`);
  }

  // Sanidade: todos mesmo channel E mesmo voiceId (batch Talkify usa 1 voz so)
  const channels = new Set(jobs.map(j => j.channel));
  if (channels.size > 1) {
    throw new Error(`generateAudioBatch: jobs com channels diferentes nao suportados: ${[...channels].join(',')}`);
  }
  const channel = jobs[0].channel;

  // voiceId pode vir do payload (voz do agente) ou cair pro fallback por channel
  const voiceIds = new Set(jobs.map(j => j.voiceId || getVoiceIdFallback(j.channel)));
  if (voiceIds.size > 1) {
    throw new Error(`generateAudioBatch: jobs com voiceIds diferentes nao suportados: ${[...voiceIds].join(',')}`);
  }
  const voiceId = [...voiceIds][0];

  // Effects: pegamos do primeiro (scheduler ja agrupou por effects equivalentes)
  const voiceEffects = jobs[0].voiceEffects || { tempo: config.TALKIFY_TEMPO };

  // 1. Pre-flight local
  const sentinels = pickSentinels(jobs.length);
  const superScript = buildSuperScript(jobs.map(j => j.script), sentinels);
  if (superScript.length > MAX_BATCH_CHARS) {
    throw new Error(`Super-script excede limite: ${superScript.length} > ${MAX_BATCH_CHARS} chars`);
  }

  // 2. Dir de trabalho do batch
  const batchId = `batch_${Date.now()}`;
  const batchDir = path.join(config.TEMP, batchId);
  const rawDir = path.join(batchDir, 'raw');
  mkdirSync(rawDir, { recursive: true });

  writeFileSync(path.join(batchDir, 'superscript.txt'), superScript, 'utf-8');
  writeFileSync(path.join(batchDir, 'manifest.json'), JSON.stringify({
    batchId,
    channel,
    jobs: jobs.map(j => ({ title: j.title, scriptChars: j.script.length })),
    sentinels,
    superScriptChars: superScript.length,
    createdAt: new Date().toISOString(),
  }, null, 2), 'utf-8');

  logger.info(`Batch ${batchId}: ${jobs.length} roteiros, ${superScript.length} chars, ${sentinels.length} sentinelas`);

  // 3. Executa job Talkify
  const { jobId, resultPath } = await executarJobTalkify(superScript, batchId, voiceId, voiceEffects);

  // 4. Baixa artefatos brutos IMEDIATAMENTE (ponto sagrado — splitter pode re-rodar)
  const rawAudioPath = path.join(rawDir, 'audio.mp3');
  const rawWordSrtPath = path.join(rawDir, 'subs_word.srt');
  const rawGroupedSrtPath = path.join(rawDir, 'subs_grouped.srt');

  const audioUrl = resultPath || `${config.TALKIFY_URL}/audios/${jobId}.mp3`;
  await downloadFile(audioUrl, rawAudioPath);
  await downloadFile(
    `${config.TALKIFY_URL}/tts/jobs/${jobId}/subtitles?style=word&format=srt`,
    rawWordSrtPath, config.TALKIFY_API_KEY,
  );
  await downloadFile(
    `${config.TALKIFY_URL}/tts/jobs/${jobId}/subtitles?style=grouped&format=srt&uppercase=true`,
    rawGroupedSrtPath, config.TALKIFY_API_KEY,
  );
  logger.info(`Batch ${batchId}: artefatos brutos salvos em ${rawDir}`);

  // 5. Roda o splitter (fase PURA, testavel offline)
  const wordText = readFileSync(rawWordSrtPath, 'utf-8');
  const groupedText = readFileSync(rawGroupedSrtPath, 'utf-8');

  let fatias;
  try {
    fatias = splitBatchSrt(wordText, groupedText, sentinels);
  } catch (err) {
    if (err instanceof BatchSplitError) {
      logger.error(`Batch ${batchId} QUARENTENADO: ${err.message}`);
      logger.error(`  Detalhes: ${JSON.stringify(err.details)}`);
      logger.error(`  Artefatos brutos preservados em: ${rawDir}`);
      throw err;
    }
    throw err;
  }

  if (fatias.length !== jobs.length) {
    throw new Error(`Splitter retornou ${fatias.length} fatias, esperado ${jobs.length}`);
  }

  // 6. Pra cada fatia: corta MP3, escreve SRTs, valida duracao
  const resultados = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const fatia = fatias[i];
    const slug = slugify(job.title);
    const sliceDir = path.join(config.TEMP, slug);
    mkdirSync(sliceDir, { recursive: true });

    const audioPath = path.join(sliceDir, 'audio.mp3');
    const srtWordPath = path.join(sliceDir, 'subs_word.srt');
    const srtGroupedPath = path.join(sliceDir, 'subs_grouped.srt');

    cortarAudio(rawAudioPath, fatia.startMs, fatia.endMs, audioPath);
    writeFileSync(srtWordPath, fatia.wordSrt, 'utf-8');
    writeFileSync(srtGroupedPath, fatia.groupedSrt, 'utf-8');

    // Validacao cruzada: duracao do MP3 cortado bate com fatia
    const audioMs = lerDuracaoAudio(audioPath);
    const expectedMs = fatia.endMs - fatia.startMs;
    const deltaMs = Math.abs(audioMs - expectedMs);
    if (deltaMs > AUDIO_DURATION_TOLERANCE_MS) {
      throw new Error(
        `Fatia ${i} "${job.title}": audio ${audioMs.toFixed(0)}ms vs SRT ${expectedMs.toFixed(0)}ms ` +
        `(delta ${deltaMs.toFixed(0)}ms > ${AUDIO_DURATION_TOLERANCE_MS}ms)`,
      );
    }

    // Sanidade: arquivo nao vazio
    if (statSync(audioPath).size < 1024) {
      throw new Error(`Fatia ${i} "${job.title}": audio vazio (${statSync(audioPath).size}B)`);
    }

    resultados.push({
      title: job.title,
      audioPath,
      srtGroupedPath,
      srtWordPath,
      durationSec: fatia.durationSec,
    });

    logger.info(`Batch ${batchId}: fatia ${i + 1}/${jobs.length} "${job.title}" OK ` +
      `(${fatia.durationSec.toFixed(1)}s, ${fatia.wordCount} palavras)`);
  }

  logger.info(`Batch ${batchId}: ${resultados.length} fatias validadas com sucesso`);
  return resultados;
}

export { TalkifyCreditsExhausted };
