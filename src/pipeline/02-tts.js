import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import { retry, sleep } from '../utils/retry.js';
import { talkifyLimiter } from '../utils/rate-limiter.js';
import { slugify } from '../utils/ffmpeg-helpers.js';
import { logger } from '../utils/logger.js';

class TalkifyCreditsExhausted extends Error {
  constructor() {
    super('Talkify: creditos esgotados (409). Batch interrompido.');
    this.fatal = true;
    this.status = 409;
  }
}

/**
 * Faz download de um arquivo da Talkify API.
 */
async function downloadFile(url, destPath, apiKey) {
  const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
  const res = await fetch(url, { headers });

  if (!res.ok) {
    throw Object.assign(new Error(`Download falhou: ${res.status} ${url}`), { status: res.status });
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  mkdirSync(path.dirname(destPath), { recursive: true });
  writeFileSync(destPath, buffer);
  logger.debug(`Download: ${destPath} (${(buffer.length / 1024).toFixed(0)}KB)`);
}

/**
 * Seleciona voice ID baseado no canal (fallback legacy).
 */
function getVoiceIdFallback(channel) {
  if (channel === 'lcf') return config.TALKIFY_VOICE_ID_ES;
  return config.TALKIFY_VOICE_ID_PT;
}

/**
 * Gera audio MP3 + 2 arquivos SRT via Talkify.
 *
 * @param {string} script   Texto do roteiro
 * @param {string} title    Titulo (para nome de arquivo)
 * @param {string} channel  'bbb' | 'lcf' (legacy — usado so pra fallback de voiceId)
 * @param {object} [opts]
 * @param {string} [opts.voiceId]         Voice ID do Talkify (vem do agente do canal).
 *                                         Se ausente, cai pro TALKIFY_VOICE_ID_* do .env.
 * @param {object} [opts.voiceEffects]    Effects do Talkify (tempo, pitch, etc.).
 *                                         Se ausente, usa { tempo: config.TALKIFY_TEMPO }.
 * @returns {Promise<{ audioPath: string, srtGroupedPath: string, srtWordPath: string, durationSec: number }>}
 */
export async function generateAudio(script, title, channel = 'bbb', opts = {}) {
  const voiceId = opts.voiceId || getVoiceIdFallback(channel);
  const voiceEffects = opts.voiceEffects || { tempo: config.TALKIFY_TEMPO };

  const slug = slugify(title);
  const tempDir = path.join(config.TEMP, slug);
  mkdirSync(tempDir, { recursive: true });

  // 1. Criar job
  logger.info(`TTS: criando job para "${title}" (voiceId=${voiceId.slice(0, 8)}...)`);
  await talkifyLimiter.waitForSlot();

  const job = await retry(async () => {
    const res = await fetch(`${config.TALKIFY_URL}/tts/jobs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.TALKIFY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audioName: slug,
        audio: {
          text: script,
          voiceId,
          effects: voiceEffects,
        },
      }),
    });

    if (res.status === 409) {
      throw new TalkifyCreditsExhausted();
    }

    if (!res.ok) {
      throw Object.assign(new Error(`Talkify create ${res.status}`), { status: res.status });
    }

    return res.json();
  }, { name: 'Talkify-create', maxAttempts: 2 });

  const jobId = job.id;
  logger.info(`TTS job criado: ${jobId}`);

  // 2. Polling ate success
  const startTime = Date.now();
  let status = 'queued';
  let durationSec = 0;
  let resultPath = null;

  while (status !== 'success') {
    if (Date.now() - startTime > config.TALKIFY_TIMEOUT) {
      throw new Error(`TTS timeout apos ${config.TALKIFY_TIMEOUT / 1000}s (job ${jobId})`);
    }

    await sleep(config.TALKIFY_POLL_INTERVAL);

    const check = await fetch(`${config.TALKIFY_URL}/tts/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${config.TALKIFY_API_KEY}` },
    });

    if (!check.ok) {
      logger.warn(`TTS polling falhou: ${check.status}`);
      continue;
    }

    const data = await check.json();
    status = data.status;
    durationSec = data.resultDurationSec || 0;
    resultPath = data.resultPath || null;

    if (status === 'error') {
      throw new Error(`TTS falhou no servidor (job ${jobId})`);
    }

    logger.debug(`TTS polling: ${status} (${((Date.now() - startTime) / 1000).toFixed(0)}s)`);
  }

  logger.info(`TTS pronto: ${durationSec.toFixed(1)}s de audio`);

  // 3. Download MP3 (usa resultPath do S3 retornado pela API)
  const audioPath = path.join(tempDir, 'audio.mp3');
  const audioUrl = resultPath || `${config.TALKIFY_URL}/audios/${jobId}.mp3`;
  await downloadFile(audioUrl, audioPath);

  // 4. Download SRT grouped (para legendas queimadas)
  const srtGroupedPath = path.join(tempDir, 'subs_grouped.srt');
  await downloadFile(
    `${config.TALKIFY_URL}/tts/jobs/${jobId}/subtitles?style=grouped&format=srt&uppercase=true`,
    srtGroupedPath,
    config.TALKIFY_API_KEY
  );

  // 5. Download SRT word-level (para detectar nomes e mapear imagens)
  const srtWordPath = path.join(tempDir, 'subs_word.srt');
  await downloadFile(
    `${config.TALKIFY_URL}/tts/jobs/${jobId}/subtitles?style=word&format=srt`,
    srtWordPath,
    config.TALKIFY_API_KEY
  );

  return { audioPath, srtGroupedPath, srtWordPath, durationSec };
}

export { TalkifyCreditsExhausted };
