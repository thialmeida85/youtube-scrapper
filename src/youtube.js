const API_BASE_URL = "https://www.googleapis.com/youtube/v3";

function extractVideoId(input) {
  if (!input || typeof input !== "string") {
    throw new Error("Informe uma URL ou ID de video do YouTube.");
  }

  const trimmed = input.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("URL ou ID de video invalido.");
  }

  if (url.hostname.includes("youtu.be")) {
    const id = url.pathname.split("/").filter(Boolean)[0];
    if (id) {
      return id;
    }
  }

  if (url.searchParams.get("v")) {
    return url.searchParams.get("v");
  }

  const shortsMatch = url.pathname.match(/\/shorts\/([^/?]+)/);
  if (shortsMatch) {
    return shortsMatch[1];
  }

  const embedMatch = url.pathname.match(/\/embed\/([^/?]+)/);
  if (embedMatch) {
    return embedMatch[1];
  }

  throw new Error("Nao consegui encontrar o ID do video nessa URL.");
}

async function getVideoDetails(videoInput, apiKey) {
  const videoId = extractVideoId(videoInput);
  const videos = await getVideosByIds([videoId], apiKey);

  if (!videos.length) {
    throw new Error("Video nao encontrado ou indisponivel para esta chave.");
  }

  return videos[0];
}

async function getVideosByIds(videoIds, apiKey) {
  const ids = [...new Set(videoIds)].filter(Boolean);
  if (!ids.length) {
    return [];
  }

  const videos = [];

  for (const chunk of chunkArray(ids, 50)) {
    const params = new URLSearchParams({
      part: "snippet,statistics,contentDetails",
      id: chunk.join(","),
      key: apiKey,
    });

    const response = await fetch(`${API_BASE_URL}/videos?${params}`);
    const payload = await response.json();

    if (!response.ok) {
      const reason = payload?.error?.message || "Erro ao consultar YouTube Data API.";
      throw new Error(reason);
    }

    videos.push(...(payload.items || []).map(normalizeVideo));
  }

  return videos;
}

async function getChannelReport(channelInput, apiKey, options = {}) {
  const mode = options.mode || "latest";
  const limit = clamp(Number(options.limit || 25), 1, 500);
  const perYear = clamp(Number(options.perYear || 10), 1, 50);
  const maxScan = clamp(Number(options.maxScan || 20000), 50, 20000);
  const yearFrom = parseYear(options.yearFrom);
  const yearTo = parseYear(options.yearTo);
  const channel = await getChannelDetails(channelInput, apiKey);
  const uploadsPlaylistId = channel.uploadsPlaylistId;

  if (!uploadsPlaylistId) {
    throw new Error("Nao encontrei a playlist de uploads desse canal.");
  }

  const playlistVideos =
    mode === "yearly-sample"
      ? sampleVideosByYear(
          await getPlaylistVideoIds(uploadsPlaylistId, apiKey, maxScan),
          perYear,
          { yearFrom, yearTo },
        )
      : await getPlaylistVideoIds(uploadsPlaylistId, apiKey, limit);
  const videos = await getVideosByIds(
    playlistVideos.map((item) => item.videoId),
    apiKey,
  );
  const positionById = new Map(playlistVideos.map((item, index) => [item.videoId, index]));

  videos.sort((a, b) => positionById.get(a.id) - positionById.get(b.id));

  return {
    channel,
    videos,
    mode,
    requestedLimit: limit,
    perYear: mode === "yearly-sample" ? perYear : null,
    yearFrom: mode === "yearly-sample" ? yearFrom : null,
    yearTo: mode === "yearly-sample" ? yearTo : null,
    scannedVideos: mode === "yearly-sample" ? Math.min(maxScan, channel.statistics.videos || maxScan) : null,
    fetchedAt: new Date().toISOString(),
  };
}

async function getChannelDetails(channelInput, apiKey) {
  const channelFilter = parseChannelInput(channelInput);
  const params = new URLSearchParams({
    part: "snippet,statistics,contentDetails,brandingSettings",
    key: apiKey,
    ...channelFilter,
  });

  const response = await fetch(`${API_BASE_URL}/channels?${params}`);
  const payload = await response.json();

  if (!response.ok) {
    const reason = payload?.error?.message || "Erro ao consultar canal na YouTube Data API.";
    throw new Error(reason);
  }

  const item = payload.items?.[0];
  if (!item) {
    throw new Error("Canal nao encontrado. Tente uma URL com @handle ou /channel/UC...");
  }

  return normalizeChannel(item);
}

async function getPlaylistVideoIds(playlistId, apiKey, limit) {
  const videos = [];
  let pageToken = "";

  while (videos.length < limit) {
    const params = new URLSearchParams({
      part: "snippet,contentDetails",
      playlistId,
      maxResults: String(Math.min(50, limit - videos.length)),
      key: apiKey,
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await fetch(`${API_BASE_URL}/playlistItems?${params}`);
    const payload = await response.json();

    if (!response.ok) {
      const reason = payload?.error?.message || "Erro ao listar videos do canal.";
      throw new Error(reason);
    }

    for (const item of payload.items || []) {
      const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
      if (videoId) {
        videos.push({
          videoId,
          publishedAt:
            item.contentDetails?.videoPublishedAt ||
            item.snippet?.publishedAt ||
            null,
        });
      }
    }

    pageToken = payload.nextPageToken || "";
    if (!pageToken) {
      break;
    }
  }

  return videos;
}

function sampleVideosByYear(items, perYear, options = {}) {
  const byYear = new Map();
  const minYear = Math.min(options.yearFrom || 0, options.yearTo || 9999);
  const maxYear = Math.max(options.yearFrom || 0, options.yearTo || 9999);

  for (const item of items) {
    if (!item.publishedAt) {
      continue;
    }

    const date = new Date(item.publishedAt);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();

    if (year < minYear || year > maxYear) {
      continue;
    }

    if (!byYear.has(year)) {
      byYear.set(year, []);
    }

    byYear.get(year).push({ ...item, year, month });
  }

  const selected = [];
  const years = [...byYear.keys()].sort((a, b) => b - a);

  for (const year of years) {
    selected.push(...pickSpreadAcrossMonths(byYear.get(year), perYear));
  }

  return selected;
}

function pickSpreadAcrossMonths(items, limit) {
  const selected = [];
  const usedIds = new Set();

  for (let month = 11; month >= 0 && selected.length < limit; month -= 1) {
    const item = items.find((candidate) => candidate.month === month && !usedIds.has(candidate.videoId));
    if (item) {
      selected.push(item);
      usedIds.add(item.videoId);
    }
  }

  for (const item of items) {
    if (selected.length >= limit) {
      break;
    }

    if (!usedIds.has(item.videoId)) {
      selected.push(item);
      usedIds.add(item.videoId);
    }
  }

  return selected;
}

function parseChannelInput(input) {
  if (!input || typeof input !== "string") {
    throw new Error("Informe uma URL, @handle ou ID de canal do YouTube.");
  }

  const trimmed = input.trim();

  if (/^UC[a-zA-Z0-9_-]{22}$/.test(trimmed)) {
    return { id: trimmed };
  }

  if (/^@[\w.-]+$/.test(trimmed)) {
    return { forHandle: trimmed };
  }

  if (/^[\w.-]+$/.test(trimmed)) {
    return { forHandle: trimmed };
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Canal invalido. Use uma URL, @handle ou ID que comece com UC.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const channelIndex = parts.indexOf("channel");
  if (channelIndex >= 0 && parts[channelIndex + 1]) {
    return { id: parts[channelIndex + 1] };
  }

  const handle = parts.find((part) => part.startsWith("@"));
  if (handle) {
    return { forHandle: handle };
  }

  const userIndex = parts.indexOf("user");
  if (userIndex >= 0 && parts[userIndex + 1]) {
    return { forUsername: parts[userIndex + 1] };
  }

  throw new Error("Nao consegui identificar o canal. Prefira URLs com @handle ou /channel/UC...");
}

function normalizeChannel(item) {
  const snippet = item.snippet || {};
  const statistics = item.statistics || {};
  const brandingSettings = item.brandingSettings || {};
  const relatedPlaylists = item.contentDetails?.relatedPlaylists || {};

  return {
    id: item.id,
    url: `https://www.youtube.com/channel/${item.id}`,
    title: snippet.title || "",
    description: snippet.description || "",
    customUrl: snippet.customUrl || "",
    publishedAt: snippet.publishedAt || null,
    country: snippet.country || brandingSettings.channel?.country || null,
    thumbnails: snippet.thumbnails || {},
    uploadsPlaylistId: relatedPlaylists.uploads || null,
    statistics: {
      views: toNumber(statistics.viewCount),
      subscribers: toNumber(statistics.subscriberCount),
      hiddenSubscriberCount: Boolean(statistics.hiddenSubscriberCount),
      videos: toNumber(statistics.videoCount),
    },
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function parseYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    return null;
  }

  return year;
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

module.exports = {
  extractVideoId,
  getChannelDetails,
  getChannelReport,
  getVideoDetails,
  getVideosByIds,
};

function normalizeVideo(item) {
  const snippet = item.snippet || {};
  const statistics = item.statistics || {};
  const contentDetails = item.contentDetails || {};

  return {
    id: item.id,
    url: `https://www.youtube.com/watch?v=${item.id}`,
    title: snippet.title || "",
    channelTitle: snippet.channelTitle || "",
    channelId: snippet.channelId || "",
    publishedAt: snippet.publishedAt || null,
    description: snippet.description || "",
    tags: snippet.tags || [],
    categoryId: snippet.categoryId || null,
    thumbnails: snippet.thumbnails || {},
    duration: contentDetails.duration || null,
    dimension: contentDetails.dimension || null,
    definition: contentDetails.definition || null,
    caption: contentDetails.caption === "true",
    statistics: {
      views: toNumber(statistics.viewCount),
      likes: toNumber(statistics.likeCount),
      comments: toNumber(statistics.commentCount),
      favorites: toNumber(statistics.favoriteCount),
    },
  };
}

function toNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
