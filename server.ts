import express from "express";
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '10mb' })); // Allow large image payloads

  const dbUrl = process.env.DATABASE_URL;
  let sql: any = null;

  if (dbUrl) {
    try {
      // Ensure the protocol is postgresql:// as requested by some versions of the neon driver
      const normalizedUrl = dbUrl.startsWith("postgres://") 
        ? dbUrl.replace("postgres://", "postgresql://") 
        : dbUrl;
      sql = neon(normalizedUrl);
    } catch (err) {
      console.error("Invalid DATABASE_URL format:", err);
    }
  } else {
    console.error("DATABASE_URL is not set. Please add it to your environment variables.");
  }

  // Initialize database table and migrations
  if (sql) {
    try {
      // Create table if not exists
      await sql`
        CREATE TABLE IF NOT EXISTS images (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          data TEXT NOT NULL,
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
      
      // Migration: Add description column if it doesn't exist (for existing tables)
      try {
        await sql`ALTER TABLE images ADD COLUMN IF NOT EXISTS description TEXT`;
      } catch (err) {
        // Ignore error if column already exists (some PG versions might throw even with IF NOT EXISTS)
        console.log("Migration: description column check finished");
      }

      console.log("Database table and migrations initialized");
    } catch (err) {
      console.error("Failed to initialize database:", err);
    }
  }

  // API Routes
  app.get("/api/images", async (req, res) => {
    if (!sql) {
      return res.status(500).json({ error: "Database not configured. Please set DATABASE_URL." });
    }
    try {
      const result = await sql`SELECT * FROM images ORDER BY created_at DESC`;
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch images" });
    }
  });

  app.post("/api/images", async (req, res) => {
    if (!sql) {
      return res.status(500).json({ error: "Database not configured. Please set DATABASE_URL." });
    }
    const { name, data } = req.body;
    if (!name || !data) {
      return res.status(400).json({ error: "Name and data are required" });
    }

    try {
      const result = await sql`
        INSERT INTO images (name, data, description) VALUES (${name}, ${data}, '') RETURNING *
      `;
      res.json(result[0]);
    } catch (err) {
      console.error("Database insert error:", err);
      res.status(500).json({ error: "Failed to save image to database" });
    }
  });

  app.delete("/api/images/:id", async (req, res) => {
    if (!sql) {
      return res.status(500).json({ error: "Database not configured. Please set DATABASE_URL." });
    }
    const { id } = req.params;
    try {
      await sql`DELETE FROM images WHERE id = ${id}`;
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete image" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    
    // SPA fallback: serve index.html for any non-API routes
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (process.env.NODE_ENV !== "production") {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }

  return app;
}

// Export the app directly for Vercel
export default startServer();
