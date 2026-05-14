import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function env(key, fallback) {
  const val = process.env[key];
  if (val !== undefined) return val;
  if (fallback !== undefined) return fallback;
  throw new Error(`Variavel de ambiente obrigatoria nao definida: ${key}`);
}

const config = {
  // Paths
  ROOT,
  OUTPUT: path.join(ROOT, 'output'),
  TEMP: path.join(ROOT, 'temp'),

  // Talkify
  TALKIFY_API_KEY: env('TALKIFY_API_KEY'),
  TALKIFY_URL: env('TALKIFY_URL', 'https://api.talkifylabs.com'),
  TALKIFY_VOICE_ID_PT: env('TALKIFY_VOICE_ID_PT', ''),
  TALKIFY_VOICE_ID_ES: env('TALKIFY_VOICE_ID_ES', ''),
  TALKIFY_TEMPO: parseFloat(env('TALKIFY_TEMPO', '1.05')),
  TALKIFY_POLL_INTERVAL: parseInt(env('TALKIFY_POLL_INTERVAL', '4000'), 10),
  TALKIFY_TIMEOUT: parseInt(env('TALKIFY_TIMEOUT', '180000'), 10),

  // Concorrencia
  MAX_CONCURRENT_TTS: parseInt(env('MAX_CONCURRENT_TTS', '2'), 10),
  MAX_CONCURRENT_FFMPEG: parseInt(env('MAX_CONCURRENT_FFMPEG', '1'), 10),

  // Video — 9:16 vertical
  VIDEO_WIDTH: 1080,
  VIDEO_HEIGHT: 1920,
  VIDEO_FPS: 24,
  VIDEO_CRF: 23,

  // PNG overlay — tamanho e pendulo
  // PNG_HEIGHT_PCT: percentual da altura do canvas (9:16 = 1920px)
  // Ex: 0.70 = 1344px de altura — PNG ocupa 70% da vertical
  PNG_HEIGHT_PCT: parseFloat(env('PNG_HEIGHT_PCT', '0.70')),
  PENDULUM_AMPLITUDE: parseFloat(env('PENDULUM_AMPLITUDE', '0.04')),   // radianos (~2.3 graus)
  PENDULUM_FREQUENCY: parseFloat(env('PENDULUM_FREQUENCY', '0.15')),   // Hz (periodo ~7s)

  // Background slideshow
  BG_SEGMENT_DURATION: parseFloat(env('BG_SEGMENT_DURATION', '8')),  // segundos por background

  // Legendas (ASS karaoke)
  SUB_FONT_NAME: 'Arial',
  SUB_FONT_SIZE: 58,
  SUB_PRIMARY_COLOR: '&H0000FFFF',    // Amarelo (palavra destacada) — ASS BGR
  SUB_SECONDARY_COLOR: '&H00FFFFFF',   // Branco (nao-destacada) — ASS BGR
  SUB_OUTLINE_COLOR: '&H00000000',     // Preto (contorno)
  SUB_BACK_COLOR: '&H80000000',        // Fundo semi-transparente
  SUB_OUTLINE_SIZE: 3,
  SUB_MARGIN_V: 45,
};

/**
 * Valida que o ambiente tem tudo necessario para rodar o pipeline.
 * Lanca erro se algo critico estiver faltando.
 */
export async function validateEnvironment() {
  const errors = [];

  // FFmpeg
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
  } catch {
    errors.push('FFmpeg nao encontrado no PATH. Instale: https://ffmpeg.org/download.html');
  }

  // Pastas de saida: criadas sob demanda se nao existirem
  const outputDirs = [config.OUTPUT, config.TEMP];
  for (const dir of outputDirs) {
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch (e) {
        errors.push(`Nao foi possivel criar pasta ${dir}: ${e.message}`);
      }
    }
  }

  // Talkify: obrigatorio pro stage TTS.
  if (!config.TALKIFY_API_KEY || config.TALKIFY_API_KEY === 'SUA_KEY_AQUI') {
    errors.push('TALKIFY_API_KEY nao configurada no .env');
  }

  if (errors.length > 0) {
    throw new Error(`Validacao de ambiente falhou:\n  - ${errors.join('\n  - ')}`);
  }
}

export default config;
