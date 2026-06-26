const CONCERN_PATTERNS = [
  {
    category: "ofensa ou xingamento",
    severity: "media",
    pattern: /\b(idiota|burro|imbecil|otario|lixo|stupid|idiot|dumb|trash)\b/i,
  },
  {
    category: "hostilidade ou ameaca",
    severity: "alta",
    pattern: /\b(matar|morte|destruir|ameaca|violencia|kill|death|destroy|threat|violence)\b/i,
  },
  {
    category: "discriminacao",
    severity: "alta",
    pattern: /\b(racista|racismo|nazista|nazi|preconceito|discriminacao|hate|racist)\b/i,
  },
  {
    category: "risco reputacional",
    severity: "media",
    pattern: /\b(golpe|fraude|roubo|mentira|fake|scam|fraud|illegal|crime)\b/i,
  },
  {
    category: "conteudo sensivel",
    severity: "baixa",
    pattern: /\b(sexo|droga|suicidio|arma|sexual|drug|suicide|weapon)\b/i,
  },
];

function analyzeSpeech(video, transcript, summary) {
  const hasTranscript = Boolean(transcript?.available && transcript.text);
  const concerningQuotes = hasTranscript ? findConcerningQuotes(transcript.segments) : [];

  return {
    summarySource: summary?.source || "description",
    hasTranscript,
    transcriptNote: transcript?.note || null,
    summary: summary?.short || "",
    concerningQuotes,
    quoteCount: concerningQuotes.length,
  };
}

function findConcerningQuotes(segments = [], maxQuotes = 8) {
  const quotes = [];

  for (const segment of segments) {
    const text = cleanText(segment.text);
    if (!text) {
      continue;
    }

    for (const rule of CONCERN_PATTERNS) {
      if (!rule.pattern.test(text)) {
        continue;
      }

      quotes.push({
        quote: text,
        category: rule.category,
        severity: rule.severity,
        start: segment.start,
        duration: segment.duration,
      });
      break;
    }

    if (quotes.length >= maxQuotes) {
      break;
    }
  }

  return quotes;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

module.exports = {
  analyzeSpeech,
};
