const STOP_WORDS = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "da",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "essa",
  "esse",
  "esta",
  "este",
  "eu",
  "foi",
  "mais",
  "mas",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "para",
  "por",
  "que",
  "se",
  "um",
  "uma",
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "you",
]);

const SUMMARY_TIMEOUT_MS = Number(process.env.SUMMARY_TIMEOUT_MS || 30 * 1000);

async function summarizeVideo(video, transcript) {
  const localSummary = summarizeVideoLocal(video, transcript);

  if (!process.env.GROQ_API_KEY) {
    return localSummary;
  }

  try {
    return await summarizeWithGroq(video, transcript, localSummary);
  } catch (error) {
    return {
      ...localSummary,
      provider: "local",
      note: `Resumo Groq indisponivel: ${error.message}`,
    };
  }
}

function summarizeVideoLocal(video, transcript) {
  const baseText = transcript?.text || video.description || "";
  const summary = summarizeText(baseText);
  const keywords = extractKeywords(`${video.title} ${video.description} ${baseText}`);
  const importantQuotes = transcript?.available ? extractImportantQuotes(transcript.segments) : [];
  const behavioralAnalysis = buildLocalBehavioralAnalysis(baseText, transcript);

  return {
    short: summary || fallbackSummary(video),
    keywords,
    importantQuotes,
    behavioralAnalysis,
    source: transcript?.available ? "transcript" : "description",
    provider: "local",
  };
}

async function summarizeWithGroq(video, transcript, fallback) {
  const baseText = transcript?.text || video.description || "";

  if (!baseText.trim()) {
    return fallback;
  }

  const model = process.env.GROQ_SUMMARY_MODEL || "llama-3.1-8b-instant";
  const payload = {
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Voce analisa transcricoes de videos do YouTube em portugues do Brasil. Responda somente JSON valido com as chaves short, keywords, important_quotes e behavioral_analysis.",
      },
      {
        role: "user",
        content: [
          `Titulo: ${video.title || "-"}`,
          `Canal: ${video.channelTitle || "-"}`,
          `Publicado em: ${video.publishedAt || "-"}`,
          `Fonte: ${transcript?.available ? "transcricao" : "descricao"}`,
          "",
          "Crie um resumo bem feito em 4 a 7 frases, focado no que o apresentador diz. Extraia ate 12 palavras-chave. Em important_quotes, coloque ate 6 falas literais importantes do apresentador, sem inventar e sem parafrasear. Em behavioral_analysis, analise tom comunicacional, emocao aparente, sinais de personalidade, estilo de comunicacao e nuances comportamentais. Seja cuidadoso: se a fonte for transcricao, diga que tom de voz/emoção sao inferencias textuais, nao leitura acustica direta. Se nao houver transcricao, use important_quotes como array vazio e baixa confianca comportamental.",
          "",
          selectRepresentativeText(baseText, 18000),
        ].join("\n"),
      },
    ],
  };

  const response = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    SUMMARY_TIMEOUT_MS,
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Erro na API de resumo da Groq.");
  }

  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = safeJsonParse(content);
  const short = String(parsed?.short || "").trim();
  const keywords = Array.isArray(parsed?.keywords)
    ? parsed.keywords.map((keyword) => String(keyword).trim()).filter(Boolean).slice(0, 12)
    : fallback.keywords;
  const importantQuotes = Array.isArray(parsed?.important_quotes)
    ? parsed.important_quotes.map((quote) => cleanQuote(quote)).filter(Boolean).slice(0, 6)
    : fallback.importantQuotes || [];
  const behavioralAnalysis = normalizeBehavioralAnalysis(
    parsed?.behavioral_analysis,
    fallback.behavioralAnalysis,
    Boolean(transcript?.available),
  );

  return {
    short: short || fallback.short,
    keywords,
    importantQuotes,
    behavioralAnalysis,
    source: fallback.source,
    provider: "groq",
    model,
  };
}

function summarizeText(text, maxSentences = 4) {
  const cleanText = (text || "").replace(/\s+/g, " ").trim();
  if (!cleanText) {
    return "";
  }

  const sentences = cleanText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 35);

  if (sentences.length <= maxSentences) {
    return sentences.join(" ");
  }

  const frequencies = wordFrequencies(cleanText);
  const ranked = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreSentence(sentence, frequencies),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index);

  return ranked.map((item) => item.sentence).join(" ");
}

function fallbackSummary(video) {
  const bits = [
    video.title ? `Video: ${video.title}.` : "",
    video.channelTitle ? `Canal: ${video.channelTitle}.` : "",
    video.publishedAt ? `Publicado em ${video.publishedAt}.` : "",
  ];

  return bits.filter(Boolean).join(" ");
}

function extractKeywords(text, limit = 12) {
  const frequencies = wordFrequencies(text);
  return [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

function extractImportantQuotes(segments = [], limit = 6) {
  return [...segments]
    .map((segment) => String(segment.text || "").replace(/\s+/g, " ").trim())
    .filter((text) => text.length >= 60 && text.length <= 280)
    .sort((a, b) => scoreQuote(b) - scoreQuote(a))
    .slice(0, limit)
    .map(cleanQuote);
}

function scoreQuote(text) {
  const keywordHits = [
    "importante",
    "principal",
    "precisa",
    "porque",
    "resultado",
    "estrategia",
    "problema",
    "solucao",
    "aprendi",
    "recomendo",
  ].reduce((total, keyword) => total + (text.toLowerCase().includes(keyword) ? 1 : 0), 0);

  return text.length + keywordHits * 80;
}

function cleanQuote(value) {
  return String(value || "")
    .replace(/[“”]/g, '"')
    .replace(/^"+|"+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLocalBehavioralAnalysis(text, transcript) {
  const cleanText = String(text || "").replace(/\s+/g, " ").trim();
  const hasTranscript = Boolean(transcript?.available && cleanText);

  return {
    tone: hasTranscript ? inferTone(cleanText) : "indisponivel",
    emotional_state: hasTranscript ? inferEmotion(cleanText) : "indisponivel",
    personality_signals: hasTranscript
      ? "Inferencia textual baseada em temas recorrentes, escolhas de palavras e forma de argumentacao."
      : "Sem transcricao suficiente para inferir sinais de personalidade.",
    communication_style: hasTranscript ? inferCommunicationStyle(cleanText) : "indisponivel",
    behavioral_nuances: hasTranscript
      ? "Analise limitada ao conteudo transcrito; pausas, ritmo, volume, ironia vocal e energia real do audio nao sao medidos diretamente por este resumo."
      : "Sem material verbal suficiente para nuances comportamentais.",
    confidence: hasTranscript ? "media" : "baixa",
    limitation:
      "Esta analise e inferida principalmente da transcricao. Para leitura acustica real de tom de voz e emocao, seria necessario um modelo que analise o audio diretamente.",
  };
}

function normalizeBehavioralAnalysis(value, fallback, hasTranscript) {
  const source = value && typeof value === "object" ? value : {};

  return {
    tone: String(source.tone || fallback?.tone || (hasTranscript ? "inferido da transcricao" : "indisponivel")),
    emotional_state: String(source.emotional_state || fallback?.emotional_state || "indisponivel"),
    personality_signals: String(source.personality_signals || fallback?.personality_signals || "indisponivel"),
    communication_style: String(source.communication_style || fallback?.communication_style || "indisponivel"),
    behavioral_nuances: String(source.behavioral_nuances || fallback?.behavioral_nuances || "indisponivel"),
    confidence: String(source.confidence || fallback?.confidence || (hasTranscript ? "media" : "baixa")),
    limitation: String(
      source.limitation ||
        fallback?.limitation ||
        "Analise inferida da transcricao, sem leitura acustica direta do audio.",
    ),
  };
}

function inferTone(text) {
  const lower = text.toLowerCase();
  if (/(urgente|grave|cuidado|aten[cç][aã]o|problema|erro)/i.test(lower)) {
    return "alerta e orientado a risco";
  }
  if (/(vamos|consegue|resultado|passo|estrat[eé]gia|fazer)/i.test(lower)) {
    return "didatico e diretivo";
  }
  return "informativo";
}

function inferEmotion(text) {
  const lower = text.toLowerCase();
  if (/(feliz|animado|empolgado|excelente|incr[ií]vel)/i.test(lower)) {
    return "positiva/entusiasmada";
  }
  if (/(frustrado|preocupado|dif[ií]cil|problema|medo|risco)/i.test(lower)) {
    return "preocupada ou tensa";
  }
  return "neutra a moderada";
}

function inferCommunicationStyle(text) {
  const lower = text.toLowerCase();
  if (/(primeiro|segundo|terceiro|passo|etapa|exemplo)/i.test(lower)) {
    return "estruturado e explicativo";
  }
  if (/(eu acho|minha opini[aã]o|experi[eê]ncia|aprendi)/i.test(lower)) {
    return "opinativo e experiencial";
  }
  return "expositivo";
}

function wordFrequencies(text) {
  const frequencies = new Map();
  const words = (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9_]{3,}/g);

  for (const word of words || []) {
    if (STOP_WORDS.has(word)) {
      continue;
    }

    frequencies.set(word, (frequencies.get(word) || 0) + 1);
  }

  return frequencies;
}

function scoreSentence(sentence, frequencies) {
  const words = sentence
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9_]{3,}/g);

  if (!words?.length) {
    return 0;
  }

  const total = words.reduce((score, word) => score + (frequencies.get(word) || 0), 0);
  return total / Math.sqrt(words.length);
}

function selectRepresentativeText(text, maxLength) {
  const cleanText = String(text || "").replace(/\s+/g, " ").trim();
  if (cleanText.length <= maxLength) {
    return cleanText;
  }

  const partLength = Math.floor(maxLength / 3);
  const middleStart = Math.max(0, Math.floor(cleanText.length / 2 - partLength / 2));

  return [
    "[inicio da transcricao]",
    cleanText.slice(0, partLength),
    "[meio da transcricao]",
    cleanText.slice(middleStart, middleStart + partLength),
    "[fim da transcricao]",
    cleanText.slice(cleanText.length - partLength),
  ].join("\n");
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
  summarizeVideo,
};
