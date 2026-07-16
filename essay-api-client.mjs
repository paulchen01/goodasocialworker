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
