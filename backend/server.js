import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

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
    version: "3.0-files-camera-voice",
    keyConfigured: !!OPENAI_API_KEY
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
    const parsed = dataUrlParts(raw);

    if (!prompt || !parsed) {
      return res.status(400).json({ error: "prompt o immagine mancanti" });
    }

    const bytes = Buffer.from(parsed.base64, "base64");
    const form = new FormData();
    form.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-2");
    form.append("prompt", prompt);
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

app.post("/api/video", async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "prompt mancante" });

    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    videoJobs.set(id, {
      status: "failed",
      error: "Il provider video non è ancora collegato in questa versione."
    });

    res.json({ job_id: id });
  } catch (error) {
    res.status(500).json({ error: error.message || "Errore video" });
  }
});

app.get("/api/video-status", (req, res) => {
  const id = String(req.query?.id || "");
  if (!id || !videoJobs.has(id)) {
    return res.status(404).json({ error: "job non trovato", status: "failed" });
  }
  return res.json(videoJobs.get(id));
});

app.listen(PORT, () => {
  console.log(`AI Italia backend v2 avviato su porta ${PORT}`);
});
