const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { suppressKnownRuntimeWarnings } = require("./warnings.js");
const { canUseAudioTranscription } = require("./audioTranscriber.js");
const { getLoadedEnvPath, loadEnv } = require("./config.js");
const { analyzeChannel, analyzeVideo } = require("./service.js");

suppressKnownRuntimeWarnings();
loadEnv();

const publicDir = path.resolve(__dirname, "..", "public");
const startPort = Number(process.env.PORT || 3000);

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/analyze") {
      const videoInput = url.searchParams.get("url") || url.searchParams.get("id");
      if (!videoInput) {
        return sendJson(response, 400, { error: "Informe ?url= ou ?id=." });
      }

      const data = await analyzeVideo(videoInput);
      return sendJson(response, 200, data);
    }

    if (request.method === "GET" && url.pathname === "/api/channel") {
      const channelInput = url.searchParams.get("url") || url.searchParams.get("id");
      if (!channelInput) {
        return sendJson(response, 400, { error: "Informe ?url= ou ?id= do canal." });
      }

      const limit = Number(url.searchParams.get("limit") || 25);
      const mode = url.searchParams.get("mode") || "latest";
      const perYear = Number(url.searchParams.get("perYear") || 10);
      const yearFrom = url.searchParams.get("yearFrom");
      const yearTo = url.searchParams.get("yearTo");
      const maxScan = Number(url.searchParams.get("maxScan") || 20000);
      const includeTranscripts = url.searchParams.get("transcripts") === "true";
      const audioFallback = url.searchParams.get("audioFallback") !== "false";
      const maxAudioTranscriptions = Number(url.searchParams.get("maxAudioTranscriptions") || 500);
      const data = await analyzeChannel(channelInput, {
        limit,
        mode,
        perYear,
        yearFrom,
        yearTo,
        maxScan,
        includeTranscripts,
        audioFallback,
        maxAudioTranscriptions,
      });
      return sendJson(response, 200, data);
    }

    if (request.method === "GET" && url.pathname === "/api/status") {
      return sendJson(response, 200, {
        ok: true,
        hasYouTubeApiKey: Boolean(process.env.YOUTUBE_API_KEY),
        hasOpenAiApiKey: Boolean(process.env.OPENAI_API_KEY),
        hasGroqApiKey: Boolean(process.env.GROQ_API_KEY),
        canUseAudioTranscription: canUseAudioTranscription(),
        envLoaded: Boolean(getLoadedEnvPath()),
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        service: "youtube-scraper",
      });
    }

    if (request.method === "GET") {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return serveStatic("/index.html", response);
      }

      if (url.pathname === "/app.js") {
        return serveStatic("/app.js", response);
      }

      if (url.pathname === "/styles.css") {
        return serveStatic("/styles.css", response);
      }

      return serveStatic(url.pathname, response);
    }

    return sendJson(response, 405, { error: "Metodo nao permitido." });
  } catch (error) {
    return sendJson(response, 500, { error: error.message });
  }
}

listenWithFallback(startPort);

function listenWithFallback(port, attemptsLeft = 20) {
  const app = http.createServer(handleRequest);

  app.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      const nextPort = port + 1;
      console.log(`Porta ${port} ocupada. Tentando http://localhost:${nextPort}`);
      listenWithFallback(nextPort, attemptsLeft - 1);
      return;
    }

    console.error(`Nao foi possivel iniciar o servidor: ${error.message}`);
    process.exit(1);
  });

  app.listen(port, () => {
    console.log(`YouTube Scraper rodando em http://localhost:${port}`);
    console.log("Mantenha esta janela aberta enquanto estiver usando o software.");
  });
}

function serveStatic(routePath, response) {
  const safePath = routePath === "/" ? "/index.html" : routePath;
  const filePath = path.resolve(publicDir, `.${safePath}`);

  if (!filePath.startsWith(publicDir)) {
    return sendText(response, 403, "Acesso negado.");
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendText(response, 404, "Arquivo nao encontrado.");
  }

  const extension = path.extname(filePath);
  const contentType =
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    }[extension] || "application/octet-stream";

  response.writeHead(200, { "content-type": contentType });
  fs.createReadStream(filePath).pipe(response);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(payload);
}
