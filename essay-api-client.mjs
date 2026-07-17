export function normalizeEssayApiBase(value) {
  return String(value || "").trim().replace(/\/+$/u, "");
}

export function buildEssayApiUrl(pathname, apiBase = "") {
  const normalizedPath = String(pathname || "").startsWith("/")
    ? String(pathname || "")
    : `/${String(pathname || "")}`;
  const normalizedBase = normalizeEssayApiBase(apiBase);
  return normalizedBase ? `${normalizedBase}${normalizedPath}` : normalizedPath;
}

export function resolveEssayApiBase(configuredBase, locationSearch = "") {
  const params = new URLSearchParams(String(locationSearch || ""));
  if (params.get("essayApi") === "local") return "";
  return normalizeEssayApiBase(configuredBase);
}

function normalizeRetryAfterSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 60;
  return Math.min(300, Math.max(1, Math.ceil(parsed)));
}

export function getEssayRetryNotice(responseStatus, payload = {}) {
  if (Number(responseStatus) !== 429 || payload?.reason !== "upstream_rate_limit") return null;
  return {
    retryAfterSeconds: normalizeRetryAfterSeconds(payload.retryAfterSeconds),
    message: String(payload.error || "目前同時批改的人較多，請稍候再試。本次不扣除今日額度。")
  };
}

export function formatEssayRetryCountdown(remainingSeconds) {
  const seconds = Math.max(0, Math.ceil(Number(remainingSeconds) || 0));
  return seconds > 0 ? `${seconds} 秒後可重新送出` : "現在可以重新送出了";
}

export function getEssayJobStatusLabel(status) {
  const labels = {
    queued: "排隊中",
    processing: "AI批改中",
    completed: "批改完成",
    failed: "批改未完成"
  };
  return labels[String(status || "")] || "查詢批改進度";
}

export function getEssayQueueRemainingSeconds(job = {}, now = Date.now()) {
  const estimatedStartAt = Number(job.estimatedStartAt);
  if (Number.isFinite(estimatedStartAt) && estimatedStartAt > 0) {
    return Math.max(0, Math.ceil((estimatedStartAt - Number(now)) / 1000));
  }
  return Math.max(0, Math.ceil(Number(job.estimatedWaitSeconds) || 0));
}

export function formatEssayQueueCountdown(job = {}, now = Date.now()) {
  if (job.status === "processing") return "正在批改整份考卷";
  if (job.status !== "queued") return "";
  const seconds = getEssayQueueRemainingSeconds(job, now);
  if (seconds > 0) return `預估約 ${seconds} 秒開始批改`;
  if (job.waitingForProviderCapacity) return "Gemini目前限制請求速度，系統正在自動等待重試";
  if (Number(job.queuePosition) > 1) return "等待前方作業完成，系統會自動更新";
  return "即將開始批改，系統會自動更新";
}

export function formatEssayJobEstimate(job = {}) {
  return formatEssayQueueCountdown(job);
}

export function parseStoredEssayJob(value, now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000) {
  try {
    const parsed = JSON.parse(String(value || ""));
    const jobId = String(parsed?.jobId || "");
    const createdAt = Number(parsed?.createdAt);
    const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(jobId);
    const age = Number(now) - createdAt;
    if (!validId || !Number.isFinite(createdAt) || age < 0 || age > maxAgeMs) return null;
    return { jobId, createdAt };
  } catch {
    return null;
  }
}
