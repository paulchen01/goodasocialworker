import { ESSAY_GRADING_DISCLAIMER } from "./essay-grading-rubric.mjs?v=20260717-02";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildQuotaResetNote(quota) {
  if (quota?.quotaResetTimeZone === "Asia/Taipei") {
    return `每日限額 ${quota?.totalLimit ?? 500} 次，全站共用；送出後先保留題數，永久失敗會退回，台灣時間午夜重置。`;
  }
  return "每日次數會在配額重置時段自動歸零。";
}

function renderOptions(options, selectedValue) {
  return options.map((option) => {
    const value = option.value ?? option.id ?? option;
    const label = option.label ?? option;
    const selected = String(value) === String(selectedValue) ? "selected" : "";
    return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(label)}</option>`;
  }).join("");
}

export function buildEssayQueueMarkup(viewModel) {
  const job = viewModel.job || {};
  const isFailed = job.status === "failed";
  const isProcessing = job.status === "processing";
  const title = isFailed ? "這次批改沒有完成" : (isProcessing ? "AI正在批改" : "已進入批改隊伍");
  const position = job.status === "queued" && job.queuePosition
    ? `<strong>目前第 ${escapeHtml(job.queuePosition)} 位</strong>`
    : "";
  const retryNote = job.status === "queued" && Number(job.attempts) > 0
    ? `<p class="muted essay-queue-retry">系統已自動等待後重試 ${escapeHtml(job.attempts)} 次，不需要重新送出。</p>`
    : "";
  const failedMessage = isFailed
    ? `<p class="essay-queue-error">${escapeHtml(job.error || "AI批改暫時失敗，本次額度已退回。")}</p>
       <p class="muted">你的作答草稿仍保留在這台裝置，可以稍後再回來送出。</p>`
    : "";

  return `
    <section class="panel essay-queue-panel" aria-live="polite">
      <button class="ghost" data-screen="home">回首頁</button>
      <div class="essay-queue-heading">
        <span class="essay-queue-status">${escapeHtml(viewModel.statusLabel)}</span>
        <h2>${escapeHtml(title)}</h2>
      </div>
      ${isFailed ? failedMessage : `
        <div class="essay-queue-progress">
          ${position}
          <span>${escapeHtml(viewModel.estimateText)}</span>
          <small>本份考卷共 ${escapeHtml(job.submissionCount || 0)} 題</small>
        </div>
        ${retryNote}
        <p class="muted essay-queue-leave-note">可以先離開，後端會繼續處理；回來申論題頁後仍能接續查看。</p>
      `}
      <div class="toolbar essay-queue-actions">
        ${isFailed
          ? '<button class="primary" id="backToEssayPractice" type="button">回申論題練習</button>'
          : '<button class="secondary" id="essayQueueRefresh" type="button">更新進度</button>'}
      </div>
    </section>
  `;
}

export function buildEssayEmptyStateMarkup(message) {
  return `
    <section class="panel warning essay-empty-panel">
      <button class="ghost" data-screen="home">回首頁</button>
      <h2>申論題練習</h2>
      <p>${escapeHtml(message)}</p>
    </section>
  `;
}

export function buildEssaySelectorMarkup(viewModel) {
  const currentQuestions = Array.isArray(viewModel.currentQuestions)
    ? viewModel.currentQuestions
    : (viewModel.currentQuestion ? [viewModel.currentQuestion] : []);
  const questionCount = currentQuestions.length;
  const hasEnoughQuota = viewModel.quota.remainingCount >= questionCount;
  const disabled = !questionCount || !hasEnoughQuota ? "disabled" : "";
  const validation = viewModel.validationMessage ? `<p class="essay-validation">${escapeHtml(viewModel.validationMessage)}</p>` : "";
  const quotaResetNote = buildQuotaResetNote(viewModel.quota);
  const submitLabel = viewModel.quota.remainingCount <= 0
    ? "今日額度已滿"
    : (!hasEnoughQuota ? "剩餘額度不足" : `送出 ${questionCount} 題批改`);

  return `
    <section class="panel essay-panel">
      <button class="ghost" data-screen="home">回首頁</button>
      <h2>申論題練習</h2>
      <p class="muted essay-intro">一次完成同份考卷的全部申論題；每題會使用 1 次全站批改額度。</p>
      <div class="status-strip essay-status-strip">
        <div class="stat"><strong>${escapeHtml(viewModel.quota.mode)}</strong><span>批改模式</span></div>
        <div class="stat"><strong>${escapeHtml(viewModel.quota.remainingCount)}</strong><span>本日剩餘</span></div>
        <div class="stat"><strong>${escapeHtml(viewModel.quota.totalLimit)}</strong><span>每日上限</span></div>
      </div>
      <p class="muted essay-quota-note">${escapeHtml(quotaResetNote)}</p>
      <p class="essay-disclaimer">${escapeHtml(ESSAY_GRADING_DISCLAIMER)}</p>
      <div class="form-grid essay-form-grid">
        <label>考試類型<select id="essayExamType">${renderOptions(viewModel.options.examTypes, viewModel.filters.examType)}</select></label>
        <label>年度<select id="essayYear">${renderOptions(viewModel.options.years, viewModel.filters.yearRoc)}</select></label>
        <label>科目<select id="essaySubject">${renderOptions(viewModel.options.subjects, viewModel.filters.subject)}</select></label>
        <label>考次<select id="essaySession">${renderOptions(viewModel.options.sessions, viewModel.filters.examSession)}</select></label>
      </div>
      ${questionCount ? `
        <p class="essay-batch-summary">本份考卷共 ${escapeHtml(questionCount)} 題申論題，請全部完成後再一次送出。</p>
        <div class="essay-question-list">
          ${currentQuestions.map((question) => `
            <article class="essay-question-card" data-essay-question-id="${escapeHtml(question.id)}">
              <div class="essay-question-meta">第 ${escapeHtml(question.questionNo)} 題｜${escapeHtml(question.points)} 分</div>
              <p class="essay-question-prompt">${escapeHtml(question.prompt)}</p>
              <label class="essay-answer-block">第 ${escapeHtml(question.questionNo)} 題作答
                <textarea class="essay-answer" data-question-id="${escapeHtml(question.id)}" rows="12" placeholder="請直接在這裡練習本題作答。">${escapeHtml(viewModel.draftTexts?.[question.id] ?? viewModel.draftText ?? "")}</textarea>
              </label>
            </article>
          `).join("")}
        </div>
      ` : '<div class="empty">目前沒有符合條件的申論題。</div>'}
      ${validation}
      <div class="toolbar essay-toolbar">
        <button class="secondary" id="essaySaveDraft" type="button">儲存草稿</button>
        <button class="primary" id="essaySubmit" type="button" ${disabled}>${escapeHtml(submitLabel)}</button>
      </div>
    </section>
  `;
}

export function buildEssayResultMarkup(viewModel) {
  const renderList = (items) => items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const renderGrade = ({ question, grade }) => {
    const rubricMarkup = Array.isArray(grade.rubricScores) && grade.rubricScores.length
    ? `
      <article class="essay-result-block">
        <h3>評分項目</h3>
        <div class="essay-rubric-list">
          ${grade.rubricScores.map((item) => `
            <div class="essay-rubric-row">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.score)} / ${escapeHtml(item.maxScore)}</strong>
            </div>
          `).join("")}
        </div>
        <p class="essay-rubric-total">評分項目合計：${escapeHtml(grade.rubricTotal)} / 100</p>
      </article>
    `
    : "";
    return `
      <section class="essay-graded-question">
        <h3>第 ${escapeHtml(question?.questionNo ?? "")} 題</h3>
        <p class="essay-result-question">${escapeHtml(question?.prompt || "")}</p>
        <div class="result-score-card">
          <strong>${escapeHtml(grade.score)} / ${escapeHtml(grade.maxScore)}</strong>
          <span>${escapeHtml(grade.level)}</span>
        </div>
        ${rubricMarkup}
        <article class="essay-result-block">
          <h3>作答優點</h3>
          <ul>${renderList(grade.strengths)}</ul>
        </article>
        <article class="essay-result-block">
          <h3>缺漏重點</h3>
          <ul>${renderList(grade.missingPoints)}</ul>
        </article>
        <article class="essay-result-block">
          <h3>修正建議</h3>
          <ul>${renderList(grade.revisionAdvice)}</ul>
        </article>
        <article class="essay-result-block">
          <h3>建議架構</h3>
          <ul>${renderList(grade.suggestedOutline)}</ul>
        </article>
        ${grade.examReminder ? `<p class="muted essay-result-reminder">${escapeHtml(grade.examReminder)}</p>` : ""}
      </section>
    `;
  };
  const results = Array.isArray(viewModel.results)
    ? viewModel.results
    : [{ question: viewModel.question, grade: viewModel.grade }];
  return `
    <section class="panel essay-result-panel">
      <button class="ghost" id="backToEssayPractice" type="button">回申論題練習</button>
      <h2>申論批改結果</h2>
      <p class="essay-result-quota">本日剩餘批改次數：${escapeHtml(viewModel.quota.remainingCount)} / ${escapeHtml(viewModel.quota.totalLimit)}</p>
      <p class="essay-disclaimer">${escapeHtml(ESSAY_GRADING_DISCLAIMER)}</p>
      ${results.map(renderGrade).join("")}
    </section>
  `;
}
