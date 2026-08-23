import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_BASE_URL = process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";

app.use(cors({ origin: ALLOW_ORIGIN === "*" ? true : ALLOW_ORIGIN }));
app.use(express.json({ limit: "50mb" }));

const videoJobs = new Map();

function requireKey(res) {
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: "Chiave OPENAI_API_KEY mancante." });
    return false;
  }
  return true;
}

function requireElevenLabsKey(res) {
  if (!ELEVENLABS_API_KEY) {
    res.status(500).json({ error: "Chiave ELEVENLABS_API_KEY mancante." });
    return false;
  }
  return true;
}

async function readJson(response) {
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!response.ok) {
    const message = data?.error?.message || data?.message || `Errore OpenAI ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function openaiJson(path, body) {
  const response = await fetch(`${OPENAI_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });
  return readJson(response);
}

function responseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text;
  const parts = [];
  for (const item of data?.output || []) {
    for (const c of item?.content || []) {
      if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("\n");
}

function dataUrlParts(dataUrl = "") {
  const m = String(dataUrl).match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/s);
  if (!m) return null;
  return { mime: m[1] || "application/octet-stream", base64: m[2] };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "AI Italia Backend",
    version: "7.0-elevenlabs-music",
    keyConfigured: !!OPENAI_API_KEY,
    elevenLabsConfigured: !!ELEVENLABS_API_KEY
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!requireKey(res)) return;

    const message = String(req.body?.message || "").trim() || "Analizza gli allegati.";
    const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
    const previousResponseId = req.body?.previous_response_id || undefined;
    const useWeb = !!req.body?.web;

    const content = [{ type: "input_text", text: message }];

    for (const a of attachments.slice(0, 4)) {
      const kind = a?.kind;
      const data = String(a?.data || "");
      const name = String(a?.name || "allegato");

      if (kind === "image" && data.startsWith("data:image/")) {
        content.push({
          type: "input_image",
          image_url: data,
          detail: "auto"
        });
      } else if (kind === "file" && data.startsWith("data:")) {
        content.push({
          type: "input_file",
          filename: name,
          file_data: data
        });
      }
    }

    const body = {
      model: process.env.OPENAI_CHAT_MODEL || "gpt-5.6-luna",
      instructions:
        "Sei AI Italia, un assistente generale in lingua italiana. Rispondi in modo chiaro e utile. " +
        "Quando ricevi immagini o file, analizzali direttamente. Se l'utente chiede una sintesi, estrai i punti principali. " +
        "Se un'informazione dipende dal web e lo strumento web è disponibile, usalo.",
      input: [{ role: "user", content }]
    };

    if (previousResponseId) body.previous_response_id = previousResponseId;
    if (useWeb) body.tools = [{ type: "web_search" }];

    const data = await openaiJson("/responses", body);
    const text = responseText(data);

    res.json({
      text: text || "Nessuna risposta disponibile.",
      response_id: data.id || ""
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Errore chat" });
  }
});

app.post("/api/image", async (req, res) => {
  try {
    if (!requireKey(res)) return;

    const prompt = String(req.body?.prompt || "").trim();
    const size = String(req.body?.size || "1024x1024");
    if (!prompt) return res.status(400).json({ error: "prompt mancante" });

    const data = await openaiJson("/images/generations", {
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
      prompt,
      size
    });

    const first = data?.data?.[0] || {};
    res.json({
      url: first.url || "",
      image_base64: first.b64_json || ""
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Errore immagine" });
  }
});

app.post("/api/image/edit", async (req, res) => {
  try {
    if (!requireKey(res)) return;

    const prompt = String(req.body?.prompt || "").trim();
    const raw = String(req.body?.image || "");
    const filename = String(req.body?.filename || "image.png");
    const requestedSize = String(req.body?.size || "1024x1024");
    const allowedSizes = new Set(["1024x1024","1536x1024","1024x1536"]);
    const size = allowedSizes.has(requestedSize) ? requestedSize : "1024x1024";
    const parsed = dataUrlParts(raw);

    if (!prompt || !parsed) {
      return res.status(400).json({ error: "prompt o immagine mancanti" });
    }

    const bytes = Buffer.from(parsed.base64, "base64");
    const form = new FormData();
    form.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-2");
    form.append("prompt", prompt);
    form.append("size", size);
    form.append("image", new Blob([bytes], { type: parsed.mime }), filename);

    const response = await fetch(`${OPENAI_BASE_URL}/images/edits`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
      body: form
    });

    const data = await readJson(response);
    const first = data?.data?.[0] || {};

    res.json({
      url: first.url || "",
      image_base64: first.b64_json || ""
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Errore modifica immagine" });
  }
});


app.post("/api/speech", async (req, res) => {
  try {
    if (!requireKey(res)) return;

    const text = String(req.body?.text || "").trim();
    const voiceType = String(req.body?.voice_type || "male");

    if (!text) {
      return res.status(400).json({ error: "testo mancante" });
    }

    // Etichette nell'app:
    // uomo -> onyx (timbro più profondo)
    // donna -> nova (timbro più chiaro)
    const voice = voiceType === "female" ? "nova" : "onyx";

    const response = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
        voice,
        input: text,
        response_format: "mp3"
      })
    });

    if (!response.ok) {
      const raw = await response.text();
      let message = `Errore OpenAI voce ${response.status}`;
      try {
        const d = JSON.parse(raw);
        message = d?.error?.message || message;
      } catch {}
      return res.status(response.status).json({ error: message });
    }

    const audio = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(audio);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Errore generazione voce"
    });
  }
});


app.post("/api/music", async (req, res) => {
  try {
    if (!requireElevenLabsKey(res)) return;

    const idea = String(req.body?.prompt || "").trim();
    const lyrics = String(req.body?.lyrics || "").trim();
    const genre = String(req.body?.genre || "pop").trim();
    const vocalist = String(req.body?.vocalist || "auto").trim();
    const requestedDuration = Number(req.body?.duration || 30);

    if (!idea && !lyrics) {
      return res.status(400).json({ error: "idea o testo della canzone mancanti" });
    }

    // Eleven Music accepts 3–600 seconds. Keep the app conservative by default.
    const durationSeconds = Math.max(10, Math.min(120, requestedDuration || 30));
    const musicLengthMs = Math.round(durationSeconds * 1000);

    let singer = "Italian lead vocalist";
    if (vocalist === "male") singer = "Italian male lead vocalist";
    if (vocalist === "female") singer = "Italian female lead vocalist";

    const promptParts = [
      "Create a complete original song with instrumental accompaniment and sung vocals.",
      `Genre/style: ${genre}.`,
      `${singer}, natural expressive singing.`,
      "The vocals must sing in Italian.",
      "Use a clear song structure with intro, verses, chorus and ending.",
      "Do not imitate a specific real artist or existing copyrighted song."
    ];

    if (idea) promptParts.push(`Theme and direction: ${idea}`);
    if (lyrics) {
      promptParts.push(
        "Use the following original lyrics as the lyrical content. Preserve the meaning and wording as much as musically possible:",
        lyrics
      );
    }

    // API prompt limit is 4100 characters.
    const musicPrompt = promptParts.join("\n").slice(0, 4050);

    const response = await fetch(
      `${ELEVENLABS_BASE_URL}/v1/music?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY
        },
        body: JSON.stringify({
          prompt: musicPrompt,
          music_length_ms: musicLengthMs,
          model_id: process.env.ELEVENLABS_MUSIC_MODEL || "music_v2",
          force_instrumental: false
        })
      }
    );

    if (!response.ok) {
      const raw = await response.text();
      let message = `Errore ElevenLabs Music ${response.status}`;
      try {
        const data = JSON.parse(raw);
        message =
          data?.detail?.message ||
          data?.detail ||
          data?.error?.message ||
          data?.message ||
          message;
      } catch {
        if (raw && raw.length < 500) message = raw;
      }

      return res.status(response.status).json({ error: String(message) });
    }

    const audio = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "audio/mpeg";
    const songId = response.headers.get("song-id") || "";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", 'inline; filename="AI-Italia-canzone.mp3"');
    if (songId) res.setHeader("X-ElevenLabs-Song-Id", songId);
    res.send(audio);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Errore generazione canzone cantata"
    });
  }
});

app.post("/api/video", async (req, res) => {
  try {
    if (!requireKey(res)) return;

    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) {
      return res.status(400).json({ error: "prompt mancante" });
    }

    // OpenAI Videos API supporta 4, 8 o 12 secondi.
    const requested = Number(req.body?.duration || 4);
    const seconds =
      requested <= 5 ? "4" :
      requested <= 10 ? "8" : "12";

    const model = process.env.OPENAI_VIDEO_MODEL || "sora-2";
    const size = String(req.body?.size || "720x1280");
    const image = String(req.body?.image || "");

    let data;

    if (image.startsWith("data:image/")) {
      const parsed = dataUrlParts(image);
      if (!parsed) {
        return res.status(400).json({ error: "immagine iniziale non valida" });
      }

      const bytes = Buffer.from(parsed.base64, "base64");
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", prompt);
      form.append("seconds", seconds);
      form.append("size", size);
      form.append(
        "input_reference",
        new Blob([bytes], { type: parsed.mime }),
        "reference-image.png"
      );

      const response = await fetch(`${OPENAI_BASE_URL}/videos`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: form
      });

      data = await readJson(response);
    } else {
      data = await openaiJson("/videos", {
        model,
        prompt,
        seconds,
        size
      });
    }

    if (!data?.id) {
      throw new Error("OpenAI non ha restituito l'ID del video.");
    }

    res.json({
      job_id: data.id,
      status: data.status || "queued",
      progress: data.progress || 0,
      seconds: data.seconds || seconds,
      size: data.size || size
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Errore generazione video"
    });
  }
});

app.get("/api/video-status", async (req, res) => {
  try {
    if (!requireKey(res)) return;

    const id = String(req.query?.id || "").trim();
    if (!id) {
      return res.status(400).json({
        error: "job_id mancante",
        status: "failed"
      });
    }

    const response = await fetch(
      `${OPENAI_BASE_URL}/videos/${encodeURIComponent(id)}`,
      {
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        }
      }
    );

    const data = await readJson(response);

    if (data.status === "failed") {
      return res.json({
        status: "failed",
        progress: data.progress || 0,
        error: data?.error?.message || "Generazione video non riuscita."
      });
    }

    if (data.status === "completed") {
      const base = `${req.protocol}://${req.get("host")}`;
      return res.json({
        status: "completed",
        progress: 100,
        url: `${base}/api/video-content?id=${encodeURIComponent(id)}`
      });
    }

    return res.json({
      status: data.status || "in_progress",
      progress: data.progress || 0
    });
  } catch (error) {
    res.status(500).json({
      error: error.message || "Errore stato video",
      status: "failed"
    });
  }
});

app.get("/api/video-content", async (req, res) => {
  try {
    if (!requireKey(res)) return;

    const id = String(req.query?.id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "video id mancante" });
    }

    const response = await fetch(
      `${OPENAI_BASE_URL}/videos/${encodeURIComponent(id)}/content`,
      {
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        }
      }
    );

    if (!response.ok) {
      const data = await response.text();
      return res.status(response.status).send(data);
    }

    const contentType = response.headers.get("content-type") || "video/mp4";
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${id}.mp4"`
    );
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buffer);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Errore download video"
    });
  }
});

app.listen(PORT, () => {
  console.log(`AI Italia backend v7 avviato su porta ${PORT}`);
});
