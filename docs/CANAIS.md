# Como criar um canal novo

O sistema suporta dois tipos de canais:

1. **Legado** (hardcoded no codigo): `bbb` e `lcf`. Usam `assets/images/bbb/` e `assets/images/lcf/` e dicionarios em `src/config.js`. Funcionam out-of-the-box, nao mexe em codigo.
2. **Dinamico** (recomendado pra canais novos): voce cria uma pasta fora do projeto com `participants.json`, `images/` e opcionalmente `backgrounds/`. O sistema carrega tudo sozinho, **sem precisar mexer em codigo**.

Este guia mostra como criar um canal dinamico do zero. Vamos usar **BBB Colombia** como exemplo.

## Passo a passo

### 1. Crie a pasta raiz do canal

Em qualquer HD/pasta, crie a estrutura:

```
D:\Canais\BBBColombia\
```

Boas praticas:
- Nome sem espacos nem acentos (simplifica a vida em Windows)
- Pasta fora do projeto — pode ficar em outro disco, OneDrive, etc
- Se voce usa o Syntax SaaS, anote esse caminho porque vai ser o `canal_pasta` no payload

### 2. Crie o `participants.json`

Dentro da pasta raiz, crie o arquivo `D:\Canais\BBBColombia\participants.json`:

```json
{
  "show": "BBB Colombia 2026",
  "language": "es-ES",
  "participants": {
    "karen":     { "aliases": ["kary", "karencita"] },
    "sebastian": { "aliases": ["seba", "sebas"] },
    "valentina": { "aliases": ["vale", "valen"] },
    "matheo":    { "aliases": ["mat"] }
  }
}
```

**Regras:**
- `show`: nome amigavel do programa (aparece nos logs)
- `language`: `pt-BR` ou `es-ES` ou similar. Determina qual voz Talkify vai usar (PT ou ES).
- `participants`: **chave = nome canonico em minusculo**. Os aliases sao apelidos que a narracao pode usar.
- O **nome canonico** tem que bater com o **inicio do nome do arquivo de imagem** (ver proximo passo).
- Evite apelidos muito curtos ou palavras comuns — "cae" vai casar com "Caela" tanto quanto com "cae" em espanhol (3a pessoa do verbo caer). Prefira apelidos unicos.

### 3. Crie a pasta `images/` e adicione as fotos

```
D:\Canais\BBBColombia\images\
  karen_01.jpg
  karen_brava.jpg
  karen_sorrindo.jpg
  sebastian_01.jpg
  sebastian_revoltado.png
  valentina_01.jpg
  matheo_01.webp
```

**Regras de nomeacao:**
- O nome do arquivo tem que **comecar com o nome canonico** do dicionario acima (minusculo, espacos viram underscore)
- Depois do nome, voce pode colocar qualquer sufixo: numeros, descricao, o que quiser
- Formatos aceitos: `.jpg`, `.jpeg`, `.png`, `.webp`
- Um mesmo participante pode ter varias fotos — o pipeline escolhe uma aleatoria cada vez que o nome e mencionado
- **NAO use apelido no nome do arquivo**: `kary_01.jpg` NAO vai ser encontrada. So o canonico (`karen_01.jpg`) funciona.

**Quantas fotos por participante?**
- Minimo 3-4 pra ter variedade
- Ideal 10-20 pra o video nao ficar repetitivo
- Maximo ilimitado — nao afeta performance

### 4. (Opcional) Crie a pasta `backgrounds/`

Se voce NAO criar, o pipeline usa o `default.jpg` global (`assets/backgrounds/default.jpg`), que e um gradient escuro neutro.

Se quiser um background especifico do canal (logo do programa, foto da casa, etc):

```
D:\Canais\BBBColombia\backgrounds\
  default.jpg
  fallback_01.jpg
  fallback_02.jpg
```

- `default.jpg` e usado como fallback primario
- Os outros entram no pool e o pipeline sorteia entre eles quando precisa de fundo (gaps sem menção de personagem)
- Formato: 1920x1080 recomendado

### 5. (Opcional) Upscale as imagens

Se suas fotos estao em baixa resolucao (~720p ou menor), o video final pode ficar borrado. Rode o upscale AI:

```cmd
cd C:\automacao-bbb
npm run upscale -- "D:\Canais\BBBColombia\images"
```

Esse comando **nao toca na pasta original**. Ele:
1. Cria um backup completo em `D:\Canais\BBBColombia\images_backup_<timestamp>\`
2. Cria uma nova pasta `D:\Canais\BBBColombia\images_upscaled\` com as versoes 4x
3. Mostra um relatorio

Depois de abrir algumas imagens no Explorer pra conferir visualmente, **voce mesmo** (manualmente) renomeia:
- `images` -> `images_720p_backup`
- `images_upscaled` -> `images`

Pronto. As imagens novas sao usadas no proximo video.

> **Importante:** o primeiro `npm run upscale` sem flag `--apply` e **dry-run** (so mostra o plano, nao escreve nada). Pra executar de verdade, tem que adicionar `--apply`:
> ```cmd
> npm run upscale -- "D:\Canais\BBBColombia\images" --apply
> ```

### 6. Configure o Syntax (ou use curl manual)

#### Se voce usa o Syntax Kanban

No painel do Syntax, ao criar o canal, defina:
- **Pasta local**: `D:\Canais\BBBColombia` (o caminho exato da pasta raiz)
- **URL webhook**: `http://localhost:5580/webhook/roteiro` (a maquina onde roda o webhook)

Quando o Syntax enviar um roteiro, o payload automaticamente inclui `canal_pasta: "D:\\Canais\\BBBColombia"` e o pipeline carrega tudo desse canal.

#### Se nao usa Syntax (envio manual via curl)

Quando for enviar um roteiro via curl, inclua o campo `canal_pasta` apontando pra pasta:

```cmd
curl -X POST http://localhost:5580/webhook/roteiro ^
  -H "Content-Type: application/json" ^
  -d "{\"titulo\":\"Teste BBB Colombia\",\"roteiro\":\"Karen discutiu com Sebastian ontem a noite...\",\"canal_pasta\":\"D:\\\\Canais\\\\BBBColombia\",\"idioma\":\"es-ES\"}"
```

### 7. Teste

Mande um roteiro curto de teste pelo canal novo. Assista ao video e confira:
- O audio esta na voz certa (espanhol vs portugues)
- As imagens dos personagens aparecem quando a narracao fala o nome
- O background nos gaps iniciais e o seu default (e nao do outro canal)

Se alguma imagem nao aparece quando deveria, verifique:
1. O nome do arquivo comeca com o nome canonico do dicionario?
2. O dicionario tem o aliases correto? (Se a narracao disser "Kary" mas o aliases so tem "karen", nao vai bater.)
3. A pasta `images/` tem mesmo as fotos? (`dir D:\Canais\BBBColombia\images`)

## Pasta de saida dos videos

Quando o pipeline termina de renderizar um video pra um canal dinamico, ele:
1. Salva em `output/{slug-do-titulo}.mp4` (pasta do projeto — padrao)
2. Se o Syntax enviou `canal_pasta` + `ciclo` + `numero_video`, COPIA tambem pra `{canal_pasta}\{ciclo}\trabalho\video {N}\video {N} - {titulo}.mp4`

Exemplo: `D:\Canais\BBBColombia\Ciclo 1\trabalho\video 5\video 5 - KAREN EXPLODE NO CONFESSIONARIO.mp4`

## Resumo rapido

| Passo | O que fazer |
|---|---|
| 1 | Criar pasta `D:\Canais\<NomeCanal>\` |
| 2 | Criar `participants.json` com dicionario |
| 3 | Criar `images/` e colocar fotos (nome canonico no inicio do arquivo) |
| 4 | (opcional) `backgrounds/` com fundos do canal |
| 5 | (opcional) `npm run upscale -- <pasta>` pra melhorar qualidade |
| 6 | Configurar Syntax ou curl manual com `canal_pasta` |
| 7 | Enviar roteiro de teste |

**Zero alteracao no codigo-fonte do projeto** pra criar canal novo.
