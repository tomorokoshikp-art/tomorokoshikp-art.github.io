import { DEFAULT_RECIPE, OqmError, convert, type Stage } from "./pipeline";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const dropZone = $<HTMLDivElement>("dropZone");
const fileInput = $<HTMLInputElement>("videoFileInput");
const processBtn = $<HTMLButtonElement>("processBtn");
const downloadBtn = $<HTMLButtonElement>("downloadBtn");
const tiktokBtn = $<HTMLButtonElement>("tiktokBtn");
const fileInfo = $<HTMLDivElement>("fileInfo");
const progressContainer = $<HTMLDivElement>("progressContainer");
const progressBar = $<HTMLDivElement>("progressBar");
const progressText = $<HTMLDivElement>("progressText");

const STAGE_TH: Record<string, string> = {
  "Reading your video": "กำลังอ่านไฟล์",
  "Loading ProRes support": "กำลังโหลดตัวถอดรหัส ProRes",
  "Re-encoding": "กำลังเข้ารหัสวิดีโอ",
  "Repackaging": "กำลังจัดแพ็กไฟล์ใหม่",
  "Applying the patch": "กำลังประมวลผล",
  "Checking the result": "กำลังตรวจสอบผลลัพธ์",
};

let selectedFile: File | null = null;
let resultUrl: string | null = null;
let resultName = "Corn_Method.mp4";

function resetResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
  downloadBtn.style.display = "none";
  tiktokBtn.style.display = "none";
  processBtn.style.display = "";
}

function handleFile(file: File) {
  if (!file.type.startsWith("video/")) {
    alert("กรุณาเลือกไฟล์วิดีโอ");
    return;
  }
  resetResult();
  selectedFile = file;
  fileInfo.style.display = "block";
  fileInfo.textContent = `ไฟล์ที่เลือก: ${file.name}`;
  processBtn.disabled = false;
  processBtn.textContent = "เริ่มประมวลผล";
  progressContainer.style.display = "none";
  progressBar.style.background = "";
}

function showStage(stage: Stage) {
  const label = STAGE_TH[stage.label] ?? stage.label;
  if (stage.progress === null) {
    progressText.textContent = `${label}...`;
    return;
  }
  const pct = Math.round(Math.min(1, Math.max(0, stage.progress)) * 100);
  progressBar.style.width = `${pct}%`;
  progressText.textContent = `${label}... ${pct}%`;
}

dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
});

["dragenter", "dragover"].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("dragover");
  }),
);
["dragleave", "drop"].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("dragover");
  }),
);
dropZone.addEventListener("drop", (e) => {
  const file = (e as DragEvent).dataTransfer?.files[0];
  if (file) handleFile(file);
});

processBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  processBtn.disabled = true;
  processBtn.textContent = "กำลังประมวลผล...";
  progressContainer.style.display = "block";
  progressBar.style.background = "";
  progressBar.style.width = "0%";
  progressText.textContent = "กำลังอ่านไฟล์...";

  try {
    const result = await convert(selectedFile, DEFAULT_RECIPE, showStage);
    const failed = result.checks.filter((c) => !c.ok && !c.warn);
    if (failed.length) {
      throw new OqmError(`ตรวจสอบผลลัพธ์ไม่ผ่าน: ${failed.map((c) => c.name).join(", ")}`);
    }

    progressBar.style.width = "100%";
    progressText.textContent = "ประมวลผลเสร็จสิ้น";
    resultUrl = URL.createObjectURL(result.blob);
    resultName = selectedFile.name.replace(/\.[^/.]+$/, "") + "_Corn_Method.mp4";

    setTimeout(() => {
      progressContainer.style.display = "none";
      processBtn.style.display = "none";
      downloadBtn.style.display = "inline-flex";
    }, 500);
  } catch (err) {
    console.error(err);
    progressText.textContent = "เกิดข้อผิดพลาด: " + (err instanceof Error ? err.message : String(err));
    progressBar.style.background = "#ff4444";
    processBtn.disabled = false;
    processBtn.textContent = "ลองใหม่";
  }
});

downloadBtn.addEventListener("click", () => {
  if (!resultUrl) return;
  const a = document.createElement("a");
  a.href = resultUrl;
  a.download = resultName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  downloadBtn.style.display = "none";
  tiktokBtn.style.display = "inline-flex";
});

tiktokBtn.addEventListener("click", () => {
  window.open("https://www.tiktok.com/tiktokstudio/upload", "_blank", "noopener,noreferrer");
});
