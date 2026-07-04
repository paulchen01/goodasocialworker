import {
  buildQuestionMetaParts,
  clearProgress,
  createQuestionSetFromExams,
  createWeakPracticeSet,
  enrichQuestionsWithExamContext,
  formatResultScoreLine,
  formatQuestionSource,
  formatRemainingTime,
  getCountdownRemainingSeconds,
  getOptionStateClasses,
  getQuestionCompletionTarget,
  getResultEncouragement,
  getWeakItems,
  loadProgress,
  normalizeDisplayText,
  paginateItems,
  saveProgress,
  shouldPersistProgress,
  scoreExam,
  selectRecentYears,
  shouldRevealAnswerAfterSelection
} from "./app-core.mjs?v=20260704-11";

const app = document.querySelector("#app");
const DATA_VERSION = "20260704-152";

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
  weakPage: { wrong: 1, unfamiliar: 1, favorite: 1 }
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

async function loadExam(exam) {
  const response = await fetch(exam.file);
  const payload = await response.json();
  payload.questions = enrichQuestionsWithExamContext(payload);
  return payload;
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
  app.innerHTML = markup;
  window.scrollTo(0, 0);
}

function examsBySubject() {
  return state.index.subjects.map((subject) => ({
    subject,
    exams: state.index.exams.filter((exam) => exam.subject === subject)
  }));
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
        <button class="mode-card" data-screen="weak">
          <strong>錯題與弱點</strong>
          <span>整理答錯、不熟悉和收藏的題目，可以再重複練習，加深印象。</span>
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
        <span>每天練習更方便</span>
      </button>
    </div>
  `);
  wireHome();
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
      <h2>把 <span class="app-name-highlight">考上社工師</span> 放到 iPhone 桌面</h2>
      <p class="muted">請用 Safari 開啟，不要用 LINE、Facebook 或其他 APP 內建瀏覽器。</p>
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
  const sourceNote = state.mode === "quick" ? "" : question.sourceLabel;
  const isFirstQuestion = state.currentQuestionIndex === 0;
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
      ${question.previousQuestionContext ? renderPreviousQuestionContext(question.previousQuestionContext) : ""}
      <p class="stem">${escapeHtml(displayText(question.stem))}</p>
      <div class="options">
        ${question.options.map((option) => {
          const classes = getOptionStateClasses(option.key, selected, question.answer, showAnswer);
          return `<button class="${classes.join(" ")}" data-answer="${option.key}"><strong>${option.key}</strong><span>${escapeHtml(displayText(option.text))}</span></button>`;
        }).join("")}
      </div>
      ${showAnswer ? `<div class="answer-box">官方答案：<strong>${question.answer}</strong></div>` : ""}
      <div class="toolbar">
        <button class="ghost" id="markUnfamiliar">不熟，之後再看</button>
        <button class="secondary" id="prevQuestion" ${isFirstQuestion ? "disabled" : ""}>上一題</button>
        <button class="primary" id="nextQuestion">${state.currentQuestionIndex === exam.questions.length - 1 ? "完成" : "下一題"}</button>
      </div>
    </section>
  `);
  wireQuestion(question);
  startTimer();
}

function renderPreviousQuestionContext(previousQuestion) {
  return html`
    <aside class="previous-context">
      <div class="previous-context-title">
        <strong>上題內容</strong>
        <span>第 ${previousQuestion.number} 題</span>
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
      if (shouldRevealAnswerAfterSelection(state.mode) && button.dataset.answer !== question.answer) {
        state.weak.wrong[question.id] = question;
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
  const target = event.target.closest("[data-screen]");
  if (!target) return;
  const screen = target.dataset.screen;
  if (screen === "home") {
    syncMockCountdown();
    persistCurrentProgress();
    renderHome();
  }
  if (screen === "install") renderInstallGuide();
  if (screen === "past") renderPastSelector();
  if (screen === "quick") renderQuickPractice();
  if (screen === "mock") renderMockNotice();
  if (screen === "weak") renderWeak();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

loadIndex()
  .then(renderHome)
  .catch((error) => {
    setScreen(`<section class="panel warning"><h2>題庫載入失敗</h2><p>${escapeHtml(error.message)}</p></section>`);
  });
