export const MAX_WEAK_BACKUP_BYTES = 1024 * 1024;

const APP_NAME = "考上社工師";
const BACKUP_FORMAT = "weak-record-backup";
const BACKUP_VERSION = 1;
const CATEGORIES = ["wrong", "unfamiliar", "favorite"];

function normalizeId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sortedUniqueIds(values) {
  return [...new Set(values.map(normalizeId).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function idsFromWeakCategory(category) {
  if (Array.isArray(category)) {
    return sortedUniqueIds(category.map((item) => typeof item === "string" ? item : item?.id));
  }
  if (!category || typeof category !== "object") return [];
  return sortedUniqueIds(Object.entries(category).map(([key, value]) => value?.id || key));
}

function normalizeBackupRecords(records) {
  if (!records || typeof records !== "object" || Array.isArray(records)) {
    throw new Error("備份檔缺少錯題、不熟與收藏紀錄。");
  }
  const normalized = {};
  for (const category of CATEGORIES) {
    if (!Array.isArray(records[category])) {
      throw new Error("備份檔的錯題、不熟或收藏格式不正確。");
    }
    if (records[category].some((id) => typeof id !== "string" || !id.trim() || id.length > 512)) {
      throw new Error("備份檔中的題目ID格式不正確。");
    }
    normalized[category] = sortedUniqueIds(records[category]);
  }
  return normalized;
}

export function createWeakRecordBackup(weakState = {}, exportedAt = new Date().toISOString()) {
  return {
    app: APP_NAME,
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    records: Object.fromEntries(
      CATEGORIES.map((category) => [category, idsFromWeakCategory(weakState?.[category])])
    )
  };
}

export function parseWeakRecordBackup(text, byteLength = new TextEncoder().encode(String(text || "")).byteLength) {
  if (Number(byteLength) > MAX_WEAK_BACKUP_BYTES) {
    throw new Error("備份檔超過1MB，請確認是否選到正確的檔案。");
  }
  let parsed;
  try {
    parsed = JSON.parse(String(text || ""));
  } catch {
    throw new Error("這不是有效的JSON備份檔。");
  }
  if (parsed?.app !== APP_NAME || parsed?.format !== BACKUP_FORMAT) {
    throw new Error("這不是「考上社工師」的學習紀錄備份。");
  }
  if (Number(parsed.version) > BACKUP_VERSION) {
    throw new Error("這份備份的版本較新，請先更新APP後再還原。");
  }
  if (Number(parsed.version) !== BACKUP_VERSION) {
    throw new Error("這份備份的版本無法使用。");
  }
  if (!parsed.exportedAt || !Number.isFinite(Date.parse(parsed.exportedAt))) {
    throw new Error("備份檔缺少有效的備份日期。");
  }
  return {
    app: APP_NAME,
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date(parsed.exportedAt).toISOString(),
    records: normalizeBackupRecords(parsed.records)
  };
}

function questionFromLookup(questionLookup, id) {
  if (questionLookup instanceof Map) return questionLookup.get(id);
  return questionLookup?.[id];
}

function cloneWeakCategory(category) {
  return category && typeof category === "object" && !Array.isArray(category)
    ? { ...category }
    : {};
}

export function restoreWeakRecords(currentWeak = {}, backup, questionLookup, mode = "merge") {
  if (!backup?.records) throw new Error("備份檔缺少可還原的學習紀錄。");
  if (!["merge", "replace"].includes(mode)) throw new Error("不支援的還原方式。");

  const nextWeak = {};
  const added = {};
  const unavailableIds = new Set();
  for (const category of CATEGORIES) {
    const nextCategory = mode === "merge" ? cloneWeakCategory(currentWeak?.[category]) : {};
    const beforeIds = new Set(Object.keys(nextCategory));
    for (const id of backup.records[category] || []) {
      const question = questionFromLookup(questionLookup, id);
      if (!question?.id) {
        unavailableIds.add(id);
        continue;
      }
      nextCategory[id] = question;
    }
    nextWeak[category] = nextCategory;
    added[category] = Object.keys(nextCategory).filter((id) => !beforeIds.has(id)).length;
  }

  return {
    weak: nextWeak,
    summary: {
      added,
      unavailableCount: unavailableIds.size,
      finalCounts: Object.fromEntries(CATEGORIES.map((category) => [category, Object.keys(nextWeak[category]).length]))
    }
  };
}
