import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

app.use(
  cors({
    origin: ALLOW_ORIGIN === "*" ? true : ALLOW_ORIGIN
  })
);

app.use(express.json({ limit: "25mb" }));

const videoJobs = new Map();

function requireKey(res) {
  if (!OPENAI_API_KEY) {
    res.status(500).json({
      error:
        "Chiave OPENAI_API_KEY mancante. Inseriscila nel file .env del backend."
    });
    return false;
  }

  return true;
}

function stripDataUrl(dataUrl = "") {
  if (typeof dataUrl !== "string") return "";

  const comma = dataUrl.indexOf(",");
  return comma >= 0
    ? dataUrl.slice(comma + 1)
    : dataUrl;
}

async function openaiRequest(path, body) {
  const response = await fetch(
    `${OPENAI_BASE_URL}${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      `Errore OpenAI ${response.status}`;

    throw new Error(message);
  }

  return data;
}

function getResponseText(data) {
  if (
    typeof data?.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text;
  }

  if (Array.isArray(data?.output)) {
    const parts = [];

    for (const item of data.output) {
      if (Array.isArray(item?.content)) {
        for (const content of item.content) {
          if (typeof content?.text === "string") {
            parts.push(content.text);
          }
        }
      }
    }

    if (parts.length) {
      return parts.join("\n");
    }
  }

  return "";
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "AI Italia Backend",
    keyConfigured: !!OPENAI_API_KEY
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!requireKey(res)) return;

    const messages =
      Array.isArray(req.body?.messages)
        ? req.body.messages
        : [];

    if (!messages.length) {
      return res.status(400).json({
        error: "messages mancante o vuoto"
      });
    }

    const input = messages.map(m => ({
      role:
        m.role === "assistant"
          ? "assistant"
          : "user",
      content: [
        {
          type: "input_text",
          text: String(m.content || "")
        }
      ]
    }));

    const data = await openaiRequest(
      "/responses",
      {
        model:
          process.env.OPENAI_CHAT_MODEL ||
          "gpt-5-mini",
        input
      }
    );

    const text = getResponseText(data);

    res.json({
      text:
        text ||
        "Nessuna risposta disponibile."
    });
  } catch (error) {
    res.status(500).json({
      error:
        error.message ||
        "Errore chat"
    });
  }
});

app.post("/api/image", async (req, res) => {
  try {
    if (!requireKey(res)) return;

    const prompt =
      String(req.body?.prompt || "").trim();

    const size =
      String(
        req.body?.size ||
        "1024x1024"
      );

    if (!prompt) {
      return res.status(400).json({
        error: "prompt mancante"
      });
    }

    const data = await openaiRequest(
      "/images/generations",
      {
        model:
          process.env.OPENAI_IMAGE_MODEL ||
          "gpt-image-1",
        prompt,
        size
      }
    );

    const first =
      data?.data?.[0] || {};

    res.json({
      url: first.url || "",
      image_base64:
        first.b64_json || ""
    });
  } catch (error) {
    res.status(500).json({
      error:
        error.message ||
        "Errore immagine"
    });
  }
});

app.post(
  "/api/image/edit",
  async (req, res) => {
    try {
      if (!requireKey(res)) return;

      const prompt =
        String(
          req.body?.prompt || ""
        ).trim();

      const image =
        stripDataUrl(
          req.body?.image || ""
        );

      if (!prompt || !image) {
        return res.status(400).json({
          error:
            "prompt o image mancanti"
        });
      }

      const data = await openaiRequest(
        "/images/edits",
        {
          model:
            process.env.OPENAI_IMAGE_MODEL ||
            "gpt-image-1",
          prompt,
          image
        }
      );

      const first =
        data?.data?.[0] || {};

      res.json({
        url: first.url || "",
        image_base64:
          first.b64_json || ""
      });
    } catch (error) {
      res.status(500).json({
        error:
          error.message ||
          "Errore modifica immagine"
      });
    }
  }
);

app.post("/api/video", async (req, res) => {
  try {
    const prompt =
      String(
        req.body?.prompt || ""
      ).trim();

    if (!prompt) {
      return res.status(400).json({
        error: "prompt mancante"
      });
    }

    const id =
      `job_${Date.now()}_` +
      Math.random()
        .toString(36)
        .slice(2, 8);

    videoJobs.set(id, {
      status: "failed",
      error:
        "Video backend da completare."
    });

    res.json({
      job_id: id
    });
  } catch (error) {
    res.status(500).json({
      error:
        error.message ||
        "Errore video"
    });
  }
});

app.get(
  "/api/video-status",
  (req, res) => {
    const id =
      String(req.query?.id || "");

    if (
      !id ||
      !videoJobs.has(id)
    ) {
      return res.status(404).json({
        error:
          "job non trovato",
        status: "failed"
      });
    }

    return res.json(
      videoJobs.get(id)
    );
  }
);

app.listen(PORT, () => {
  console.log(
    `AI Italia backend avviato su http://localhost:${PORT}`
  );
});
