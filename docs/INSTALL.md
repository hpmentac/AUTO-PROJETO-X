# Instalacao — automacao-bbb

Guia completo de instalacao em Windows. Leva cerca de 30 minutos na primeira vez.

## 1. Pre-requisitos (instalar ANTES de abrir o pacote)

### 1.1 Node.js 20+
- Baixe em: https://nodejs.org/ (versao LTS, 20.x ou superior)
- Instale com opcoes padrao
- Confirme abrindo um CMD novo e rodando:
  ```cmd
  node --version
  npm --version
  ```
  Esperado: v20.x.x ou superior

### 1.2 FFmpeg no PATH
- Baixe em: https://www.gyan.dev/ffmpeg/builds/ (escolha `ffmpeg-release-full.7z`)
- Extraia em `C:\ffmpeg\`
- Adicione `C:\ffmpeg\bin` ao PATH do Windows:
  1. Menu Iniciar > "variaveis de ambiente" > "Editar as variaveis de ambiente do sistema"
  2. Botao "Variaveis de Ambiente..."
  3. Em "Variaveis do sistema", selecione `Path` e clique "Editar..."
  4. "Novo" e cole `C:\ffmpeg\bin`
  5. OK, OK, OK, **feche e reabra todos os terminais**
- Confirme:
  ```cmd
  ffmpeg -version
  ffprobe -version
  ```
  Ambos devem responder.

### 1.3 GPU NVIDIA (recomendado)
- Pro **render rapido** do video (`h264_nvenc`), voce precisa de uma GPU NVIDIA recente
- Pro **upscale AI** (`realesrgan-ncnn-vulkan`), precisa de GPU com suporte Vulkan (qualquer GPU de 2014 pra ca)
- Se nao tiver GPU, o projeto ainda roda mas MUITO mais devagar (encoding CPU)

### 1.4 Espaco em disco
- Reserve **pelo menos 10 GB livres** na pasta onde voce vai extrair
- Cada video renderizado ocupa ~20-30 MB
- A pasta `temp/` acumula cache rapidamente se nao limpar

## 2. Extrair o pacote

1. Receba o arquivo `automacao-bbb-v1.0.zip` (via Drive, WeTransfer, etc)
2. Clique direito > "Extrair Tudo..."
3. Escolha um caminho SEM espacos nem acentos se possivel. Bons exemplos:
   - `C:\automacao-bbb\`
   - `D:\projetos\automacao-bbb\`
4. Espere a extracao (~460 MB, demora 30s-2min)

## 3. Instalar dependencias Node.js

1. Abra CMD ou PowerShell
2. Entre na pasta extraida:
   ```cmd
   cd C:\automacao-bbb
   ```
3. Rode:
   ```cmd
   npm install
   ```
4. Espere 1-3 minutos. No fim voce ve `added N packages`

## 4. Configurar as credenciais (.env)

1. Na pasta do projeto, copie o template:
   ```cmd
   copy .env.example .env
   ```
2. Abra o `.env` no bloco de notas ou VSCode
3. Preencha as chaves OBRIGATORIAS:
   - `TALKIFY_API_KEY` — chave Talkify (usada pra gerar audio + legenda)
   - `TALKIFY_VOICE_ID_PT` — UUID da voz em portugues
   - `TALKIFY_VOICE_ID_ES` — UUID da voz em espanhol
4. Se for usar o Syntax Kanban (provavelmente vai), preencha tambem:
   - `SUPABASE_URL` — URL do projeto Supabase do Syntax
   - `SUPABASE_ANON_KEY` — chave anon do mesmo projeto
5. Pode deixar VAZIO:
   - `WENOX_API_KEY` — so eh necessaria se voce for usar o modo CLI legacy
     (`npm start "Titulo"`) pra gerar roteiros direto na maquina. Pelo Syntax,
     o roteiro vem pronto e essa chave nunca eh usada.
6. Salve e feche

> **IMPORTANTE:** nunca commit/compartilhe o `.env` — ele contem credenciais. Se precisar trocar de maquina, copie de forma segura.

## 5. Validar o setup

```cmd
npm run check
```

Este comando verifica:
- Node.js version
- FFmpeg e ffprobe no PATH
- NVENC disponivel (warning se nao)
- `.env` com todas as chaves obrigatorias preenchidas
- Pastas `assets/images/bbb/`, `assets/images/lcf/`, `assets/backgrounds/`, `src/prompts/` existem
- `tools/realesrgan/realesrgan-ncnn-vulkan.exe` existe
- Contagem de imagens por canal

**Saida esperada:** todos os checks em verde. Se aparecer algo em vermelho, corrija antes de avancar.

## 6. Primeiro teste

1. Suba o webhook:
   ```cmd
   npm run webhook
   ```
   Esperado: ve o banner com `Webhook Server rodando em http://localhost:5580`.

2. Em outro terminal, teste o health:
   ```cmd
   curl http://localhost:5580/health
   ```
   Esperado: `{"status":"ok"}`

3. Envie 1 roteiro de teste (pode copiar este):
   ```cmd
   curl -X POST http://localhost:5580/webhook/roteiro ^
     -H "Content-Type: application/json" ^
     -d "{\"titulo\":\"Teste Instalacao\",\"roteiro\":\"Gente, essa e a primeira vez que rodo o automacao BBB. Jordana ficou nervosa hoje, Samira tentou acalmar, Tadeu levou todo mundo pro confessionario. Deu ate briga.\",\"batch\":false}"
   ```

4. Veja os logs do webhook rodando as 4 etapas. No fim, deve aparecer um `.mp4` em `output/teste_instalacao.mp4`

5. Abra o video no player pra conferir. Se tocar com audio + imagens + legendas, **tudo funcionando**.

## Proximos passos

- Criar seu primeiro canal dinamico: [CANAIS.md](CANAIS.md)
- Entender o webhook e integracao Syntax: [WEBHOOK.md](WEBHOOK.md)
- Problemas? [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
