import express from "express";
import { neon } from "@neondatabase/serverless";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import crypto from "node:crypto";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSION_DAYS = 30;
const COOKIE_NAME = "kokjoke_session";
const aiModels = new Set(["gemini-3-flash-preview", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.1-pro-preview"]);
type Attachment = { data: string; mimeType: string; name?: string };

function safeEqual(a: string, b: string): boolean {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

function getToken(cookieHeader = ""): string {
  const cookie = cookieHeader.split(";").map(part => part.trim())
    .find(part => part.startsWith(COOKIE_NAME + "="));
  return cookie ? cookie.slice(COOKIE_NAME.length + 1) : "";
}

function validSession(token: string): boolean {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

function makeSession(): string {
  const payload = Buffer.from(JSON.stringify({
    sid: crypto.randomUUID(),
    exp: Date.now() + SESSION_DAYS * 86400000
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("base64url");
  return payload + "." + signature;
}

function normalizeAttachments(input: unknown): Attachment[] {
  if (!Array.isArray(input)) return [];
  if (input.length > 3) throw new Error("Maximal drei Anhänge erlaubt.");
  return input.map(item => {
    if (!item || typeof item !== "object") throw new Error("Ungültiger Anhang.");
    const { data, mimeType, name } = item;
    if (typeof data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(data) || data.length > 2700000)
      throw new Error("Anhang zu groß oder ungültig (max. etwa 2 MB).");
    if (typeof mimeType !== "string" || !(/^(image\/(png|jpeg|webp|gif)|application\/pdf|text\/plain)$/.test(mimeType)))
      throw new Error("Dateityp nicht unterstützt.");
    return { data, mimeType, name: typeof name === "string" ? name.slice(0, 100) : "Datei" };
  });
}

function parseAttachments(value: any): Attachment[] {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || "[]"); } catch { return []; }
}

async function startServer() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10mb" }));

  const dbUrl = process.env.DATABASE_URL;
  const sql = dbUrl ? neon(dbUrl.startsWith("postgres://") ? dbUrl.replace("postgres://", "postgresql://") : dbUrl) : null;

  if (sql) {
    try {
      await sql\`
        CREATE TABLE IF NOT EXISTS images (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          data TEXT NOT NULL,
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      \`;
      await sql\`ALTER TABLE images ADD COLUMN IF NOT EXISTS description TEXT\`;
      await sql\`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id BIGSERIAL PRIMARY KEY,
          room TEXT NOT NULL CHECK (room IN ('group','ai')),
          client_id TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL CHECK (role IN ('user','assistant')),
          sender TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL,
          attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      \`;
      await sql\`CREATE INDEX IF NOT EXISTS idx_chat_room_client_id ON chat_messages (room, client_id, id DESC)\`;
    } catch (err) {
      console.error("Database initialization failed", err);
    }
  } else {
    console.error("DATABASE_URL is not configured");
  }

  app.post("/api/login", (req, res) => {
    const expected = process.env.APP_PASSWORD;
    if (!expected || !process.env.SESSION_SECRET)
      return res.status(503).json({ error: "App-Zugang ist nicht konfiguriert." });
    const submitted = typeof req.body?.password === "string" ? req.body.password : "";
    if (!safeEqual(submitted, expected)) return res.status(401).json({ error: "Falsches Passwort." });
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", COOKIE_NAME + "=" + makeSession() + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + (SESSION_DAYS * 86400) + secure);
    return res.json({ ok: true });
  });

  app.get("/api/session", (req, res) => res.json({ authenticated: validSession(getToken(req.headers.cookie)) }));

  app.post("/api/logout", (_req, res) => {
    res.setHeader("Set-Cookie", COOKIE_NAME + "=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    res.json({ ok: true });
  });

  app.use("/api", (req, res, next) => {
    if (!validSession(getToken(req.headers.cookie)))
      return res.status(401).json({ error: "Bitte erneut anmelden." });
    next();
  });

  app.get("/api/images", async (_req, res) => {
    if (!sql) return res.status(503).json({ error: "Datenbank nicht konfiguriert." });
    try {
      const records = await sql\`SELECT * FROM images ORDER BY created_at DESC\`;
      return res.json(records);
    } catch (err) {
      console.error("Image listing failed", err);
      return res.status(500).json({ error: "Bilder konnten nicht geladen werden." });
    }
  });

  app.post("/api/images", async (req, res) => {
    if (!sql) return res.status(503).json({ error: "Datenbank nicht konfiguriert." });
    const { name, data } = req.body || {};
    if (typeof name !== "string" || !name.trim() || typeof data !== "string" || !data.startsWith("data:image/"))
      return res.status(400).json({ error: "Name und Bild sind erforderlich." });
    try {
      const records = await sql\`INSERT INTO images (name, data, description) VALUES (\${name.slice(0, 200)}, \${data}, '') RETURNING *\`;
      return res.json(records[0]);
    } catch (err) {
      console.error("Image upload failed", err);
      return res.status(500).json({ error: "Bild konnte nicht gespeichert werden." });
    }
  });

  app.delete("/api/images/:id", async (req, res) => {
    if (!sql) return res.status(503).json({ error: "Datenbank nicht konfiguriert." });
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Ungültige ID" });
    try {
      await sql\`DELETE FROM images WHERE id = \${id}\`;
      return res.json({ success: true });
    } catch (err) {
      console.error("Image deletion failed", err);
      return res.status(500).json({ error: "Bild konnte nicht gelöscht werden." });
    }
  });

  app.get("/api/chat/messages", async (req, res) => {
    if (!sql) return res.status(503).json({ error: "Datenbank nicht konfiguriert." });
    const room = req.query.room === "group" ? "group" : req.query.room === "ai" ? "ai" : "";
    const clientId = typeof req.query.clientId === "string" ? req.query.clientId : "";
    if (!room || (room === "ai" && !/^[a-f0-9-]{36}$/i.test(clientId)))
      return res.status(400).json({ error: "Ungültiger Chat." });
    const before = typeof req.query.before === "string" && /^\d+$/.test(req.query.before)
      ? req.query.before : "9223372036854775807";
    try {
      const records = await sql\`
        SELECT * FROM chat_messages
        WHERE room = \${room} AND client_id = \${room === "ai" ? clientId : ""}
          AND id < \${before}::bigint
        ORDER BY id DESC LIMIT 100
      \`;
      return res.json(records.reverse());
    } catch (err) {
      console.error("Chat listing failed", err);
      return res.status(500).json({ error: "Nachrichten konnten nicht geladen werden." });
    }
  });

  app.post("/api/chat/group", async (req, res) => {
    if (!sql) return res.status(503).json({ error: "Datenbank nicht konfiguriert." });
    const sender = typeof req.body?.sender === "string" ? req.body.sender.trim().slice(0, 40) : "";
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!sender || content.length > 8000) return res.status(400).json({ error: "Name oder Nachricht ungültig." });
    let attachments: Attachment[];
    try { attachments = normalizeAttachments(req.body?.attachments); }
    catch (err: any) { return res.status(400).json({ error: err.message }); }
    if (!content && attachments.length === 0) return res.status(400).json({ error: "Nachricht fehlt." });
    try {
      const recent = await sql\`
        SELECT COUNT(*)::int AS total FROM chat_messages
        WHERE room = 'group' AND sender = \${sender} AND created_at > NOW() - INTERVAL '1 minute'
      \`;
      if (Number(recent[0]?.total || 0) >= 15)
        return res.status(429).json({ error: "Zu viele Nachrichten. Bitte kurz warten." });
      const records = await sql\`
        INSERT INTO chat_messages (room, client_id, role, sender, content, attachments)
        VALUES ('group', '', 'user', \${sender}, \${content}, \${JSON.stringify(attachments)}::jsonb)
        RETURNING *
      \`;
      return res.json(records[0]);
    } catch (err) {
      console.error("Group message insert failed", err);
      return res.status(500).json({ error: "Nachricht konnte nicht gespeichert werden." });
    }
  });

  app.post("/api/chat/ai", async (req, res) => {
    if (!sql) return res.status(503).json({ error: "Datenbank nicht konfiguriert." });
    const clientId = typeof req.body?.clientId === "string" ? req.body.clientId : "";
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    const requestedModel = typeof req.body?.model === "string" ? req.body.model : "";
    const model = aiModels.has(requestedModel) ? requestedModel : "gemini-3-flash-preview";
    if (!/^[a-f0-9-]{36}$/i.test(clientId) || content.length > 12000)
      return res.status(400).json({ error: "Nachricht oder Chat-ID ungültig." });
    if (!process.env.GEMINI_API_KEY)
      return res.status(503).json({ error: "KI-Zugang ist auf dem Server nicht konfiguriert." });
    let attachments: Attachment[];
    try { attachments = normalizeAttachments(req.body?.attachments); }
    catch (err: any) { return res.status(400).json({ error: err.message }); }
    if (!content && !attachments.length)
      return res.status(400).json({ error: "Nachricht fehlt." });

    try {
      const usage = await sql\`
        SELECT COUNT(*)::int AS total FROM chat_messages
        WHERE room='ai' AND role='user' AND created_at > NOW() - INTERVAL '1 hour'
      \`;
      if (Number(usage[0]?.total || 0) >= 100)
        return res.status(429).json({ error: "Das stündliche KI-Limit der App ist erreicht." });

      const inserted = await sql\`
        INSERT INTO chat_messages (room, client_id, role, sender, content, attachments)
        VALUES ('ai', \${clientId}, 'user', 'Du', \${content}, \${JSON.stringify(attachments)}::jsonb)
        RETURNING *
      \`;
      const recent = await sql\`
        SELECT role, content, attachments FROM chat_messages
        WHERE room='ai' AND client_id=\${clientId}
        ORDER BY id DESC LIMIT 24
      \`;
      const contents = recent.reverse().map(msg => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [
          { text: msg.content || (parseAttachments(msg.attachments).length ? "Analysiere diese Anhänge." : " ") },
          ...parseAttachments(msg.attachments).map(att => ({
            inlineData: { mimeType: att.mimeType, data: att.data }
          }))
        ]
      }));

      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      const send = (data: object) => res.write("data: " + JSON.stringify(data) + "\n\n");
      send({ type: "user", message: inserted[0] });
      let fullContent = "";
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const stream = await ai.models.generateContentStream({
          model,
          contents,
          config: {
            systemInstruction: "Du bist ein hilfreicher, freundlicher, prägnanter KI-Assistent. Antworte standardmäßig auf Deutsch. Beziehe die Chat-Historie ein. Du kannst Bilder und Dokumente analysieren."
          }
        });
        for await (const chunk of stream) {
          if (chunk.text) {
            fullContent += chunk.text;
            send({ type: "delta", text: chunk.text });
          }
        }
        const records = await sql\`
          INSERT INTO chat_messages (room, client_id, role, sender, content)
          VALUES ('ai', \${clientId}, 'assistant', 'KI', \${fullContent || "(Keine Textantwort erhalten)"})
          RETURNING *
        \`;
        send({ type: "done", message: records[0] });
      } catch (err: any) {
        console.error("AI generation error:", err?.message || err);
        const raw = String(err?.message || "");
        const message = /429|quota|rate.limit/i.test(raw) ? "Das Gemini-Nutzungslimit wurde erreicht." :
          /401|403|API_KEY_INVALID|API key not valid/i.test(raw) ? "Der hinterlegte KI-API-Schlüssel wurde abgelehnt. Bitte in Vercel prüfen." :
          "Die KI konnte gerade nicht antworten. Deine Nachricht bleibt gespeichert.";
        send({ type: "error", error: message });
      }
      return res.end();
    } catch (err) {
      console.error("AI chat request failed", err);
      if (!res.headersSent) return res.status(500).json({ error: "KI-Nachricht konnte nicht gesendet werden." });
      return res.end();
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
    app.listen(3000, "0.0.0.0", () => console.log("Server läuft auf Port 3000"));
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  return app;
}

export default startServer();
