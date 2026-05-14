# Webhook HTTP e integracao com Syntax

O webhook e o jeito **recomendado** de usar o pipeline. Ele fica rodando em background, recebe roteiros via HTTP, agrupa em batches pra economizar creditos Talkify, e renderiza os videos em serie.

## Arquitetura: Syntax (frontend) <-> webhook local

```
┌─────────────────────────┐                ┌──────────────────────────┐
│  Browser do usuario     │                │  Maquina do usuario      │
│                         │                │                          │
│  Site Syntax (HTTPS)    │                │  webhook local em :5580  │
│  https://syntax.app     │                │  (npm run webhook)       │
│         │               │                │         ▲                │
│         │ JS faz fetch  │  HTTP POST     │         │                │
│         └───────────────┼────────────────┼─────────┘                │
│                         │  localhost:5580│                          │
└─────────────────────────┘                └──────────────────────────┘
```

**Como funciona** (sem precisar de ngrok, tunnel ou IP publico):

1. O usuario abre o site do Syntax no navegador (Chrome recomendado)
2. O usuario configura no Syntax: URL do webhook = `http://localhost:5580/webhook/roteiro`
3. Quando ele clica em "enviar pro editor", o **JavaScript do site Syntax** (que esta rodando no navegador dele) faz `fetch('http://localhost:5580/webhook/roteiro', ...)`
4. O navegador alcanca `localhost` da PROPRIA maquina dele — funciona porque o JS executa **no navegador**, nao no servidor do Syntax
5. O webhook local recebe, processa, gera o video em `output/`

**Por que isso funciona:**
- O webhook tem CORS aberto (`Access-Control-Allow-Origin: *`)
- Browsers como Chrome permitem `http://localhost` mesmo vindo de site `https://`, especificamente pra esse caso (development/local apps)
- Nenhuma requisicao precisa atravessar a internet — tudo fica entre o navegador e a maquina do usuario

**Pre-requisitos no lado do usuario:**
- Webhook rodando (`npm run webhook`)
- Chrome (ou outro browser que permita `http://localhost` de origem `https://`)
- Maquina onde roda o webhook = mesma maquina onde o navegador esta aberto

**Erros tipicos:**
- "Mixed content blocked" no console do browser — o browser bloqueou. **Solucao:** adicione `http://localhost:5580` na lista de permissoes em `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, ou use o Chrome em modo desenvolvedor
- "Failed to fetch" — webhook nao esta rodando. **Solucao:** abra um CMD na pasta da automacao e rode `npm run webhook`

## Como subir o servidor

```cmd
cd C:\automacao-bbb
npm run webhook
```

Voce vai ver algo como:

```
============================================================
  Webhook Server rodando em http://localhost:5580
  Batch: max=10 wait=300s
  Supabase: ATIVO (sync com Syntax Kanban)

  Endpoints:
    POST /webhook/roteiro   — receber roteiro do Syntax
    POST /scheduler/flush   — forcar flush do batch atual
    GET  /health            — health check
    GET  /status            — status detalhado
============================================================
```

O servidor fica rodando ate voce dar `Ctrl+C`. Pode deixar numa janela separada enquanto trabalha.

## Endpoints

### `GET /health`
Teste rapido pra saber se o servidor esta respondendo.
```cmd
curl http://localhost:5580/health
```
Resposta: `{"status":"ok"}`

### `GET /status`
Estado detalhado do scheduler e da fila de render.
```cmd
curl http://localhost:5580/status
```
Resposta exemplo:
```json
{
  "rendering": true,
  "render_queue_length": 3,
  "current_render": "Teste BBB Colombia",
  "scheduler": {
    "pending": 2,
    "flushing": false,
    "oldest_age_sec": 45,
    "max_batch": 10,
    "max_wait_sec": 300
  }
}
```

### `POST /webhook/roteiro`
O endpoint principal. Recebe 1 roteiro e coloca no scheduler.

**Headers:**
```
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "titulo": "Titulo do video",
  "roteiro": "Texto completo do roteiro narrado",
  "contexto": "Contexto opcional (salvo junto com o roteiro na pasta externa)",
  "idioma": "pt-BR",
  "canal_pasta": "D:\\Canais\\BBBColombia",
  "ciclo": "Ciclo 1",
  "numero_video": 5,
  "pipeline_item_id": "uuid-do-kanban",
  "batch": true
}
```

**Campos:**

| Campo | Obrigatorio? | Descricao |
|---|---|---|
| `titulo` | SIM | Titulo do video. Vira o nome do arquivo final. |
| `roteiro` | SIM | Texto que a Talkify vai narrar. Idealmente 1000-2000 palavras. |
| `contexto` | nao | Texto auxiliar. Salvo em `contexto.txt` na pasta do canal. Nao vai pra narracao. |
| `idioma` | nao | `pt-BR` (default) ou `es-ES`. Determina voz Talkify. |
| `canal_pasta` | nao | Caminho absoluto da pasta raiz do canal dinamico. Se omitido, usa canal legado. |
| `ciclo` | nao | Nome do ciclo/temporada. So usado pra organizar pasta externa. |
| `numero_video` | nao | Numero sequencial do video. Usado pro nome do arquivo final. |
| `pipeline_item_id` | nao | UUID do card no Kanban Supabase. Se presente, webhook patcha o status do card quando termina. |
| `batch` | nao | `true` (default): entra no scheduler e espera companheiros. `false`: processa imediato sem agrupar (gasta 1 credito na hora). |

**Resposta de sucesso (HTTP 200):**
```json
{
  "ok": true,
  "titulo": "Titulo do video",
  "slug": "titulo_do_video",
  "batch": true,
  "scheduler_pending": 3,
  "mensagem": "Roteiro enfileirado — aguardando batch ou timeout"
}
```

### `POST /scheduler/flush`
Forca o scheduler a disparar o batch agora, com o que tiver na fila. Util no fim do dia ou pra emergencia.
```cmd
curl -X POST http://localhost:5580/scheduler/flush
```

## Como funciona o batch TTS

O Talkify limita a **40 jobs/dia**, mas cada job pode ter ate 150k caracteres. O sistema agrupa ate 10 roteiros (default) num unico job pra reduzir o gasto de creditos em 10x.

**Fluxo:**

1. Voce manda 10 POSTs `/webhook/roteiro` (cada um um roteiro diferente). Eles nao processam na hora — entram no scheduler.
2. Quando o scheduler atinge 10 roteiros (`BATCH_MAX`) OU passa 5 minutos (`BATCH_WAIT_MS`) desde o primeiro, ele dispara o batch:
   - Concatena os 10 roteiros num super-script com sentinelas separadoras
   - Manda 1 unica request na Talkify (= 1 credito gasto)
   - Recebe um audio gigante + SRT
   - Corta o audio nas sentinelas em 10 pedacos individuais
   - Cada pedaco vai pra fila de render
3. A fila de render serializa os 10 videos (1 FFmpeg por vez, pra nao saturar a GPU)
4. Os mp4 vao parecendo em `output/` e sao copiados pra pasta do canal

**Vantagens do batch:**
- 10x menos creditos Talkify gastos
- Um unico round-trip HTTP reduz overhead
- Audio mais consistente entre videos (mesma voz, mesma sessao)

**Quando NAO usar batch:**
- Video urgente que nao pode esperar o scheduler acumular
- Teste/debug isolado
- Neste caso, mande com `"batch": false` no payload e o pipeline processa imediato como antes.

## Integracao com Syntax SaaS

Se voce usa o Syntax Kanban:

### 1. Configure a URL do webhook no Syntax
No painel Syntax:
- Settings > Webhook > URL = `http://localhost:5580/webhook/roteiro`
- Se o Syntax esta em outro computador, use o IP da maquina onde roda o webhook (ex: `http://192.168.0.10:5580/webhook/roteiro`)

### 2. Configure as credenciais Supabase no `.env`
```
SUPABASE_URL=https://seuprojeto.supabase.co
SUPABASE_ANON_KEY=eyJhbGci...
```
Sem isso, o webhook ainda recebe os POSTs mas **nao patcha** o status dos cards (modo standalone).

### 3. O que acontece quando um card do Kanban e "enviado"
1. Syntax faz POST `/webhook/roteiro` com o payload completo (incluindo `pipeline_item_id`)
2. Webhook responde 200 na hora (o batch e assincrono)
3. Quando o video fica pronto, webhook faz `PATCH` no Supabase mudando o card pra `stage=editing, status=on_track`
4. No Kanban do Syntax, o card move sozinho pra proxima coluna

## Integracao via curl manual (sem Syntax)

Se voce nao usa Syntax e quer testar/usar manualmente:

```cmd
curl -X POST http://localhost:5580/webhook/roteiro ^
  -H "Content-Type: application/json" ^
  -d "{\"titulo\":\"Jordana explodiu\",\"roteiro\":\"Gente, ontem aconteceu uma coisa absurda...\",\"batch\":false}"
```

Sem `pipeline_item_id`, o Supabase patch e pulado. Sem `canal_pasta`, usa canal legado (`bbb`).

## Variaveis de ambiente relevantes

No `.env`:

| Var | Default | Descricao |
|---|---|---|
| `WEBHOOK_PORT` | 5580 | Porta do servidor HTTP |
| `BATCH_MAX` | 10 | Quantos roteiros agrupar por batch |
| `BATCH_WAIT_MS` | 300000 | Tempo max (ms) de espera antes de disparar batch parcial |
| `SUPABASE_URL` | — | URL do projeto Supabase do Syntax |
| `SUPABASE_ANON_KEY` | — | Chave anon do Supabase |

## Dicas

- **Mantenha o webhook rodando em um terminal dedicado.** Deixa aberto o dia inteiro, os logs fluem ali.
- **Monitore com `/status`.** Pode abrir num navegador: `http://localhost:5580/status`
- **Fim de dia**: se sobraram 3 roteiros na fila e voce nao quer esperar os 5 minutos, roda `curl -X POST http://localhost:5580/scheduler/flush`
- **Porta ocupada?** Mude `WEBHOOK_PORT=5581` no `.env` e suba de novo
- **Render travado?** Veja `/status`. Se `current_render` nao muda por muito tempo, pode ser um video especifico com problema — veja os logs do CMD do webhook
