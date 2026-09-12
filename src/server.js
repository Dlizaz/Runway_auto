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

// Nhan 2 kieu du lieu:
// 1) Kieu form nhap tay (mac dinh tren web): field "rowsJson" = JSON string
//    [{ id, prompt, image? }], cong voi field global "model", "duration", "upscale".
// 2) Kieu CSV (nang cao): field "csv" la 1 file CSV voi cot id, prompt, model, duration, image.
// Ca 2 kieu deu co the kem field "images" = nhieu file anh, ten file phai
// trung voi gia tri cot/truong "image" tuong ung.
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

      const imageMap = {};
      for (const file of req.files.images || []) {
        imageMap[file.originalname] = file.path;
      }

      let items = [];

      if (req.files?.csv?.[0]) {
        // Kieu CSV
        const csvContent = fs.readFileSync(req.files.csv[0].path, "utf8");
        const rows = parse(csvContent, {
          columns: true,
          skip_empty_lines: true,
          trim: true
        });

        items = rows.map((row) => ({
          ...row,
          imagePath: row.image ? imageMap[row.image] : undefined
        }));
      } else if (req.body?.rowsJson) {
        // Kieu form nhap tay
        const rows = JSON.parse(req.body.rowsJson);

        items = rows.map((row) => ({
          id: row.id,
          prompt: row.prompt,
          model: req.body.model,
          duration: req.body.duration,
          imagePath: row.image ? imageMap[row.image] : undefined
        }));
      } else {
        return res.status(400).json({ error: "Thieu du lieu: can rowsJson hoac file csv" });
      }

      items = items.filter((item) => item.prompt && item.prompt.trim());

      if (items.length === 0) {
        return res.status(400).json({ error: "Chua co prompt nao" });
      }

      const state = getQueueState();
      if (state.isRunning) {
        return res.status(409).json({ error: "Hang doi dang chay, doi xong hoac Stop truoc" });
      }

      res.json({ ok: true, count: items.length });

      const upscaleEnabled = req.body.upscale !== "false";

      // Chay nen, khong block response - de nguoi dung dong tab di lam viec khac
      runQueue(items, {
        model: req.body.model || "gen4.5",
        ratio: "1280:720",
        duration: Number(req.body.duration) || 5,
        concurrency: Number(process.env.QUEUE_CONCURRENCY) || 2,
        upscaleEnabled,
        upscaleResolution: "4k"
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
