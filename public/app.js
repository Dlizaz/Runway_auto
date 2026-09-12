const form = document.getElementById("uploadForm");
const formMsg = document.getElementById("formMsg");
const submitBtn = document.getElementById("submitBtn");
const statusBody = document.getElementById("statusBody");
const queueStateEl = document.getElementById("queueState");
const rowsContainer = document.getElementById("rowsContainer");
const addRowBtn = document.getElementById("addRowBtn");
const rowTemplate = document.getElementById("rowTemplate");

let rowCounter = 0;

function addRow() {
  rowCounter++;
  const id = String(rowCounter).padStart(3, "0");

  const node = rowTemplate.content.cloneNode(true);
  const rowEl = node.querySelector(".row-item");
  rowEl.dataset.id = id;
  rowEl.querySelector(".row-id").textContent = id;

  rowEl.querySelector(".row-remove").addEventListener("click", () => {
    rowEl.remove();
  });

  rowsContainer.appendChild(node);
}

addRowBtn.addEventListener("click", addRow);

// Luon co san 1 dong khi vao trang
addRow();

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const rowEls = Array.from(rowsContainer.querySelectorAll(".row-item"));
  const rows = [];
  const fd = new FormData();

  for (const rowEl of rowEls) {
    const id = rowEl.dataset.id;
    const prompt = rowEl.querySelector(".row-prompt").value.trim();
    const imageFile = rowEl.querySelector(".row-image").files[0];

    if (!prompt) continue;

    let imageName;
    if (imageFile) {
      const ext = imageFile.name.includes(".") ? imageFile.name.split(".").pop() : "jpg";
      imageName = `img_${id}.${ext}`;
      fd.append("images", imageFile, imageName);
    }

    rows.push({ id, prompt, image: imageName });
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

async function pollStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
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

    tr.innerHTML = `
      <td>${id}</td>
      <td>${(item.prompt || "").slice(0, 60)}</td>
      <td class="state-${item.state}">${item.state}${item.error ? " - " + item.error : ""}</td>
      <td>${videoCell}</td>
      <td>${driveCell}</td>
    `;
    statusBody.appendChild(tr);
  }
}

pollStatus();
setInterval(pollStatus, 3000);
