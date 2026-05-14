# Tutorial — Como usar a automação de espiritualidade dentro do Syntax Desktop

> **Audiência:** sócio operando a automação dele dentro do Syntax. Tempo total de setup: ~20 minutos. Depois disso é só usar.

## 1. Instalar o Syntax Desktop

1. Baixa o instalador mais recente:
   <https://github.com/thiagordn01/syntax-desktop-releases/releases/latest>
   - Procura por `Syntax-Desktop-X.Y.Z-setup.exe` (~103 MB)
2. Roda o setup → escolhe pasta (default OK) → instala
3. Abre o Syntax Desktop pelo atalho do desktop ou do menu Iniciar
4. **Login** com o email + senha que o Thiago cadastrou pra você no Supabase

> A automação de espiritualidade **já vem embutida** no instalador. Não precisa baixar nada separado. No primeiro boot, o app extrai automaticamente pra `%APPDATA%\Syntax Desktop\automations\espiritualidade\`.

## 2. Cadastrar a entry da automação

A 1ª vez que abre o app, a UI ainda não sabe qual automação rodar. Você cadastra uma vez e fica salvo.

1. Sidebar → **Configurações** (ícone de engrenagem)
2. Card **Automações** → botão **"Nova automação"**
3. Preenche:
   - **Nome**: `Espiritualidade`
   - **Pasta da automação**: clica **"usar pasta padrão"** → vai virar `C:\Users\<seu-user>\AppData\Roaming\Syntax Desktop\automations\espiritualidade`
   - **Entry script**: `src/webhook-server.js`
   - **Porta**: `5581`
4. Salva
5. Marca essa entry como **ativa** (botão "ativar" se houver outras cadastradas)

## 3. Configurar credenciais (uma vez só)

1. Sidebar → **Configurações** → card **APIs**
2. **Talkify**: cola sua `TALKIFY_API_KEY` (formato `tk_...`)
3. **Claude (WenOX)**: se for usar o gerador de roteiros do Syntax pra criar narrações via Claude, cola a key. Se for usar só Gemini ou só mandar roteiros prontos, pode pular.

> O Syntax injeta essas chaves no env do processo Node automaticamente quando inicia a automação. **Você não precisa mexer em `.env` manualmente.**

## 4. Subir a automação

1. Sidebar → **Automação**
2. Clica **▶ Iniciar**
3. Confere no log: deve aparecer `Webhook Server rodando em http://localhost:5581`
4. Status no topo: **RODANDO** (verde)

Se der erro, copia o log e manda pro Thiago — provavelmente é alguma key faltando ou conflito de porta.

## 5. Preparar os assets locais

A automação precisa de 2 coisas externas pra cada canal:

### 5.1 PNG do avatar (figura/espírito)
- Imagem em **PNG transparente** (fundo alpha) — vertical, idealmente sem texto colado
- Exemplos: silhueta de filósofo, símbolo místico, retrato estilizado
- A automação escala automaticamente pra 70% da altura do vídeo (~1344px de altura num canvas 1080×1920)
- Salva em qualquer pasta do seu PC (ex: `D:\meus-avatares\carl-jung.png`)

> ✅ Aceita PNG e JPEG (desde 0.21.4 o pipeline normaliza qualquer formato). Mas PNG transparente fica visualmente melhor.

### 5.2 Pasta de backgrounds (slideshow)
- Pasta com **MP4 e/ou imagens** (PNG/JPG/WebP)
- Resolução: idealmente 1920×1080 ou maior (a automação escala+crop pra 1080×1920)
- Quantidade: 10-50 itens funciona bem (a automação embaralha em segmentos de 8 segundos cada)
- Salva em uma pasta dedicada (ex: `D:\backgrounds-espiritualidade\`)
- Pode ser cenas de natureza, neblina, abstrações, time-lapses — depende do canal

> ⚠️ **NÃO mistura** vídeos com SAR (pixel aspect ratio) muito esquisito. Se vier de DaVinci/Premiere com SAR 1:1 está OK. Screenshots de stream com SAR 300:300 podem dar problema — desde 0.21.4 temos defesa contra isso mas evita por garantia.

## 6. Cadastrar um canal

1. Sidebar → **Canais** → botão **+ Novo canal**
2. Preenche dados básicos:
   - **Nome**: ex: `Espiritualidade - Carl Jung`
   - **Idioma**: pt-BR (ou es-ES, en-US...)
   - **Pasta local**: onde os vídeos vão ser entregues (ex: `D:\Canais\Carl Jung\`)
3. Cria o canal
4. Abre o canal recém-criado
5. Card **Webhook**:
   - **URL**: `http://127.0.0.1:5581/webhook/roteiro`
   - **Habilitado**: ✅
6. Card **"Assets do vídeo"** *(novo a partir da 0.21.1)*:
   - **PNG do avatar**: clica "Escolher..." → seleciona o `.png` do avatar pra esse canal
   - **Pasta de backgrounds**: clica "Escolher..." → seleciona a pasta com os MP4/PNG
   - Salva

> 💡 Você pode ter vários canais cada um com PNG + backgrounds diferentes. Ex: canal "Jung" usa avatar do Jung, canal "Mitologia Grega" usa um avatar mítico. Tudo isolado.

## 7. Cadastrar um agente

Agente = "persona" do narrador. Define a voz Talkify, prompts de premissa/roteiro, e quantos roteiros vão num batch TTS.

1. Sidebar → **Agentes** → **+ Novo**
2. Preenche:
   - **Nome**: ex: `Narrador Espiritual`
   - **Idioma**: igual ao canal
   - **Duração**: minutos típicos do roteiro (ex: 5)
   - **Batch (Talkify)**: quantos roteiros agrupar num único job Talkify (default 13; até 50). **Vídeos curtos (~3min) cabem até 30-50; vídeos longos (~10min), 13 é o teto.**
3. Card **Prompt de premissa**: instrução de sistema pro Claude/Gemini gerar a premissa
4. Card **Prompt de roteiro**: instrução pra gerar o roteiro completo
5. Card **Voz** (botão "voz →" na listagem): escolhe voiceId Talkify + efeitos (tempo, pitch, reverb, etc)
6. Salva

Volta na página do canal → escolhe esse agente no card **Agente**.

## 8. Gerar o primeiro vídeo

### Modo A — Roteiro pronto (você cola o texto)

1. Página do canal → kanban → clica em **+** na coluna **Ideia**
2. Cola um título → cria o card
3. Clica no card → cola o roteiro completo na coluna **Roteiro**
4. Seleciona o card → botão **"Enviar ao editor"**

### Modo B — Geração automática via Claude/Gemini

1. Sidebar → **Gerador de roteiros**
2. Escolhe o canal e o agente
3. Cola um título por linha (1 ou vários em lote)
4. Provider: Claude / Gemini / Qwen
5. Toggle **"Enviar ao editor via webhook ao finalizar"** ON (importante se quer que o vídeo seja gerado direto após o roteiro)
6. Botão **"Adicionar à fila"**

### O que acontece depois

1. Roteiros viram cards na coluna "Roteiro"
2. Conforme cada termina, webhook é disparado pra `http://127.0.0.1:5581`
3. Servidor da automação enfileira no scheduler de batch
4. Quando o batch enche (ex: 13 roteiros do mesmo agente), dispara **1 único job Talkify** pra todos
5. Áudios cortados em N fatias
6. Cada vídeo renderiza: slideshow embaralhado + PNG do avatar com pêndulo + legendas karaoke
7. MP4 final entregue em `<pasta-do-canal>/<...>/teste.mp4`
8. Card no kanban migra automaticamente pra "Edição" → "Publicado"

## 9. Acompanhar o progresso

- **Tela Automação** → mostra:
  - Status da fila (quantos esperando batch, quantos rendering)
  - Logs em tempo real
  - Render queue + tempo estimado

- **Tela Kanban do canal** → cards movem entre colunas conforme processam

- **Pasta local do canal** → MP4s aparecem quando prontos

## 10. Atualizações automáticas

O Syntax tem **auto-update**. Quando o Thiago publicar uma versão nova:
- Você abre o app, vê um banner no topo: "Atualização disponível"
- Aceita → baixa em background → reinicia o app
- Pronto, versão nova rodando

Não precisa baixar nada manualmente.

## Resolução de problemas comuns

### "Refused to connect" no console
CSP do navegador bloqueando porta. Já resolvido na 0.21.3 (cobre 5580-5589). Se persistir, atualiza o Syntax.

### "png_path obrigatorio"
O canal não tem PNG configurado. Vai no card "Assets do vídeo" e escolhe um. Já resolvido na 0.21.5 com fallback pra `.env`, mas o ideal é configurar por canal.

### "Talkify: creditos esgotados (409)"
Conta Talkify sem crédito. Recarrega lá no painel do Talkify e a automação retoma sozinha quando reiniciar.

### Render falha com "NVENC incompatible client key" / "no capable devices"
Driver NVIDIA atualizou e ficou fora de sync com o FFmpeg. Atualiza o FFmpeg ou downgrade do driver. Já resolvido na 0.20.4: fallback automático pra CPU (libx264 ultrafast) quando isso acontece — só fica mais lento, não quebra.

### O processo cai com "Error: write EOF"
Resolvido na 0.20.1. Se aparecer em versão nova, manda o log pro Thiago.

### Vídeo sai todo preto / nada renderizado
Verifica:
- Os backgrounds existem na pasta apontada
- O PNG existe no path apontado
- A pasta local do canal existe e tem permissão de escrita

## Comandos úteis (caso queira diagnosticar via terminal)

A pasta da automação (`%APPDATA%\Syntax Desktop\automations\espiritualidade\`) tem `npm scripts`:

```bash
# valida o setup (FFmpeg, env vars, etc)
npm run check

# sobe o webhook server manualmente (sem Syntax)
npm run webhook

# converte assets pesados (.mov gigantes) pra MP4 otimizado
npm run convert
```

## Suporte

- Bugs / sugestões: cola o log + screenshot e manda pro Thiago no Telegram/Discord
- O log persistente da automação fica em `%APPDATA%\Syntax Desktop\automations\espiritualidade.log` (sobrevive a restart do app — útil pra diagnóstico)

## Versão do tutorial

Atualizado em 2026-05-14 para Syntax Desktop 0.21.5+.
