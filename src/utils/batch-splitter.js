/**
 * Batch splitter: divide 1 SRT grandao (de um batch Talkify) em N pacotes individuais,
 * usando sentinelas faladas como ancoras temporais.
 *
 * Design baseado no probe empirico (scripts/probe-talkify-batch.js):
 *   - Reticencias "..." viram cues proprios no SRT word-level (1-3s cada)
 *   - Sentinelas inventadas ("ZEBRAKAPPA ALFA") aparecem como 1 token por palavra
 *   - Padrao estavel: "..." antes + ROOT + POSICAO + "..." depois (4-way validation)
 *
 * Fail-safe: QUALQUER anomalia aborta o batch inteiro. Nao existe retorno parcial.
 */

import { parseSrtText, serializeSrt, sliceCues } from './srt-parser.js';

// --- CATALOGO DE SENTINELAS ---
//
// Regras:
//   1. Cada sentinela = <ROOT_INVENTADO> <POSICAO_INVENTADA> (2 tokens)
//   2. ROOT tem que ser foneticamente valido em PT-BR mas SEM significado real
//   3. Unico no batch inteiro (nao repetir em posicoes diferentes)
//   4. No super-script sempre envelopado em "... X Y ..." pra criar cues de silencio
//
// ZEBRAKAPPA, XILOFONIO, NEBRABLUXO: confirmados empiricamente no probe (cada um
//   virou 1 token discreto, sandwichados por "..." como esperado).
//
// Ciclamos root entre as 3 confirmadas + 16 posicoes NATO-ish (evitando nomes reais
//   em PT-BR como "lima", "india", "papa"). Total: 48 combos unicos. Mais do que
//   suficiente pra batch de 30.
export const SENTINEL_CATALOG = [
  'ZEBRAKAPPA ALFA',
  'XILOFONIO BRAVO',
  'NEBRABLUXO CHARLIE',
  'ZEBRAKAPPA DELTA',
  'XILOFONIO ECHO',
  'NEBRABLUXO FOXTROT',
  'ZEBRAKAPPA GOLF',
  'XILOFONIO HOTEL',
  'NEBRABLUXO JULIET',
  'ZEBRAKAPPA KILO',
  'XILOFONIO MIKE',
  'NEBRABLUXO NOVEMBER',
  'ZEBRAKAPPA OSCAR',
  'XILOFONIO QUEBEC',
  'NEBRABLUXO ROMEO',
  'ZEBRAKAPPA SIERRA',
  'XILOFONIO TANGO',
  'NEBRABLUXO UNIFORM',
  'ZEBRAKAPPA VICTOR',
  'XILOFONIO WHISKEY',
  'NEBRABLUXO YANKEE',
  'ZEBRAKAPPA ZULU',
  'XILOFONIO ALFA',
  'NEBRABLUXO BRAVO',
  'ZEBRAKAPPA CHARLIE',
  'XILOFONIO DELTA',
  'NEBRABLUXO ECHO',
  'ZEBRAKAPPA FOXTROT',
  'XILOFONIO GOLF',
];

// Validacoes plausibilidade por fatia.
// Bounds BEM folgados de proposito — a validacao real de que o split funcionou
// ja eh feita pelo 4-way sentinel matching + ordem + contagem N-1 sentinelas.
// Estes limites sao salvaguarda contra bugs extremos (fatia com 0 palavras,
// duracao negativa, etc), NAO julgamento editorial do tamanho do roteiro.
const MIN_SLICE_DURATION_MS = 5 * 1000;         // 5 segundos
const MAX_SLICE_DURATION_MS = 60 * 60 * 1000;   // 1 hora
const MIN_SLICE_WORD_COUNT = 10;                // 10 palavras — pega so cues vazios
// Sem MAX_SLICE_WORD_COUNT — roteiros longos sao legitimos

// Tokens que representam silencio/pontuacao e sao ignorados na contagem de palavras
const SILENCE_TOKEN_REGEX = /^[\s.,;:!?\-–—…]+$/;

export class BatchSplitError extends Error {
  constructor(reason, details = {}) {
    super(reason);
    this.name = 'BatchSplitError';
    this.details = details;
  }
}

/**
 * Retorna as primeiras N sentinelas do catalogo, pra batch de N+1 roteiros.
 */
export function pickSentinels(numRoteiros) {
  if (numRoteiros < 2) {
    throw new BatchSplitError(`Batch precisa de >= 2 roteiros, recebido ${numRoteiros}`);
  }
  const needed = numRoteiros - 1;
  if (needed > SENTINEL_CATALOG.length) {
    throw new BatchSplitError(
      `Batch excede catalogo: ${numRoteiros} roteiros precisam de ${needed} sentinelas, so temos ${SENTINEL_CATALOG.length}`
    );
  }
  return SENTINEL_CATALOG.slice(0, needed);
}

/**
 * Monta o super-script concatenando N roteiros com sentinelas envelopadas em "...".
 * As reticencias criam cues de silencio no SRT word-level que usamos como borda de corte.
 */
export function buildSuperScript(scripts, sentinels) {
  if (scripts.length !== sentinels.length + 1) {
    throw new BatchSplitError(
      `Mismatch: ${scripts.length} roteiros requerem ${scripts.length - 1} sentinelas, recebido ${sentinels.length}`
    );
  }
  const partes = [];
  for (let i = 0; i < scripts.length; i++) {
    partes.push(scripts[i].trim());
    if (i < sentinels.length) {
      partes.push(`... ${sentinels[i]} ...`);
    }
  }
  return partes.join(' ');
}

// Normaliza texto pra comparacao tolerante: lowercase, sem acentos, so alfanumerico
function normalize(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Retorna true se o cue eh cue de "silencio" (reticencias, pontuacao isolada)
function isSilenceCue(cue) {
  return SILENCE_TOKEN_REGEX.test(cue.text);
}

/**
 * Procura uma sentinela num array de cues word-level.
 * Espera padrao: [silenceCue, ...tokensDaSentinela, silenceCue]
 * Retorna { precedingSilenceIdx, sentinelStartIdx, sentinelEndIdx, followingSilenceIdx }
 * ou lanca BatchSplitError.
 */
function encontrarSentinela(cues, sentinelPhrase, startSearchIdx = 0) {
  const alvo = normalize(sentinelPhrase);
  const matches = [];

  for (let i = startSearchIdx; i < cues.length; i++) {
    // Tenta casar janela de 1..6 tokens consecutivos
    let concat = '';
    for (let size = 1; size <= 6 && i + size <= cues.length; size++) {
      concat += normalize(cues[i + size - 1].text);
      if (!concat) break;  // todos silencio, pula
      if (concat === alvo) {
        matches.push({ start: i, end: i + size - 1 });
        break;
      }
      if (!alvo.startsWith(concat)) break;
    }
  }

  if (matches.length === 0) {
    throw new BatchSplitError(`Sentinela nao encontrada: "${sentinelPhrase}"`, {
      sentinel: sentinelPhrase, matches: 0,
    });
  }
  if (matches.length > 1) {
    throw new BatchSplitError(`Sentinela ambigua: "${sentinelPhrase}" encontrada ${matches.length}x`, {
      sentinel: sentinelPhrase, matches: matches.length,
    });
  }

  const { start, end } = matches[0];

  // Valida silencio antes
  if (start === 0 || !isSilenceCue(cues[start - 1])) {
    throw new BatchSplitError(`Sentinela "${sentinelPhrase}" sem silencio antes (cue ${start - 1})`, {
      sentinel: sentinelPhrase, reason: 'missing_preceding_silence',
    });
  }
  // Valida silencio depois
  if (end === cues.length - 1 || !isSilenceCue(cues[end + 1])) {
    throw new BatchSplitError(`Sentinela "${sentinelPhrase}" sem silencio depois (cue ${end + 1})`, {
      sentinel: sentinelPhrase, reason: 'missing_following_silence',
    });
  }

  return {
    precedingSilenceIdx: start - 1,
    sentinelStartIdx: start,
    sentinelEndIdx: end,
    followingSilenceIdx: end + 1,
  };
}

/**
 * Conta palavras reais (nao-silencio) num array de cues word-level.
 */
function contarPalavras(cues) {
  return cues.filter(c => !isSilenceCue(c)).length;
}

/**
 * Valida plausibilidade de uma fatia.
 * Lanca BatchSplitError se violar limites.
 */
function validarFatia(fatia, indice, total) {
  const duracaoMs = fatia.endMs - fatia.startMs;
  if (duracaoMs < MIN_SLICE_DURATION_MS || duracaoMs > MAX_SLICE_DURATION_MS) {
    throw new BatchSplitError(
      `Fatia ${indice + 1}/${total} com duracao invalida: ${(duracaoMs / 1000).toFixed(1)}s ` +
      `(esperado ${MIN_SLICE_DURATION_MS / 1000}-${MAX_SLICE_DURATION_MS / 1000}s)`,
      { indice, duracaoMs, total },
    );
  }

  const palavras = contarPalavras(fatia.wordCues);
  if (palavras < MIN_SLICE_WORD_COUNT) {
    throw new BatchSplitError(
      `Fatia ${indice + 1}/${total} com poucas palavras: ${palavras} ` +
      `(esperado >= ${MIN_SLICE_WORD_COUNT}, pode indicar split quebrado)`,
      { indice, palavras, total },
    );
  }
}

/**
 * Divide SRTs brutos em N fatias usando as sentinelas como ancoras.
 *
 * @param {string} wordSrtText      SRT word-level bruto da Talkify
 * @param {string} groupedSrtText   SRT grouped bruto da Talkify
 * @param {Array<string>} sentinels Sentinelas na ordem que foram injetadas (N-1 itens pra N scripts)
 * @param {object} [options]
 * @param {boolean} [options.strictValidation=true] Aplica validacoes de plausibilidade (duracao/palavras)
 * @returns {Array<{
 *   index: number,
 *   startMs: number,
 *   endMs: number,
 *   durationSec: number,
 *   wordCount: number,
 *   wordSrt: string,
 *   groupedSrt: string
 * }>}
 * @throws {BatchSplitError}
 */
export function splitBatchSrt(wordSrtText, groupedSrtText, sentinels, options = {}) {
  const { strictValidation = true } = options;

  const wordCues = parseSrtText(wordSrtText);
  const groupedCues = parseSrtText(groupedSrtText);

  if (wordCues.length === 0) {
    throw new BatchSplitError('SRT word-level vazio ou invalido');
  }

  const numSlices = sentinels.length + 1;

  // 1. Localiza cada sentinela em ordem. Cada uma tem que aparecer DEPOIS da anterior.
  const ancoras = [];
  let searchFrom = 0;
  for (let i = 0; i < sentinels.length; i++) {
    const anc = encontrarSentinela(wordCues, sentinels[i], searchFrom);
    ancoras.push(anc);
    searchFrom = anc.followingSilenceIdx + 1;  // proxima busca comeca depois dessa sentinela
  }

  // 2. Define bordas das fatias em ms
  //
  // Pra fatia i (0-indexed):
  //   startMs = (i == 0) ? 0 : end do silencio-depois da sentinela i-1
  //   endMs   = (i == last) ? last cue end : start do silencio-antes da sentinela i
  //
  // Isso cai dentro da janela de silencio — zero risco de clippar fala.
  const fatias = [];
  for (let i = 0; i < numSlices; i++) {
    const startMs = (i === 0)
      ? 0
      : wordCues[ancoras[i - 1].followingSilenceIdx].endMs;

    const endMs = (i === numSlices - 1)
      ? wordCues[wordCues.length - 1].endMs
      : wordCues[ancoras[i].precedingSilenceIdx].startMs;

    if (endMs <= startMs) {
      throw new BatchSplitError(
        `Fatia ${i + 1}/${numSlices} com borda invalida: start=${startMs}ms end=${endMs}ms`,
        { indice: i, startMs, endMs },
      );
    }

    const slicedWordCues = sliceCues(wordCues, startMs, endMs);
    const slicedGroupedCues = sliceCues(groupedCues, startMs, endMs);

    const fatia = {
      index: i,
      startMs,
      endMs,
      durationSec: (endMs - startMs) / 1000,
      wordCount: contarPalavras(slicedWordCues),
      wordCues: slicedWordCues,
      groupedCues: slicedGroupedCues,
    };
    fatias.push(fatia);
  }

  // 3. Validacoes de plausibilidade (pode desabilitar pra testes)
  if (strictValidation) {
    for (let i = 0; i < fatias.length; i++) {
      validarFatia(fatias[i], i, fatias.length);
    }
  }

  // 4. Serializa SRTs por fatia (renumerando a partir de 1)
  return fatias.map(f => ({
    index: f.index,
    startMs: f.startMs,
    endMs: f.endMs,
    durationSec: f.durationSec,
    wordCount: f.wordCount,
    wordSrt: serializeSrt(f.wordCues),
    groupedSrt: serializeSrt(f.groupedCues),
  }));
}
