import pLimit from "p-limit";
import { generateVideo } from "./runway.js";
import { downloadVideo } from "./download.js";
import { uploadToDrive } from "./drive.js";
import { updateItemStatus, loadStatus } from "./storage.js";

const MAX_RETRIES = 2;

let isPaused = false;
let isStopped = false;
let isRunning = false;

export function getQueueState() {
  return { isPaused, isStopped, isRunning };
}

export function pauseQueue() {
  isPaused = true;
}

export function resumeQueue() {
  isPaused = false;
}

export function stopQueue() {
  isStopped = true;
}

async function waitWhilePaused() {
  while (isPaused && !isStopped) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function processItem(item, options) {
  // Resume: neu item nay da DONE roi thi bo qua
  const existing = loadStatus()[item.id];
  if (existing?.state === "DONE") {
    console.log(`Skip ${item.id}, already DONE`);
    return;
  }

  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    try {
      await waitWhilePaused();
      if (isStopped) {
        updateItemStatus(item.id, { state: "STOPPED" });
        return;
      }

      updateItemStatus(item.id, {
        state: "RENDERING",
        prompt: item.prompt,
        model: item.model || options.model,
        hasImage: Boolean(item.imagePath),
        attempt
      });

      const task = await generateVideo({
        prompt: item.prompt,
        model: item.model || options.model,
        ratio: item.ratio || options.ratio,
        duration: Number(item.duration) || options.duration,
        imagePath: item.imagePath
      });

      const videoUrl = task.output?.[0] || task.output?.video || task.videoUrl;
      if (!videoUrl) throw new Error("Runway completed but no video URL returned");

      const filename = `${item.id}.mp4`;
      const localPath = await downloadVideo(videoUrl, filename);

      updateItemStatus(item.id, { state: "UPLOADING" });

      let driveLink = null;
      if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        try {
          const driveFile = await uploadToDrive(localPath, filename);
          driveLink = driveFile.webViewLink;
        } catch (driveError) {
          console.error(`Drive upload failed for ${item.id}:`, driveError.message);
          updateItemStatus(item.id, { driveError: driveError.message });
        }
      }

      updateItemStatus(item.id, {
        state: "DONE",
        driveLink,
        localPath: `/downloads/${filename}`
      });
      return;
    } catch (error) {
      attempt++;
      const willRetry = attempt <= MAX_RETRIES;
      console.error(`Error on ${item.id}, attempt ${attempt}:`, error.message);
      updateItemStatus(item.id, {
        state: willRetry ? "RETRYING" : "FAILED",
        error: error.message
      });
      if (!willRetry) return;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

export async function runQueue(items, options = {}) {
  isPaused = false;
  isStopped = false;
  isRunning = true;

  const concurrency = options.concurrency || 2;
  const limit = pLimit(concurrency);

  try {
    await Promise.all(items.map((item) => limit(() => processItem(item, options))));
  } finally {
    isRunning = false;
    console.log("QUEUE FINISHED");
  }
}
