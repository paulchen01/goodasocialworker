export const ESSAY_GRADING_TEMPERATURE = 0.2;
export const ESSAY_GRADING_DISCLAIMER = "此為AI練習回饋，非考選部正式評分。";

export const ESSAY_GRADING_RUBRIC = Object.freeze([
  Object.freeze({ key: "accuracy", label: "題旨與概念正確性", maxScore: 40 }),
  Object.freeze({ key: "completeness", label: "關鍵要點完整度", maxScore: 30 }),
  Object.freeze({ key: "structure", label: "結構與論述條理", maxScore: 20 }),
  Object.freeze({ key: "terminology", label: "專業用語與表達", maxScore: 10 })
]);

function toSafeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampScore(value, maxScore) {
  return Math.max(0, Math.min(maxScore, Math.round(toSafeNumber(value))));
}

function normalizeStringList(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function deriveLevelFromPercentage(percentage) {
  if (percentage >= 85) return "優秀";
  if (percentage >= 60) return "中上";
  return "待加強";
}

function normalizeOriginalQuestionScore(rawScore, maxScore) {
  let score = toSafeNumber(rawScore);
  if (score > maxScore && score <= 100 && maxScore > 0) {
    score = (score / 100) * maxScore;
  }
  return Math.max(0, Math.min(maxScore, Math.round(score)));
}

export function buildEssayGradingPrompt(question, answerText) {
  const points = Math.max(0, toSafeNumber(question?.points));
  return [
    "你是一位熟悉台灣社會工作師考試、社會工作理論、實務與法規的社會工作學系資深教授。",
    "請以資深教授的角度批改，指出作答優點、缺漏，並提供具體、可操作的修正建議。",
    ESSAY_GRADING_DISCLAIMER,
    "請只輸出 JSON，不要加任何額外文字。",
    "本題尚未核准題目專屬評分規準，請只使用下列固定四項練習評分標準：",
    ...ESSAY_GRADING_RUBRIC.map((item) => `- ${item.label}：${item.maxScore}分`),
    "四項合計為100分。不要自行輸出總分，系統會依四項分數換算為原題配分。",
    "所有批改內容都必須具體、真實且可被驗證，不得把推測、印象或模型記憶寫成已查證事實。",
    "涉及法規、政策、制度或統計時，僅以政府機關官方網站為主要依據，優先查核 .gov.tw 來源，例如全國法規資料庫、考選部及衛生福利部。",
    "涉及理論或研究時，優先採大學與學術機構（.edu、.edu.tw）、專業學會或非營利專業組織（.org、.org.tw）及同儕審查學術資料。",
    "禁止使用維基百科作為批改、補充或建議的資料來源。",
    "不得虛構來源、網址、作者、年份、條文或研究結果；不能確定存在且內容正確的資料，不得列為依據。",
    "若目前無法查證某項內容，必須在 examReminder 明確標示『尚未查證』及需要核對的項目，不得猜測或自行補寫。",
    "請依應試當年度的法規、制度與專業脈絡判斷；若無法確認當年度規定，必須在 examReminder 清楚標示不確定處，不可猜測。",
    "請嚴格使用這個 JSON 結構：",
    '{"rubricScores":{"accuracy":數字,"completeness":數字,"structure":數字,"terminology":數字},"strengths":["..."],"missingPoints":["..."],"revisionAdvice":["..."],"suggestedOutline":["..."],"examReminder":"..."}',
    `考試類型：${question?.examTypeLabel || question?.examType || "未標示"}`,
    `考試年度：民國${question?.yearRoc ?? "未標示"}年`,
    `考次：${question?.examSession || "未標示"}`,
    `科目：${question?.subject || "未標示"}`,
    `題號：第${question?.questionNo ?? "未標示"}題`,
    `原題配分：${points}分`,
    `題目：${question?.prompt || ""}`,
    `作答：${String(answerText || "").trim()}`
  ].join("\n");
}

export function normalizeEssayGradePayload(payload = {}, question = {}) {
  const maxScore = Math.max(0, toSafeNumber(question.points));
  const hasRubricScores = payload.rubricScores
    && typeof payload.rubricScores === "object"
    && !Array.isArray(payload.rubricScores);

  let rubricScores = [];
  let rubricTotal = null;
  let score;
  let percentage;

  if (hasRubricScores) {
    rubricScores = ESSAY_GRADING_RUBRIC.map((item) => ({
      ...item,
      score: clampScore(payload.rubricScores[item.key], item.maxScore)
    }));
    rubricTotal = rubricScores.reduce((total, item) => total + item.score, 0);
    percentage = rubricTotal;
    score = maxScore > 0 ? Math.round((rubricTotal / 100) * maxScore) : 0;
  } else {
    score = normalizeOriginalQuestionScore(payload.score, maxScore);
    percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;
  }

  return {
    score,
    maxScore,
    level: String(payload.level || deriveLevelFromPercentage(percentage)),
    rubricScores,
    rubricTotal,
    strengths: normalizeStringList(payload.strengths),
    missingPoints: normalizeStringList(payload.missingPoints),
    revisionAdvice: normalizeStringList(payload.revisionAdvice),
    suggestedOutline: normalizeStringList(payload.suggestedOutline),
    examReminder: String(payload.examReminder || "")
  };
}
