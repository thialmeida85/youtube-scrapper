const { requireConfig } = require("./config.js");
const { transcribeVideoAudio } = require("./audioTranscriber.js");
const { getTranscript } = require("./transcript.js");
const { extractVideoId, getChannelReport, getVideoDetails } = require("./youtube.js");
const { analyzeSpeech } = require("./speechAnalysis.js");
const { summarizeVideo } = require("./summarizer.js");

async function analyzeVideo(videoInput, options = {}) {
  const apiKey = options.apiKey || requireConfig("YOUTUBE_API_KEY");
  const video = await getVideoDetails(videoInput, apiKey);
  const transcript = await getBestTranscript(video, options);
  const summary = await summarizeVideo(video, transcript);
  const speechAnalysis = analyzeSpeech(video, transcript, summary);

  return {
    video,
    transcript,
    summary,
    speechAnalysis,
    fetchedAt: new Date().toISOString(),
  };
}

async function analyzeChannel(channelInput, options = {}) {
  const apiKey = options.apiKey || requireConfig("YOUTUBE_API_KEY");
  const report = await getChannelReport(channelInput, apiKey, {
    limit: options.limit,
    mode: options.mode,
    perYear: options.perYear,
    yearFrom: options.yearFrom,
    yearTo: options.yearTo,
    maxScan: options.maxScan,
  });
  const includeTranscripts = Boolean(options.includeTranscripts);
  const maxAudioTranscriptions = clamp(Number(options.maxAudioTranscriptions ?? 500), 0, 500);
  let audioTranscriptionsUsed = 0;
  const videos = [];
  const totalVideos = report.videos.length;

  if (options.onProgress) {
    options.onProgress({
      phase: "videos",
      processed: 0,
      total: totalVideos,
      message: `Coleta preparada: ${totalVideos} videos para analisar.`,
    });
  }

  for (let index = 0; index < report.videos.length; index += 1) {
    const video = report.videos[index];
    if (options.onProgress) {
      options.onProgress({
        phase: includeTranscripts ? "transcription" : "summary",
        processed: index,
        total: totalVideos,
        currentTitle: video.title,
        message: `Processando ${index + 1}/${totalVideos}: ${video.title}`,
      });
    }

    const audioAllowed =
      Boolean(options.audioFallback) &&
      audioTranscriptionsUsed < maxAudioTranscriptions;
    const transcript = includeTranscripts
      ? await getBestTranscript(video, {
          ...options,
          audioFallback: audioAllowed,
          audioFallbackNote: buildAudioFallbackNote(
            maxAudioTranscriptions,
            audioTranscriptionsUsed,
          ),
        })
      : {
          available: false,
          language: null,
          source: "disabled",
          text: "",
          segments: [],
          note: "Transcricao nao solicitada nesta consulta.",
        };
    if (includeTranscripts && transcript.audioAttempted) {
      audioTranscriptionsUsed += 1;
    }

    const summary = await summarizeVideo(video, transcript);

    videos.push({
      video,
      transcript,
      summary,
    });

    if (options.onProgress) {
      options.onProgress({
        phase: "videos",
        processed: index + 1,
        total: totalVideos,
        currentTitle: video.title,
        message: `Concluido ${index + 1}/${totalVideos}: ${video.title}`,
      });
    }
  }

  for (const item of videos) {
    item.speechAnalysis = analyzeSpeech(item.video, item.transcript, item.summary);
  }

  return {
    channel: report.channel,
    videos,
    totals: buildTotals(videos),
    mode: report.mode,
    requestedLimit: report.requestedLimit,
    perYear: report.perYear,
    yearFrom: report.yearFrom,
    yearTo: report.yearTo,
    scannedVideos: report.scannedVideos,
    maxAudioTranscriptions: includeTranscripts ? maxAudioTranscriptions : null,
    audioTranscriptionsUsed: includeTranscripts ? audioTranscriptionsUsed : null,
    fetchedAt: report.fetchedAt,
  };
}

async function getBestTranscript(video, options = {}) {
  if (options.audioFallback) {
    const audioTranscript = await transcribeVideoAudio(video, options);

    if (audioTranscript.available) {
      return { ...audioTranscript, audioAttempted: true };
    }

    const publicTranscript = await getTranscript(video.id, options.languages);

    if (publicTranscript.available) {
      return {
        ...publicTranscript,
        audioAttempted: true,
        note: `Audio indisponivel; usei legenda publica. ${audioTranscript.note || ""}`.trim(),
      };
    }

    return {
      ...publicTranscript,
      audioAttempted: true,
      note: `${audioTranscript.note || "Transcricao por audio indisponivel."} ${publicTranscript.note || ""}`.trim(),
    };
  }

  const publicTranscript = await getTranscript(video.id, options.languages);
  if (!publicTranscript.available && options.audioFallbackNote) {
    return {
      ...publicTranscript,
      note: `${publicTranscript.note || "Transcricao publica indisponivel."} ${options.audioFallbackNote}`.trim(),
    };
  }

  return publicTranscript;
}

function buildAudioFallbackNote(maxAudioTranscriptions, used) {
  if (used >= maxAudioTranscriptions) {
    return `Audio nao transcrito: limite de ${maxAudioTranscriptions} transcricoes por coleta atingido.`;
  }

  return "";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function buildTotals(items) {
  return items.reduce(
    (totals, item) => {
      totals.videos += 1;
      totals.views += item.video.statistics.views || 0;
      totals.likes += item.video.statistics.likes || 0;
      totals.comments += item.video.statistics.comments || 0;
      return totals;
    },
    { videos: 0, views: 0, likes: 0, comments: 0 },
  );
}

module.exports = {
  analyzeChannel,
  analyzeVideo,
  extractVideoId,
};
