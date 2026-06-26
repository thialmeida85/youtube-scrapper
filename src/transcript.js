const WATCH_URL = "https://www.youtube.com/watch";
const TIMED_TEXT_URL = "https://www.youtube.com/api/timedtext";
const TIMED_TEXT_LIST_URL = "https://video.google.com/timedtext";

async function getTranscript(videoId, preferredLanguages = ["pt", "pt-BR", "en"]) {
  const tracks = await getCaptionTracks(videoId);

  if (!tracks.length) {
    return {
      available: false,
      language: null,
      source: "youtube-timedtext",
      text: "",
      segments: [],
      note: "Nenhuma legenda publica foi encontrada para este video.",
    };
  }

  const orderedTracks = orderTracks(tracks, preferredLanguages);
  let selectedTrack = orderedTracks[0];
  let segments = [];

  for (const track of orderedTracks) {
    const response = await fetch(track.url);

    if (!response.ok) {
      continue;
    }

    const transcriptPayload = await response.text();
    const parsedSegments = parseTimedText(transcriptPayload);

    if (parsedSegments.length) {
      selectedTrack = track;
      segments = parsedSegments;
      break;
    }
  }

  return {
    available: segments.length > 0,
    language: selectedTrack.languageCode || selectedTrack.name || null,
    source: "youtube-timedtext",
    text: segments.map((segment) => segment.text).join(" "),
    segments,
    note: segments.length
      ? null
      : "Legendas foram encontradas, mas nenhuma faixa publica entregou segmentos de fala.",
  };
}

async function getCaptionTracks(videoId) {
  const [htmlTracks, listTracks] = await Promise.all([
    getCaptionTracksFromHtml(videoId),
    getCaptionTracksFromList(videoId),
  ]);
  const tracks = [];
  const used = new Set();

  for (const track of [...listTracks, ...htmlTracks]) {
    const key = `${track.languageCode}:${track.name}:${track.kind}`;
    if (!used.has(key)) {
      tracks.push(track);
      used.add(key);
    }
  }

  return tracks;
}

async function getCaptionTracksFromHtml(videoId) {
  const watchUrl = `${WATCH_URL}?v=${encodeURIComponent(videoId)}`;
  const response = await fetch(watchUrl, {
    headers: {
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    },
  });

  if (!response.ok) {
    return [];
  }

  const html = await response.text();
  const playerResponse = extractPlayerResponse(html);
  const tracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  return tracks.map((track) => ({
    name: track.name?.simpleText || track.name?.runs?.map((run) => run.text).join("") || "",
    languageCode: track.languageCode || "",
    kind: track.kind || "manual",
    source: "html",
    url: withFormat(track.baseUrl),
  }));
}

async function getCaptionTracksFromList(videoId) {
  const listUrl = new URL(TIMED_TEXT_LIST_URL);
  listUrl.searchParams.set("type", "list");
  listUrl.searchParams.set("v", videoId);

  const response = await fetch(listUrl);
  if (!response.ok) {
    return [];
  }

  const xml = await response.text();
  const tracks = [];
  const regex = /<track\b([^>]*)\/?>/g;
  let match;

  while ((match = regex.exec(xml)) !== null) {
    const attributes = parseAttributes(match[1]);
    const trackName = decodeHtml(attributes.name || "");
    const url = new URL(TIMED_TEXT_LIST_URL);
    url.searchParams.set("v", videoId);
    url.searchParams.set("lang", attributes.lang_code || "");
    url.searchParams.set("fmt", "json3");

    if (trackName) {
      url.searchParams.set("name", trackName);
    }

    tracks.push({
      name: trackName || decodeHtml(attributes.lang_original || ""),
      languageCode: attributes.lang_code || "",
      kind: attributes.kind || "manual",
      source: "timedtext-list",
      url: url.toString(),
    });
  }

  return tracks;
}

function extractPlayerResponse(html) {
  const marker = "ytInitialPlayerResponse = ";
  const markerIndex = html.indexOf(marker);

  if (markerIndex >= 0) {
    const start = markerIndex + marker.length;
    const jsonText = extractJsonObject(html, start);
    if (jsonText) {
      return safeJsonParse(jsonText);
    }
  }

  const fallbackMarker = '"ytInitialPlayerResponse":';
  const fallbackIndex = html.indexOf(fallbackMarker);
  if (fallbackIndex >= 0) {
    const start = html.indexOf("{", fallbackIndex + fallbackMarker.length);
    const jsonText = extractJsonObject(html, start);
    if (jsonText) {
      return safeJsonParse(jsonText);
    }
  }

  return null;
}

function extractJsonObject(input, startIndex) {
  if (startIndex < 0 || input[startIndex] !== "{") {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = startIndex; index < input.length; index += 1) {
    const char = input[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return input.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function orderTracks(tracks, preferredLanguages) {
  const ordered = [];
  const used = new Set();

  for (const language of preferredLanguages) {
    for (const track of tracks) {
      if (track.languageCode === language && !used.has(track.url)) {
        ordered.push(track);
        used.add(track.url);
      }
    }
  }

  for (const language of preferredLanguages) {
    const prefix = language.split("-")[0];
    for (const track of tracks) {
      if (track.languageCode.startsWith(prefix) && !used.has(track.url)) {
        ordered.push(track);
        used.add(track.url);
      }
    }
  }

  for (const track of tracks) {
    if (!used.has(track.url)) {
      ordered.push(track);
      used.add(track.url);
    }
  }

  return ordered;
}

function withFormat(baseUrl) {
  const url = new URL(baseUrl || TIMED_TEXT_URL);
  url.searchParams.set("fmt", "json3");
  return url.toString();
}

function parseTimedText(payload) {
  const trimmed = payload.trim();
  if (trimmed.startsWith("{")) {
    return parseJson3Transcript(trimmed);
  }

  const segments = [];
  const regex = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let match;

  while ((match = regex.exec(payload)) !== null) {
    const attributes = parseAttributes(match[1]);
    const text = decodeHtml(stripTags(match[2])).replace(/\s+/g, " ").trim();

    if (!text) {
      continue;
    }

    segments.push({
      start: Number(attributes.start || 0),
      duration: Number(attributes.dur || 0),
      text,
    });
  }

  return segments;
}

function parseJson3Transcript(payload) {
  const data = safeJsonParse(payload);
  const events = data?.events || [];
  const segments = [];

  for (const event of events) {
    const text = (event.segs || [])
      .map((segment) => segment.utf8 || "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      continue;
    }

    segments.push({
      start: Number(event.tStartMs || 0) / 1000,
      duration: Number(event.dDurationMs || 0) / 1000,
      text,
    });
  }

  return segments;
}

function parseAttributes(input) {
  const attributes = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match;

  while ((match = regex.exec(input)) !== null) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

module.exports = {
  getCaptionTracks,
  getTranscript,
};
