import {
  buildQuestionImagesMarkup,
  buildQuestionMetaParts,
  clearProgress,
  createQuestionSetFromExams,
  createWeakPracticeSet,
  enrichQuestionsWithExamContext,
  formatResultScoreLine,
  formatQuestionSource,
  formatOfficialAnswerText,
  formatRemainingTime,
  getAcceptedAnswers,
  getCountdownRemainingSeconds,
  getOptionStateClasses,
  getAnalyticsEvent,
  getOfficialAnswerNoticeText,
  getQuestionCompletionTarget,
  getResultEncouragement,
  getQuestionSourceNote,
  getVisitAnalyticsEvents,
  getWeakItems,
  loadProgress,
  normalizeDisplayText,
  paginateItems,
  saveProgress,
  saveVisitAnalyticsState,
  shouldPersistProgress,
  scoreExam,
  selectRecentYears,
  shouldRevealAnswerAfterSelection,
  updateWrongItemsAfterImmediateReveal,
  updateWrongItemsAfterAnsweredPractice,
  registerServiceWorkerWithAutoReload,
  withDataVersion
} from "./app-core.mjs?v=20260715-01";
import {
  filterEssayQuestions,
  getEssayFilterOptions,
  getEssayQuestionById,
  validateEssayAnswer
} from "./essay-practice-core.mjs?v=20260707-03";
import {
  buildEssayEmptyStateMarkup,
  buildEssayQueueMarkup,
  buildEssayResultMarkup,
  buildEssaySelectorMarkup,
  clearEssayAnswerDraft
} from "./essay-practice-view.mjs?v=20260717-06";
import {
  buildEssayApiUrl,
  formatEssayQueueCountdown,
  formatEssayJobEstimate,
  getEssayJobStatusLabel,
  parseStoredEssayJob,
  resolveEssayApiBase
} from "./essay-api-client.mjs?v=20260717-05";
import {
  MAX_WEAK_BACKUP_BYTES,
  createWeakRecordBackup,
  parseWeakRecordBackup,
  restoreWeakRecords
} from "./weak-record-backup.mjs?v=20260717-05";

const app = document.querySelector("#app");
const DATA_VERSION = "20260715-01";
const ESSAY_DRAFTS_KEY = "kaoshangSocialWorkerEssayDrafts";
const ESSAY_PENDING_JOB_KEY = "kaoshangSocialWorkerEssayPendingJob";
const ESSAY_JOB_POLL_INTERVAL_MS = 3000;
const ESSAY_ANSWER_LIMITS = { minChars: 80, maxChars: 5000 };
const WEAK_BACKUP_CATEGORIES = ["wrong", "unfamiliar", "favorite"];
const ESSAY_API_HINT = "申論題批改服務暫時無法連線，請稍後再試。";
const ESSAY_API_BASE = resolveEssayApiBase(
  document.querySelector('meta[name="essay-api-base"]')?.content,
  window.location.search
);

const state = {
  index: null,
  currentExam: null,
  currentQuestionIndex: 0,
  mode: "memorize",
  showAnswer: false,
  selected: {},
  activeProgress: loadProgress(),
  completed: false,
  remainingSeconds: null,
  deadlineAt: null,
  timerId: null,
  weak: loadWeakState(),
  weakPage: { wrong: 1, unfamiliar: 1, favorite: 1 },
  lawLookup: null,
  essayBank: null,
  essayQuota: null,
  essayFilters: { examType: "", subject: "", yearRoc: "", examSession: "", questionId: "" },
  essayDrafts: loadEssayDrafts(),
  essayLastGrade: null,
  essayPendingJob: loadEssayPendingJob(),
  essayJobPollId: null,
  essayQueueCountdownId: null
};

function loadWeakState() {
  try {
    return JSON.parse(localStorage.getItem("kaoshangSocialWorkerWeak") || '{"wrong":{},"unfamiliar":{},"favorite":{}}');
  } catch {
    return { wrong: {}, unfamiliar: {}, favorite: {} };
  }
}

function saveWeakState() {
  localStorage.setItem("kaoshangSocialWorkerWeak", JSON.stringify(state.weak));
}

async function loadIndex() {
  const response = await fetch(`data/index.json?v=${DATA_VERSION}`);
  const index = await response.json();
  state.index = index;
  return index;
}

async function loadLawLookup() {
  if (state.lawLookup) return state.lawLookup;
  const response = await fetch(`data/law-lookup.json?v=${DATA_VERSION}`);
  if (!response.ok) throw new Error("法規清冊載入失敗");
  state.lawLookup = await response.json();
  return state.lawLookup;
}

async function loadExam(exam) {
  const response = await fetch(withDataVersion(exam.file, DATA_VERSION));
  const payload = await response.json();
  payload.questions = enrichQuestionsWithExamContext(payload);
  return payload;
}

function loadEssayDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ESSAY_DRAFTS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveEssayDrafts() {
  localStorage.setItem(ESSAY_DRAFTS_KEY, JSON.stringify(state.essayDrafts));
}

function loadEssayPendingJob() {
  const stored = parseStoredEssayJob(localStorage.getItem(ESSAY_PENDING_JOB_KEY));
  if (!stored) localStorage.removeItem(ESSAY_PENDING_JOB_KEY);
  return stored;
}

function saveEssayPendingJob(jobId) {
  const pendingJob = { jobId, createdAt: Date.now() };
  state.essayPendingJob = pendingJob;
  localStorage.setItem(ESSAY_PENDING_JOB_KEY, JSON.stringify(pendingJob));
}

function clearEssayPendingJob() {
  state.essayPendingJob = null;
  localStorage.removeItem(ESSAY_PENDING_JOB_KEY);
}

function stopEssayJobPolling() {
  if (!state.essayJobPollId) return;
  window.clearInterval(state.essayJobPollId);
  state.essayJobPollId = null;
}

function stopEssayQueueCountdown() {
  if (!state.essayQueueCountdownId) return;
  window.clearInterval(state.essayQueueCountdownId);
  state.essayQueueCountdownId = null;
}

function saveEssayDraft(questionId, answerText) {
  if (!questionId) return;
  const nextText = String(answerText ?? "");
  if (nextText.trim()) {
    state.essayDrafts[questionId] = nextText;
  } else {
    delete state.essayDrafts[questionId];
  }
  saveEssayDrafts();
}

function saveCurrentEssayDraftFromScreen() {
  document.querySelectorAll(".essay-answer[data-question-id]").forEach((answerField) => {
    saveEssayDraft(answerField.dataset.questionId, answerField.value);
  });
}

async function loadEssayBank(force = false) {
  if (!force && state.essayBank) return state.essayBank;
  const response = await fetch(buildEssayApiUrl("/api/essay/questions", ESSAY_API_BASE));
  if (!response.ok) {
    throw new Error(ESSAY_API_HINT);
  }
  const bank = await response.json();
  state.essayBank = bank;
  return bank;
}

async function loadEssayQuota(force = false) {
  if (!force && state.essayQuota) return state.essayQuota;
  const response = await fetch(buildEssayApiUrl("/api/essay/status", ESSAY_API_BASE));
  if (!response.ok) {
    throw new Error(ESSAY_API_HINT);
  }
  const quota = await response.json();
  state.essayQuota = quota;
  return quota;
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function startTimer() {
  stopTimer();
  if (state.mode !== "mockExam") return;
  syncMockCountdown();
  updateTimerDisplay();
  if (state.remainingSeconds === 0) {
    renderResult();
    return;
  }
  state.timerId = setInterval(() => {
    syncMockCountdown();
    updateTimerDisplay();
    persistCurrentProgress();
    if (state.remainingSeconds === 0) {
      stopTimer();
      renderResult();
    }
  }, 1000);
}

function syncMockCountdown() {
  if (state.mode !== "mockExam") return;
  const remaining = getCountdownRemainingSeconds(state.deadlineAt);
  if (remaining !== null) state.remainingSeconds = remaining;
}

function updateTimerDisplay() {
  const timer = document.querySelector("#examTimer");
  if (timer) timer.textContent = formatRemainingTime(state.remainingSeconds);
}

function beginButtonLoading(button, label = "題目載入中") {
  if (!button || button.disabled) return false;
  button.dataset.originalText = button.textContent;
  button.textContent = label;
  button.disabled = true;
  return true;
}

function endButtonLoading(button) {
  if (!button) return;
  button.textContent = button.dataset.originalText || button.textContent;
  button.disabled = false;
  delete button.dataset.originalText;
}

function renderNoQuestionsWarning(message) {
  setScreen(html`
    <section class="panel warning">
      <button class="ghost" data-screen="home">回首頁</button>
      <h2>目前沒有符合條件的題目</h2>
      <p>${escapeHtml(message)}</p>
    </section>
  `);
}

function html(strings, ...values) {
  return strings.reduce((output, string, index) => output + string + (values[index] ?? ""), "");
}

function setScreen(markup) {
  stopTimer();
  stopEssayQueueCountdown();
  app.innerHTML = markup;
  window.scrollTo(0, 0);
}

function trackUsageEvent(screen) {
  const event = getAnalyticsEvent(screen);
  if (!event || !window.goatcounter?.count) return;
  window.goatcounter.count(event);
}

function isStandaloneDisplayMode() {
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator?.standalone === true
  );
}

function sendGoatCounterEventsWhenReady(events, attempt = 0) {
  if (!events.length) return;
  if (window.goatcounter?.count) {
    for (const event of events) {
      window.goatcounter.count(event);
    }
    return;
  }
  if (attempt >= 10) return;
  window.setTimeout(() => sendGoatCounterEventsWhenReady(events, attempt + 1), 300);
}

function trackVisitAnalytics() {
  try {
    const { events, state: nextVisitState } = getVisitAnalyticsEvents(
      localStorage,
      new Date(),
      isStandaloneDisplayMode()
    );
    saveVisitAnalyticsState(localStorage, nextVisitState);
    sendGoatCounterEventsWhenReady(events);
  } catch {
    // Analytics must never interrupt loading the question bank.
  }
}

function examsBySubject() {
  return state.index.subjects.map((subject) => ({
    subject,
    exams: state.index.exams.filter((exam) => exam.subject === subject)
  }));
}

function getEssayValidationMessage(validation) {
  if (validation.reason === "empty") {
    return "請先輸入申論題作答內容。";
  }
  if (validation.reason === "tooShort") {
    return `至少輸入 ${ESSAY_ANSWER_LIMITS.minChars} 字再送出批改，目前 ${validation.trimmedLength} 字。`;
  }
  if (validation.reason === "tooLong") {
    return `作答上限為 ${ESSAY_ANSWER_LIMITS.maxChars} 字，目前 ${validation.trimmedLength} 字。`;
  }
  return "申論題作答格式不正確。";
}

function buildEssayPracticeViewModel(validationMessage = "") {
  const questions = state.essayBank?.questions || [];
  const filters = { ...state.essayFilters };
  const filterOptions = getEssayFilterOptions(questions);

  const examTypes = filterOptions.examTypes || [];
  const examType = examTypes.some((item) => item.value === filters.examType)
    ? filters.examType
    : (examTypes[0]?.value || "");

  const yearChoices = (filterOptions.yearsByExamType[examType] || []).map((year) => ({
    value: String(year),
    label: `民國 ${year} 年`
  }));
  const yearRoc = yearChoices.some((item) => String(item.value) === String(filters.yearRoc))
    ? String(filters.yearRoc)
    : String(yearChoices[0]?.value || "");

  const subjectChoices = (filterOptions.subjectsByExamTypeYear[`${examType}::${yearRoc}`] || []).map((subject) => ({
    value: subject,
    label: subject
  }));
  const subject = subjectChoices.some((item) => item.value === filters.subject)
    ? filters.subject
    : (subjectChoices[0]?.value || "");

  const sessionChoices = (filterOptions.sessionsByExamTypeYearSubject[`${examType}::${yearRoc}::${subject}`] || []).map((session) => ({
    value: session,
    label: session
  }));
  const examSession = sessionChoices.some((item) => item.value === filters.examSession)
    ? filters.examSession
    : (sessionChoices[0]?.value || "");

  const filteredQuestions = filterEssayQuestions(questions, {
    examType,
    subject,
    yearRoc,
    examSession
  });
  const currentQuestions = [...filteredQuestions].sort((a, b) => Number(a.questionNo) - Number(b.questionNo));

  state.essayFilters = {
    examType,
    subject,
    yearRoc,
    examSession,
    questionId: ""
  };

  return {
    filters: { ...state.essayFilters },
    options: {
      examTypes,
      subjects: subjectChoices,
      years: yearChoices,
      sessions: sessionChoices,
      questionChoices: []
    },
    filteredQuestions,
    currentQuestions,
    draftTexts: Object.fromEntries(currentQuestions.map((question) => [
      question.id,
      state.essayDrafts[question.id] || ""
    ])),
    quota: state.essayQuota || {
      mode: "mock",
      remainingCount: 0,
      totalLimit: 0,
      quotaDate: "",
      quotaResetTimeZone: "Asia/Taipei"
    },
    validationMessage
  };
}

function renderEssayCompletedJob(job) {
  stopEssayJobPolling();
  clearEssayPendingJob();
  state.essayQuota = job.quota || state.essayQuota;
  state.essayLastGrade = job.results || null;
  const questions = state.essayBank?.questions || [];
  const results = (job.results || []).map((result) => ({
    question: getEssayQuestionById(questions, result.questionId),
    grade: result.grade
  }));
  setScreen(buildEssayResultMarkup({
    results,
    quota: state.essayQuota
  }));
  document.querySelector("#backToEssayPractice")?.addEventListener("click", () => {
    renderEssayPractice();
  });
}

function renderEssayJobStatus(job) {
  if (job.quota) state.essayQuota = job.quota;
  if (job.status === "completed") {
    renderEssayCompletedJob(job);
    return;
  }

  if (job.status === "failed") {
    stopEssayJobPolling();
    clearEssayPendingJob();
  }
  setScreen(buildEssayQueueMarkup({
    job,
    statusLabel: getEssayJobStatusLabel(job.status),
    estimateText: formatEssayJobEstimate(job)
  }));

  document.querySelector("#essayQueueRefresh")?.addEventListener("click", () => {
    if (state.essayPendingJob?.jobId) pollEssayJob(state.essayPendingJob.jobId);
  });
  document.querySelector("#backToEssayPractice")?.addEventListener("click", () => {
    renderEssayPractice();
  });
  if (["queued", "processing"].includes(job.status)) {
    startEssayJobPolling(job.jobId);
  }
  if (job.status === "queued") startEssayQueueCountdown(job);
}

function startEssayQueueCountdown(job) {
  stopEssayQueueCountdown();
  const updateCountdown = () => {
    const estimateNode = document.querySelector("#essayQueueEstimate");
    if (!estimateNode) {
      stopEssayQueueCountdown();
      return;
    }
    estimateNode.textContent = formatEssayQueueCountdown(job, Date.now());
  };
  updateCountdown();
  state.essayQueueCountdownId = window.setInterval(updateCountdown, 1000);
}

async function fetchEssayJob(jobId) {
  const response = await fetch(buildEssayApiUrl(`/api/essay/jobs/${encodeURIComponent(jobId)}`, ESSAY_API_BASE));
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function pollEssayJob(jobId) {
  try {
    const { response, payload } = await fetchEssayJob(jobId);
    if (response.status === 404) {
      stopEssayJobPolling();
      clearEssayPendingJob();
      await renderEssayPractice("先前的批改進度已到期，作答草稿仍保留，可以重新送出。");
      return false;
    }
    if (!response.ok || !payload.job) throw new Error(payload.error || ESSAY_API_HINT);
    state.essayQuota = payload.quota || payload.job.quota || state.essayQuota;
    renderEssayJobStatus(payload.job);
    return true;
  } catch {
    const statusNode = document.querySelector(".essay-queue-status");
    if (statusNode) statusNode.textContent = "暫時無法更新，系統會繼續重試";
    return true;
  }
}

function startEssayJobPolling(jobId) {
  stopEssayJobPolling();
  state.essayJobPollId = window.setInterval(() => {
    pollEssayJob(jobId);
  }, ESSAY_JOB_POLL_INTERVAL_MS);
}

async function resumeEssayPendingJob() {
  const jobId = state.essayPendingJob?.jobId;
  if (!jobId) return false;
  const { response, payload } = await fetchEssayJob(jobId);
  if (response.status === 404) {
    clearEssayPendingJob();
    return false;
  }
  if (!response.ok || !payload.job) throw new Error(payload.error || ESSAY_API_HINT);
  state.essayQuota = payload.quota || payload.job.quota || state.essayQuota;
  renderEssayJobStatus(payload.job);
  return true;
}

async function renderEssayPractice(validationMessage = "") {
  setScreen(html`
    <section class="panel essay-panel">
      <button class="ghost" data-screen="home">回首頁</button>
      <h2>申論題練習</h2>
      <p class="muted">申論題資料載入中...</p>
    </section>
  `);

  try {
    const [bank, quota] = await Promise.all([
      loadEssayBank(),
      loadEssayQuota()
    ]);

    if (!bank.questions?.length) {
      setScreen(buildEssayEmptyStateMarkup("申論題庫整理中，先完成 reviewed 題目後會顯示在這裡。"));
      return;
    }

    state.essayBank = bank;
    state.essayQuota = quota;
    if (await resumeEssayPendingJob()) return;
    const viewModel = buildEssayPracticeViewModel(validationMessage);
    setScreen(buildEssaySelectorMarkup(viewModel));
    wireEssayPractice();
  } catch (error) {
    setScreen(buildEssayEmptyStateMarkup(`申論題載入失敗：${error.message}`));
  }
}

function flashEssayDraftSaved() {
  const button = document.querySelector("#essaySaveDraft");
  if (!button) return;
  const originalText = button.textContent;
  button.textContent = "已儲存";
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = originalText;
    button.disabled = false;
  }, 1200);
}

function wireEssayPractice() {
  document.querySelector("#essayExamType")?.addEventListener("change", (event) => {
    saveCurrentEssayDraftFromScreen();
    state.essayFilters = {
      examType: event.target.value,
      yearRoc: "",
      subject: "",
      examSession: "",
      questionId: ""
    };
    renderEssayPractice();
  });

  document.querySelector("#essayYear")?.addEventListener("change", (event) => {
    saveCurrentEssayDraftFromScreen();
    state.essayFilters = {
      ...state.essayFilters,
      yearRoc: event.target.value,
      subject: "",
      examSession: "",
      questionId: ""
    };
    renderEssayPractice();
  });

  document.querySelector("#essaySubject")?.addEventListener("change", (event) => {
    saveCurrentEssayDraftFromScreen();
    state.essayFilters = {
      ...state.essayFilters,
      subject: event.target.value,
      examSession: "",
      questionId: ""
    };
    renderEssayPractice();
  });

  document.querySelector("#essaySession")?.addEventListener("change", (event) => {
    saveCurrentEssayDraftFromScreen();
    state.essayFilters = {
      ...state.essayFilters,
      examSession: event.target.value,
      questionId: ""
    };
    renderEssayPractice();
  });

  document.querySelectorAll(".essay-clear-answer[data-question-id]").forEach((clearButton) => {
    const questionCard = clearButton.closest(".essay-question-card");
    const answerField = questionCard?.querySelector(".essay-answer[data-question-id]");
    if (!answerField) return;

    const syncClearButtonState = () => {
      clearButton.disabled = !String(answerField.value ?? "").trim();
    };

    answerField.addEventListener("input", syncClearButtonState);
    clearButton.addEventListener("click", () => {
      const cleared = clearEssayAnswerDraft({
        answerField,
        questionId: clearButton.dataset.questionId,
        questionNo: clearButton.dataset.questionNo,
        confirmFn: confirm,
        saveDraft: saveEssayDraft
      });
      if (cleared) syncClearButtonState();
    });
    syncClearButtonState();
  });

  document.querySelector("#essaySaveDraft")?.addEventListener("click", () => {
    saveCurrentEssayDraftFromScreen();
    flashEssayDraftSaved();
  });

  document.querySelector("#essaySubmit")?.addEventListener("click", (event) => {
    submitEssayGrade(event.currentTarget);
  });
}

async function submitEssayGrade(button) {
  const currentQuestions = filterEssayQuestions(state.essayBank?.questions || [], state.essayFilters)
    .sort((a, b) => Number(a.questionNo) - Number(b.questionNo));
  const answerFields = new Map(
    [...document.querySelectorAll(".essay-answer[data-question-id]")]
      .map((field) => [field.dataset.questionId, field.value])
  );

  if (!currentQuestions.length) {
    renderEssayPractice("目前沒有可送出的申論題。");
    return;
  }

  const submissions = currentQuestions.map((question) => ({
    questionId: question.id,
    answerText: answerFields.get(question.id) || ""
  }));
  for (let index = 0; index < submissions.length; index += 1) {
    const submission = submissions[index];
    saveEssayDraft(submission.questionId, submission.answerText);
    const validation = validateEssayAnswer(submission.answerText, ESSAY_ANSWER_LIMITS);
    if (!validation.ok) {
      renderEssayPractice(`第 ${currentQuestions[index].questionNo} 題：${getEssayValidationMessage(validation)}`);
      return;
    }
  }

  const submissionCount = submissions.length;
  if ((state.essayQuota?.remainingCount ?? 0) <= 0) {
    alert("今日額度已滿");
    renderEssayPractice("今日額度已滿，整份考卷未送出，也不會扣除次數。");
    return;
  }

  if (!confirm(`確定送出本份考卷嗎？${submissionCount} 題作答會合併為 1 次AI批改，並使用 1 次今日全站額度。`)) {
    return;
  }

  if (!beginButtonLoading(button, "加入隊伍中")) return;

  try {
    const response = await fetch(buildEssayApiUrl("/api/essay/jobs", ESSAY_API_BASE), {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({ submissions })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (payload.quota) state.essayQuota = payload.quota;
      await loadEssayQuota(true).catch(() => {});
      if (response.status === 429) {
        alert("今日額度已滿");
        renderEssayPractice("今日額度已滿。");
        return;
      }
      renderEssayPractice(payload.error || "申論批改失敗，請稍後再試。");
      return;
    }

    state.essayQuota = payload.quota || state.essayQuota;
    saveEssayPendingJob(payload.jobId);
    renderEssayJobStatus(payload.job);
  } catch (error) {
    renderEssayPractice(`申論批改失敗：${error.message}`);
  } finally {
    endButtonLoading(button);
  }
}

function renderHome() {
  const included = state.index.buildSummary.includedExams;
  const latest = state.index.latestYearRoc;
  const progress = state.activeProgress;
  setScreen(html`
    ${progress ? html`
      <section class="panel continue-panel">
        <h2>繼續上次考試</h2>
        <p class="muted">${escapeHtml(progress.subject)}｜${progress.mode === "mockExam" ? "模擬考" : `民國 ${progress.yearRoc} 年`}｜第 ${Number(progress.currentQuestionIndex) + 1} 題</p>
        <div class="toolbar two-actions">
          <button class="primary" id="continueProgress">繼續考試</button>
          <button class="ghost danger-ghost" id="abandonProgress">放棄本次</button>
        </div>
      </section>
    ` : ""}

    <section class="panel home-section">
      <h2>今天想怎麼練習呢？</h2>
      <p class="muted home-section-note">用零碎時間刷考古題，錯題會自動留下，考前回來補洞。</p>
      <div class="home-grid">
        <button class="mode-card" data-screen="quick">
          <strong>快速練習</strong>
          <span>碎片時間用。選一科後隨機做幾題。</span>
        </button>
        <button class="mode-card" data-screen="past">
          <strong>歷屆題庫</strong>
          <span>收入不同年份各科的考題，供使用者背誦，還可以練習考古題測驗。</span>
        </button>
        <button class="mode-card" data-screen="mock">
          <strong>模擬考</strong>
          <span>依國考該科題數出題，有時間限制，考題會以跨年度隨機抽取。</span>
        </button>
        <button class="mode-card essay-mode-card" data-screen="essay">
          <strong>申論題練習（測試中）</strong>
          <span>申論題題庫已先整理，可練習作答並送出AI批改建議。每日全站共用500份考卷批改額度。</span>
        </button>
        <button class="mode-card" data-screen="weak">
          <strong>錯題與弱點</strong>
          <span>整理答錯、不熟悉和收藏的題目，可以再重複練習，加深印象。</span>
        </button>
      </div>
    </section>

    <section class="panel home-tools-section">
      <h2>考試工具</h2>
      <div class="home-grid compact-home-grid">
        <button class="mode-card" data-screen="law">
          <strong>法規速查</strong>
          <span>收錄社工師歷年考試出過的法規，且統計考過幾次，供考生參考。</span>
        </button>
      </div>
    </section>

    <div class="home-support-grid">
      <section class="panel home-summary">
        <h2>考題更新狀況</h2>
        <div class="status-strip" aria-label="題庫狀態">
          <div class="stat"><strong>${included}</strong><span>份考卷已入題庫</span></div>
          <div class="stat"><strong>5</strong><span>科考試題庫</span></div>
          <div class="stat"><strong>${latest}</strong><span>最新年度</span></div>
        </div>
      </section>

      <button class="panel install-panel" data-screen="install">
        <img src="icons/icon-192.png" alt="" aria-hidden="true">
        <strong>第一次使用請先點我</strong>
        <span>加入到手機桌面</span>
        <span>iPhone／Android 都可以</span>
      </button>
    </div>
  `);
  wireHome();
}

async function renderLawCategories() {
  setScreen(html`<section class="panel"><h2>法規速查</h2><p class="muted">法規清冊載入中...</p></section>`);
  try {
    const lookup = await loadLawLookup();
    setScreen(html`
      <section class="panel">
        <button class="ghost" data-screen="home">回首頁</button>
        <h2>法規速查</h2>
        <p class="muted law-page-intro">收錄社工師歷年考試出過的法規，且統計考過幾次，供考生參考。</p>
        <div class="law-list">
          ${lookup.groups.map((group) => html`
            <button class="mode-card law-tier-card" data-law-tier="${escapeHtml(group.id)}">
              <strong>${escapeHtml(group.label)}</strong>
              <span>${group.lawCount}部法規｜近5年${group.recent5YearQuestionCount}題｜歷屆題庫共${group.totalQuestionCount}題</span>
            </button>
          `).join("")}
        </div>
        <p class="law-footnote">法規內容以全國法規資料庫官方頁面為準。統計會隨題庫更新重新計算。</p>
      </section>
    `);
  } catch (error) {
    setScreen(html`
      <section class="panel warning">
        <button class="ghost" data-screen="home">回首頁</button>
        <h2>法規清冊載入失敗</h2>
        <p>${escapeHtml(error.message)}</p>
      </section>
    `);
  }
}

async function renderLawList(groupId) {
  try {
    const lookup = await loadLawLookup();
    const group = lookup.groups.find((item) => item.id === groupId) || lookup.groups[0];
    setScreen(html`
      <section class="panel law-list-panel">
        <button class="ghost" data-screen="law">回分類</button>
        <h2>${escapeHtml(group.label)}</h2>
        <p class="muted law-page-intro">本分類共${group.lawCount}部法規，近5年${group.recent5YearQuestionCount}題，歷屆題庫共出現${group.totalQuestionCount}題。點法規名稱後，會另開全國法規資料庫。</p>
        <div class="law-list scroll-law-list">
          ${group.laws.map((law) => html`
            <a class="law-card" href="${escapeHtml(law.url)}" target="_blank" rel="noopener noreferrer">
              <strong>${escapeHtml(law.name)}</strong>
              <span>近5年${law.recent5YearQuestionCount}題｜歷屆${law.totalQuestionCount}題</span>
              <small>出現年度：${escapeHtml(law.yearRangeRoc || "未標示")}｜最新修正：${escapeHtml(law.lawModifiedDate || "未標示")}</small>
              <em>開啟全國法規資料庫</em>
            </a>
          `).join("")}
        </div>
        <p class="law-footnote">法規內容以全國法規資料庫官方頁面為準。</p>
      </section>
    `);
  } catch (error) {
    setScreen(html`
      <section class="panel warning">
        <button class="ghost" data-screen="law">回分類</button>
        <h2>法規列表載入失敗</h2>
        <p>${escapeHtml(error.message)}</p>
      </section>
    `);
  }
}

function wireHome() {
  const continueButton = document.querySelector("#continueProgress");
  if (continueButton) continueButton.addEventListener("click", continueSavedProgress);

  const abandonButton = document.querySelector("#abandonProgress");
  if (abandonButton) abandonButton.addEventListener("click", abandonSavedProgress);
}

function renderInstallGuide() {
  setScreen(html`
    <section class="panel past-selector-panel">
      <button class="ghost" data-screen="home">回首頁</button>
      <h2>把 <span class="app-name-highlight">考上社工師</span> 放到手機桌面</h2>
      <p class="muted">請用手機瀏覽器開啟網站，不要用 LINE、Facebook 或其他 APP 內建瀏覽器。</p>
      <div class="install-platforms">
        <section class="install-platform">
          <h3>iPhone 使用者</h3>
          <p class="muted">請用 Safari 開啟網站，再照下面步驟加入主畫面。</p>
          <div class="install-steps">
            <article class="install-step">
              <strong>點 Safari 的分享按鈕</strong>
              <div class="phone-shot">
                <img src="install-guide/install-step-1-share.png" alt="Safari 選單中分享按鈕的位置">
              </div>
              <p>先在 Safari 打開網站，找到選單裡的「分享」。</p>
            </article>
            <article class="install-step">
              <strong>點「檢視較多」</strong>
              <div class="phone-shot">
                <img src="install-guide/install-step-2-more.png" alt="iPhone 分享面板中檢視較多的位置">
              </div>
              <p>如果一開始沒有看到「加入主畫面」，先點「檢視較多」。</p>
            </article>
            <article class="install-step">
              <strong>選「加入主畫面」</strong>
              <div class="phone-shot">
                <img src="install-guide/install-step-3-add-home.png" alt="iPhone 選單中加入主畫面的位置">
              </div>
              <p>接著確認名稱是「考上社工師」，按加入後就會出現在桌面。</p>
            </article>
            <article class="install-step">
              <strong>回桌面點「考上社工師」</strong>
              <p>之後就可以像 APP 一樣從桌面開啟，不需要登入。</p>
            </article>
          </div>
        </section>
        <section class="install-platform">
          <h3>Android 使用者</h3>
          <p class="muted">請用 Google Chrome 開啟網站，再把它加到主畫面。</p>
          <div class="install-steps android-install-steps">
            <article class="install-step">
              <strong>用 Google Chrome 開啟網站</strong>
              <p>打開 Chrome 瀏覽器，前往「考上社工師」網頁。</p>
            </article>
            <article class="install-step">
              <strong>點右上角「⋮」</strong>
              <p>找到 Chrome 右上角的更多選單。</p>
            </article>
            <article class="install-step">
              <strong>選「加到主畫面」</strong>
              <p>向下滑動選單，點選「加到主畫面」。</p>
            </article>
            <article class="install-step">
              <strong>按「新增」完成</strong>
              <p>確認名稱是「考上社工師」，按新增後就會出現在手機桌面。</p>
            </article>
          </div>
        </section>
      </div>
    </section>
  `);
}

function renderPastSelector() {
  const subjects = examsBySubject();
  setScreen(html`
    <section class="panel past-selector-panel">
      <div class="past-intro-block">
      <button class="ghost" data-screen="home">回首頁</button>
      <h2>歷屆題庫</h2>
      <p class="muted">先選科目、年度與考次，再選背誦模式或考試模式。</p>
      </div>
      <div class="form-grid past-select-block">
        <label>科目
          <select id="subjectSelect">
            ${subjects.map(({ subject }) => `<option value="${subject}">${subject}</option>`).join("")}
          </select>
        </label>
        <label>年度
          <select id="yearSelect"></select>
        </label>
        <label>考次
          <select id="examSelect"></select>
        </label>
      </div>
      <div class="toolbar past-mode-actions">
        <button class="primary" id="startMemorize">背誦模式</button>
        <p class="muted">此為題庫模式，題目和答案會一起顯示，適合快速翻略、背誦。也可以考前抱佛腳。</p>
        <button class="secondary" id="startExam">考試模式</button>
        <p class="muted">模擬社工師考試，會先不顯示答案，交卷後才看結果。這個模式僅選擇題，沒有申論題。</p>
      </div>
    </section>
  `);
  wirePastSelector();
}

function getSelectedExam() {
  const examId = document.querySelector("#examSelect").value;
  return state.index.exams.find((exam) => exam.examId === examId);
}

function wirePastSelector() {
  const subjectSelect = document.querySelector("#subjectSelect");
  const yearSelect = document.querySelector("#yearSelect");
  const examSelect = document.querySelector("#examSelect");

  function updateYears() {
    const years = [...new Set(state.index.exams.filter((exam) => exam.subject === subjectSelect.value).map((exam) => exam.yearRoc))].sort((a, b) => b - a);
    yearSelect.innerHTML = years.map((year) => `<option value="${year}">民國 ${year} 年</option>`).join("");
    updateExams();
  }

  function updateExams() {
    const exams = state.index.exams.filter((exam) => exam.subject === subjectSelect.value && String(exam.yearRoc) === yearSelect.value);
    examSelect.innerHTML = exams.map((exam) => `<option value="${exam.examId}">民國 ${exam.yearRoc} 年 ${exam.examAttempt}</option>`).join("");
  }

  subjectSelect.addEventListener("change", updateYears);
  yearSelect.addEventListener("change", updateExams);
  document.querySelector("#startMemorize").addEventListener("click", async () => startExamMode(getSelectedExam(), "memorize"));
  document.querySelector("#startExam").addEventListener("click", async () => startExamMode(getSelectedExam(), "exam"));
  updateYears();
}

async function startExamMode(exam, mode) {
  state.currentExam = await loadExam(exam);
  state.currentExam.examFile = exam.file;
  state.currentQuestionIndex = 0;
  state.mode = mode;
  state.completed = false;
  state.showAnswer = mode === "memorize";
  state.selected = {};
  state.remainingSeconds = null;
  state.deadlineAt = null;
  if (mode === "exam") persistCurrentProgress();
  renderQuestion();
}

async function continueSavedProgress() {
  const progress = state.activeProgress;
  if (!progress) return;
  if (progress.currentExamSnapshot) {
    state.currentExam = progress.currentExamSnapshot;
    state.currentQuestionIndex = Math.min(
      Number(progress.currentQuestionIndex) || 0,
      state.currentExam.questions.length - 1
    );
    state.mode = progress.mode || "mockExam";
    state.completed = false;
    state.showAnswer = false;
    state.selected = progress.selected || {};
    state.deadlineAt = progress.deadlineAt ?? Date.now() + Number(progress.remainingSeconds ?? 60 * 60) * 1000;
    syncMockCountdown();
    if (state.remainingSeconds === 0) {
      renderResult();
      return;
    }
    renderQuestion();
    return;
  }

  const indexExam = state.index.exams.find((exam) => exam.examId === progress.examId);
  const examFile = progress.examFile || indexExam?.file;
  if (!examFile) {
    clearProgress(localStorage);
    state.activeProgress = null;
    renderHome();
    return;
  }

  state.currentExam = await loadExam({ file: examFile });
  state.currentExam.examFile = examFile;
  state.currentQuestionIndex = Math.min(
    Number(progress.currentQuestionIndex) || 0,
    state.currentExam.questions.length - 1
  );
  state.mode = progress.mode || "exam";
  state.completed = false;
  state.showAnswer = false;
  state.selected = progress.selected || {};
  state.remainingSeconds = progress.remainingSeconds ?? null;
  state.deadlineAt = progress.deadlineAt ?? null;
  renderQuestion();
}

function abandonSavedProgress() {
  const confirmed = window.confirm("確定要放棄這次考試嗎？放棄後不會計分，也不會保留作答進度。");
  if (!confirmed) return;
  clearProgress(localStorage);
  state.activeProgress = null;
  renderHome();
}

function persistCurrentProgress() {
  if (!shouldPersistProgress(state.mode, state.currentExam, state.completed)) return;
  const progress = {
    examId: state.currentExam.examId,
    examFile: state.currentExam.examFile,
    mode: state.mode,
    subject: state.currentExam.subject,
    yearRoc: state.currentExam.yearRoc,
    examAttempt: state.currentExam.examAttempt,
    currentQuestionIndex: state.currentQuestionIndex,
    selected: state.selected,
    markedUnfamiliar: Object.keys(state.weak.unfamiliar),
    currentExamSnapshot: state.mode === "mockExam" ? state.currentExam : null,
    remainingSeconds: state.remainingSeconds,
    deadlineAt: state.deadlineAt,
    updatedAt: new Date().toISOString()
  };
  saveProgress(localStorage, progress);
  state.activeProgress = progress;
}

function renderQuestion() {
  const exam = state.currentExam;
  syncMockCountdown();
  if (state.mode === "mockExam" && state.remainingSeconds === 0) {
    renderResult();
    return;
  }
  const question = exam.questions[state.currentQuestionIndex];
  const selected = state.selected[question.id];
  const showAnswer = state.showAnswer || state.mode === "memorize";
  const metaParts = buildQuestionMetaParts(exam, question, state.mode, state.currentQuestionIndex);
  const sourceNote = getQuestionSourceNote(state.mode, question);
  const isFirstQuestion = state.currentQuestionIndex === 0;
  const canRemoveWrong = state.mode === "weakReview" && state.weakReturnCategory === "wrong" && Boolean(state.weak.wrong[question.id]);
  const questionContext = question.sharedPromptContext || question.previousQuestionContext || null;
  setScreen(html`
    <section class="question-card mode-${state.mode}">
      <div class="top-actions">
        <button class="ghost" data-screen="home">${["exam", "mockExam"].includes(state.mode) ? "暫停回首頁" : "回首頁"}</button>
      </div>
      <div class="question-meta">
        <span class="pill">${exam.subject}</span>
        ${metaParts.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}
        ${state.mode === "mockExam" ? `<span class="timer-pill" id="examTimer">${formatRemainingTime(state.remainingSeconds)}</span>` : ""}
      </div>
      ${sourceNote ? `<p class="source-note">${escapeHtml(sourceNote)}</p>` : ""}
      ${questionContext ? renderPreviousQuestionContext(questionContext) : ""}
      <p class="stem">${escapeHtml(displayText(question.stem))}</p>
      ${buildQuestionImagesMarkup(question)}
      <div class="options">
        ${question.options.map((option) => {
          const classes = getOptionStateClasses(option.key, selected, getAcceptedAnswers(question), showAnswer);
          return `<button class="${classes.join(" ")}" data-answer="${option.key}"><strong>${option.key}</strong><span>${escapeHtml(displayText(option.text))}</span></button>`;
        }).join("")}
      </div>
      ${showAnswer ? renderAnswerBox(question) : ""}
      <div class="toolbar">
        ${canRemoveWrong ? `<button class="ghost danger-ghost" id="removeWrongQuestion">移除錯題</button>` : ""}
        <button class="ghost" id="markUnfamiliar">不熟，之後再看</button>
        <button class="secondary" id="prevQuestion" ${isFirstQuestion ? "disabled" : ""}>上一題</button>
        <button class="primary" id="nextQuestion">${state.currentQuestionIndex === exam.questions.length - 1 ? "完成" : "下一題"}</button>
      </div>
    </section>
  `);
  wireQuestion(question);
  startTimer();
}

function renderAnswerBox(question) {
  const notice = getOfficialAnswerNoticeText(question);
  return html`
    <div class="answer-box">
      <div>官方答案：<strong>${formatOfficialAnswerText(question)}</strong></div>
      ${notice ? `<p class="official-answer-notice">${escapeHtml(notice)}</p>` : ""}
    </div>
  `;
}

function renderPreviousQuestionContext(previousQuestion) {
  const title = previousQuestion.title || "上題內容";
  const numberLabel = Number.isFinite(previousQuestion.number) ? `<span>第 ${previousQuestion.number} 題</span>` : "";
  return html`
    <aside class="previous-context">
      <div class="previous-context-title">
        <strong>${escapeHtml(title)}</strong>
        ${numberLabel}
      </div>
      <p>${escapeHtml(displayText(previousQuestion.stem))}</p>
      ${(previousQuestion.options || []).length ? html`
        <div class="previous-options">
          ${previousQuestion.options.map((option) => `<span>${option.key}. ${escapeHtml(displayText(option.text))}</span>`).join("")}
        </div>
      ` : ""}
    </aside>
  `;
}

function wireQuestion(question) {
  document.querySelectorAll("[data-answer]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selected[question.id] = button.dataset.answer;
      if (shouldRevealAnswerAfterSelection(state.mode)) state.showAnswer = true;
      if (state.mode === "weakExam") {
        state.weak = updateWrongItemsAfterAnsweredPractice(state.weak, [question], state.selected);
        saveWeakState();
      } else if (shouldRevealAnswerAfterSelection(state.mode)) {
        state.weak = updateWrongItemsAfterImmediateReveal(state.weak, question, button.dataset.answer);
        saveWeakState();
      }
      persistCurrentProgress();
      renderQuestion();
    });
  });
  document.querySelector("#markUnfamiliar").addEventListener("click", () => {
    state.weak.unfamiliar[question.id] = question;
    saveWeakState();
    persistCurrentProgress();
    renderQuestion();
  });
  document.querySelector("#removeWrongQuestion")?.addEventListener("click", () => {
    delete state.weak.wrong[question.id];
    saveWeakState();
    renderWeak("wrong");
  });
  document.querySelector("#prevQuestion").addEventListener("click", () => {
    if (state.currentQuestionIndex === 0) return;
    state.currentQuestionIndex = Math.max(0, state.currentQuestionIndex - 1);
    state.showAnswer = state.mode === "memorize";
    persistCurrentProgress();
    renderQuestion();
  });
  document.querySelector("#nextQuestion").addEventListener("click", () => {
    if (state.currentQuestionIndex === state.currentExam.questions.length - 1) {
      if (getQuestionCompletionTarget(state.mode) === "weak") {
        renderWeak(state.weakReturnCategory || "wrong");
      } else {
        renderResult();
      }
    } else {
      state.currentQuestionIndex += 1;
      state.showAnswer = state.mode === "memorize";
      persistCurrentProgress();
      renderQuestion();
    }
  });
}

function renderResult() {
  stopTimer();
  state.completed = true;
  const result = scoreExam(state.currentExam.questions, state.selected);
  const encouragement = getResultEncouragement(result.correct, result.total);
  for (const id of result.wrongQuestionIds) {
    const question = state.currentExam.questions.find((item) => item.id === id);
    if (question) state.weak.wrong[id] = question;
  }
  saveWeakState();
  if (state.mode === "exam" || state.mode === "mockExam") {
    clearProgress(localStorage);
    state.activeProgress = null;
  }
  setScreen(html`
    <section class="panel result-panel">
      <h2>本次結果</h2>
      <p class="stem">${formatResultScoreLine(result)}</p>
      <p class="result-message">${escapeHtml(encouragement)}</p>
      <div class="result-actions">
        <button class="primary" data-screen="weak">看錯題</button>
        <button class="secondary" id="practiceFiveMore">再練 5 題</button>
        <button class="ghost" data-screen="home">回首頁</button>
      </div>
    </section>
  `);
  document.querySelector("#practiceFiveMore").addEventListener("click", (event) => startFiveQuestionFollowUp(event.currentTarget));
}

async function startFiveQuestionFollowUp(button) {
  if (!beginButtonLoading(button)) return;
  const subject = getFollowUpSubject();
  try {
    const exams = state.index.exams.filter((exam) => exam.subject === subject);
    const loaded = await Promise.all(exams.map(loadExam));
    const picked = createQuestionSetFromExams(loaded, { count: 5 });
    if (!picked.length) {
      renderNoQuestionsWarning("目前找不到可再練 5 題的題目，請回首頁改用快速練習或歷屆題庫。");
      return;
    }
    state.currentExam = {
      subject,
      yearRoc: "全部",
      examAttempt: "快速練習",
      questions: picked
    };
    state.currentQuestionIndex = 0;
    state.mode = "quick";
    state.completed = false;
    state.showAnswer = false;
    state.remainingSeconds = null;
    state.deadlineAt = null;
    state.selected = {};
    renderQuestion();
  } catch (error) {
    renderNoQuestionsWarning(`題目載入失敗：${error.message}`);
  } finally {
    endButtonLoading(button);
  }
}

function getFollowUpSubject() {
  const examSubject = state.currentExam?.subject;
  if (state.index.subjects.includes(examSubject)) return examSubject;
  const questionSubject = state.currentExam?.questions?.find((question) => state.index.subjects.includes(question.subject))?.subject;
  return questionSubject || state.index.subjects[0];
}

function renderQuickPractice() {
  setScreen(html`
    <section class="panel practice-setup-panel">
      <button class="ghost" data-screen="home">回首頁</button>
      <h2>快速練習</h2>
      <p class="muted">選科目、題數和來源。每題答完立刻看答案。</p>
      <div class="form-grid">
        <label>科目
          <select id="quickSubject">
            ${state.index.subjects.map((subject) => `<option value="${subject}">${subject}</option>`).join("")}
          </select>
        </label>
        <label>題數
          <select id="quickCount">
            <option value="5">5 題</option>
            <option value="10">10 題</option>
            <option value="20">20 題</option>
          </select>
        </label>
        <label>來源
          <select id="quickSource">
            <option value="all">全部歷年題</option>
            <option value="recent">近五年</option>
          </select>
        </label>
      </div>
      <button class="primary" id="startQuick">開始練習</button>
    </section>
  `);
  document.querySelector("#startQuick").addEventListener("click", (event) => startQuickPractice(event.currentTarget));
}

async function startQuickPractice(button) {
  if (!beginButtonLoading(button)) return;
  const subject = document.querySelector("#quickSubject").value;
  const count = Number(document.querySelector("#quickCount").value);
  const source = document.querySelector("#quickSource").value;
  try {
    const recentYears = selectRecentYears(state.index, 5);
    const exams = state.index.exams.filter((exam) => exam.subject === subject && (source === "all" || recentYears.includes(exam.yearRoc)));
    const loaded = await Promise.all(exams.map(loadExam));
    const picked = createQuestionSetFromExams(loaded, { count });
    if (!picked.length) {
      renderNoQuestionsWarning("目前沒有符合條件的題目，請改選全部歷年題、其他科目，或稍後再試。");
      return;
    }
    state.currentExam = {
      subject,
      yearRoc: source === "recent" ? recentYears.join("-") : "全部",
      examAttempt: "快速練習",
      questions: picked
    };
    state.currentQuestionIndex = 0;
    state.mode = "quick";
    state.completed = false;
    state.showAnswer = false;
    state.remainingSeconds = null;
    state.deadlineAt = null;
    state.selected = {};
    renderQuestion();
  } catch (error) {
    renderNoQuestionsWarning(`題目載入失敗：${error.message}`);
  } finally {
    endButtonLoading(button);
  }
}

function renderWeak(activeCategory = "wrong", requestedPage = state.weakPage?.[activeCategory] || 1) {
  const categories = [
    { key: "wrong", label: "錯題", help: "答錯過，要再練一次。" },
    { key: "unfamiliar", label: "不熟", help: "你手動標記不確定，適合考前回來看。" },
    { key: "favorite", label: "收藏", help: "你覺得重要，先留起來。" }
  ];
  const active = categories.find((category) => category.key === activeCategory) || categories[0];
  const activeItems = getWeakItems(state.weak, active.key);
  const pageData = paginateItems(activeItems, requestedPage, 5);
  state.weakPage[active.key] = pageData.page;
  const wrongCount = getWeakItems(state.weak, "wrong").length;
  const unfamiliarCount = getWeakItems(state.weak, "unfamiliar").length;
  const favoriteCount = getWeakItems(state.weak, "favorite").length;
  setScreen(html`
    <section class="panel weak-panel">
      <button class="ghost" data-screen="home">回首頁</button>
      <h2>錯題與弱點</h2>
      <p class="muted weak-intro">這裡是你的考前補洞清單。先不用全會，先把常錯的題目變少。</p>
      <div class="status-strip">
        <button class="stat weak-tab ${active.key === "wrong" ? "active" : ""}" data-weak-category="wrong"><strong>${wrongCount}</strong><span>錯題</span></button>
        <button class="stat weak-tab ${active.key === "unfamiliar" ? "active" : ""}" data-weak-category="unfamiliar"><strong>${unfamiliarCount}</strong><span>不熟</span></button>
        <button class="stat weak-tab ${active.key === "favorite" ? "active" : ""}" data-weak-category="favorite"><strong>${favoriteCount}</strong><span>收藏</span></button>
      </div>
      <p class="muted weak-help">${active.help}</p>
      <div class="weak-actions">
        ${active.key !== "favorite" ? `<button class="primary" id="startWeakPractice" ${activeItems.length ? "" : "disabled"}>用${active.label}練習</button>` : ""}
        ${(wrongCount + unfamiliarCount) > 0 ? `<button class="primary" id="startWeakMixed">錯題＋不熟混合練習</button>` : ""}
      </div>
      <div class="weak-list">
        ${pageData.items.length ? pageData.items.map(renderWeakItem).join("") : `<div class="empty">目前沒有${active.label}。之後做題、標記不熟或收藏後，會出現在這裡。</div>`}
      </div>
      ${activeItems.length > 5 ? renderWeakPagination(active.key, pageData) : ""}
      <section class="weak-backup-section" aria-labelledby="weakBackupTitle">
        <h3 id="weakBackupTitle">學習紀錄備份</h3>
        <p class="muted">只備份錯題、不熟與收藏。刪除桌面APP或更換手機前，請先備份。</p>
        <div class="weak-backup-actions">
          <button class="primary" id="exportWeakBackup">備份到手機</button>
          <button class="secondary" id="importWeakBackup">從備份還原</button>
          <button class="secondary" id="showWeakBackupGuide">查看備份與還原教學</button>
        </div>
        <input id="weakBackupFile" type="file" accept="application/json,.json" hidden>
        <p class="weak-backup-status" id="weakBackupStatus" aria-live="polite"></p>
      </section>
    </section>
  `);
  wireWeak(active.key);
}

function renderWeakPagination(category, pageData) {
  return html`
    <label class="weak-pagination">切換頁面
      <select id="weakPageSelect" data-weak-page-category="${category}">
        ${Array.from({ length: pageData.totalPages }, (_, index) => {
          const page = index + 1;
          const start = index * pageData.perPage + 1;
          const end = Math.min(page * pageData.perPage, pageData.totalItems);
          return `<option value="${page}" ${page === pageData.page ? "selected" : ""}>第 ${page} 頁｜第 ${start}-${end} 題</option>`;
        }).join("")}
      </select>
    </label>
  `;
}

function renderWeakItem(question) {
  return html`
    <article class="weak-item">
      <div class="weak-item-meta">${escapeHtml(weakSourceLine(question))}</div>
      <p>${escapeHtml(displayText(question.stem))}</p>
      <button class="ghost" data-weak-question="${escapeHtml(question.id)}">看這一題</button>
    </article>
  `;
}

function weakSourceLine(question) {
  if (question.sourceDisplay) return question.sourceDisplay;
  if (question.yearRoc && question.examAttempt && question.subject && question.number) return formatQuestionSource(question);
  return "來源：本機弱點紀錄";
}

function wireWeak(activeCategory) {
  document.querySelectorAll("[data-weak-category]").forEach((button) => {
    button.addEventListener("click", () => renderWeak(button.dataset.weakCategory, 1));
  });

  document.querySelector("#startWeakPractice")?.addEventListener("click", () => startWeakPractice([activeCategory]));
  document.querySelector("#startWeakMixed")?.addEventListener("click", () => startWeakPractice(["wrong", "unfamiliar"]));
  document.querySelector("#weakPageSelect")?.addEventListener("change", (event) => {
    renderWeak(event.target.dataset.weakPageCategory, Number(event.target.value));
  });
  document.querySelectorAll("[data-weak-question]").forEach((button) => {
    button.addEventListener("click", () => openWeakQuestion(button.dataset.weakQuestion, activeCategory));
  });
  document.querySelector("#exportWeakBackup")?.addEventListener("click", exportWeakBackup);
  document.querySelector("#importWeakBackup")?.addEventListener("click", () => {
    document.querySelector("#weakBackupFile")?.click();
  });
  document.querySelector("#weakBackupFile")?.addEventListener("change", (event) => {
    importWeakBackupFile(event.target.files?.[0], activeCategory);
    event.target.value = "";
  });
  document.querySelector("#showWeakBackupGuide")?.addEventListener("click", () => {
    renderWeakBackupGuide("iphone", activeCategory);
  });
}

function setWeakBackupStatus(message, isError = false) {
  const status = document.querySelector("#weakBackupStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function isAppleMobileDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function weakBackupFileName() {
  const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  return `考上社工師_學習紀錄_${date}.json`;
}

function downloadWeakBackup(file, fileName) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportWeakBackup() {
  const total = WEAK_BACKUP_CATEGORIES.reduce((sum, category) => sum + getWeakItems(state.weak, category).length, 0);
  if (!total && !window.confirm("目前沒有錯題、不熟或收藏紀錄，仍要建立空白備份嗎？")) return;

  const fileName = weakBackupFileName();
  const text = JSON.stringify(createWeakRecordBackup(state.weak), null, 2);
  const file = new File([text], fileName, { type: "application/json" });

  try {
    if (isAppleMobileDevice() && navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title: "考上社工師學習紀錄", files: [file] });
      setWeakBackupStatus("分享面板已開啟；請選「儲存到檔案」，並確認檔案已保存。");
      return;
    }
    downloadWeakBackup(file, fileName);
    setWeakBackupStatus("備份檔已下載；請到下載／Downloads確認檔案。");
  } catch (error) {
    if (error?.name === "AbortError") return;
    try {
      downloadWeakBackup(file, fileName);
      setWeakBackupStatus("分享功能無法使用，已改為下載備份檔；請確認檔案已保存。");
    } catch {
      setWeakBackupStatus("目前無法建立備份，請稍後再試。", true);
    }
  }
}

async function buildWeakQuestionLookup(records) {
  const wantedIds = new Set(WEAK_BACKUP_CATEGORIES.flatMap((category) => records[category] || []));
  const targetExams = state.index.exams.filter((exam) => {
    const prefix = `${exam.examId}:q`;
    return [...wantedIds].some((id) => id.startsWith(prefix));
  });
  const lookup = new Map();
  const batchSize = 8;

  for (let index = 0; index < targetExams.length; index += batchSize) {
    const loaded = await Promise.all(targetExams.slice(index, index + batchSize).map(loadExam));
    loaded.flatMap((exam) => exam.questions).forEach((question) => {
      if (wantedIds.has(question.id)) lookup.set(question.id, question);
    });
  }
  return lookup;
}

async function importWeakBackupFile(file, activeCategory) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".json") || file.size > MAX_WEAK_BACKUP_BYTES) {
    setWeakBackupStatus(file.size > MAX_WEAK_BACKUP_BYTES
      ? "備份檔超過1MB，請確認是否選到正確的檔案。"
      : "請選擇「考上社工師」匯出的JSON備份檔。", true);
    return;
  }

  setWeakBackupStatus("正在檢查備份內容，請稍候……");
  try {
    const backup = parseWeakRecordBackup(await file.text(), file.size);
    const lookup = await buildWeakQuestionLookup(backup.records);
    renderWeakBackupPreview(backup, lookup, activeCategory);
  } catch (error) {
    setWeakBackupStatus(error?.message || "無法讀取這份備份檔。", true);
  }
}

function formatWeakBackupTime(value) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei"
  }).format(new Date(value));
}

function renderWeakBackupPreview(backup, lookup, activeCategory) {
  const counts = Object.fromEntries(WEAK_BACKUP_CATEGORIES.map((category) => [category, backup.records[category].length]));
  const uniqueIds = new Set(WEAK_BACKUP_CATEGORIES.flatMap((category) => backup.records[category]));
  const unavailableCount = [...uniqueIds].filter((id) => !lookup.has(id)).length;

  setScreen(html`
    <section class="panel weak-backup-preview">
      <button class="ghost" id="backToWeak">回錯題與弱點</button>
      <h2>確認還原內容</h2>
      <p class="muted">備份時間：${escapeHtml(formatWeakBackupTime(backup.exportedAt))}</p>
      <div class="weak-backup-counts">
        <div class="stat"><strong>${counts.wrong}</strong><span>錯題</span></div>
        <div class="stat"><strong>${counts.unfamiliar}</strong><span>不熟</span></div>
        <div class="stat"><strong>${counts.favorite}</strong><span>收藏</span></div>
      </div>
      <p class="weak-backup-preview-note">系統已找到${lookup.size}題目前題庫內容；${unavailableCount ? `另有${unavailableCount}題已無法對應，還原時會略過。` : "沒有找不到的題目。"}</p>
      <div class="weak-backup-actions">
        <button class="primary" id="mergeWeakBackup">加入目前紀錄</button>
        <button class="danger-ghost" id="replaceWeakBackup">用備份取代目前紀錄</button>
      </div>
      <p class="muted">建議選「加入目前紀錄」，原本手機裡的錯題、不熟與收藏會保留。</p>
    </section>
  `);

  document.querySelector("#backToWeak").addEventListener("click", () => renderWeak(activeCategory));
  document.querySelector("#mergeWeakBackup").addEventListener("click", () => {
    applyWeakBackup(backup, lookup, "merge", activeCategory);
  });
  document.querySelector("#replaceWeakBackup").addEventListener("click", () => {
    if (!window.confirm("確定要用備份取代目前紀錄嗎？手機裡現有的錯題、不熟與收藏會被這份備份取代。")) return;
    applyWeakBackup(backup, lookup, "replace", activeCategory);
  });
}

function applyWeakBackup(backup, lookup, mode, activeCategory) {
  const result = restoreWeakRecords(state.weak, backup, lookup, mode);
  state.weak = result.weak;
  saveWeakState();
  renderWeak(activeCategory, 1);
  const added = Object.values(result.summary.added).reduce((sum, count) => sum + count, 0);
  setWeakBackupStatus(mode === "merge"
    ? `還原完成，已加入${added}筆紀錄${result.summary.unavailableCount ? `，略過${result.summary.unavailableCount}題` : ""}。`
    : `還原完成，已用備份取代目前紀錄${result.summary.unavailableCount ? `，略過${result.summary.unavailableCount}題` : ""}。`);
}

function renderWeakBackupGuide(platform = "iphone", activeCategory = "wrong") {
  const isIphone = platform === "iphone";
  setScreen(html`
    <section class="panel weak-backup-guide">
      <button class="ghost" id="backToWeak">回錯題與弱點</button>
      <h2>備份與還原教學</h2>
      <p class="muted">備份只包含錯題、不熟與收藏，不會上傳到伺服器。</p>
      <div class="weak-backup-platform-tabs" role="tablist" aria-label="選擇手機系統">
        <button class="${isIphone ? "primary" : "secondary"}" data-weak-backup-platform="iphone">iPhone</button>
        <button class="${isIphone ? "secondary" : "primary"}" data-weak-backup-platform="android">Android</button>
      </div>
      ${isIphone ? html`
        <div class="weak-backup-guide-content">
          <h3>iPhone備份</h3>
          <ol>
            <li>回到錯題與弱點頁，點「備份到手機」。</li>
            <li>在分享面板點「儲存到檔案」。</li>
            <li>選擇iCloud Drive或「我的iPhone」，再點「儲存」。</li>
          </ol>
          <h3>iPhone還原</h3>
          <ol>
            <li>點「從備份還原」。</li>
            <li>在「檔案」中選擇先前保存的JSON備份。</li>
            <li>確認筆數後，選「加入目前紀錄」。</li>
          </ol>
        </div>
      ` : html`
        <div class="weak-backup-guide-content">
          <h3>Android備份</h3>
          <ol>
            <li>回到錯題與弱點頁，點「備份到手機」。</li>
            <li>Chrome會下載JSON備份檔。</li>
            <li>到「檔案」的下載／Downloads確認檔案。</li>
          </ol>
          <h3>Android還原</h3>
          <ol>
            <li>點「從備份還原」。</li>
            <li>從「檔案」或下載／Downloads選擇JSON備份。</li>
            <li>確認筆數後，選「加入目前紀錄」。</li>
          </ol>
        </div>
      `}
    </section>
  `);
  document.querySelector("#backToWeak").addEventListener("click", () => renderWeak(activeCategory));
  document.querySelectorAll("[data-weak-backup-platform]").forEach((button) => {
    button.addEventListener("click", () => renderWeakBackupGuide(button.dataset.weakBackupPlatform, activeCategory));
  });
}

function startWeakPractice(categories) {
  const picked = createWeakPracticeSet(state.weak, categories, { count: 40 });
  if (!picked.length) return;
  state.currentExam = {
    subject: "錯題與弱點",
    yearRoc: "本機紀錄",
    examAttempt: "弱點練習",
    questions: picked
  };
  state.currentQuestionIndex = 0;
  state.mode = "weakExam";
  state.completed = false;
  state.showAnswer = false;
  state.remainingSeconds = null;
  state.deadlineAt = null;
  state.selected = {};
  renderQuestion();
}

function openWeakQuestion(questionId, category) {
  const question = getWeakItems(state.weak, category).find((item) => item.id === questionId);
  if (!question) return;
  state.currentExam = {
    subject: "錯題與弱點",
    yearRoc: "本機紀錄",
    examAttempt: "單題複習",
    questions: [question]
  };
  state.currentQuestionIndex = 0;
  state.mode = "weakReview";
  state.completed = false;
  state.showAnswer = true;
  state.remainingSeconds = null;
  state.deadlineAt = null;
  state.selected = {};
  state.weakReturnCategory = category;
  renderQuestion();
}

function renderMockNotice() {
  setScreen(html`
    <section class="panel">
      <button class="ghost" data-screen="home">回首頁</button>
      <h2>模擬考</h2>
      <p class="muted">單科跨年度抽 40 題，60 分鐘倒數。中途可以暫停回首頁，之後繼續。</p>
      <div class="form-grid mock-form">
        <label>科目
          <select id="mockSubject">
            ${state.index.subjects.map((subject) => `<option value="${subject}">${subject}</option>`).join("")}
          </select>
        </label>
        <label>來源
          <select id="mockSource">
            <option value="all">全部歷年題</option>
            <option value="recent">近五年</option>
          </select>
        </label>
      </div>
      <div class="mock-rules">
        <strong>本次規則</strong>
        <span>40 題選擇題</span>
        <span>60 分鐘</span>
        <span>每題答完不顯示答案，交卷後看結果。</span>
      </div>
      <button class="primary" id="startMock">開始模擬考</button>
    </section>
  `);
  document.querySelector("#startMock").addEventListener("click", (event) => startMockExam(event.currentTarget));
}

async function startMockExam(button) {
  if (!beginButtonLoading(button)) return;
  const subject = document.querySelector("#mockSubject").value;
  const source = document.querySelector("#mockSource").value;
  try {
    const recentYears = selectRecentYears(state.index, 5);
    const exams = state.index.exams.filter((exam) => exam.subject === subject && (source === "all" || recentYears.includes(exam.yearRoc)));
    const loaded = await Promise.all(exams.map(loadExam));
    const picked = createQuestionSetFromExams(loaded, { count: 40 });
    if (!picked.length) {
      renderNoQuestionsWarning("目前沒有符合條件的模擬考題目，請改選全部歷年題、其他科目，或稍後再試。");
      return;
    }
    state.currentExam = {
      examId: `mock:${subject}:${source}:${Date.now()}`,
      subject,
      yearRoc: source === "recent" ? recentYears.join("-") : "全部",
      examAttempt: "模擬考",
      questions: picked
    };
    state.currentQuestionIndex = 0;
    state.mode = "mockExam";
    state.completed = false;
    state.showAnswer = false;
    state.deadlineAt = Date.now() + 60 * 60 * 1000;
    syncMockCountdown();
    state.selected = {};
    persistCurrentProgress();
    renderQuestion();
  } catch (error) {
    renderNoQuestionsWarning(`題目載入失敗：${error.message}`);
  } finally {
    endButtonLoading(button);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayText(value) {
  return normalizeDisplayText(value);
}

document.addEventListener("click", (event) => {
  const lawTier = event.target.closest("[data-law-tier]");
  if (lawTier) {
    renderLawList(lawTier.dataset.lawTier);
    return;
  }

  const target = event.target.closest("[data-screen]");
  if (!target) return;
  const screen = target.dataset.screen;
  trackUsageEvent(screen);
  if (screen === "home") {
    stopEssayJobPolling();
    saveCurrentEssayDraftFromScreen();
    syncMockCountdown();
    persistCurrentProgress();
    renderHome();
  }
  if (screen === "essay") renderEssayPractice();
  if (screen === "install") renderInstallGuide();
  if (screen === "past") renderPastSelector();
  if (screen === "quick") renderQuickPractice();
  if (screen === "mock") renderMockNotice();
  if (screen === "weak") renderWeak();
  if (screen === "law") renderLawCategories();
});

registerServiceWorkerWithAutoReload(navigator, "sw.js").catch(() => {});

trackVisitAnalytics();

loadIndex()
  .then(renderHome)
  .catch((error) => {
    setScreen(`<section class="panel warning"><h2>題庫載入失敗</h2><p>${escapeHtml(error.message)}</p></section>`);
  });
