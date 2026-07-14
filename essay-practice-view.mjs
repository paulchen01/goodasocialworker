function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildQuotaResetNote(quota) {
  if (quota?.quotaResetTimeZone === "America/Los_Angeles") {
    return "每日次數依 Gemini 官方配額，於美西時間午夜重置。";
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
  const currentQuestion = viewModel.currentQuestion;
  const disabled = !currentQuestion || viewModel.quota.remainingCount <= 0 ? "disabled" : "";
  const validation = viewModel.validationMessage ? `<p class="essay-validation">${escapeHtml(viewModel.validationMessage)}</p>` : "";
  const quotaResetNote = buildQuotaResetNote(viewModel.quota);

  return `
    <section class="panel essay-panel">
      <button class="ghost" data-screen="home">回首頁</button>
      <h2>申論題練習</h2>
      <p class="muted essay-intro">申論題獨立練習，不和選擇題模式混用。</p>
      <div class="status-strip essay-status-strip">
        <div class="stat"><strong>${escapeHtml(viewModel.quota.mode)}</strong><span>批改模式</span></div>
        <div class="stat"><strong>${escapeHtml(viewModel.quota.remainingCount)}</strong><span>本日剩餘</span></div>
        <div class="stat"><strong>${escapeHtml(viewModel.quota.totalLimit)}</strong><span>每日上限</span></div>
      </div>
      <p class="muted essay-quota-note">${escapeHtml(quotaResetNote)}</p>
      <div class="form-grid essay-form-grid">
        <label>考試類型<select id="essayExamType">${renderOptions(viewModel.options.examTypes, viewModel.filters.examType)}</select></label>
        <label>年度<select id="essayYear">${renderOptions(viewModel.options.years, viewModel.filters.yearRoc)}</select></label>
        <label>科目<select id="essaySubject">${renderOptions(viewModel.options.subjects, viewModel.filters.subject)}</select></label>
        <label>考次<select id="essaySession">${renderOptions(viewModel.options.sessions, viewModel.filters.examSession)}</select></label>
        <label>題號<select id="essayQuestionId">${renderOptions(viewModel.options.questionChoices, viewModel.filters.questionId)}</select></label>
      </div>
      ${currentQuestion ? `
        <article class="essay-question-card">
          <div class="essay-question-meta">第 ${escapeHtml(currentQuestion.questionNo)} 題｜${escapeHtml(currentQuestion.points)} 分</div>
          <p class="essay-question-prompt">${escapeHtml(currentQuestion.prompt)}</p>
        </article>
      ` : '<div class="empty">目前沒有符合條件的申論題。</div>'}
      <label class="essay-answer-block">你的作答
        <textarea id="essayAnswer" rows="12" placeholder="請直接在這裡練習申論題作答。">${escapeHtml(viewModel.draftText)}</textarea>
      </label>
      ${validation}
      <div class="toolbar essay-toolbar">
        <button class="secondary" id="essaySaveDraft" type="button">儲存草稿</button>
        <button class="primary" id="essaySubmit" type="button" ${disabled}>送出批改</button>
      </div>
    </section>
  `;
}

export function buildEssayResultMarkup(viewModel) {
  const grade = viewModel.grade;
  const renderList = (items) => items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `
    <section class="panel essay-result-panel">
      <button class="ghost" id="backToEssayPractice" type="button">回申論題練習</button>
      <h2>申論批改結果</h2>
      <div class="result-score-card">
        <strong>${escapeHtml(grade.score)} / ${escapeHtml(grade.maxScore)}</strong>
        <span>${escapeHtml(grade.level)}</span>
        <small>本日剩餘批改次數：${escapeHtml(viewModel.quota.remainingCount)} / ${escapeHtml(viewModel.quota.totalLimit)}</small>
      </div>
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
      <p class="muted essay-result-reminder">${escapeHtml(grade.examReminder)}</p>
    </section>
  `;
}
