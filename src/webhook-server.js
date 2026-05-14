import http from 'node:http';
import path from 'node:path';
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { runSingle } from './index.js';
import { validateEnvironment } from './config.js';
import { loadState, saveState } from './utils/state.js';
import { ensureDirs, slugify } from './utils/ffmpeg-helpers.js';
import { logger } from './utils/logger.js';
import { BatchScheduler } from './utils/batch-scheduler.js';
import { generateAudioBatch } from './pipeline/02b-tts-batch.js';

const PORT = parseInt(process.env.WEBHOOK_PORT || '5580', 10);
const BATCH_MAX = parseInt(process.env.BATCH_MAX || '13', 10);
// Default 30min pra dar tempo de acumular roteiros enviados esporadicamente.
// O scheduler tem protecao anti-desperdicio: se timeout bate mas fila < minOnTimeout,
// o timer re-arma em vez de disparar single flush (que gastaria 1 credito por roteiro).
const BATCH_WAIT_MS = parseInt(process.env.BATCH_WAIT_MS || String(30 * 60 * 1000), 10);
const BATCH_MIN_ON_TIMEOUT = parseInt(process.env.BATCH_MIN_ON_TIMEOUT || '2', 10);

// Integracao Supabase/Syntax (opcional). Se nao configurado, patchSupabase vira no-op
// e o webhook continua funcionando normal pra quem manda roteiros via curl/manual.
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Assets padrao (fallback quando o webhook nao envia os campos)
const DEFAULT_BACKGROUNDS_DIR = process.env.DEFAULT_BACKGROUNDS_DIR || '';
const DEFAULT_PNG_DIR          = process.env.DEFAULT_PNG_DIR          || '';
const DEFAULT_PNG_PATH         = process.env.DEFAULT_PNG_PATH         || '';

// Fila serial pra execucao de runSingle (stages 3-4 + video). O scheduler disparar
// flushes sobrepostos — mas nao podemos rodar N ffmpeg em paralelo porque satura CPU.
// Solucao: uma fila separada de "renderizacao" que serializa os runSingle.
const renderQueue = [];
let rendering = false;
let currentRender = null;

function sanitizarFilename(nome) {
  return nome
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || 'video';
}

function inferirCanal(idioma) {
  if (!idioma) return 'bbb';
  const lower = String(idioma).toLowerCase();
  if (lower.startsWith('es')) return 'lcf';
  return 'bbb';
}

function prepararProjeto(data) {
  const titulo = String(data.titulo || '').trim();
  const roteiro = String(data.roteiro || '');
  const contexto = String(data.contexto || '');
  const idioma = data.idioma || 'pt-BR';
  const canalPasta = data.canal_pasta ? String(data.canal_pasta) : '';
  const ciclo = data.ciclo ? String(data.ciclo) : '';
  const numeroVideo = parseInt(data.numero_video || 0, 10) || 0;
  const pipelineItemId = data.pipeline_item_id || null;
  const batchOptIn = data.batch !== false;  // default true

  // Voz do agente. Opcional — sem isso, cai no fallback TALKIFY_VOICE_ID_* do .env.
  const voiceId = data.voice_id ? String(data.voice_id) : null;
  const voiceEffects =
    data.voice_effects && typeof data.voice_effects === 'object' ? data.voice_effects : null;

  // Layout do video: PNG overlay e pasta de backgrounds
  // Prioridade: payload > DEFAULT_* do .env
  const pngPath        = data.png_path        ? String(data.png_path)        : DEFAULT_PNG_PATH || null;
  const pngDir         = data.png_dir         ? String(data.png_dir)         : DEFAULT_PNG_DIR  || null;
  const backgroundsDir = data.backgrounds_dir ? String(data.backgrounds_dir) : DEFAULT_BACKGROUNDS_DIR || null;

  const canal = inferirCanal(idioma);

  let pastaExterna = null;
  if (canalPasta) {
    if (ciclo && numeroVideo) {
      pastaExterna = path.join(canalPasta, ciclo, 'trabalho', `video ${numeroVideo}`);
    } else if (ciclo) {
      pastaExterna = path.join(canalPasta, ciclo, 'trabalho', slugify(titulo));
    } else {
      pastaExterna = path.join(canalPasta, 'trabalho', slugify(titulo));
    }

    try {
      mkdirSync(pastaExterna, { recursive: true });
      writeFileSync(path.join(pastaExterna, 'roteiro.txt'), roteiro, 'utf-8');
      writeFileSync(path.join(pastaExterna, 'contexto.txt'), contexto, 'utf-8');
      logger.info(`Projeto organizado em: ${pastaExterna}`);
    } catch (err) {
      logger.error(`Falha ao criar pasta externa: ${err.message}`);
      pastaExterna = null;
    }
  }

  ensureDirs(titulo);
  const state = loadState(titulo);

  // Retomar: se job existente está em stage intermediário (tts_done/images_done)
  // e o caller pediu resume:true, preserva o progresso. Caso contrario, reset.
  const RESUMABLE_STAGES = ['tts_done', 'images_done'];
  const canResume = data.resume === true && state.stage && RESUMABLE_STAGES.includes(state.stage);

  if (canResume) {
    logger.info(`Retomando "${titulo}" a partir de stage=${state.stage} (pulando etapas concluídas)`);
  } else {
    state.script = roteiro;
    state.stage = 'script_done';
  }

  state.webhookPipelineItemId = pipelineItemId;
  state.webhookPastaCanal = pastaExterna;
  state.webhookCanalPastaRaiz = canalPasta || null;
  state.webhookChannel = canal;
  state.webhookNumeroVideo = numeroVideo;
  state.webhookVoiceId = voiceId;
  state.webhookVoiceEffects = voiceEffects;
  state.webhookPngPath = pngPath;
  state.webhookPngDir = pngDir;
  state.webhookBackgroundsDir = backgroundsDir;
  saveState(state);

  return {
    titulo,
    script: roteiro,
    canal,
    channel: canal,       // scheduler agrupa por channel + voiceId
    voiceId,              // null => fallback no TTS pelo channel
    voiceEffects,         // null => { tempo: config.TALKIFY_TEMPO }
    pipelineItemId,
    pastaExterna,
    pastaRaiz: canalPasta || null,
    numeroVideo,
    pngPath,
    pngDir,
    backgroundsDir,
    batch: batchOptIn,
  };
}

async function patchSupabase(pipelineItemId) {
  if (!pipelineItemId) return;
  if (!SUPABASE_ENABLED) {
    logger.debug(`Supabase PATCH ignorado (SUPABASE_URL/KEY nao configurado) — item=${pipelineItemId}`);
    return;
  }
  const url = `${SUPABASE_URL}/rest/v1/pipeline_items?id=eq.${encodeURIComponent(pipelineItemId)}`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ stage: 'editing', status: 'on_track' }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.error(`Supabase PATCH falhou (${res.status}): ${text}`);
    } else {
      logger.info(`Supabase atualizado: ${pipelineItemId} -> editing/on_track`);
    }
  } catch (err) {
    logger.error(`Supabase PATCH erro: ${err.message}`);
  }
}

function copiarVideoParaPastaCanal(src, pastaExterna, titulo, numeroVideo) {
  if (!pastaExterna || !src || !existsSync(src)) return;
  const baseNome = numeroVideo
    ? sanitizarFilename(`video ${numeroVideo} - ${titulo}`)
    : sanitizarFilename(titulo);
  const nomeMp4 = `${baseNome}.mp4`;

  // 1. Copia pra pasta especifica do video (estrutura original — preserva roteiro.txt, contexto.txt)
  try {
    copyFileSync(src, path.join(pastaExterna, nomeMp4));
    logger.info(`Video copiado para: ${path.join(pastaExterna, nomeMp4)}`);
  } catch (err) {
    logger.error(`Falha ao copiar video: ${err.message}`);
  }

  // 2. Copia tambem pra pasta agregadora "prontos/" do ciclo — facilita ver
  //    todos os videos juntos sem ter que entrar em cada subpasta.
  //    pastaExterna = {canal}/{ciclo}/trabalho/{video N}
  //    prontosDir   = {canal}/{ciclo}/prontos
  try {
    const prontosDir = path.resolve(pastaExterna, '..', '..', 'prontos');
    mkdirSync(prontosDir, { recursive: true });
    copyFileSync(src, path.join(prontosDir, nomeMp4));
    logger.info(`Video tambem em: ${path.join(prontosDir, nomeMp4)}`);
  } catch (err) {
    logger.error(`Falha ao copiar video pra prontos/: ${err.message}`);
  }
}

/**
 * Roda stages 3-4 (image-map + video) via runSingle. Assume que o state ja
 * esta em 'tts_done' (via batch) ou 'script_done' (via single-mode legacy).
 * Depois copia video pra pasta do canal e patcha Supabase.
 */
async function renderizar(job) {
  if (!job.pngPath && !job.pngDir) {
    throw new Error(`png_path ou png_dir obrigatorio. Configure DEFAULT_PNG_DIR no .env. Titulo="${job.titulo}"`);
  }
  if (!job.backgroundsDir) {
    throw new Error(`backgrounds_dir obrigatorio. Configure DEFAULT_BACKGROUNDS_DIR no .env. Titulo="${job.titulo}"`);
  }
  const outputPath = await runSingle(job.titulo, {
    pngPath:        job.pngPath,
    pngDir:         job.pngDir,
    backgroundsDir: job.backgroundsDir,
    channel:        job.channel,
  });
  copiarVideoParaPastaCanal(outputPath, job.pastaExterna, job.titulo, job.numeroVideo);
  await patchSupabase(job.pipelineItemId);
  return outputPath;
}

/**
 * Fila serial de renderizacao. Garante 1 ffmpeg-video por vez.
 */
function enfileirarRender(job) {
  renderQueue.push(job);
  logger.info(`Render queue: +1 "${job.titulo}" [${renderQueue.length} pendentes]`);
  processarRenderQueue();
}

async function processarRenderQueue() {
  if (rendering) return;
  rendering = true;
  while (renderQueue.length) {
    const job = renderQueue.shift();
    currentRender = job;
    logger.info(`>>> Render iniciado: "${job.titulo}" [${renderQueue.length} restantes]`);
    try {
      await renderizar(job);
      logger.info(`<<< Render concluido: "${job.titulo}"`);
    } catch (err) {
      logger.error(`<<< Render falhou "${job.titulo}": ${err.message}`);
    }
  }
  currentRender = null;
  rendering = false;
}

/**
 * Callback do scheduler: recebe N jobs do mesmo channel, roda TTS em batch,
 * pre-popula state com audio/srt, enfileira cada um na render queue.
 *
 * Se falhar em qualquer ponto do batch, lanca — o scheduler captura e chama
 * onSingleFlush(job) pra cada um (fallback seguro automatico).
 */
async function onBatchFlush(jobs) {
  logger.info(`>>> Batch TTS: ${jobs.length} roteiros canal=${jobs[0].channel}`);
  const ttsJobs = jobs.map(j => ({
    title: j.titulo,
    script: j.script,
    channel: j.canal,
    voiceId: j.voiceId,
    voiceEffects: j.voiceEffects,
  }));

  const resultados = await generateAudioBatch(ttsJobs);

  // Commit atomico: so mexe em state depois que todas N fatias foram validadas
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    const r = resultados[i];
    const state = loadState(j.titulo);
    state.audioPath = r.audioPath;
    state.srtGroupedPath = r.srtGroupedPath;
    state.srtWordPath = r.srtWordPath;
    state.durationSec = r.durationSec;
    state.stage = 'tts_done';
    saveState(state);
  }

  // Enfileira cada job na render queue serial (stages 3-4)
  for (const j of jobs) enfileirarRender(j);
  logger.info(`<<< Batch TTS: ${jobs.length} roteiros enfileirados para render`);
}

/**
 * Callback single: pula TTS batch e vai direto pra render queue. runSingle
 * detecta que o state ta em 'script_done' e roda TTS single-mode + stages 3-4.
 */
async function onSingleFlush(job) {
  enfileirarRender(job);
}

const scheduler = new BatchScheduler({
  maxBatch: BATCH_MAX,
  maxWaitMs: BATCH_WAIT_MS,
  minOnTimeout: BATCH_MIN_ON_TIMEOUT,
  onBatchFlush,
  onSingleFlush,
});

function respond(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    return respond(res, 200, { status: 'ok' });
  }

  if (req.method === 'GET' && req.url === '/status') {
    const sched = scheduler.status();
    return respond(res, 200, {
      rendering,
      render_queue_length: renderQueue.length,
      current_render: currentRender ? currentRender.titulo : null,
      scheduler: {
        pending: sched.pending,
        flushing: sched.flushing,
        oldest_age_sec: Math.floor(sched.oldestAgeMs / 1000),
        max_batch: BATCH_MAX,
        max_wait_sec: Math.floor(BATCH_WAIT_MS / 1000),
        min_on_timeout: BATCH_MIN_ON_TIMEOUT,
      },
    });
  }

  if (req.method === 'POST' && req.url === '/scheduler/flush') {
    // Flush manual — util pra ambiente de teste ou encerrar dia
    const before = scheduler.status().pending;
    scheduler.flush();
    return respond(res, 200, { ok: true, flushed: before });
  }

  if (req.method === 'POST' && req.url === '/webhook/roteiro') {
    let data;
    try {
      const body = await readBody(req);
      data = JSON.parse(body);
    } catch {
      return respond(res, 400, { error: 'JSON invalido' });
    }

    if (!data.titulo || !data.roteiro) {
      return respond(res, 400, { error: 'Campos obrigatorios: titulo, roteiro' });
    }

    let job;
    try {
      job = prepararProjeto(data);
    } catch (err) {
      logger.error(`prepararProjeto falhou: ${err.message}`);
      return respond(res, 500, { error: err.message });
    }

    scheduler.enqueue(job);

    respond(res, 200, {
      ok: true,
      titulo: job.titulo,
      slug: slugify(job.titulo),
      batch: job.batch,
      scheduler_pending: scheduler.status().pending,
      mensagem: job.batch
        ? 'Roteiro enfileirado — aguardando batch ou timeout'
        : 'Roteiro recebido — processamento single imediato',
    });
    return;
  }

  respond(res, 404, { error: 'Endpoint nao encontrado' });
});

try {
  await validateEnvironment();
} catch (err) {
  logger.error(err.message);
  process.exit(1);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log(`  Webhook Server rodando em http://localhost:${PORT}`);
  console.log(`  Batch: max=${BATCH_MAX} wait=${Math.floor(BATCH_WAIT_MS / 60000)}min min_on_timeout=${BATCH_MIN_ON_TIMEOUT}`);
  console.log(`  (timer re-arma se fila < min_on_timeout — protege contra single flush acidental)`);
  console.log(`  Supabase: ${SUPABASE_ENABLED ? 'ATIVO (sync com Syntax Kanban)' : 'DESATIVADO (modo standalone)'}`);
  console.log('');
  console.log('  Endpoints:');
  console.log('    POST /webhook/roteiro   — receber roteiro do Syntax');
  console.log('    POST /scheduler/flush   — forcar flush do batch atual');
  console.log('    GET  /health            — health check');
  console.log('    GET  /status            — status detalhado');
  console.log('='.repeat(60));
});
