import { mkdirSync } from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import { runFfmpeg, hasNvenc, slugify } from '../utils/ffmpeg-helpers.js';
import { generateKaraokeASS } from '../utils/ass-generator.js';
import { logger } from '../utils/logger.js';

const { VIDEO_WIDTH: W, VIDEO_HEIGHT: H, VIDEO_FPS: FPS } = config;

function getEncoderArgs() {
  if (hasNvenc()) {
    return [
      '-c:v', 'h264_nvenc',
      '-preset', 'p1',
      '-rc', 'vbr',
      '-cq', String(config.VIDEO_CRF),
      '-b:v', '4M',
      '-maxrate', '6M',
      '-bufsize', '8M',
      '-profile:v', 'high',
      '-g', '48',
      '-bf', '3',
      '-pix_fmt', 'yuv420p',
    ];
  }
  return [
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', String(config.VIDEO_CRF),
    '-profile:v', 'high',
    '-g', '48',
    '-bf', '3',
    '-pix_fmt', 'yuv420p',
  ];
}

/**
 * Escapa caminhos para uso em opcoes de filtros FFmpeg.
 * No Windows: "C:\path\file.ass" => "C\:/path/file.ass"
 */
function escapeFfmpegFilterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

/**
 * Renderiza o video final via um unico filtergraph FFmpeg:
 *   backgrounds (16:9 -> 9:16, slideshow) + PNG overlay (pendulo) + legendas + audio.
 *
 * @param {{
 *   audioPath: string,
 *   srtGroupedPath: string,
 *   srtWordPath: string,
 *   pngPath: string,
 *   backgroundSegments: Array<{path: string, durationSec: number}>,
 *   title: string,
 * }} opts
 * @returns {Promise<string>} Caminho do .mp4 gerado
 */
export async function buildVideo({
  audioPath,
  srtGroupedPath,
  srtWordPath,
  pngPath,
  backgroundSegments,
  title,
}) {
  const slug = slugify(title);
  const tempDir = path.join(config.TEMP, slug);
  mkdirSync(tempDir, { recursive: true });
  mkdirSync(config.OUTPUT, { recursive: true });

  const outputPath = path.resolve(config.OUTPUT, `${slug}.mp4`);
  const tTotal = Date.now();

  // ── Fase A: Gerar legenda ASS karaoke ──────────────────────────────────────
  const tA = Date.now();
  const assPath = path.join(tempDir, 'subs_karaoke.ass');
  generateKaraokeASS(srtWordPath, srtGroupedPath, assPath);
  logger.info(`[TIMING] Fase A (ASS karaoke): ${Date.now() - tA}ms`);

  // ── Fase B: Montar comando FFmpeg com filtergraph unico ────────────────────
  const n   = backgroundSegments.length;
  const A   = config.PENDULUM_AMPLITUDE;
  const F   = config.PENDULUM_FREQUENCY;
  const pngH = Math.round(H * 0.70);  // 70% do canvas em altura (~1344px para 1920)

  const args = ['-y'];

  // Entradas: N backgrounds + 1 PNG + 1 audio
  // Imagens: -loop 1 (loop infinito, cortado por -t)
  // Videos:  -stream_loop -1 (loop infinito, cortado por -t) — sem -loop 1 que e so para image2
  for (const seg of backgroundSegments) {
    if (seg.type === 'video') {
      args.push('-stream_loop', '-1', '-t', String(seg.durationSec), '-i', seg.path);
    } else {
      args.push('-loop', '1', '-t', String(seg.durationSec), '-i', seg.path);
    }
  }
  const pngIdx   = n;
  const audioIdx = n + 1;
  args.push('-i', pngPath);
  args.push('-i', audioPath);

  // ── Filtergraph ────────────────────────────────────────────────────────────
  //
  // 1. Scale cada background para 9:16 (crop central)
  // 2. Concat backgrounds em sequencia (ou passa direto se n=1)
  // 3. Rotacao senoidal suave no PNG (pendulo)
  // 4. Overlay do PNG centralizado
  // 5. Legendas karaoke ASS

  // [1] Scale + crop cada BG para W x H
  const bgFilters = backgroundSegments.map((_, i) =>
    `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
    `crop=${W}:${H},fps=${FPS},setpts=PTS-STARTPTS[v${i}]`
  ).join(';');

  // [2] Concat (ou alias direto se n=1 — concat com n=1 e fragil em alguns builds)
  const concatFilter = n === 1
    ? `[v0]null[bg]`
    : `${backgroundSegments.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[bg]`;

  // [3] PNG: escala pela ALTURA (70% do canvas) → crop central para largura do canvas
  //         → pendulo. O PNG e paisagem (16:9): escalar para pngH gera largura ~2390px;
  //         o crop central (1080px) exibe o centro da imagem onde esta o sujeito.
  //         Ancorado no rodape para preencher de baixo ate ~30% do topo.
  //
  //   Por que n/FPS em vez de t?
  //   Com -loop 1, PTS=0 em todos os frames → t=0 → sin(0)=0 → sem movimento.
  //   Usando n (frame number) / FPS obtemos tempo crescente correto.
  const pendulumFilter =
    `[${pngIdx}:v]scale=-2:${pngH}[png_sized];` +
    `[png_sized]crop=${W}:${pngH}:0:0[png_cropped];` +
    `[png_cropped]rotate=angle='${A}*sin(2*PI*${F}*(n/${FPS}))':c=none` +
    `:ow=iw+100:oh=ih+100[png_rot]`;

  // [4] PNG ancorado no rodape, centralizado horizontalmente.
  //     +50 compensa o padding transparente inferior do rotate (oh=ih+100 = 50px em baixo).
  const overlayFilter = `[bg][png_rot]overlay=x=(W-w)/2:y=H-h+50[comp]`;

  // [5] Legendas ASS karaoke
  const assEscaped  = escapeFfmpegFilterPath(assPath);
  const subsFilter  = `[comp]subtitles='${assEscaped}'[vout]`;

  const filterComplex = [
    bgFilters,
    concatFilter,
    pendulumFilter,
    overlayFilter,
    subsFilter,
  ].join(';');

  args.push('-filter_complex', filterComplex);
  args.push('-map', '[vout]', '-map', `${audioIdx}:a`);
  args.push('-r', String(FPS));
  args.push(...getEncoderArgs());
  args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart');
  args.push(outputPath);

  const durationSec = backgroundSegments.reduce((s, seg) => s + seg.durationSec, 0);
  logger.info(
    `Renderizando ${W}x${H} @ ${FPS}fps | ` +
    `${n} background(s) | ` +
    `PNG ${pngH}px alto (${Math.round(config.PNG_HEIGHT_PCT*100)}% vertical) | ` +
    `pendulo ${(A * 180 / Math.PI).toFixed(1)}graus @ ${F}Hz | ` +
    `${hasNvenc() ? 'GPU (NVENC)' : 'CPU (libx264)'}`
  );

  const tRender = Date.now();
  await runFfmpeg(args);
  const renderMs = Date.now() - tRender;
  const speedRatio = (durationSec / (renderMs / 1000)).toFixed(2);
  logger.info(`[TIMING] Render FFmpeg: ${(renderMs / 1000).toFixed(1)}s para ${durationSec.toFixed(1)}s de video (${speedRatio}x realtime)`);

  logger.info(`[TIMING] TOTAL buildVideo: ${((Date.now() - tTotal) / 1000).toFixed(1)}s`);
  logger.info(`Video finalizado: ${outputPath}`);
  return outputPath;
}
