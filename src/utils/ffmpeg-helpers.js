import { execFileSync, execFile } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import { logger } from './logger.js';

/**
 * Gera slug a partir de um titulo (para nomes de pasta/arquivo).
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // remove acentos
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
}

/**
 * Cria as pastas necessarias para processar um video.
 */
export function ensureDirs(title) {
  const slug = slugify(title);
  const tempDir = path.join(config.TEMP, slug);

  mkdirSync(tempDir, { recursive: true });
  mkdirSync(config.OUTPUT, { recursive: true });

  return { slug, tempDir };
}

/**
 * Detecta se h264_nvenc (NVIDIA GPU encoder) esta disponivel.
 */
let _nvencAvailable = null;
export function hasNvenc() {
  if (_nvencAvailable !== null) return _nvencAvailable;
  try {
    const out = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { stdio: 'pipe', encoding: 'utf-8' });
    _nvencAvailable = out.includes('h264_nvenc');
    logger.info(`NVENC: ${_nvencAvailable ? 'DISPONIVEL (GPU)' : 'NAO DISPONIVEL (usando CPU)'}`);
  } catch {
    _nvencAvailable = false;
  }
  return _nvencAvailable;
}

/**
 * Verifica se FFmpeg esta instalado e retorna a versao.
 */
export function checkFfmpeg() {
  try {
    const out = execFileSync('ffmpeg', ['-version'], { stdio: 'pipe', encoding: 'utf-8' });
    const version = out.split('\n')[0];
    logger.debug(`FFmpeg: ${version}`);
    return version;
  } catch {
    throw new Error('FFmpeg nao encontrado. Instale: https://ffmpeg.org/download.html');
  }
}

/**
 * Executa FFmpeg como Promise.
 * @param {string[]} args  Argumentos para ffmpeg
 * @param {object} [opts]  Opcoes extras para execFile (ex: cwd)
 * @returns {Promise<string>}  stdout
 */
export function runFfmpeg(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = execFile('ffmpeg', args, { maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        logger.error(`FFmpeg falhou: ${stderr.slice(-500)}`);
        reject(new Error(`FFmpeg erro: ${err.message}\n${stderr.slice(-300)}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Carrega backgrounds do canal — imagens e videos.
 * Prefere a subpasta _converted/ (arquivos ja em 9:16) quando ela existir.
 *
 * @param {string|null} dir
 * @returns {Array<{path: string, type: 'image'|'video'}>}
 */
export function loadBackgrounds(dir) {
  if (!dir || !existsSync(dir)) return [];

  // Prefere _converted/ se existir e tiver arquivos
  const convertedDir = path.join(dir, '_converted');
  const searchDir = existsSync(convertedDir) ? convertedDir : dir;

  const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
  const VIDEO_RE = /\.(mp4|mov|avi|mkv|webm)$/i;

  return readdirSync(searchDir)
    .filter(f => IMAGE_RE.test(f) || VIDEO_RE.test(f))
    .map(f => ({
      path: path.join(searchDir, f),
      type: VIDEO_RE.test(f) ? 'video' : 'image',
    }));
}

/**
 * Retorna item aleatorio de um array.
 */
export function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}
