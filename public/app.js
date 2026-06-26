const form = document.querySelector("#channel-form");
const channelInput = document.querySelector("#channel-url");
const modeInput = document.querySelector("#collection-mode");
const limitInput = document.querySelector("#video-limit");
const perYearInput = document.querySelector("#videos-per-year");
const yearFromInput = document.querySelector("#year-from");
const yearToInput = document.querySelector("#year-to");
const maxScanInput = document.querySelector("#max-scan");
const includeTranscriptsInput = document.querySelector("#include-transcripts");
const statusElement = document.querySelector("#status");
const progressElement = document.querySelector("#progress");
const progressSteps = [...document.querySelectorAll("#progress-steps li")];
const dashboard = document.querySelector("#dashboard");
const rowsElement = document.querySelector("#video-rows");
const printReportElement = document.querySelector("#print-report");

let currentReport = null;
let progressTimer = null;

const fields = {
  avatar: document.querySelector("#channel-avatar"),
  handle: document.querySelector("#channel-handle"),
  title: document.querySelector("#channel-title"),
  description: document.querySelector("#channel-description"),
  link: document.querySelector("#channel-link"),
  videos: document.querySelector("#metric-videos"),
  views: document.querySelector("#metric-views"),
  likes: document.querySelector("#metric-likes"),
  subscribers: document.querySelector("#metric-subscribers"),
};

modeInput.addEventListener("change", syncModeFields);
syncModeFields();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = form.querySelector("button");
  const url = channelInput.value.trim();
  const mode = modeInput.value;
  const limit = limitInput.value || "25";
  const perYear = perYearInput.value || "12";
  const yearFrom = yearFromInput.value;
  const yearTo = yearToInput.value;
  const maxScan = maxScanInput.value || "20000";
  const transcripts = includeTranscriptsInput.checked ? "true" : "false";
  const maxAudioTranscriptions = "500";

  if (!url) {
    return;
  }

  if (mode === "yearly-sample") {
    const validation = validateYearRange(yearFrom, yearTo);
    if (validation) {
      setStatus(validation);
      return;
    }
  }

  startProgress(
    includeTranscriptsInput.checked
      ? "Coletando canal e tentando baixar falas. Isso pode demorar..."
      : mode === "yearly-sample"
        ? "Varrendo historico do canal e montando amostra por ano..."
        : "Coletando canal e videos...",
  );
  button.disabled = true;
  dashboard.hidden = true;
  printReportElement.hidden = true;

  try {
    setProgressStep(1);
    const status = await fetchJson("/api/status");
    if (!status.hasYouTubeApiKey) {
      throw new Error(
        "Chave da YouTube API nao encontrada. Coloque o arquivo .env na pasta do .exe ou na pasta acima dele.",
      );
    }
    if (includeTranscriptsInput.checked && !status.canUseAudioTranscription) {
      setStatus(
        "Falas ativadas. Sem GROQ_API_KEY/OPENAI_API_KEY, yt-dlp ou ffmpeg, vou tentar apenas legendas publicas do YouTube.",
      );
    }

    setProgressStep(2);
    setProgressStep(3);
    const params = new URLSearchParams({
      url,
      mode,
      limit,
      perYear,
      yearFrom,
      yearTo,
      maxScan,
      transcripts,
      audioFallback: "true",
      maxAudioTranscriptions,
    });
    const endpoint = `/api/channel?${params}`;
    const { response, payload } = await fetchJsonWithResponse(endpoint);

    if (!response.ok) {
      throw new Error(payload.error || "Falha ao analisar canal.");
    }

    setProgressStep(4);
    currentReport = payload;
    renderReport(payload);
    setStatus(buildDoneMessage(payload));
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
    stopProgress();
  }
});

function syncModeFields() {
  const yearly = modeInput.value === "yearly-sample";
  for (const element of document.querySelectorAll(".yearly-only")) {
    element.hidden = !yearly;
  }

  limitInput.disabled = yearly;
}

function buildDoneMessage(payload) {
  if (payload.mode === "yearly-sample") {
    const range =
      payload.yearFrom || payload.yearTo
        ? ` de ${payload.yearFrom || "inicio"} ate ${payload.yearTo || "hoje"}`
        : "";
    const audio =
      payload.audioTranscriptionsUsed !== null && payload.audioTranscriptionsUsed !== undefined
        ? ` Falas por audio: ${payload.audioTranscriptionsUsed}/${payload.maxAudioTranscriptions}. Videos longos sao transcritos em partes.`
        : "";
    return `Coleta concluida: ${payload.videos.length} videos em amostra de ${payload.perYear} por ano${range}.${audio}`;
  }

  const audio =
    payload.audioTranscriptionsUsed !== null && payload.audioTranscriptionsUsed !== undefined
      ? ` Falas por audio: ${payload.audioTranscriptionsUsed}/${payload.maxAudioTranscriptions}. Videos longos sao transcritos em partes.`
      : "";
  return `Coleta concluida: ${payload.videos.length} videos prontos para exportar.${audio}`;
}

function validateYearRange(yearFrom, yearTo) {
  const start = Number(yearFrom);
  const end = Number(yearTo);

  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return "Preencha Ano inicial e Ano final para a amostra por ano.";
  }

  if (start < 1900 || end > 2100) {
    return "Use anos entre 1900 e 2100.";
  }

  if (start > end) {
    return "Ano inicial nao pode ser maior que Ano final.";
  }

  return "";
}

document.querySelector("#export-jsonl").addEventListener("click", () => {
  exportFile("youtube-channel.jsonl", toJsonl(currentReport), "application/x-ndjson");
});

document.querySelector("#export-json").addEventListener("click", () => {
  exportFile("youtube-channel.json", JSON.stringify(currentReport, null, 2), "application/json");
});

document.querySelector("#export-csv").addEventListener("click", () => {
  exportFile("youtube-channel.csv", toCsv(currentReport), "text/csv");
});

document.querySelector("#export-md").addEventListener("click", () => {
  exportFile("youtube-channel.md", toMarkdown(currentReport), "text/markdown");
});

document.querySelector("#export-doc").addEventListener("click", () => {
  exportFile("youtube-channel.doc", toDocHtml(currentReport), "application/msword");
});

document.querySelector("#print-pdf").addEventListener("click", () => {
  if (!currentReport) {
    setStatus("Cole um canal e faca uma coleta antes de exportar.");
    return;
  }

  printPdfReport(currentReport);
});

function renderReport(report) {
  const { channel, totals } = report;
  const avatar =
    channel.thumbnails?.high?.url ||
    channel.thumbnails?.medium?.url ||
    channel.thumbnails?.default?.url ||
    "";

  fields.avatar.src = avatar;
  fields.avatar.alt = channel.title;
  fields.handle.textContent = channel.customUrl || channel.id;
  fields.title.textContent = channel.title;
  fields.description.textContent = truncate(channel.description || "Sem descricao.", 260);
  fields.link.href = channel.url;
  fields.videos.textContent = formatNumber(totals.videos);
  fields.views.textContent = formatNumber(totals.views);
  fields.likes.textContent = formatNumber(totals.likes);
  fields.subscribers.textContent = channel.statistics.hiddenSubscriberCount
    ? "Oculto"
    : formatNumber(channel.statistics.subscribers);

  rowsElement.innerHTML = "";
  for (const item of report.videos) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><a href="${item.video.url}" target="_blank" rel="noreferrer">${escapeHtml(
        item.video.title,
      )}</a></td>
      <td>${formatDate(item.video.publishedAt)}</td>
      <td>${formatNumber(item.video.statistics.views)}</td>
      <td>${formatNumber(item.video.statistics.likes)}</td>
      <td>${formatNumber(item.video.statistics.comments)}</td>
      <td>${renderTranscriptStatus(item)}</td>
      <td>${renderConcerningQuotes(item)}</td>
      <td>${escapeHtml(truncate(item.summary.short || item.video.description || "", 220))}
        <span class="source-label">${item.summary.source === "transcript" ? "transcricao" : "descricao"}</span>
        ${renderImportantQuotes(item.summary.importantQuotes)}
      </td>
    `;
    rowsElement.append(row);
  }

  renderPrintReport(report);
  dashboard.hidden = false;
}

function renderPrintReport(report) {
  const stats = buildReportStats(report);
  const topVideos = [...report.videos]
    .sort((a, b) => (b.video.statistics.views || 0) - (a.video.statistics.views || 0))
    .slice(0, 5);

  printReportElement.innerHTML = `
    <header class="report-cover">
      <p class="report-kicker">YouTube Channel Intelligence</p>
      <h1>${escapeHtml(report.channel.title)}</h1>
      <p>${escapeHtml(report.channel.url)}</p>
      <dl class="report-meta">
        <div><dt>Coletado em</dt><dd>${escapeHtml(formatDateTime(report.fetchedAt))}</dd></div>
        <div><dt>Modo</dt><dd>${report.mode === "yearly-sample" ? "Amostra por ano" : "Ultimos videos"}</dd></div>
        <div><dt>Recorte</dt><dd>${escapeHtml(describeReportRange(report))}</dd></div>
        <div><dt>Videos analisados</dt><dd>${formatNumber(report.videos.length)}</dd></div>
      </dl>
    </header>

    <section class="report-section">
      <h2>Visao Executiva</h2>
      <p>${escapeHtml(buildExecutiveSummary(report, stats))}</p>
      <div class="report-grid">
        <div><span>Views no recorte</span><strong>${formatNumber(report.totals.views)}</strong></div>
        <div><span>Likes no recorte</span><strong>${formatNumber(report.totals.likes)}</strong></div>
        <div><span>Comentarios no recorte</span><strong>${formatNumber(report.totals.comments)}</strong></div>
        <div><span>Falas transcritas</span><strong>${stats.transcribed}/${report.videos.length}</strong></div>
      </div>
    </section>

    <section class="report-section">
      <h2>Metodo e Cobertura</h2>
      <ul>
        <li>${escapeHtml(describeCollectionMethod(report))}</li>
        <li>${escapeHtml(describeTranscriptMethod(report))}</li>
        <li>${escapeHtml(describeSummaryMethod(report))}</li>
        <li>${escapeHtml(stats.yearRange ? `Periodo coberto pelos videos coletados: ${stats.yearRange}.` : "Periodo coberto indisponivel.")}</li>
      </ul>
    </section>

    <section class="report-section">
      <h2>Videos com Maior Alcance</h2>
      ${renderTopVideos(topVideos)}
    </section>

    <section class="report-section">
      <h2>Analise por Video</h2>
      ${report.videos.map((item, index) => renderPrintVideo(item, index)).join("")}
    </section>
  `;
  printReportElement.hidden = false;
}

function toAiRecords(report) {
  if (!report) {
    return [];
  }

  return report.videos.map((item) => ({
    channel_id: report.channel.id,
    channel_title: report.channel.title,
    channel_url: report.channel.url,
    video_id: item.video.id,
    video_url: item.video.url,
    title: item.video.title,
    published_at: item.video.publishedAt,
    views: item.video.statistics.views,
    likes: item.video.statistics.likes,
    comments: item.video.statistics.comments,
    duration: item.video.duration,
    description: item.video.description,
    tags: item.video.tags,
    summary: item.summary.short,
    keywords: item.summary.keywords,
    important_quotes: item.summary.importantQuotes || [],
    behavioral_analysis: item.summary.behavioralAnalysis || null,
    transcript_available: item.transcript.available,
    transcript_language: item.transcript.language,
    transcript_source: item.transcript.source,
    transcript_note: item.transcript.note,
    transcript: item.transcript.text,
    summary_source: item.summary.source,
    summary_provider: item.summary.provider,
    summary_note: item.summary.note,
    concerning_quotes: item.speechAnalysis?.concerningQuotes || [],
  }));
}

function toJsonl(report) {
  return toAiRecords(report)
    .map((record) => JSON.stringify(record))
    .join("\n");
}

function toCsv(report) {
  const records = toAiRecords(report);
  const columns = [
    "channel_title",
    "video_id",
    "video_url",
    "title",
    "published_at",
    "views",
    "likes",
    "comments",
    "duration",
    "summary",
    "important_quotes",
    "behavioral_analysis",
    "summary_source",
    "summary_provider",
    "summary_note",
    "transcript_source",
    "transcript_note",
    "concerning_quotes",
    "keywords",
    "transcript_available",
  ];
  const lines = [columns.join(",")];

  for (const record of records) {
    lines.push(
      columns
        .map((column) => {
          const value = Array.isArray(record[column])
            ? record[column]
                .map((item) => (typeof item === "string" ? item : item.quote || JSON.stringify(item)))
                .join("; ")
            : record[column] && typeof record[column] === "object"
              ? JSON.stringify(record[column])
            : record[column] ?? "";
          return `"${String(value).replace(/"/g, '""')}"`;
        })
        .join(","),
    );
  }

  return lines.join("\n");
}

function toMarkdown(report) {
  if (!report) {
    return "";
  }

  const stats = buildReportStats(report);
  const lines = [
    `# ${report.channel.title}`,
    "",
    `Canal: ${report.channel.url}`,
    `Coletado em: ${report.fetchedAt}`,
    `Modo: ${report.mode === "yearly-sample" ? "Amostra por ano" : "Ultimos videos"}`,
    report.mode === "yearly-sample"
      ? `Recorte: ${report.perYear} videos por ano, ${report.yearFrom || "inicio"} ate ${report.yearTo || "hoje"}`
      : "",
    `Videos no arquivo: ${report.videos.length}`,
    `Falas transcritas: ${stats.transcribed}/${report.videos.length}`,
    `Periodo coberto: ${stats.yearRange || "-"}`,
    "",
    "## Visao Executiva",
    "",
    buildExecutiveSummary(report, stats),
    "",
    "## Metodo e Cobertura",
    "",
    `- ${describeCollectionMethod(report)}`,
    `- ${describeTranscriptMethod(report)}`,
    `- ${describeSummaryMethod(report)}`,
    "",
  ];

  for (const item of report.videos) {
    lines.push(`## ${item.video.title}`);
    lines.push("");
    lines.push(`URL: ${item.video.url}`);
    lines.push(`Publicado em: ${item.video.publishedAt || "-"}`);
    lines.push(
      `Metricas: ${formatNumber(item.video.statistics.views)} views, ${formatNumber(
        item.video.statistics.likes,
      )} likes, ${formatNumber(item.video.statistics.comments)} comentarios`,
    );
    lines.push("");
    lines.push(`Resumo: ${item.summary.short || "-"}`);
    lines.push("");
    if (item.summary.importantQuotes?.length) {
      lines.push("Falas importantes:");
      lines.push("");
      for (const quote of item.summary.importantQuotes) {
        lines.push(`- "${quote}"`);
      }
      lines.push("");
    }
    if (item.summary.behavioralAnalysis) {
      lines.push("Analise comportamental:");
      lines.push("");
      lines.push(`- Tom: ${item.summary.behavioralAnalysis.tone || "-"}`);
      lines.push(`- Emocao aparente: ${item.summary.behavioralAnalysis.emotional_state || "-"}`);
      lines.push(`- Personalidade/sinais: ${item.summary.behavioralAnalysis.personality_signals || "-"}`);
      lines.push(`- Estilo de comunicacao: ${item.summary.behavioralAnalysis.communication_style || "-"}`);
      lines.push(`- Nuances: ${item.summary.behavioralAnalysis.behavioral_nuances || "-"}`);
      lines.push(`- Confianca: ${item.summary.behavioralAnalysis.confidence || "-"}`);
      lines.push(`- Limite tecnico: ${item.summary.behavioralAnalysis.limitation || "-"}`);
      lines.push("");
    }
    lines.push(`Resumo gerado por: ${item.summary.provider || "local"}`);
    lines.push("");
    if (item.summary.note) {
      lines.push(`Nota sobre resumo: ${item.summary.note}`);
      lines.push("");
    }
    lines.push(`Fonte do resumo: ${item.summary.source === "transcript" ? "transcricao" : "descricao"}`);
    lines.push("");
    if (!item.transcript.available && item.transcript.note) {
      lines.push(`Nota sobre falas: ${item.transcript.note}`);
      lines.push("");
    }
    const quotes = item.speechAnalysis?.concerningQuotes || [];
    if (quotes.length) {
      lines.push("Falas sinalizadas:");
      lines.push("");
      for (const quote of quotes) {
        lines.push(`- "${quote.quote}" (${quote.category}, ${quote.severity}, ${formatTime(quote.start)})`);
      }
      lines.push("");
    }
    lines.push(`Palavras-chave: ${(item.summary.keywords || []).join(", ") || "-"}`);
    lines.push("");
    if (item.transcript.text) {
      lines.push("Transcricao:");
      lines.push("");
      lines.push(item.transcript.text);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function toDocHtml(report) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    report?.channel?.title || "YouTube Channel",
  )}</title></head><body>${toMarkdown(report)
    .split("\n")
    .map((line) => `<p>${escapeHtml(line) || "&nbsp;"}</p>`)
    .join("")}</body></html>`;
}

function printPdfReport(report) {
  renderPrintReport(report);
  const html = buildPrintableHtml(report);
  const printWindow = window.open("", "_blank");

  if (!printWindow) {
    setStatus("O navegador bloqueou a janela de PDF. Libere pop-ups para este app e tente novamente.");
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 250);
}

function buildPrintableHtml(report) {
  return `<!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(report.channel.title)} - YouTube Channel Intelligence</title>
        <style>${printReportCss()}</style>
      </head>
      <body>
        <main class="print-report">${printReportElement.innerHTML}</main>
      </body>
    </html>`;
}

function printReportCss() {
  return `
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      color: #172033;
      background: #ffffff;
      font-family: Arial, Helvetica, sans-serif;
      line-height: 1.45;
    }
    h1, h2, h3, p { margin-top: 0; }
    h1 { font-size: 28px; }
    h2 { font-size: 20px; margin-bottom: 10px; }
    h3 { font-size: 16px; margin-bottom: 6px; }
    a { color: #1b63d9; }
    .report-cover {
      padding: 0 0 18px;
      border-bottom: 2px solid #172033;
    }
    .report-kicker,
    .report-muted,
    .report-meta dt,
    .report-facts dt,
    .report-grid span,
    .report-list span {
      color: #667085;
    }
    .report-kicker {
      margin: 0 0 8px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .report-meta,
    .report-facts,
    .report-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin: 16px 0 0;
    }
    .report-meta div,
    .report-facts div,
    .report-grid div {
      padding: 10px;
      border: 1px solid #dfe5ef;
      border-radius: 6px;
    }
    .report-meta dt,
    .report-facts dt {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .report-meta dd,
    .report-facts dd {
      margin: 4px 0 0;
    }
    .report-section {
      padding: 18px 0;
      border-bottom: 1px solid #dfe5ef;
    }
    .report-grid span {
      display: block;
      font-size: 12px;
    }
    .report-grid strong {
      display: block;
      margin-top: 4px;
      font-size: 18px;
    }
    .report-list li {
      margin-bottom: 8px;
    }
    .report-video {
      break-inside: avoid;
      page-break-inside: avoid;
      padding: 14px 0;
      border-bottom: 1px solid #e5eaf2;
    }
    .report-quotes blockquote {
      margin: 8px 0;
      padding-left: 10px;
      border-left: 3px solid #1f6f8b;
      color: #344054;
    }
    .report-quotes small {
      color: #667085;
    }
    .report-behavior {
      margin: 10px 0;
      padding: 10px;
      border: 1px solid #dfe5ef;
      border-radius: 6px;
      background: #f9fafc;
    }
    .report-behavior ul {
      margin: 8px 0 0;
      padding-left: 18px;
    }
    .report-behavior li {
      margin-bottom: 4px;
    }
    details summary {
      font-weight: 700;
    }
    @page {
      margin: 14mm;
    }
  `;
}

function buildReportStats(report) {
  const dates = report.videos
    .map((item) => (item.video.publishedAt ? new Date(item.video.publishedAt) : null))
    .filter((date) => date && !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b);
  const transcribed = report.videos.filter((item) => item.transcript.available).length;
  const groqSummaries = report.videos.filter((item) => item.summary.provider === "groq").length;
  const audioSources = report.videos.filter((item) =>
    ["groq-audio", "openai-audio"].includes(item.transcript.source),
  ).length;

  return {
    transcribed,
    groqSummaries,
    audioSources,
    yearRange: dates.length
      ? `${dates[0].getUTCFullYear()} a ${dates[dates.length - 1].getUTCFullYear()}`
      : "",
  };
}

function buildExecutiveSummary(report, stats) {
  const topVideo = [...report.videos].sort(
    (a, b) => (b.video.statistics.views || 0) - (a.video.statistics.views || 0),
  )[0];
  const parts = [
    `Foram analisados ${report.videos.length} videos do canal ${report.channel.title}.`,
    `O recorte soma ${formatNumber(report.totals.views)} views, ${formatNumber(report.totals.likes)} likes e ${formatNumber(report.totals.comments)} comentarios.`,
    stats.transcribed
      ? `${stats.transcribed} videos tiveram falas transcritas, permitindo resumo baseado no que foi dito pelo apresentador.`
      : "Nenhum video teve fala transcrita; os resumos dependem de descricoes e metadados.",
    topVideo
      ? `O video de maior alcance no recorte foi "${topVideo.video.title}", com ${formatNumber(topVideo.video.statistics.views)} views.`
      : "",
  ];

  return parts.filter(Boolean).join(" ");
}

function describeReportRange(report) {
  if (report.mode === "yearly-sample") {
    return `${report.perYear} videos por ano, ${report.yearFrom || "inicio"} ate ${report.yearTo || "hoje"}`;
  }

  return `${report.requestedLimit || report.videos.length} videos mais recentes solicitados`;
}

function describeCollectionMethod(report) {
  if (report.mode === "yearly-sample") {
    return `A coleta varreu a playlist de uploads e selecionou ate ${report.perYear} videos por ano no intervalo ${report.yearFrom || "inicio"}-${report.yearTo || "hoje"}.`;
  }

  return "A coleta selecionou os videos mais recentes disponiveis na playlist oficial de uploads do canal.";
}

function describeTranscriptMethod(report) {
  if (report.maxAudioTranscriptions === null || report.maxAudioTranscriptions === undefined) {
    return "As falas nao foram solicitadas nesta coleta.";
  }

  return `Quando solicitado, o app baixou somente audio em arquivo compacto, dividiu arquivos longos em partes e tentou transcrever o video completo, com fallback para legenda publica quando necessario.`;
}

function describeSummaryMethod(report) {
  const stats = buildReportStats(report);
  return stats.groqSummaries
    ? `${stats.groqSummaries} resumos foram gerados pela Groq; os demais usaram fallback local quando necessario.`
    : "Os resumos foram gerados localmente a partir da transcricao disponivel ou da descricao do video.";
}

function renderTopVideos(items) {
  if (!items.length) {
    return "<p>Nenhum video disponivel.</p>";
  }

  return `<ol class="report-list">${items
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.video.title)}</strong><br><span>${formatNumber(
          item.video.statistics.views,
        )} views · ${formatDate(item.video.publishedAt)} · ${escapeHtml(item.video.url)}</span></li>`,
    )
    .join("")}</ol>`;
}

function renderPrintVideo(item, index) {
  const importantQuotes = item.summary.importantQuotes || [];
  const concerningQuotes = item.speechAnalysis?.concerningQuotes || [];

  return `
    <article class="report-video">
      <h3>${index + 1}. ${escapeHtml(item.video.title)}</h3>
      <p class="report-muted">${escapeHtml(item.video.url)}</p>
      <dl class="report-facts">
        <div><dt>Publicado</dt><dd>${formatDate(item.video.publishedAt)}</dd></div>
        <div><dt>Views</dt><dd>${formatNumber(item.video.statistics.views)}</dd></div>
        <div><dt>Likes</dt><dd>${formatNumber(item.video.statistics.likes)}</dd></div>
        <div><dt>Comentarios</dt><dd>${formatNumber(item.video.statistics.comments)}</dd></div>
        <div><dt>Falas</dt><dd>${item.transcript.available ? `transcritas (${escapeHtml(item.transcript.source)})` : "indisponiveis"}</dd></div>
        <div><dt>Resumo</dt><dd>${escapeHtml(item.summary.provider || "local")}</dd></div>
      </dl>
      <p><strong>Resumo:</strong> ${escapeHtml(item.summary.short || "-")}</p>
      ${renderPrintQuotes("Falas importantes", importantQuotes)}
      ${renderBehavioralAnalysis(item.summary.behavioralAnalysis)}
      ${renderPrintConcerningQuotes(concerningQuotes)}
      <p><strong>Palavras-chave:</strong> ${escapeHtml((item.summary.keywords || []).join(", ") || "-")}</p>
      ${item.transcript.note ? `<p><strong>Nota sobre falas:</strong> ${escapeHtml(item.transcript.note)}</p>` : ""}
      ${item.summary.note ? `<p><strong>Nota sobre resumo:</strong> ${escapeHtml(item.summary.note)}</p>` : ""}
      ${item.transcript.text ? `<details open><summary>Transcricao</summary><p>${escapeHtml(truncate(item.transcript.text, 2500))}</p></details>` : ""}
    </article>
  `;
}

function renderBehavioralAnalysis(analysis) {
  if (!analysis) {
    return "";
  }

  return `
    <div class="report-behavior">
      <strong>Tom, emocao e comportamento:</strong>
      <ul>
        <li><b>Tom:</b> ${escapeHtml(analysis.tone || "-")}</li>
        <li><b>Emocao aparente:</b> ${escapeHtml(analysis.emotional_state || "-")}</li>
        <li><b>Sinais de personalidade:</b> ${escapeHtml(analysis.personality_signals || "-")}</li>
        <li><b>Estilo de comunicacao:</b> ${escapeHtml(analysis.communication_style || "-")}</li>
        <li><b>Nuances:</b> ${escapeHtml(analysis.behavioral_nuances || "-")}</li>
        <li><b>Confianca:</b> ${escapeHtml(analysis.confidence || "-")}</li>
        <li><b>Limite tecnico:</b> ${escapeHtml(analysis.limitation || "-")}</li>
      </ul>
    </div>
  `;
}

function renderPrintQuotes(title, quotes) {
  if (!quotes.length) {
    return "";
  }

  return `<div class="report-quotes"><strong>${title}:</strong>${quotes
    .map((quote) => `<blockquote>"${escapeHtml(quote)}"</blockquote>`)
    .join("")}</div>`;
}

function renderPrintConcerningQuotes(quotes) {
  if (!quotes.length) {
    return "";
  }

  return `<div class="report-quotes"><strong>Falas sinalizadas:</strong>${quotes
    .map(
      (quote) =>
        `<blockquote>"${escapeHtml(quote.quote)}" <small>${escapeHtml(quote.category)} · ${escapeHtml(
          quote.severity,
        )} · ${formatTime(quote.start)}</small></blockquote>`,
    )
    .join("")}</div>`;
}

function exportFile(filename, content, type) {
  if (!currentReport) {
    setStatus("Cole um canal e faca uma coleta antes de exportar.");
    return;
  }

  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function fetchJson(url) {
  return (await fetchJsonWithResponse(url)).payload;
}

async function fetchJsonWithResponse(url) {
  const response = await fetch(url);
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 120) || response.statusText;
    throw new Error(`A rota ${url} respondeu ${response.status} como texto, nao JSON: ${preview}`);
  }

  return { response, payload };
}

function setStatus(message) {
  statusElement.textContent = message;
}

function renderTranscriptStatus(item) {
  if (item.transcript.available) {
    const source =
      item.transcript.source === "groq-audio"
        ? "groq"
        : item.transcript.source === "openai-audio"
          ? "audio"
          : "legenda";
    return `<span class="badge good">transcrita: ${source}</span>`;
  }

  if (item.transcript.source === "disabled") {
    return `<span class="badge muted-badge">nao solicitada</span>`;
  }

  const note = item.transcript.note ? ` title="${escapeHtml(item.transcript.note)}"` : "";
  return `<span class="badge warn"${note}>indisponivel</span>`;
}

function renderConcerningQuotes(item) {
  const quotes = item.speechAnalysis?.concerningQuotes || [];
  if (!quotes.length) {
    return '<span class="muted">-</span>';
  }

  return quotes
    .slice(0, 2)
    .map(
      (quote) =>
        `<figure class="quote-alert"><blockquote>"${escapeHtml(
          truncate(quote.quote, 120),
        )}"</blockquote><figcaption>${escapeHtml(quote.category)} · ${formatTime(
          quote.start,
        )}</figcaption></figure>`,
    )
    .join("");
}

function renderImportantQuotes(quotes = []) {
  if (!quotes.length) {
    return "";
  }

  return `<div class="summary-quotes">${quotes
    .slice(0, 2)
    .map((quote) => `<q>${escapeHtml(truncate(quote, 120))}</q>`)
    .join("")}</div>`;
}

function startProgress(message) {
  setStatus(message);
  progressElement.hidden = false;
  setProgressStep(1);

  let step = 1;
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    step = Math.min(step + 1, 3);
    setProgressStep(step);
  }, 1800);
}

function stopProgress() {
  clearInterval(progressTimer);
  progressTimer = null;
  setProgressStep(0);
  progressElement.hidden = true;
}

function setProgressStep(activeStep) {
  for (const item of progressSteps) {
    const step = Number(item.dataset.step);
    item.classList.toggle("active", step === activeStep);
    item.classList.toggle("done", activeStep > step);
  }
}

function formatNumber(value) {
  if (value === null || value === undefined) {
    return "-";
  }

  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("pt-BR") : "-";
}

function formatTime(seconds) {
  if (!Number.isFinite(Number(seconds))) {
    return "00:00";
  }

  const total = Math.max(0, Math.floor(Number(seconds)));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function truncate(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
