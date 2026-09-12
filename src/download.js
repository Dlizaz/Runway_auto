import fs from "fs";
import path from "path";

export async function downloadVideo(url, filename) {
  const folder = path.resolve("downloads");
  fs.mkdirSync(folder, { recursive: true });

  const outputPath = path.join(folder, filename);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}
