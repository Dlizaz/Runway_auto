const form = document.getElementById("uploadForm");
const formMsg = document.getElementById("formMsg");
const submitBtn = document.getElementById("submitBtn");
const statusBody = document.getElementById("statusBody");
const queueStateEl = document.getElementById("queueState");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formMsg.textContent = "Đang upload...";
  submitBtn.disabled = true;

  const csvFile = document.getElementById("csvInput").files[0];
  const imageFiles = document.getElementById("imagesInput").files;

  const fd = new FormData();
  fd.append("csv", csvFile);
  for (const f of imageFiles) fd.append("images", f);

  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();

    if (!res.ok) {
      formMsg.textContent = "Lỗi: " + data.error;
    } else {
      formMsg.textContent = `Đã nhận ${data.count} prompt. Đang render, có thể đóng tab và quay lại sau.`;
      form.reset();
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
