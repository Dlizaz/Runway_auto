const form = document.getElementById("uploadForm");
const formMsg = document.getElementById("formMsg");
const submitBtn = document.getElementById("submitBtn");
const statusBody = document.getElementById("statusBody");
const queueStateEl = document.getElementById("queueState");
const rowsContainer = document.getElementById("rowsContainer");
const addRowBtn = document.getElementById("addRowBtn");
const rowTemplate = document.getElementById("rowTemplate");

let rowCounter = 0;
// Gia tri mac dinh, se duoc dong bo lai tu server (PROMPT_MAX_LENGTH trong runway.js)
// ngay lan poll status dau tien.
let promptMaxLength = 1000;

function addRow() {
  rowCounter++;
  const id = String(rowCounter).padStart(3, "0");

  const node = rowTemplate.content.cloneNode(true);
  const rowEl = node.querySelector(".row-item");
  rowEl.dataset.id = id;
  rowEl.querySelector(".row-id").textContent = id;

  const promptEl = rowEl.querySelector(".row-prompt");
  const countEl = rowEl.querySelector(".row-char-count");
  updateCharCount(promptEl, countEl);
  promptEl.addEventListener("input", () => updateCharCount(promptEl, countEl));

  rowEl.querySelector(".row-remove").addEventListener("click", () => {
    rowEl.remove();
  });

  rowsContainer.appendChild(node);
}

function updateCharCount(promptEl, countEl) {
  const len = promptEl.value.length;
  countEl.textContent = `${len} / ${promptMaxLength}`;
  countEl.classList.toggle("over-limit", len > promptMaxLength);
}

addRowBtn.addEventListener("click", addRow);

// Luon co san 1 dong khi vao trang
addRow();

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const rowEls = Array.from(rowsContainer.querySelectorAll(".row-item"));
  const rows = [];
  const fd = new FormData();
  const overLimitIds = [];

  for (const rowEl of rowEls) {
    const id = rowEl.dataset.id;
    const prompt = rowEl.querySelector(".row-prompt").value.trim();
    const imageFile = rowEl.querySelector(".row-image").files[0];

    if (!prompt) continue;

    if (prompt.length > promptMaxLength) {
      overLimitIds.push(id);
      continue;
    }

    let imageName;
    if (imageFile) {
      const ext = imageFile.name.includes(".") ? imageFile.name.split(".").pop() : "jpg";
      imageName = `img_${id}.${ext}`;
      fd.append("images", imageFile, imageName);
    }

    rows.push({ id, prompt, image: imageName });
  }

  if (overLimitIds.length > 0) {
    formMsg.textContent = `Prompt của dòng ${overLimitIds.join(", ")} vượt quá ${promptMaxLength} ký tự (giới hạn của Runway), hãy rút ngắn lại rồi gửi lại.`;
    return;
  }

  if (rows.length === 0) {
    formMsg.textContent = "Bạn cần nhập ít nhất 1 prompt.";
    return;
  }

  fd.append("rowsJson", JSON.stringify(rows));
  fd.append("model", document.getElementById("modelInput").value);
  fd.append("duration", document.getElementById("durationInput").value);
  fd.append("upscale", document.getElementById("upscaleInput").checked ? "true" : "false");

  formMsg.textContent = "Đang upload...";
  submitBtn.disabled = true;

  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok) {
      formMsg.textContent = "Lỗi: " + data.error;
    } else {
      formMsg.textContent = `Đã nhận ${data.count} prompt. Đang render, có thể đóng tab và quay lại sau.`;
      rowsContainer.innerHTML = "";
      rowCounter = 0;
      addRow();
    }
  } catch (err) {
    formMsg.textContent = "Lỗi kết nối: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById("pauseBtn").onclick = () => fetch("/api/pause", { method: "POST" });
document.getElementById("resumeBtn").onclick = () => fetch("/api/resume", { method: "POST" });
document.getElementById("stopBtn").onclick = () => fetch("/api/stop", { method: "POST" });

function pauseVideo(id) {
  fetch(`/api/item/${encodeURIComponent(id)}/pause`, { method: "POST" });
}

function resumeVideo(id) {
  fetch(`/api/item/${encodeURIComponent(id)}/resume`, { method: "POST" });
}

function stopVideo(id) {
  fetch(`/api/item/${encodeURIComponent(id)}/stop`, { method: "POST" });
}

async function pollStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    if (data.promptMaxLength) promptMaxLength = data.promptMaxLength;
    renderTable(data.items);
    renderQueueState(data.queue);
  } catch (err) {
    // im lang, thu lai lan sau
  }
}

function renderQueueState(q) {
  if (!q) return;
  let text = q.isRunning ? "Đang chạy" : "Không chạy";
  if (q.isPaused) text += " (đã Pause)";
  if (q.isStopped) text += " (đã Stop)";
  queueStateEl.textContent = text;
}

// Nut nao hien ra tuy theo trang thai hien tai cua tung video.
function renderItemControls(id, state) {
  const wrap = document.createElement("div");
  wrap.className = "item-controls";

  const activeStates = ["QUEUED", "RENDERING", "UPSCALING", "DOWNLOADING", "UPLOADING", "RETRYING"];
  const canPause = activeStates.includes(state);
  const canResume = state === "PAUSED" || state === "STOPPED" || state === "FAILED";
  const canStop = canPause;

  if (canPause) {
    const btn = document.createElement("button");
    btn.className = "btn-pause";
    btn.textContent = "⏸";
    btn.title = "Pause video này";
    btn.onclick = () => pauseVideo(id);
    wrap.appendChild(btn);
  }

  if (canResume) {
    const btn = document.createElement("button");
    btn.className = "btn-resume";
    btn.textContent = "▶";
    btn.title = state === "PAUSED" ? "Resume video này" : "Render lại video này";
    btn.onclick = () => resumeVideo(id);
    wrap.appendChild(btn);
  }

  if (canStop) {
    const btn = document.createElement("button");
    btn.className = "btn-stop";
    btn.textContent = "⏹";
    btn.title = "Stop video này";
    btn.onclick = () => stopVideo(id);
    wrap.appendChild(btn);
  }

  return wrap;
}

function renderTable(items) {
  const ids = Object.keys(items || {}).sort();
  statusBody.innerHTML = "";

  for (const id of ids) {
    const item = items[id];
    const tr = document.createElement("tr");

    const videoCell = item.localPath
      ? `<a href="${item.localPath}" target="_blank">Tải video</a>`
      : "-";

    const driveCell = item.driveLink
      ? `<a href="${item.driveLink}" target="_blank">Mở Drive</a>`
      : (item.driveError ? "lỗi upload" : "-");

    const errorCell = renderErrorCell(item);

    tr.innerHTML = `
      <td>${id}</td>
      <td>${escapeHtml((item.prompt || "").slice(0, 60))}</td>
      <td class="state-${item.state}">${item.state}</td>
      <td class="error-cell"></td>
      <td>${videoCell}</td>
      <td>${driveCell}</td>
      <td class="controls-cell"></td>
    `;
    tr.querySelector(".error-cell").appendChild(errorCell);
    tr.querySelector(".controls-cell").appendChild(renderItemControls(id, item.state));
    statusBody.appendChild(tr);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Hien loi Runway tra ve ngay tren bang, khong can vao dev.runwayml.com de tra.
// Uu tien loi chinh (item.error), neu khong co thi hien loi upscale/drive
// (nhung do khong lam video that bai han toan, chi la buoc phu bi loi).
function renderErrorCell(item) {
  const wrap = document.createElement("div");
  wrap.className = "error-wrap";

  if (item.error) {
    const badge = document.createElement("div");
    badge.className = "error-message";
    let tag = "";
    if (item.errorStatus) tag += `HTTP ${item.errorStatus}`;
    if (item.errorCode) tag += (tag ? " · " : "") + item.errorCode;
    if (tag) {
      const tagEl = document.createElement("span");
      tagEl.className = "error-tag";
      tagEl.textContent = tag;
      badge.appendChild(tagEl);
    }
    badge.appendChild(document.createTextNode(item.error));
    wrap.appendChild(badge);
  } else if (item.upscaleError) {
    const badge = document.createElement("div");
    badge.className = "error-message error-secondary";
    badge.textContent = `Upscale lỗi (đã dùng bản gốc): ${item.upscaleError}`;
    wrap.appendChild(badge);
  } else {
    wrap.textContent = "-";
  }

  return wrap;
}

pollStatus();
setInterval(pollStatus, 3000);
