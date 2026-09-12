import "dotenv/config";
import express from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";

import {
  runQueue,
  enqueueItem,
  pauseQueue,
  resumeQueue,
  stopQueue,
  pauseItem,
  resumeItem,
  stopItem,
  getQueueState
} from "./queue.js";
import { loadStatus, getItem, updateItemStatus, getUnfinishedItems } from "./storage.js";
import { getVideoBucket, ObjectId } from "./db.js";
import { PROMPT_MAX_LENGTH } from "./runway.js";

const app = express();
app.use(express.json());

// Luu file trong RAM (khong ghi ra dia cua Railway) - anh se duoc chuyen
// thanh base64 va luu thang trong document Mongo cua item do.
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static("public"));

app.get("/api/status", async (req, res) => {
  try {
    const items = await loadStatus();
    res.json({ items, queue: getQueueState(), promptMaxLength: PROMPT_MAX_LENGTH });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// --- Dieu khien chung ca hang doi (giu tuong thich ban cu) ---
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

// --- Dieu khien rieng tung video ---
app.post("/api/item/:id/pause", async (req, res) => {
  try {
    const id = req.params.id;
    pauseItem(id);
    // Cap nhat trang thai hien thi ngay; qua trinh xu ly ben duoi (queue.js)
    // se tu kiem tra co "paused" o buoc kiem tra tiep theo va dung lai that su.
    await updateItemStatus(id, { state: "PAUSED" });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/item/:id/resume", async (req, res) => {
  try {
    const id = req.params.id;
    const item = await getItem(id);
    if (!item) return res.status(404).json({ error: "Khong tim thay video nay" });

    const wasTerminal = ["STOPPED", "FAILED"].includes(item.state);
    resumeItem(id);

    // Neu video da dung han (Stop) hoac loi han (Failed), phai dua lai vao
    // hang doi xu ly tu dau (Runway khong the "tiep tuc" 1 task da huy/loi).
    // Neu chi dang Pause (van con trong vong lap cho o queue.js) thi chi
    // can bo co paused la du, khong can enqueue lai.
    if (wasTerminal) {
      enqueueItem(item).catch((err) => console.error(`Resume ${id} loi:`, err));
    }

    res.json({ ok: true, requeued: wasTerminal });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/item/:id/stop", async (req, res) => {
  try {
    await stopItem(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Phat video da render tu MongoDB GridFS (thay cho express.static("downloads")
// truoc day, vi dia cua Railway bi xoa moi lan redeploy/restart).
app.get("/videos/:id", async (req, res) => {
  try {
    const bucket = await getVideoBucket();
    const _id = new ObjectId(req.params.id);
    const files = await bucket.find({ _id }).toArray();
    if (!files[0]) return res.status(404).send("Khong tim thay video");

    res.set("Content-Type", files[0].contentType || "video/mp4");
    res.set("Content-Disposition", `inline; filename="${files[0].filename}"`);
    bucket.openDownloadStream(_id).on("error", () => res.end()).pipe(res);
  } catch (error) {
    res.status(404).send("Khong tim thay video");
  }
});

function bufferToDataUrl(buffer, originalName) {
  const ext = (originalName.split(".").pop() || "jpg").toLowerCase();
  const mime = ext === "jpg" ? "jpeg" : ext;
  return `data:image/${mime};base64,${buffer.toString("base64")}`;
}

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
        imageMap[file.originalname] = bufferToDataUrl(file.buffer, file.originalname);
      }

      let rawItems = [];

      if (req.files?.csv?.[0]) {
        // Kieu CSV
        const csvContent = req.files.csv[0].buffer.toString("utf8");
        const rows = parse(csvContent, {
          columns: true,
          skip_empty_lines: true,
          trim: true
        });

        rawItems = rows.map((row) => ({
          id: row.id,
          prompt: row.prompt,
          model: row.model || req.body.model,
          duration: row.duration || req.body.duration,
          imageDataUrl: row.image ? imageMap[row.image] : undefined
        }));
      } else if (req.body?.rowsJson) {
        // Kieu form nhap tay
        const rows = JSON.parse(req.body.rowsJson);

        rawItems = rows.map((row) => ({
          id: row.id,
          prompt: row.prompt,
          model: req.body.model,
          duration: req.body.duration,
          imageDataUrl: row.image ? imageMap[row.image] : undefined
        }));
      } else {
        return res.status(400).json({ error: "Thieu du lieu: can rowsJson hoac file csv" });
      }

      rawItems = rawItems.filter((item) => item.prompt && item.prompt.trim());

      if (rawItems.length === 0) {
        return res.status(400).json({ error: "Chua co prompt nao" });
      }

      const state = getQueueState();
      if (state.isRunning) {
        return res.status(409).json({ error: "Hang doi dang chay, doi xong hoac Stop truoc" });
      }

      const upscaleEnabled = req.body.upscale !== "false";
      const ratio = "1280:720";

      // Chan truoc nhung prompt vuot qua gioi han cua Runway (1000 ky tu cho
      // promptText) - day la gioi han cua chinh Runway, khong the nang len
      // 15000 duoc, nen thay vi de request that bai giua chung thi bao loi
      // ro rang cho tung dong ngay tu dau va KHONG dua vao hang doi.
      const items = [];
      const rejected = [];

      for (const raw of rawItems) {
        const prompt = raw.prompt.trim();
        if (prompt.length > PROMPT_MAX_LENGTH) {
          rejected.push({ id: raw.id, length: prompt.length });
          await updateItemStatus(raw.id, {
            state: "FAILED",
            prompt,
            error: `promptText: Prompt dai ${prompt.length} ky tu, vuot qua gioi han ${PROMPT_MAX_LENGTH} ky tu cua Runway`,
            errorCode: "too_big",
            errorField: "promptText",
            errorStatus: 400
          });
          continue;
        }

        items.push({
          id: raw.id,
          prompt,
          model: raw.model || "gen4.5",
          duration: Number(raw.duration) || 5,
          ratio,
          imageDataUrl: raw.imageDataUrl,
          upscaleEnabled,
          upscaleResolution: "4k"
        });
      }

      if (items.length === 0) {
        return res.status(400).json({
          error: `Tat ca prompt deu vuot qua ${PROMPT_MAX_LENGTH} ky tu, khong co video nao duoc queue`,
          rejected
        });
      }

      res.json({ ok: true, count: items.length, rejected });

      // Ghi truoc trang thai QUEUED cho tung item (dung tru khi server bi
      // restart giua chung, item van con nam trong DB de tu resume duoc).
      for (const item of items) {
        await updateItemStatus(item.id, { ...item, state: "QUEUED", error: null });
      }

      // Chay nen, khong block response - de nguoi dung dong tab di lam viec khac
      runQueue(items).catch((err) => console.error("Queue error:", err));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * Neu server bi Railway restart/redeploy giua luc dang render, cac video
 * chua toi trang thai cuoi (DONE/FAILED/STOPPED) se duoc tu dong day lai
 * vao hang doi khi server khoi dong lai, vi toan bo du lieu can thiet
 * (prompt, model, anh dang base64...) da nam san trong MongoDB.
 */
async function resumeInterruptedItems() {
  try {
    const items = await getUnfinishedItems();
    if (items.length === 0) return;
    console.log(`Tim thay ${items.length} video do dang, tu dong render tiep...`);
    for (const item of items) {
      enqueueItem(item).catch((err) => console.error(`Resume ${item.id} loi:`, err));
    }
  } catch (error) {
    console.error("Khong resume duoc video do dang:", error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  resumeInterruptedItems();
});
