const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const AUDIO_COMMAND_TIMEOUT_MS = Number(process.env.AUDIO_COMMAND_TIMEOUT_MS || 0);
const TRANSCRIPTION_TIMEOUT_MS = Number(process.env.TRANSCRIPTION_TIMEOUT_MS || 10 * 60 * 1000);
const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES || 25 * 1024 * 1024);
const AUDIO_BITRATE = process.env.AUDIO_BITRATE || "32k";
const AUDIO_SAMPLE_RATE = process.env.AUDIO_SAMPLE_RATE || "16000";
const AUDIO_CHANNELS = process.env.AUDIO_CHANNELS || "1";
const AUDIO_CHUNK_SECONDS = Number(process.env.AUDIO_CHUNK_SECONDS || 600);

function canUseAudioTranscription() {
  return Boolean(
    (process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY) &&
      findExecutable("yt-dlp") &&
      findExecutable("ffmpeg"),
  );
}

async function transcribeVideoAudio(video, options = {}) {
  if (!process.env.GROQ_API_KEY && !process.env.OPENAI_API_KEY) {
    return unavailable("GROQ_API_KEY ou OPENAI_API_KEY nao configurada para transcricao por audio.");
  }

  const ytDlpPath = findExecutable("yt-dlp");
  const ffmpegPath = findExecutable("ffmpeg");

  if (!ytDlpPath) {
    return unavailable("yt-dlp nao encontrado. Instale ou coloque yt-dlp.exe ao lado do executavel.");
  }

  if (!ffmpegPath) {
    return unavailable("ffmpeg nao encontrado. Instale ou coloque ffmpeg.exe ao lado do executavel.");
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-scraper-"));
  const outputTemplate = path.join(workDir, `${video.id}.%(ext)s`);
  const audioPath = path.join(workDir, `${video.id}.mp3`);
  const compactAudioPath = path.join(workDir, `${video.id}.compact.mp3`);

  try {
    await runCommand(ytDlpPath, [
      "--no-playlist",
      "--format",
      "worstaudio/worst",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "9",
      "--ffmpeg-location",
      path.dirname(ffmpegPath),
      "--output",
      outputTemplate,
      video.url,
    ], AUDIO_COMMAND_TIMEOUT_MS);

    if (!fs.existsSync(audioPath)) {
      return unavailable("Audio nao foi gerado pelo yt-dlp.");
    }

    await runCommand(ffmpegPath, [
      "-y",
      "-i",
      audioPath,
      "-vn",
      "-ac",
      AUDIO_CHANNELS,
      "-ar",
      AUDIO_SAMPLE_RATE,
      "-b:a",
      AUDIO_BITRATE,
      compactAudioPath,
    ], AUDIO_COMMAND_TIMEOUT_MS);

    if (!fs.existsSync(compactAudioPath)) {
      return unavailable("Audio compactado nao foi gerado pelo ffmpeg.");
    }

    const chunks = await prepareTranscriptionChunks(ffmpegPath, compactAudioPath, workDir);
    const results = [];

    for (let index = 0; index < chunks.length; index += 1) {
      const result = process.env.GROQ_API_KEY
        ? await createGroqTranscription(chunks[index], options)
        : await createOpenAiTranscription(chunks[index], options);
      results.push({ result, offset: index * AUDIO_CHUNK_SECONDS });
    }

    const segments = mergeTranscriptionSegments(results);
    const text = segments.map((segment) => segment.text).join(" ").trim();

    return {
      available: Boolean(text),
      language: results.find((item) => item.result.language)?.result.language || null,
      source: process.env.GROQ_API_KEY ? "groq-audio" : "openai-audio",
      text,
      segments,
      note: text
        ? chunks.length > 1
          ? `Audio completo transcrito em ${chunks.length} partes compactas.`
          : null
        : "A API de transcricao nao retornou texto.",
    };
  } catch (error) {
    return unavailable(`Falha na transcricao por audio: ${error.message}`);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function prepareTranscriptionChunks(ffmpegPath, compactAudioPath, workDir) {
  const audioBytes = fs.statSync(compactAudioPath).size;

  if (audioBytes <= MAX_AUDIO_BYTES) {
    return [compactAudioPath];
  }

  const chunkPattern = path.join(workDir, "chunk-%03d.mp3");
  await runCommand(ffmpegPath, [
    "-y",
    "-i",
    compactAudioPath,
    "-f",
    "segment",
    "-segment_time",
    String(AUDIO_CHUNK_SECONDS),
    "-c",
    "copy",
    chunkPattern,
  ], AUDIO_COMMAND_TIMEOUT_MS);

  const chunks = fs
    .readdirSync(workDir)
    .filter((file) => /^chunk-\d+\.mp3$/.test(file))
    .sort()
    .map((file) => path.join(workDir, file))
    .filter((file) => fs.statSync(file).size > 0);

  if (!chunks.length) {
    throw new Error("Nao consegui dividir o audio compacto para transcricao.");
  }

  return chunks;
}

async function createGroqTranscription(audioPath, options = {}) {
  const form = new FormData();
  const audio = fs.readFileSync(audioPath);
  const model = process.env.GROQ_TRANSCRIBE_MODEL || options.groqModel || "whisper-large-v3-turbo";

  form.append("file", new Blob([audio], { type: "audio/mpeg" }), path.basename(audioPath));
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  form.append("timestamp_granularities[]", "segment");

  const response = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: form,
    },
    TRANSCRIPTION_TIMEOUT_MS,
  );

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error?.message || "Erro na API de transcricao da Groq.");
  }

  return payload;
}

async function createOpenAiTranscription(audioPath, options = {}) {
  const form = new FormData();
  const audio = fs.readFileSync(audioPath);
  const model = process.env.OPENAI_TRANSCRIBE_MODEL || options.model || "whisper-1";

  form.append("file", new Blob([audio], { type: "audio/mpeg" }), path.basename(audioPath));
  form.append("model", model);
  form.append("response_format", "verbose_json");

  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    },
    TRANSCRIPTION_TIMEOUT_MS,
  );

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error?.message || "Erro na API de transcricao da OpenAI.");
  }

  return payload;
}

function normalizeSegments(result) {
  if (Array.isArray(result.segments) && result.segments.length) {
    return result.segments
      .map((segment) => ({
        start: Number(segment.start || 0),
        duration: Number(segment.end || 0) - Number(segment.start || 0),
        text: String(segment.text || "").trim(),
      }))
      .filter((segment) => segment.text);
  }

  return splitSentences(result.text || "").map((text) => ({
    start: null,
    duration: null,
    text,
  }));
}

function mergeTranscriptionSegments(results) {
  const merged = [];

  for (const { result, offset } of results) {
    const segments = normalizeSegments(result);
    for (const segment of segments) {
      merged.push({
        ...segment,
        start: Number.isFinite(Number(segment.start)) ? Number(segment.start) + offset : segment.start,
      });
    }
  }

  return merged;
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function unavailable(note) {
  return {
    available: false,
    language: null,
    source: "openai-audio",
    text: "",
    segments: [],
    note,
  };
}

function findExecutable(name) {
  for (const candidate of executableCandidates(name)) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function executableCandidates(name) {
  const executableName = process.platform === "win32" ? `${name}.exe` : name;
  const envName = `${name.toUpperCase().replace("-", "_")}_PATH`;
  const exeDir = path.dirname(process.execPath);
  const pathDirs = String(process.env.PATH || "").split(path.delimiter);

  return [
    process.env[envName],
    path.join(process.cwd(), executableName),
    path.join(exeDir, executableName),
    ...pathDirs.map((dir) => path.join(dir, executableName)),
  ];
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const timeout = timeoutMs
      ? setTimeout(() => {
          if (settled) {
            return;
          }

          settled = true;
          child.kill();
          reject(new Error(`${path.basename(command)} excedeu ${Math.round(timeoutMs / 1000)} segundos.`));
        }, timeoutMs)
      : null;

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${path.basename(command)} saiu com codigo ${code}.`));
    });
  });
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Requisicao excedeu ${Math.round(timeoutMs / 1000)} segundos.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  canUseAudioTranscription,
  transcribeVideoAudio,
};
