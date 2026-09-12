import "dotenv/config";
import express from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import fs from "fs";

import { runQueue, pauseQueue, resumeQueue, stopQueue, getQueueState } from "./queue.js";
import { loadStatus } from "./storage.js";

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(express.static("public"));
app.use("/downloads", express.static("downloads"));

app.get("/api/status", (req, res) => {
  res.json({ items: loadStatus(), queue: getQueueState() });
});

app.post("/api/pause", (req, res) => {
  pauseQueue();
  res.json({ ok: true });
});

app.post("/api/resume", (req, res) => {
  resumeQueue();
  res.json({ ok: true });
});

app.post("/api/stop", (req, res) => {
  stopQueue();
  res.json({ ok: true });
});

// Upload CSV (bat buoc) + nhieu anh (tuy chon).
// CSV can cot: id, prompt, va tuy chon: model, duration, ratio, image
// Cot "image" phai trung ten file anh da upload (vi du: 001.jpg)
app.post(
  "/api/upload",
  upload.fields([
    { name: "csv", maxCount: 1 },
    { name: "images", maxCount: 300 }
  ]),
  async (req, res) => {
    try {
      if (!process.env.RUNWAYML_API_SECRET) {
        return res.status(400).json({ error: "Server missing RUNWAYML_API_SECRET" });
      }
      if (!req.files?.csv?.[0]) {
        return res.status(400).json({ error: "Thieu file CSV" });
      }

      const csvContent = fs.readFileSync(req.files.csv[0].path, "utf8");
      const rows = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });

      const imageMap = {};
      for (const file of req.files.images || []) {
        imageMap[file.originalname] = file.path;
      }

      const items = rows.map((row) => ({
        ...row,
        imagePath: row.image ? imageMap[row.image] : undefined
      }));

      if (items.length === 0) {
        return res.status(400).json({ error: "CSV khong co dong nao" });
      }

      const state = getQueueState();
      if (state.isRunning) {
        return res.status(409).json({ error: "Hang doi dang chay, doi xong hoac Stop truoc" });
      }

      res.json({ ok: true, count: items.length });

      // Chay nen, khong block response - de nguoi dung dong tab di lam viec khac
      runQueue(items, {
        model: "gen4.5",
        ratio: "1280:720",
        duration: 5,
        concurrency: Number(process.env.QUEUE_CONCURRENCY) || 2
      }).catch((err) => console.error("Queue error:", err));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  }
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
