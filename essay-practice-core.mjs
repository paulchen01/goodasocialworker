function isExcludedEssayQuestion(question) {
  return question.examType === "social_worker" && /^國文/u.test(String(question.subject || ""));
}

function isAvailableEssayQuestion(question) {
  return question.reviewStatus === "reviewed" && !isExcludedEssayQuestion(question);
}

export function getEssayFilterOptions(questions) {
  const examTypeMap = new Map();
  const yearsByExamType = {};
  const subjectsByExamTypeYear = {};
  const sessionsByExamTypeYearSubject = {};

  for (const question of questions) {
    if (!isAvailableEssayQuestion(question)) continue;

    if (!examTypeMap.has(question.examType)) {
      examTypeMap.set(question.examType, question.examTypeLabel);
    }

    const yearKey = question.examType;
    const subjectKey = `${question.examType}::${question.yearRoc}`;
    const sessionKey = `${question.examType}::${question.yearRoc}::${question.subject}`;

    yearsByExamType[yearKey] = [...new Set([...(yearsByExamType[yearKey] || []), Number(question.yearRoc)])].sort((a, b) => b - a);
    subjectsByExamTypeYear[subjectKey] = [...new Set([...(subjectsByExamTypeYear[subjectKey] || []), question.subject])];
    sessionsByExamTypeYearSubject[sessionKey] = [...new Set([...(sessionsByExamTypeYearSubject[sessionKey] || []), question.examSession])];
  }

  return {
    examTypes: [...examTypeMap.entries()].map(([value, label]) => ({ value, label })),
    yearsByExamType,
    subjectsByExamTypeYear,
    sessionsByExamTypeYearSubject
  };
}

export function filterEssayQuestions(questions, filters = {}) {
  return questions.filter((question) => {
    if (!isAvailableEssayQuestion(question)) return false;
    if (filters.examType && question.examType !== filters.examType) return false;
    if (filters.subject && question.subject !== filters.subject) return false;
    if (filters.yearRoc && Number(question.yearRoc) !== Number(filters.yearRoc)) return false;
    if (filters.examSession && question.examSession !== filters.examSession) return false;
    return true;
  });
}

export function getEssayQuestionById(questions, questionId) {
  return questions.find((question) => question.id === questionId && isAvailableEssayQuestion(question)) || null;
}

export function validateEssayAnswer(answerText, limits = {}) {
  const minChars = Number(limits.minChars || 80);
  const maxChars = Number(limits.maxChars || 5000);
  const trimmed = String(answerText || "").trim();
  const trimmedLength = trimmed.length;

  if (!trimmedLength) return { ok: false, reason: "empty", trimmedLength };
  if (trimmedLength < minChars) return { ok: false, reason: "tooShort", trimmedLength };
  if (trimmedLength > maxChars) return { ok: false, reason: "tooLong", trimmedLength };
  return { ok: true, reason: null, trimmedLength };
}
