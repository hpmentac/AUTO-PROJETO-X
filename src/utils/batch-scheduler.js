/**
 * Scheduler que acumula jobs TTS e dispara em batch.
 *
 * Regras de flush (o que vier primeiro):
 *   - Atingiu MAX_BATCH jobs acumulados               → batch imediato
 *   - Job mais antigo >= MAX_WAIT_MS E fila >= MIN_ON_TIMEOUT → batch
 *   - User chamou POST /scheduler/flush               → batch/single forcado
 *   - User enviou com "batch": false                  → single imediato
 *
 * PROTECAO CONTRA DESPERDICIO DE CREDITO:
 * Se o timer de MAX_WAIT_MS bater mas a fila por channel ainda nao atingiu
 * MIN_ON_TIMEOUT (default 2), o timer **re-arma** por mais MAX_WAIT_MS em vez
 * de ir pra single flush (que gastaria 1 credito por roteiro sozinho).
 *
 * Jobs ficam "presos" na fila ate:
 *   (a) chegar mais companheiros e atingir MIN_ON_TIMEOUT ou MAX_BATCH
 *   (b) user chamar flush manual
 *   (c) user re-enviar com "batch": false
 *
 * Agrupa por channel (pt/es) pra nao misturar vozes no mesmo job Talkify.
 */

import { logger } from './logger.js';

export class BatchScheduler {
  /**
   * @param {object} opts
   * @param {number} opts.maxBatch        Tamanho maximo do batch (padrao 10)
   * @param {number} opts.maxWaitMs       Janela maxima pro job mais antigo esperar (padrao 30 min)
   * @param {number} opts.minOnTimeout    Grupo minimo pra disparar flush por timeout (padrao 2).
   *                                      Se timer bater e grupo < minOnTimeout, timer re-arma.
   * @param {(jobs: Array) => Promise<void>} opts.onBatchFlush
   * @param {(job: object) => Promise<void>} opts.onSingleFlush
   */
  constructor({
    maxBatch = 10,
    maxWaitMs = 30 * 60 * 1000,
    minOnTimeout = 2,
    onBatchFlush,
    onSingleFlush,
  }) {
    this.maxBatch = maxBatch;
    this.maxWaitMs = maxWaitMs;
    this.minOnTimeout = minOnTimeout;
    this.onBatchFlush = onBatchFlush;
    this.onSingleFlush = onSingleFlush;
    this.pending = [];
    this.flushTimer = null;
    this.flushing = false;
  }

  /**
   * Enfileira um job. Se o job tem batch:false, dispara direto via onSingleFlush.
   */
  enqueue(job) {
    if (job.batch === false) {
      logger.info(`Scheduler: job "${job.titulo || job.title}" com bypass (batch:false) — single imediato`);
      this.onSingleFlush(job).catch(err => logger.error(`Single flush erro: ${err.message}`));
      return;
    }

    this.pending.push({ job, enqueuedAt: Date.now() });
    const label = job.titulo || job.title || '(sem titulo)';
    logger.info(`Scheduler: enfileirado "${label}" [${this.pending.length}/${this.maxBatch}]`);

    // Gatilho por tamanho — batch imediato
    if (this.pending.length >= this.maxBatch) {
      logger.info(`Scheduler: maxBatch (${this.maxBatch}) atingido, flush imediato`);
      this._flush(false);
      return;
    }

    // Arma timer so se for o primeiro da rodada
    if (!this.flushTimer && this.pending.length === 1) {
      this._armTimer();
    }
  }

  _armTimer() {
    this.flushTimer = setTimeout(() => {
      this._onTimeout();
    }, this.maxWaitMs);
  }

  /**
   * Callback do timer. Decide se flusha ou re-arma baseado no tamanho
   * do grupo por channel (protegendo contra single flush acidental).
   */
  _onTimeout() {
    this.flushTimer = null;
    if (this.pending.length === 0) return;

    // Agrupa por channel pra avaliar o menor grupo
    const grupos = this._agruparPorChannel(this.pending.map(e => e.job));
    const menorGrupo = Math.min(...Object.values(grupos).map(g => g.length));
    const totalJobs = this.pending.length;
    const idadeMaisAntigo = Math.floor((Date.now() - this.pending[0].enqueuedAt) / 1000);

    if (menorGrupo < this.minOnTimeout) {
      // Nao tem roteiros suficientes por channel — re-arma timer
      logger.warn(`Scheduler: \u26a0\ufe0f  timeout bateu (${Math.floor(this.maxWaitMs / 60000)}min) mas fila tem grupos pequenos (menor=${menorGrupo} < minOnTimeout=${this.minOnTimeout})`);
      logger.warn(`Scheduler:   total=${totalJobs} jobs, canais=${Object.keys(grupos).join(',')}, idade do mais antigo=${idadeMaisAntigo}s`);
      logger.warn(`Scheduler:   RE-ARMANDO timer por mais ${Math.floor(this.maxWaitMs / 60000)}min pra evitar single flush (gastaria credito Talkify)`);
      logger.warn(`Scheduler:   Pra forcar agora: POST /scheduler/flush`);
      logger.warn(`Scheduler:   Pra enviar isolado intencional: re-envie com "batch": false no payload`);
      this._armTimer();
      return;
    }

    logger.info(`Scheduler: timeout atingido (${Math.floor(this.maxWaitMs / 60000)}min) com ${totalJobs} jobs, disparando flush`);
    this._flush(false);
  }

  /**
   * Flush forcado (via /scheduler/flush). Ignora protecao de minOnTimeout —
   * se o user pediu, vai direto, mesmo que tenha 1 roteiro so (vira single).
   */
  flush() {
    logger.info(`Scheduler: flush MANUAL forcado`);
    this._flush(true);
  }

  _flush(forced) {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pending.length === 0) return;
    if (this.flushing) {
      logger.warn('Scheduler: flush ignorado — outro flush em andamento');
      return;
    }

    // Pega no maximo maxBatch roteiros por flush — evita estourar o limite de
    // chars do Talkify quando a fila acumulou muitos itens durante um flush
    // anterior em andamento.
    const batch = this.pending.splice(0, this.maxBatch);
    this.flushing = true;

    logger.info(`Scheduler: flush iniciado com ${batch.length} roteiros (fila restante: ${this.pending.length})`);
    const grupos = this._agruparPorChannel(batch.map(e => e.job));

    (async () => {
      for (const [channel, jobs] of Object.entries(grupos)) {
        if (jobs.length >= 2) {
          logger.info(`Scheduler: flush batch channel=${channel} jobs=${jobs.length}`);
          try {
            await this.onBatchFlush(jobs);
          } catch (err) {
            logger.error(`Scheduler: batch flush falhou (${err.message}), fallback pra single`);
            for (const j of jobs) {
              try { await this.onSingleFlush(j); }
              catch (e) { logger.error(`Fallback single falhou "${j.titulo || j.title}": ${e.message}`); }
            }
          }
        } else {
          // Grupo de 1 — so vai single se for flush forcado pelo user
          if (forced) {
            logger.warn(`Scheduler: flush manual com grupo de 1 channel=${channel} — indo single (gasta 1 credito)`);
            try { await this.onSingleFlush(jobs[0]); }
            catch (err) { logger.error(`Single flush falhou: ${err.message}`); }
          } else {
            // Nao forcado e < 2 — nao deveria chegar aqui porque _onTimeout protege.
            // Mas por seguranca extra, re-enfileira em vez de gastar credito acidentalmente.
            logger.warn(`Scheduler: PROTECAO: grupo de 1 em flush nao-forcado, RE-ENFILEIRANDO channel=${channel}`);
            this.pending.push({ job: jobs[0], enqueuedAt: Date.now() });
          }
        }
      }
      this.flushing = false;

      // Se chegaram novos jobs durante o flush, processa agora
      if (this.pending.length > 0) {
        if (this.pending.length >= this.maxBatch) {
          logger.info(`Scheduler: ${this.pending.length} jobs pendentes apos flush — re-flush imediato`);
          this._flush(false);
        } else if (!this.flushTimer) {
          this._armTimer();
        }
      }
    })();
  }

  /**
   * Agrupa jobs por channel + voiceId. Batch Talkify usa UMA voz por job,
   * entao jobs com vozes diferentes precisam ir em batches separados
   * (ou como single se ficarem sozinhos no grupo).
   *
   * Chave composta: "{channel}::{voiceId}". Se job nao tem voiceId (payload
   * legacy), chave vira "{channel}::default" e o fallback por channel decide
   * a voz no TTS.
   */
  _agruparPorChannel(jobs) {
    const grupos = {};
    for (const j of jobs) {
      const ch = j.channel || 'bbb';
      const vid = j.voiceId || 'default';
      const key = `${ch}::${vid}`;
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(j);
    }
    return grupos;
  }

  status() {
    return {
      pending: this.pending.length,
      flushing: this.flushing,
      oldestAgeMs: this.pending.length ? Date.now() - this.pending[0].enqueuedAt : 0,
      maxBatch: this.maxBatch,
      maxWaitMs: this.maxWaitMs,
      minOnTimeout: this.minOnTimeout,
    };
  }
}
