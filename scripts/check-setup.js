/**
 * Check setup — diagnostico rapido antes de subir o webhook.
 *
 * Valida: Node, FFmpeg, NVENC, .env, pastas essenciais.
 * Exit 0 se OK, 1 se erro fatal.
 *
 * Uso: npm run check
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[90m';

let fatalCount = 0;
let warnCount = 0;
let okCount = 0;

function ok(label, detail = '') {
  console.log(`  ${GREEN}OK${RESET}   ${label}${detail ? DIM + ' — ' + detail + RESET : ''}`);
  okCount++;
}
function warn(label, detail = '') {
  console.log(`  ${YELLOW}WARN${RESET} ${label}${detail ? ' — ' + detail : ''}`);
  warnCount++;
}
function fail(label, detail = '') {
  console.log(`  ${RED}FAIL${RESET} ${label}${detail ? ' — ' + detail : ''}`);
  fatalCount++;
}
function section(name) {
  console.log('');
  console.log(`${CYAN}${name}${RESET}`);
}
function tryExec(cmd, args) {
  try {
    return execFileSync(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  } catch {
    return null;
  }
}

console.log('');
console.log(`${CYAN}======================================================================${RESET}`);
console.log(`${CYAN}  automacao-bbb — diagnostico de ambiente${RESET}`);
console.log(`${CYAN}======================================================================${RESET}`);

// ---- Node.js ----
section('[1] Node.js');
const nodeV = process.version;
const major = parseInt(nodeV.replace(/^v/, '').split('.')[0], 10);
if (major >= 20) {
  ok(`Node.js ${nodeV}`);
} else {
  fail(`Node.js ${nodeV}`, 'precisa ser v20 ou superior (https://nodejs.org/)');
}

// ---- FFmpeg / ffprobe ----
section('[2] FFmpeg');
const ffmpegOut = tryExec('ffmpeg', ['-version']);
if (ffmpegOut) {
  const ver = ffmpegOut.split('\n')[0].replace(/^ffmpeg version /, '').split(' ')[0];
  ok(`ffmpeg`, `versao ${ver}`);
} else {
  fail('ffmpeg', 'nao encontrado no PATH. Instale: https://www.gyan.dev/ffmpeg/builds/');
}
const ffprobeOut = tryExec('ffprobe', ['-version']);
if (ffprobeOut) {
  ok('ffprobe');
} else {
  fail('ffprobe', 'nao encontrado no PATH (geralmente vem junto com ffmpeg)');
}

// ---- NVENC ----
section('[3] GPU NVENC (opcional mas recomendado)');
const encodersOut = tryExec('ffmpeg', ['-hide_banner', '-encoders']);
if (encodersOut && encodersOut.includes('h264_nvenc')) {
  ok('h264_nvenc disponivel', 'render vai usar GPU NVIDIA (rapido)');
} else {
  warn('h264_nvenc nao detectado', 'render vai cair em encoding CPU (lento). OK se nao tiver GPU NVIDIA.');
}

// ---- .env ----
section('[4] Variaveis de ambiente (.env)');
const envPath = path.join(ROOT, '.env');
if (!existsSync(envPath)) {
  fail('.env', 'arquivo nao existe. Crie a partir das keys configuradas no Syntax Desktop.');
} else {
  const envText = readFileSync(envPath, 'utf-8');
  const envMap = {};
  for (const line of envText.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    envMap[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }

  const checkKey = (name, isRequired, hint = '') => {
    const v = envMap[name];
    if (!v || v === '' || /SUA_(CHAVE|KEY)_AQUI/i.test(v) || /uuid-da-voz/i.test(v) || v.startsWith('uuid-')) {
      if (isRequired) fail(name, 'nao preenchido ou ainda com placeholder');
      else warn(name, hint || 'vazio (opcional)');
      return false;
    }
    ok(name, `${v.slice(0, 8)}...${v.slice(-4)}`);
    return true;
  };

  checkKey('TALKIFY_API_KEY', true);
  checkKey('TALKIFY_VOICE_ID_PT', true);
  checkKey('TALKIFY_VOICE_ID_ES', true);
  checkKey('SUPABASE_URL', false, 'opcional — necessario pra sincronizar com Syntax Kanban');
  checkKey('SUPABASE_ANON_KEY', false, 'opcional — necessario pra sincronizar com Syntax Kanban');
}

// ---- Pastas essenciais ----
section('[5] Pastas essenciais');
const requiredDirs = [
  ['src/pipeline', true],
  ['src/utils', true],
];
for (const [rel, required] of requiredDirs) {
  const full = path.join(ROOT, rel);
  if (existsSync(full) && statSync(full).isDirectory()) {
    ok(rel);
  } else if (required) {
    fail(rel, 'pasta nao existe');
  }
}

// ---- Relatorio ----
console.log('');
console.log(`${CYAN}======================================================================${RESET}`);
if (fatalCount === 0 && warnCount === 0) {
  console.log(`  ${GREEN}TUDO OK${RESET} — ${okCount} checks passaram`);
  console.log(`  Pode rodar: npm run webhook`);
} else if (fatalCount === 0) {
  console.log(`  ${YELLOW}TUDO OK com ressalvas${RESET} — ${okCount} OK, ${warnCount} warnings`);
  console.log(`  Os warnings sao opcionais. Pode rodar: npm run webhook`);
} else {
  console.log(`  ${RED}PROBLEMAS ENCONTRADOS${RESET} — ${okCount} OK, ${warnCount} warnings, ${fatalCount} ${RED}erros fatais${RESET}`);
  console.log(`  Corrija os erros antes de rodar o webhook.`);
}
console.log(`${CYAN}======================================================================${RESET}`);
console.log('');

process.exit(fatalCount > 0 ? 1 : 0);
