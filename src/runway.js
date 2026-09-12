import RunwayML, { TaskFailedError } from "@runwayml/sdk";
import fs from "fs";
import path from "path";

const client = new RunwayML({
  apiKey: process.env.RUNWAYML_API_SECRET
});

function toBase64DataUrl(filePath) {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).replace(".", "").toLowerCase() || "jpeg";
  const mime = ext === "jpg" ? "jpeg" : ext;
  return `data:image/${mime};base64,${buffer.toString("base64")}`;
}

/**
 * Tạo video. Nếu có imagePath -> dùng image-to-video.
 * Nếu không có ảnh -> dùng text-to-video.
 */
export async function generateVideo({
  prompt,
  model = "gen4.5",
  ratio = "1280:720",
  duration = 5,
  imagePath
}) {
  try {
    if (imagePath) {
      const promptImage = toBase64DataUrl(imagePath);

      const task = await client.imageToVideo
        .create({
          model,
          promptImage,
          promptText: prompt,
          ratio,
          duration
        })
        .waitForTaskOutput();

      return task;
    }

    const task = await client.textToVideo
      .create({
        model,
        promptText: prompt,
        ratio,
        duration
      })
      .waitForTaskOutput();

    return task;
  } catch (error) {
    if (error instanceof TaskFailedError) {
      console.error("Runway task failed:", error.taskDetails);
    }
    throw error;
  }
}
