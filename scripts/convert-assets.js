/**
 * Converte backgrounds (imagens + videos) para 9:16 (1080x1920).
 *
 * Uso:
 *   node scripts/convert-assets.js <pasta>           — converte novos arquivos
 *   node scripts/convert-assets.js <pasta> --force   — reconverte tudo
 *
 * Saida: <pasta>/_converted/
 * O pipeline usa _converted/ automaticamente quando ela existir.
 *
 * Suporte:
 *   Imagens: .jpg .jpeg .png .webp  → salvas como .jpg
 *   Videos:  .mp4 .mov .avi .mkv .webm → salvos como .mp4
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const W = 1080;
const H = 1920;

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const VIDEO_RE = /\.(mp4|mov|avi|mkv|webm)$/i;

const COLORS = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};

function c(color, text) {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function fmtSize(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function runFfmpeg(args) {
  try {
    await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      maxBuffer: 100 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(err.stderr?.trim() || err.message);
  }
}

// Converte imagem para 9:16 com crop central
async function convertImage(src, dst) {
  await runFfmpeg([
    '-i', src,
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`,
    '-q:v', '2',
    dst,
  ]);
}

// Converte video para 9:16 com crop central + 24fps + H.264
async function convertVideo(src, dst) {
  await runFfmpeg([
    '-i', src,
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=24`,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-an',  // sem audio em backgrounds
    '-movflags', '+faststart',
    dst,
  ]);
}

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const folder = argv.find(a => !a.startsWith('--'));

  if (!folder) {
    console.error(`\nUso: node scripts/convert-assets.js <pasta> [--force]\n`);
    console.error(`  <pasta>    Pasta com imagens e/ou videos originais`);
    console.error(`  --force    Reconverte mesmo se o arquivo de saida ja existe\n`);
    process.exit(1);
  }

  const absFolder = path.resolve(folder);

  if (!existsSync(absFolder)) {
    console.error(`\n${c('red', 'ERRO')} Pasta nao encontrada: ${absFolder}\n`);
    process.exit(1);
  }

  const outDir = path.join(absFolder, '_converted');
  mkdirSync(outDir, { recursive: true });

  const allFiles = readdirSync(absFolder).filter(f => {
    // Ignora a propria subpasta _converted e arquivos ocultos
    if (f === '_converted' || f.startsWith('.')) return false;
    return IMAGE_RE.test(f) || VIDEO_RE.test(f);
  });

  if (allFiles.length === 0) {
    console.log(`\n${c('yellow', 'Atencao')} Nenhum arquivo de imagem ou video encontrado em: ${absFolder}\n`);
    process.exit(0);
  }

  console.log(`\n${c('cyan', '━'.repeat(58))}`);
  console.log(`  Conversor de Assets  →  ${W}x${H} (9:16)`);
  console.log(`  Pasta: ${absFolder}`);
  console.log(`  Saida: ${outDir}`);
  console.log(`  Arquivos: ${allFiles.length} | Force: ${force ? 'sim' : 'nao'}`);
  console.log(`${c('cyan', '━'.repeat(58))}\n`);

  let ok = 0, skipped = 0, failed = 0;
  const errors = [];

  for (const file of allFiles) {
    const src = path.join(absFolder, file);
    const isVideo = VIDEO_RE.test(file);
    const baseName = path.parse(file).name;
    const ext = isVideo ? '.mp4' : '.jpg';
    const dst = path.join(outDir, baseName + ext);

    const srcSize = fmtSize(statSync(src).size);
    const tag = isVideo ? c('yellow', 'VIDEO') : c('cyan', 'IMAGEM');

    if (!force && existsSync(dst)) {
      console.log(`  ${c('gray', 'SKIP')}  [${tag}]  ${file}  ${c('gray', '(ja convertido)')}`);
      skipped++;
      continue;
    }

    process.stdout.write(`  ${c('gray', '...')}   [${tag}]  ${file}  ${c('gray', `(${srcSize})`)}  `);

    const t = Date.now();
    try {
      if (isVideo) {
        await convertVideo(src, dst);
      } else {
        await convertImage(src, dst);
      }
      const dstSize = fmtSize(statSync(dst).size);
      const elapsed = ((Date.now() - t) / 1000).toFixed(1);
      console.log(`${c('green', 'OK')}  ${c('gray', `${dstSize} | ${elapsed}s`)}`);
      ok++;
    } catch (err) {
      console.log(`${c('red', 'ERRO')}`);
      errors.push({ file, msg: err.message });
      failed++;
    }
  }

  console.log(`\n${c('cyan', '━'.repeat(58))}`);
  console.log(`  ${c('green', `${ok} convertido(s)`)}   ${c('gray', `${skipped} ignorado(s)`)}   ${failed > 0 ? c('red', `${failed} erro(s)`) : '0 erro(s)'}`);
  console.log(`${c('cyan', '━'.repeat(58))}\n`);

  if (errors.length > 0) {
    console.log(`${c('red', 'Erros detalhados:')}`);
    for (const e of errors) {
      console.log(`  ${e.file}: ${e.msg}`);
    }
    console.log('');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`\n${c('red', 'Erro fatal:')} ${err.message}\n`);
  process.exit(1);
});
