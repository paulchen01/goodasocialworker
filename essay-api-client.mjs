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
