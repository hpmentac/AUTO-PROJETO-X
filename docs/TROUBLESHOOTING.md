# Troubleshooting — erros comuns

## Instalacao

### "node" nao e reconhecido como comando
- Node.js nao esta instalado OU o PATH nao foi atualizado
- **Solucao:** baixe e instale o Node.js 20+ em https://nodejs.org/, **feche e reabra** todos os terminais

### "ffmpeg" nao e reconhecido
- FFmpeg nao esta no PATH
- **Solucao:** veja passo 1.2 do [INSTALL.md](INSTALL.md). Apos adicionar ao PATH, feche TODOS os terminais e abra um novo (o PATH so atualiza em novos processos)
- **Teste:** `ffmpeg -version` deve responder

### `npm install` trava ou erra
- Conexao lenta, NPM com cache ruim, antivirus interferindo
- **Solucao 1:** `npm cache clean --force` e rodar de novo
- **Solucao 2:** desativar antivirus temporariamente (alguns bloqueiam `sharp` e binarios nativos)
- **Solucao 3:** rodar com `npm install --verbose` pra ver onde trava

## Rodando o webhook

### `Error: listen EADDRINUSE: address already in use 0.0.0.0:5580`
- A porta 5580 ja esta ocupada por outro processo (um webhook antigo que nao morreu, ou outro app)
- **Solucao 1** — trocar porta:
  ```cmd
  set WEBHOOK_PORT=5581
  npm run webhook
  ```
- **Solucao 2** — matar o processo que esta na porta:
  ```cmd
  netstat -ano | findstr :5580
  ```
  Copie o PID da ultima coluna e rode:
  ```cmd
  taskkill /PID <numero> /F
  ```
  Tente subir o webhook de novo.

### Webhook aborta com "Validacao de ambiente falhou"
- Faltando FFmpeg, TALKIFY_API_KEY ou pastas obrigatorias (`assets/images/...`)
- **Solucao:** rode `npm run check` pra ver exatamente o que esta faltando

### `TALKIFY_API_KEY nao configurada no .env`
- Voce nao preencheu a chave Talkify, ou ainda esta com placeholder
- **Solucao:** edite `.env`, coloque a chave real, salve, suba o webhook de novo
- **OBS:** essa eh a unica chave de API obrigatoria. WENOX_API_KEY pode ficar vazia (so eh usada no modo CLI legacy).

### Browser bloqueou: "Mixed Content" ou "Blocked by CORS policy"
- O Syntax (HTTPS) tentou alcancar o webhook (HTTP localhost) e o browser bloqueou
- **Solucao 1 (recomendada):** use Chrome ou Edge — eles geralmente permitem `localhost` mesmo de origem `https://`
- **Solucao 2:** habilite explicitamente em `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, adicione `http://localhost:5580` e reinicie o browser
- **Solucao 3:** rode o Chrome com flag `--disable-web-security --user-data-dir=C:\temp\chrome-dev` (so pra teste, nao use pra navegacao normal)

### Browser diz: "Failed to fetch" / "ERR_CONNECTION_REFUSED"
- O webhook nao esta rodando
- **Solucao:** abra um CMD na pasta da automacao e rode `npm run webhook`. Confira que aparece o banner com `localhost:5580`

## Talkify

### `Talkify: creditos esgotados (409)`
- Voce bateu o limite de 40 jobs/dia da Talkify
- **Solucao:** espere reiniciar (geralmente meia-noite horario da conta) OU use menos creditos amanha (use batch ao maximo)
- **Preven cao:** rode com `BATCH_MAX=10` ou mais alto, nunca com `batch: false` se possivel

### Talkify retorna timeout
- Job Talkify demorou mais que 3 min
- **Solucao:** aumente `TALKIFY_TIMEOUT` no `.env` (valor em ms, default 180000 = 3min)
- Se persistir, pode ser instabilidade da Talkify — tente mais tarde

### Batch TTS quarentenado
Log parecido:
```
Batch batch_1776262182474 QUARENTENADO: Fatia 1/10 com poucas palavras: 5
```
- O splitter achou algo errado na saida da Talkify (sentinela nao encontrada, fatia muito curta, etc)
- Os artefatos brutos (audio, SRTs) estao salvos em `temp/batch_<id>/raw/` — o credito ja foi gasto mas voce pode reaproveitar
- **Solucao:** rode o rescue-batch:
  ```cmd
  node scripts/rescue-batch.js temp/batch_<id>
  ```
  Ele le os arquivos brutos, tenta o splitter de novo (com a versao atual do codigo, que pode ter bugs corrigidos), corta o audio e enfileira os videos no render. Zero credito gasto.

### Fallback automatico pra single mode gastou creditos extras
- Se o batch explodiu e voce nao estava olhando, o scheduler pode ter caido no fallback single mode e gastado 1 credito por roteiro ao inves de 1 no batch
- **Preven cao:** monitore os logs do webhook. Se aparecer "batch flush falhou", pare o webhook imediatamente antes do fallback rodar, corrija o problema e rode rescue-batch.

## Render

### Video renderizado muito lento (minutos por video)
- NVENC (GPU encoding) nao foi detectado, esta usando libx264 (CPU)
- **Teste:** `ffmpeg -encoders | findstr nvenc` — deve listar `h264_nvenc`
- **Solucao:** atualize os drivers da NVIDIA (precisa de driver recente + GPU compativel)
- **Fallback:** se nao tem GPU NVIDIA, aceita a lentidao ou troca de maquina

### "Error: spawn ffmpeg ENOENT"
- FFmpeg nao esta no PATH
- **Solucao:** veja [INSTALL.md](INSTALL.md) passo 1.2

### Imagens aparecem no video mas o participante certo nao
- O nome do arquivo nao comeca com o nome canonico do dicionario, OU o dicionario nao tem esse participante
- **Solucao:** veja [CANAIS.md](CANAIS.md) secao "regras de nomeacao"

### Video renderizado mas audio/imagens dessincronizadas
- Raro. Quase sempre e um problema no SRT que a Talkify retornou (bug deles)
- **Solucao:** apague `temp/<slug-do-video>/` e rode de novo — pipeline vai baixar SRT de novo da Talkify
- Se persistir em varios videos, pode ser bug no splitter. Me avise.

## Upscale

### `Real-ESRGAN nao encontrado em: tools\realesrgan\realesrgan-ncnn-vulkan.exe`
- O binario nao esta no lugar
- **Solucao 1:** confira que `tools/realesrgan/realesrgan-ncnn-vulkan.exe` existe
- **Solucao 2:** se voce extraiu o pacote mas a pasta `tools/realesrgan/` esta vazia ou incompleta, re-extraia o zip

### Upscale trava em uma imagem especifica
- Formato nao padrao, imagem corrompida, ou GPU indisponivel
- **Solucao:** mate o processo (Ctrl+C), veja qual imagem travou nos logs, pule ela manualmente renomeando-a temporariamente, rode de novo

### Upscale nao melhorou a imagem
- Se a fonte e muito ruim (imagem de 6-10 KB), o Real-ESRGAN nao consegue reconstruir detalhes que nao existem
- **Solucao:** substitua a imagem fonte por uma melhor manualmente, antes de rodar upscale

## Pasta cheia / disco lotado

### `temp/` ocupando muitos GB
- O pipeline acumula cache de cada video processado
- **Solucao:** apague subpastas antigas manualmente. Pra limpar tudo que ja foi renderizado com sucesso:
  ```cmd
  rmdir /S /Q temp
  ```
  (vai recriar sozinho nas proximas execucoes)

### `output/` ocupando muitos GB
- Cada `.mp4` pronto fica la (alem de ter sido copiado pra pasta do canal)
- **Solucao:** mova ou delete os videos ja enviados pro YouTube. A pasta do canal externa (`D:\Canais\...`) mantem a copia oficial.

## Log e debugging

### "Onde vejo os logs?"
O webhook loga tudo no terminal em que foi iniciado (`npm run webhook`). Nao tem arquivo de log dedicado. Dicas:
- Deixe o terminal grande pra ver historico
- Se precisar capturar: `npm run webhook > webhook.log 2>&1` redireciona tudo pra arquivo
- Pra logs mais detalhados: `LOG_LEVEL=debug npm run webhook`

### "Como sei qual foi o problema de um video especifico?"
- Procure o nome dele nos logs do webhook
- Olhe o `temp/<slug-do-video>/state.json` — mostra em qual stage parou (`pending`, `script_done`, `tts_done`, `images_done`, `video_done`, `error`)
- Se tem `error` no state, abre o JSON e le a mensagem

## Se nada funciona

1. Rode `npm run check` e manda o output pro dono do projeto
2. Copie os ultimos 20-30 linhas do log do webhook
3. Diga qual comando voce rodou e o que esperava vs o que aconteceu
