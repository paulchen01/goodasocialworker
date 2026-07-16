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
