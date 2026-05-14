# automacao-bbb

Pipeline automatizado de producao de videos de reality show (BBB, La Casa de los Famosos, La Casa de los Campeones, etc). Recebe roteiros via webhook HTTP, gera audio narrado com Talkify TTS, mapeia imagens de participantes baseado nos nomes ditos na narracao, e renderiza o video final com legendas karaoke via FFmpeg NVENC.

## O que ele faz, em linha geral

```
Roteiro (texto)
   |
   v
[Talkify TTS]  -->  audio.mp3 + SRT word-level
   |
   v
[Image Map]    -->  "quando o audio diz 'Jordana', mostra foto da Jordana"
   |
   v
[FFmpeg]       -->  video.mp4 com Ken Burns + legendas amarelas karaoke
```

## Features principais

- **Webhook HTTP** recebe roteiros prontos do SaaS Syntax (ou de qualquer sistema via `curl`)
- **Batch Talkify** — agrupa ate 10 roteiros num unico job TTS, reduzindo gasto de creditos em 10x
- **Canais dinamicos** — cada canal tem sua propria pasta com `participants.json` + `images/`, sem editar codigo
- **Upscale AI** — pre-processa imagens de baixa resolucao com Real-ESRGAN antes de usar no video
- **Checkpoint** — se o pipeline quebra no meio, retoma de onde parou sem refazer etapas ja completas
- **Render NVENC** — usa GPU NVIDIA pra renderizar videos em tempo real

## Como comecar

1. Leia [docs/INSTALL.md](docs/INSTALL.md) e siga o passo a passo
2. Depois, leia [docs/CANAIS.md](docs/CANAIS.md) pra aprender a criar canais novos
3. Pra integracao com o Syntax ou envio manual via curl, veja [docs/WEBHOOK.md](docs/WEBHOOK.md)
4. Problemas? [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Estrutura de pastas

```
automacao-bbb/
├── README.md              Este arquivo
├── docs/                  Documentacao completa
├── src/                   Codigo fonte (pipeline + utils)
├── scripts/               Scripts utilitarios (upscale, check, etc)
├── assets/
│   ├── images/
│   │   ├── bbb/           Imagens dos participantes do BBB
│   │   └── lcf/           Imagens dos participantes do La Casa de los Famosos
│   ├── backgrounds/       Background padrao (fallback neutro)
│   └── fonts/             Fontes pras legendas (se precisar)
├── tools/
│   └── realesrgan/        Binario do Real-ESRGAN (upscale AI, GPU Vulkan)
├── package.json
└── .env.example           Template de configuracao
```

## Requisitos

- **Windows** (testado no 10/11)
- **Node.js** 20 ou superior
- **FFmpeg** no PATH (com suporte a NVENC idealmente)
- **GPU NVIDIA** com suporte a Vulkan (pro Real-ESRGAN) e NVENC (pro render)
- **Chaves de API**: Talkify (obrigatoria), Supabase (opcional, so se usar Syntax). WenOX so eh necessaria pro modo CLI legacy.
- **~10 GB** de espaco livre em disco pra temp + output

## Comandos uteis (npm scripts)

```bash
npm run check           # valida setup antes do primeiro uso
npm run webhook         # sobe o webhook HTTP na porta 5580
npm run upscale -- <path>   # roda upscale AI em uma pasta de imagens
npm start "Titulo"      # roda o pipeline completo pra 1 video via CLI (modo legacy)
```

Pra mais detalhes de cada comando, veja `docs/`.

## Licenca e uso

Projeto pessoal pra producao de conteudo YouTube. Nao distribua publicamente sem autorizacao.
