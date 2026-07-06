const PROGRESS_KEY = "kaoshangSocialWorkerProgress";
const VISIT_ANALYTICS_KEY = "kaoshangSocialWorkerVisitAnalytics";
const ANALYTICS_EVENTS = {
  quick: { path: "click-quick-practice", title: "Click quick practice", event: true },
  past: { path: "click-past-bank", title: "Click past bank", event: true },
  mock: { path: "click-mock-exam", title: "Click mock exam", event: true },
  weak: { path: "click-weakness", title: "Click weakness", event: true },
  install: { path: "click-install-guide", title: "Click install guide", event: true },
  law: { path: "click-law-lookup", title: "Click law lookup", event: true }
};

export function getAnalyticsEvent(screen) {
  return ANALYTICS_EVENTS[screen] ? { ...ANALYTICS_EVENTS[screen] } : null;
}

const VISIT_ANALYTICS_EVENTS = {
  first: { path: "visit-first-time", title: "Visit first time", event: true },
  repeatSameDay: { path: "visit-repeat-same-day", title: "Visit repeat same day", event: true },
  returnNextDay: { path: "visit-return-next-day", title: "Visit return next day", event: true },
  returnTwoToSixDays: { path: "visit-return-2-6-days", title: "Visit return 2-6 days", event: true },
  returnSevenPlusDays: { path: "visit-return-7-plus-days", title: "Visit return 7 plus days", event: true },
  pwaMode: { path: "visit-pwa-mode", title: "Visit PWA mode", event: true }
};

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateDayNumber(dateText) {
  const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function loadVisitAnalyticsState(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(VISIT_ANALYTICS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      firstVisitDate: typeof parsed.firstVisitDate === "string" ? parsed.firstVisitDate : null,
      lastVisitDate: typeof parsed.lastVisitDate === "string" ? parsed.lastVisitDate : null,
      visitDates: Array.isArray(parsed.visitDates) ? parsed.visitDates.filter((item) => typeof item === "string") : [],
      sentEventDates: parsed.sentEventDates && typeof parsed.sentEventDates === "object" ? parsed.sentEventDates : {}
    };
  } catch {
    return null;
  }
}

function hasSentVisitEvent(state, dateText, eventPath) {
  return Array.isArray(state.sentEventDates?.[dateText]) && state.sentEventDates[dateText].includes(eventPath);
}

function rememberSentVisitEvent(state, dateText, eventPath) {
  if (!state.sentEventDates[dateText]) {
    state.sentEventDates[dateText] = [];
  }
  if (!state.sentEventDates[dateText].includes(eventPath)) {
    state.sentEventDates[dateText].push(eventPath);
  }
}

function queueVisitEvent(events, state, dateText, event) {
  if (hasSentVisitEvent(state, dateText, event.path)) return;
  events.push({ ...event });
  rememberSentVisitEvent(state, dateText, event.path);
}

export function getVisitAnalyticsEvents(storage = globalThis.localStorage, nowDate = new Date(), isStandalone = false) {
  const today = formatLocalDate(nowDate);
  const previous = loadVisitAnalyticsState(storage);
  const state = previous ?? {
    firstVisitDate: today,
    lastVisitDate: today,
    visitDates: [],
    sentEventDates: {}
  };
  const events = [];

  if (!state.firstVisitDate) state.firstVisitDate = today;
  if (!state.sentEventDates || typeof state.sentEventDates !== "object") state.sentEventDates = {};
  if (!Array.isArray(state.visitDates)) state.visitDates = [];

  if (!previous) {
    queueVisitEvent(events, state, today, VISIT_ANALYTICS_EVENTS.first);
  } else if (state.lastVisitDate === today) {
    queueVisitEvent(events, state, today, VISIT_ANALYTICS_EVENTS.repeatSameDay);
  } else {
    const todayNumber = parseDateDayNumber(today);
    const lastNumber = parseDateDayNumber(state.lastVisitDate);
    const daysSinceLastVisit = todayNumber !== null && lastNumber !== null ? todayNumber - lastNumber : null;
    if (daysSinceLastVisit === 1) {
      queueVisitEvent(events, state, today, VISIT_ANALYTICS_EVENTS.returnNextDay);
    } else if (daysSinceLastVisit !== null && daysSinceLastVisit >= 2 && daysSinceLastVisit <= 6) {
      queueVisitEvent(events, state, today, VISIT_ANALYTICS_EVENTS.returnTwoToSixDays);
    } else {
      queueVisitEvent(events, state, today, VISIT_ANALYTICS_EVENTS.returnSevenPlusDays);
    }
  }

  if (isStandalone) {
    queueVisitEvent(events, state, today, VISIT_ANALYTICS_EVENTS.pwaMode);
  }

  if (!state.visitDates.includes(today)) {
    state.visitDates.push(today);
  }
  state.lastVisitDate = today;

  return { events, state };
}

export function saveVisitAnalyticsState(storage = globalThis.localStorage, state) {
  if (!storage || !state) return;
  storage.setItem(VISIT_ANALYTICS_KEY, JSON.stringify(state));
}

export function selectRecentYears(index, count = 5) {
  const latest = index.latestYearRoc;
  const start = Math.max(index.yearRange.start, latest - count + 1);
  return Array.from({ length: latest - start + 1 }, (_, offset) => start + offset);
}

export function withDataVersion(url, version) {
  if (!version) return url;
  const separator = String(url).includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

export function scoreExam(questions, answers) {
  let correct = 0;
  const wrongQuestionIds = [];

  for (const question of questions) {
    if (isCorrectAnswer(question, answers[question.id])) {
      correct += 1;
    } else {
      wrongQuestionIds.push(question.id);
    }
  }

  return { correct, total: questions.length, wrongQuestionIds };
}

export function isCorrectAnswer(question, selectedAnswer) {
  if (!selectedAnswer) return false;
  if (question?.officialAnswerNotice?.type === "allGiveScore") {
    return ["A", "B", "C", "D"].includes(selectedAnswer);
  }
  return getAcceptedAnswers(question).includes(selectedAnswer);
}

export function getAcceptedAnswers(question) {
  if (question?.officialAnswerNotice?.type === "allGiveScore") {
    return ["A", "B", "C", "D"];
  }
  const answers = Array.isArray(question?.acceptedAnswers)
    ? question.acceptedAnswers
    : [question?.answer];
  return answers
    .map((answer) => String(answer || "").trim())
    .filter((answer) => /^[A-D]$/.test(answer));
}

export function formatOfficialAnswerText(question) {
  const originalAnswer = String(question?.answer || "").trim();
  if (question?.officialAnswerNotice?.type === "allGiveScore") {
    return originalAnswer ? `一律給分（原答案 ${originalAnswer}）` : "一律給分";
  }
  const answers = getAcceptedAnswers(question);
  if (question?.officialAnswerNotice?.type === "multipleAnswers" && answers.length > 1) {
    return `${answers.join("／")}（均給分）`;
  }
  if (question?.officialAnswerNotice?.type === "singleAnswerCredit" && answers.length === 1) {
    return `${answers[0]}（更正給分）`;
  }
  return answers.length ? answers.join("／") : originalAnswer;
}

export function getOfficialAnswerNoticeText(question) {
  const notice = question?.officialAnswerNotice;
  if (!notice?.text) return "";
  const parts = [String(notice.text).trim()];
  if (notice.sourceTitle || notice.sourceDate) {
    const source = [notice.sourceDate, notice.sourceTitle].filter(Boolean).join("｜");
    parts.push(`來源：${source}`);
  }
  return parts.filter(Boolean).join("\n");
}

export function formatResultScoreLine(result) {
  const correct = Number(result?.correct) || 0;
  const total = Number(result?.total) || 0;
  const wrong = Math.max(0, total - correct);
  return `選擇題答對 ${correct} 題，答錯 ${wrong} 題。`;
}

export function getOptionStateClasses(optionKey, selected, answer, showAnswer) {
  const classes = ["option"];
  const answers = Array.isArray(answer) ? answer : [answer];
  if (!showAnswer && selected === optionKey) classes.push("selected");
  if (showAnswer && answers.includes(optionKey)) classes.push("correct");
  if (showAnswer && selected === optionKey && !answers.includes(selected)) classes.push("wrong");
  return classes;
}

export function getQuestionExplanationText(question, maxLength = 200) {
  const normalized = normalizeDisplayText(question?.explanation || "").trim();
  if (!normalized) return "";
  const safeMax = Math.max(20, Number(maxLength) || 200);
  if (normalized.length <= safeMax) return normalized;
  return normalized.slice(0, safeMax).replace(/[，。；：、,;:\s]+$/u, "");
}

function escapeHtmlAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildQuestionImagesMarkup(question) {
  const images = Array.isArray(question?.images) ? question.images : [];
  const safeImages = images.filter((image) => image?.src);
  if (!safeImages.length) return "";
  return `<div class="question-images">${safeImages.map((image) =>
    `<figure><img src="${escapeHtmlAttribute(image.src)}" alt="${escapeHtmlAttribute(image.alt || "題目附圖")}" loading="lazy"></figure>`
  ).join("")}</div>`;
}

export function getQuestionCompletionTarget(mode) {
  return mode === "weakReview" ? "weak" : "result";
}

export function createPracticeSet(index, options, rng = Math.random) {
  const recentYears = selectRecentYears(index, 5);
  const exams = index.exams.filter((exam) => {
    if (options.subject && exam.subject !== options.subject) return false;
    if (options.source === "recent" && !recentYears.includes(exam.yearRoc)) return false;
    return true;
  });
  const pool = exams.flatMap((exam) => exam.questions || []);

  return pool
    .map((question) => ({ question, sort: rng() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, options.count)
    .map((item) => item.question);
}

export function createQuestionSetFromExams(exams, options, rng = Math.random) {
  const pool = exams.flatMap((exam) =>
    enrichQuestionsWithExamContext(exam)
  );

  return pool
    .map((question) => ({ question, sort: rng() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, options.count)
    .map((item) => item.question);
}

export function enrichQuestionsWithExamContext(exam) {
  const questions = exam.questions || [];
  return questions.map((question) => {
    const previousQuestion = questions.find((item) => item.number === question.number - 1);
    const enriched = {
      ...question,
      subject: exam.subject,
      yearRoc: exam.yearRoc,
      examCode: exam.examCode,
      examAttempt: exam.examAttempt,
      sourceLabel: `民國 ${exam.yearRoc} 年 ${exam.examAttempt}`,
      sourceDisplay: formatQuestionSource({ ...question, ...exam })
    };

    if (isCarryOverQuestion(question.stem) && previousQuestion) {
      enriched.previousQuestionContext = {
        number: previousQuestion.number,
        stem: previousQuestion.stem,
        options: previousQuestion.options || []
      };
    }

    return enriched;
  });
}

export function isCarryOverQuestion(stem) {
  return /^承上[題提]/.test(normalizeDisplayText(stem).trim());
}

export function normalizeDisplayText(value) {
  return String(value ?? "")
    .replace(/([\p{Script=Han}])\s+([\p{Script=Han}])/gu, "$1$2")
    .replace(/([\p{Script=Han}])\s+([，。；：、？！）])/gu, "$1$2")
    .replace(/([（])\s+([\p{Script=Han}])/gu, "$1$2")
    .replace(/\s+([）])/gu, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

export function formatQuestionSource(question) {
  return `民國 ${question.yearRoc} 年 ${question.examAttempt}｜${question.subject}｜第 ${question.number} 題`;
}

export function buildQuestionMetaParts(exam, question, mode, currentQuestionIndex = 0) {
  const total = exam?.questions?.length ?? 0;
  const progress = `第 ${Number(currentQuestionIndex) + 1} / ${total} 題`;
  if (mode === "quick" && question?.yearRoc && question?.examAttempt) {
    return [`民國 ${question.yearRoc} 年 ${question.examAttempt}考試`, exam.examAttempt, progress];
  }
  if (exam?.yearRoc === "本機紀錄") return ["本機紀錄", exam.examAttempt, progress];
  if (mode === "mockExam") return ["跨年度", exam.examAttempt, progress];
  return [`民國 ${exam.yearRoc} 年`, exam.examAttempt, progress];
}

export function getResultEncouragement(correct, total) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const ratio = Math.max(0, Math.min(1, Number(correct) / safeTotal));
  if (ratio === 1) {
    return "太好了，這回合全對。先把這份手感記下來，代表這個範圍你已經有不錯的掌握。可以換科目練，或把速度再練穩一點。";
  }
  if (ratio >= 0.8) {
    return "很接近滿分了。先不用急著重來，建議看一下錯題卡在哪裡，是觀念混淆、題目陷阱，還是太快選。把這一題補起來，這回合就很有價值。";
  }
  if (ratio >= 0.6) {
    return "你已經抓到一半以上了。接下來最重要的是整理錯題，把不熟的關鍵字留下來。這種分數很適合再練一次同科目，會進步得很明顯。";
  }
  if (ratio >= 0.4) {
    return "這回合有點卡，但不是白做。現在先看錯題，不用一次讀太多，先找出你最常被題目考倒的概念。會錯的地方，通常就是之後最容易加分的地方。";
  }
  if (ratio > 0) {
    return "這回合比較辛苦，但它幫你抓出需要補強的範圍。先不要否定自己，考古題本來就是用來發現弱點的。建議從錯題開始，一題一題把答案理由看懂。";
  }
  return "這次沒有答對，代表這一小段目前還不熟。沒關係，這正是練習模式存在的原因。先從第一題開始看答案，不求快，先把題目在問什麼讀懂，下一輪就會不一樣。";
}

export function formatRemainingTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function getCountdownRemainingSeconds(deadlineAt, now = Date.now()) {
  const deadline = Number(deadlineAt);
  const current = Number(now);
  if (!Number.isFinite(deadline) || !Number.isFinite(current)) return null;
  return Math.max(0, Math.ceil((deadline - current) / 1000));
}

export function shouldRevealAnswerAfterSelection(mode) {
  return ["memorize", "quick", "weakExam"].includes(mode);
}

export function getWeakItems(weakState, category) {
  return Object.values(weakState?.[category] || {});
}

export function paginateItems(items, page = 1, perPage = 5) {
  const safeItems = Array.isArray(items) ? items : [];
  const safePerPage = Math.max(1, Number(perPage) || 5);
  const totalPages = Math.max(1, Math.ceil(safeItems.length / safePerPage));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (safePage - 1) * safePerPage;
  return {
    items: safeItems.slice(start, start + safePerPage),
    page: safePage,
    perPage: safePerPage,
    totalItems: safeItems.length,
    totalPages
  };
}

export function createWeakPracticeSet(weakState, categories, options = {}, rng = Math.random) {
  const seen = new Set();
  const pool = categories.flatMap((category) => getWeakItems(weakState, category))
    .filter((question) => {
      if (!question?.id || seen.has(question.id)) return false;
      seen.add(question.id);
      return true;
    });
  const count = options.count ?? pool.length;

  return pool
    .map((question) => ({ question, sort: rng() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, count)
    .map((item) => item.question);
}

export function updateWrongItemsAfterAnsweredPractice(weakState, questions, selectedAnswers) {
  const next = {
    wrong: { ...(weakState?.wrong || {}) },
    unfamiliar: { ...(weakState?.unfamiliar || {}) },
    favorite: { ...(weakState?.favorite || {}) }
  };

  for (const question of questions || []) {
    if (!question?.id || !selectedAnswers?.[question.id]) continue;
    if (selectedAnswers[question.id] === question.answer) {
      delete next.wrong[question.id];
    } else {
      next.wrong[question.id] = question;
    }
  }

  return next;
}

export function loadProgress(storage = globalThis.localStorage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveProgress(storage = globalThis.localStorage, progress) {
  if (!storage) return;
  storage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

export function clearProgress(storage = globalThis.localStorage) {
  if (!storage) return;
  storage.removeItem(PROGRESS_KEY);
}

export function shouldPersistProgress(mode, currentExam, completed = false) {
  return !completed && ["exam", "mockExam"].includes(mode) && Boolean(currentExam);
}
