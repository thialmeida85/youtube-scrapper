# YouTube Scraper

MVP em Node.js para extrair informacoes de canais e videos do YouTube:

- URL, nome, descricao, inscritos, views e quantidade de videos do canal
- ultimos videos do canal via playlist oficial de uploads
- titulo, canal, data de postagem e descricao
- visualizacoes, likes e comentarios
- duracao e dados basicos do video
- falas/transcricao quando houver legenda publica disponivel
- resumo com Groq a partir da transcricao quando `GROQ_API_KEY` estiver configurada, com fallback local simples
- falas importantes do apresentador destacadas entre aspas quando houver transcricao
- fonte do resumo: transcricao quando disponivel, descricao quando nao houver fala publica
- falas sinalizadas com aspas literais quando a transcricao contem termos potencialmente problemáticos
- fallback opcional de transcricao por audio com `yt-dlp`, `ffmpeg` e `GROQ_API_KEY` ou `OPENAI_API_KEY`
- exportacao em JSONL, JSON, CSV, Markdown, DOC e PDF pelo navegador
- API HTTP, interface web e CLI para video unico

## Requisitos

- Node.js 18 ou superior
- Uma chave da YouTube Data API v3

Crie ou ajuste o arquivo `.env`:

```env
YOUTUBE_API_KEY=sua_chave_aqui
GROQ_API_KEY=sua_chave_groq_aqui
GROQ_TRANSCRIBE_MODEL=whisper-large-v3-turbo
GROQ_SUMMARY_MODEL=llama-3.1-8b-instant
AUDIO_BITRATE=32k
AUDIO_SAMPLE_RATE=16000
AUDIO_CHANNELS=1
AUDIO_CHUNK_SECONDS=600
OPENAI_API_KEY=sua_chave_openai_aqui
OPENAI_TRANSCRIBE_MODEL=whisper-1
PORT=3000
```

## Rodar interface web

```bash
npm start
```

Depois abra:

```text
http://localhost:3000
```

## Deploy no Render

Este projeto usa Docker no Render para garantir `ffmpeg` e `yt-dlp` no ambiente de producao.

1. Crie um repositorio no GitHub, GitLab ou Bitbucket.
2. Envie este projeto para o repositorio.
3. No Render, crie um novo Blueprint usando o arquivo `render.yaml`.
4. Preencha os secrets solicitados:
   - `YOUTUBE_API_KEY`
   - `GROQ_API_KEY`
5. Aplique o Blueprint e monitore o deploy.

O servico usa `/health` como health check. As variaveis de audio ficam no `render.yaml` com padroes de arquivo pequeno: MP3 mono, 16 kHz e 32 kbps.

Observacao: transcricoes longas podem demorar porque o app baixa o audio, compacta, divide em partes quando necessario e transcreve tudo antes de responder. Se isso ficar pesado em producao, o proximo refinamento natural e separar a transcricao em worker/background job.

## Usar API

```text
GET /api/channel?url=https://www.youtube.com/@HANDLE&limit=25
GET /api/channel?id=UC_CHANNEL_ID&limit=50&transcripts=true
GET /api/channel?url=@HANDLE&mode=yearly-sample&perYear=10&maxScan=20000
GET /api/channel?url=@HANDLE&mode=yearly-sample&perYear=12&yearFrom=2018&yearTo=2024&maxScan=20000
GET /api/analyze?url=https://www.youtube.com/watch?v=VIDEO_ID
GET /api/analyze?id=VIDEO_ID
GET /api/status
```

Exemplo:

```bash
curl "http://localhost:3000/api/analyze?id=VIDEO_ID"
```

Para IA, prefira exportar em `JSONL` quando quiser processar item por item, ou `Markdown` quando quiser colar/ler o relatorio inteiro em um chat.

No modo `Amostra por ano`, o sistema varre a playlist de uploads ate `maxScan` videos e escolhe ate `perYear` videos por ano, tentando espalhar os resultados por meses diferentes. Use `yearFrom` e `yearTo` para limitar o periodo. Esse modo pode demorar mais em canais grandes.

## Usar CLI

```bash
npm run cli -- "https://www.youtube.com/watch?v=VIDEO_ID" --pretty
npm run cli -- VIDEO_ID --out resultado.json --pretty
```

## Observacoes importantes

O YouTube Data API fornece metadados e estatisticas publicas. As falas do video dependem de legendas publicas disponiveis pelo endpoint de transcricao do YouTube; videos sem legenda, com legenda bloqueada, limitados por regiao/rate limit ou que exigem autorizacao do dono podem retornar transcricao vazia.

A API oficial de captions do YouTube geralmente exige OAuth e permissao do dono do canal para baixar arquivos de legenda. Este MVP prioriza consulta por chave de API para metadados e tenta legenda publica como conveniencia.

Quando `GROQ_API_KEY` ou `OPENAI_API_KEY` estiver configurada e `yt-dlp`/`ffmpeg` estiverem instalados, o app baixa somente o audio do video no menor formato disponivel, compacta para MP3 mono 16 kHz/32 kbps por padrao e transcreve a partir dele. Se o audio compacto ainda ficar grande, o app divide em partes e transcreve o video completo. A Groq e usada primeiro quando as duas chaves existem. Se a transcricao por audio falhar, o app ainda pode tentar legenda publica como fallback.

Quando `GROQ_API_KEY` estiver configurada, o resumo e gerado pela Groq a partir da transcricao quando existir ou da descricao quando nao existir. O export inclui o resumo, palavras-chave, falas importantes entre aspas e uma analise comportamental textual sobre tom comunicacional, emocao aparente, estilo, sinais de personalidade e nuances. Essa analise e uma inferencia a partir da transcricao; para leitura acustica real de tom de voz, ritmo, volume e emocao seria necessario um modelo que analise audio diretamente. Se a Groq falhar, o app usa o resumo local extrativo e inclui a nota da falha no export.
