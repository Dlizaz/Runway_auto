import fs from "fs";

const STATUS_FILE = "status.json";

export function loadStatus() {
  if (!fs.existsSync(STATUS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function saveStatus(status) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
}

export function updateItemStatus(id, patch) {
  const status = loadStatus();
  status[id] = {
    ...status[id],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  saveStatus(status);
  return status[id];
}
