# automacao-espiritualidade

Pipeline automatizado de produção de vídeos com narração TTS para nichos de espiritualidade (Carl Jung, esoterismo, filosofia mística, etc). Recebe roteiros via webhook HTTP, gera áudio narrado com Talkify TTS em batch (1 crédito por N roteiros), monta um slideshow de backgrounds com PNG overlay animado (efeito pêndulo senoidal) e renderiza o vídeo final com legendas karaoke via FFmpeg.

## O que ele faz, em linha geral

```
Roteiro (texto)
   |
   v
[Talkify TTS Batch]  -->  audio.mp3 + SRT word-level (1 crédito por até ~50 roteiros)
   |
   v
[Layout]             -->  N segmentos de background embaralhados (8s cada)
   |
   v
[FFmpeg]             -->  vídeo final 9:16 com PNG avatar + pêndulo + legendas karaoke
```

## Features principais

- **Webhook HTTP** recebe roteiros prontos do Syntax Desktop (ou de qualquer sistema via `curl`)
- **Batch Talkify** — agrupa até 50 roteiros num único job TTS, reduzindo gasto de créditos drasticamente
- **PNG overlay animado** — avatar/figura central com efeito pêndulo senoidal (amplitude e frequência configuráveis)
- **Background slideshow** — backgrounds aleatorizados em segmentos curtos, vídeos ou imagens
- **Legendas karaoke** — destaque palavra por palavra em ASS (cores configuráveis no `.env`)
- **Checkpoint** — se o pipeline quebra no meio, retoma de onde parou sem refazer etapas já completas
- **Render NVENC** — usa GPU NVIDIA pra renderizar vídeos em tempo real (fallback CPU automático)

## Como começar

1. Leia [docs/INSTALL.md](docs/INSTALL.md) e siga o passo a passo
2. Configure `.env` a partir de `.env.example` — preencha `TALKIFY_API_KEY` no mínimo
3. Adicione seus backgrounds em uma pasta qualquer (ex: `D:\meus-backgrounds\`) — pode ser MP4 ou PNG
4. Adicione um PNG de avatar (transparente) em uma pasta qualquer (ex: `D:\meus-avatares\`)
5. Pra integração com o Syntax ou envio manual via curl, veja [docs/WEBHOOK.md](docs/WEBHOOK.md)

## Estrutura de pastas

```
automacao-espiritualidade/
├── README.md              Este arquivo
├── docs/                  Documentação completa
├── src/                   Código fonte
│   ├── webhook-server.js  HTTP server (porta 5581 default)
│   ├── index.js           runSingle() — orquestra os 4 stages
│   ├── config.js          Defaults + validação de env
│   ├── pipeline/
│   │   ├── 02-tts.js          TTS single-mode (fallback)
│   │   ├── 02b-tts-batch.js   TTS batch (1 request → N áudios)
│   │   ├── 03-layout.js       Monta segmentos de background
│   │   └── 04-video.js        FFmpeg render com pêndulo + legendas
│   └── utils/
│       ├── batch-scheduler.js  Fila + agrupamento + flush
│       ├── batch-splitter.js   Sentinelas + super-script + split SRT
│       ├── srt-parser.js       Parse/slice/serialize SRT
│       ├── ass-generator.js    Karaoke ASS gen
│       ├── ffmpeg-helpers.js   slugify, ensureDirs, hasNvenc
│       ├── state.js            Checkpoint JSON por job
│       └── ...
├── scripts/               Scripts utilitários (check, convert assets)
├── assets/
│   └── png/               PNGs de exemplo (avatares pré-bundlados)
├── package.json
└── .env.example           Template de configuração
```

## Requisitos

- **Windows** (testado no 10/11), Linux ou macOS
- **Node.js** 20 ou superior
- **FFmpeg + ffprobe** no PATH (com suporte a NVENC idealmente)
- **GPU NVIDIA** com NVENC (opcional — fallback CPU funciona)
- **Chaves de API**: Talkify (obrigatória), Supabase (opcional, só se usar Syntax)
- **~10 GB** de espaço livre em disco pra temp + output

## Comandos úteis (npm scripts)

```bash
npm run check           # valida setup antes do primeiro uso
npm run webhook         # sobe o webhook HTTP (porta WEBHOOK_PORT do .env, default 5580)
npm run convert         # converte backgrounds .mov/.mp4 grandes em formato otimizado
```

Pra mais detalhes de cada comando, veja `docs/`.

## Integração com Syntax Desktop

Este pipeline foi pensado pra rodar como **2ª automação** dentro do Syntax Desktop (junto com a BBB de realities). Quando empacotado no Syntax, fica em `%APPDATA%\Syntax Desktop\automations\espiritualidade\` e é gerenciado pelo lifecycle do Syntax (start/stop/log via UI).

Porta default no contexto do Syntax: **5581** (pra não colidir com a BBB que roda em 5580).

## Licença e uso

Projeto pessoal pra produção de conteúdo. Não distribuir publicamente sem autorização.
