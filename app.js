const state = {
  bank: [],
  session: [],
  responses: new Map(),
  index: 0,
  view: 'home',
  lastReviewIds: [],
};

const $ = (selector) => document.querySelector(selector);
const views = { home: $('#homeView'), quiz: $('#quizView'), results: $('#resultsView') };
const filterControls = ['#difficultySelect', '#typeSelect', '#topicSelect', '#countSelect'].map($);
let toastTimer;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function shuffle(list) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function normalized(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ko-KR').replace(/[\s,，。.!！?？:：;；]/g, '');
}

function isFormulaQuestion(question) {
  return /수식|공식/.test(question.kind) || question.accepted.some((item) => /^\s*=/.test(item));
}

function isWrittenExplanation(question) {
  return question.kind === '개념 설명' || question.kind === '개념·오류 설명';
}

function matchesAnswer(question, value) {
  if (!value) return false;
  const candidates = [question.answer, ...(question.accepted || [])];
  if (isFormulaQuestion(question)) {
    const normalizeFormula = (text) => String(text).normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s/g, '').replace(/^=/, '');
    const entered = normalizeFormula(value);
    return candidates.some((answer) => normalizeFormula(answer) === entered);
  }
  const entered = normalized(value);
  return candidates.some((answer) => normalized(answer) === entered);
}

function responseFor(question) {
  if (!state.responses.has(question.id)) {
    state.responses.set(question.id, { value: '', checked: false, correct: null, revealed: false, selfGrade: null, notice: '' });
  }
  return state.responses.get(question.id);
}

function filteredQuestions() {
  const difficulty = $('#difficultySelect').value;
  const type = $('#typeSelect').value;
  const topic = $('#topicSelect').value;
  return state.bank.filter((question) => (difficulty === 'all' || question.difficulty === difficulty)
    && (type === 'all' || question.type === type)
    && (topic === 'all' || question.topic === topic));
}

function updateSetupSummary() {
  const filtered = filteredQuestions();
  const countSelect = $('#countSelect');
  const requested = countSelect.value === 'all' ? filtered.length : Number(countSelect.value);
  $('#filteredCount').textContent = String(filtered.length).padStart(3, '0');
  const start = $('#beginQuizBtn');
  start.disabled = !filtered.length;
  start.querySelector('span:first-child').textContent = filtered.length ? `이 조건으로 시작 · ${Math.min(requested, filtered.length)}문항` : '조건에 맞는 문제가 없어요';
  $('#startBtn').disabled = !state.bank.length;
}

function populateTopics() {
  const topicSelect = $('#topicSelect');
  const topics = [...new Set(state.bank.map((question) => question.topic))].sort((a, b) => a.localeCompare(b, 'ko'));
  topicSelect.innerHTML = '<option value="all">모든 영역</option>' + topics.map((topic) => `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`).join('');
  updateSetupSummary();
}

function showView(name) {
  state.view = name;
  Object.entries(views).forEach(([key, element]) => { element.hidden = key !== name; });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function startSession(onlyIds = null) {
  const candidates = onlyIds
    ? state.bank.filter((question) => onlyIds.includes(question.id))
    : filteredQuestions();
  if (!candidates.length) {
    showToast('선택한 조건에 맞는 문제가 없어요. 다른 조건을 골라 주세요.');
    return;
  }
  const amount = onlyIds ? candidates.length : ($('#countSelect').value === 'all' ? candidates.length : Math.min(Number($('#countSelect').value), candidates.length));
  const picked = shuffle(candidates).slice(0, amount);
  state.session = picked.map((question) => ({ ...question, options: question.options ? shuffle(question.options) : undefined }));
  state.responses = new Map();
  state.index = 0;
  state.lastReviewIds = [];
  $('#roundLabel').textContent = `${amount}문항 · 매 회차 무작위`;
  showView('quiz');
  renderQuestion();
}

function renderPrompt(prompt) {
  return prompt.split('\n').map((line) => {
    const safe = escapeHtml(line);
    return /^\s*=/.test(line) ? `<div class="prompt-code">${safe}</div>` : `<div>${safe || '&nbsp;'}</div>`;
  }).join('');
}

function renderQuestion() {
  const question = state.session[state.index];
  if (!question) return;
  const response = responseFor(question);
  const indexText = String(state.index + 1).padStart(2, '0');
  const total = state.session.length;
  $('#progressQuestion').textContent = `${indexText} / ${String(total).padStart(2, '0')}`;
  const filled = [...state.responses.values()].filter((item) => String(item.value).trim()).length;
  $('#progressAnswered').textContent = `답변 ${filled}개`;
  $('#progressFill').style.width = `${((state.index + 1) / total) * 100}%`;
  $('#prevBtn').disabled = state.index === 0;
  $('#nextBtn').innerHTML = state.index === total - 1 ? '결과 보기 <span class="button-arrow" aria-hidden="true">↗</span>' : '다음 문제 <span class="button-arrow" aria-hidden="true">→</span>';

  const questionLabel = question.type === '객관식' ? 'MULTIPLE CHOICE' : 'SHORT ANSWER';
  const meta = `<div class="question-meta"><span class="question-id">${escapeHtml(question.id)}</span><span class="difficulty-prefix">df</span><span class="level-chip level-${question.difficulty === '상' ? 'high' : question.difficulty === '중' ? 'mid' : 'low'}">${escapeHtml(question.difficulty)}</span><span class="meta-divider"></span><span class="question-type">${questionLabel}</span><span class="topic-chip">${escapeHtml(question.topic)}</span></div>`;
  let answerBody = '';
  if (question.type === '객관식') {
    answerBody = `<div class="options-list">${question.options.map((option, i) => {
      const isSelected = response.value === option;
      const lockedClass = response.checked ? (option === question.answer ? ' option-correct' : isSelected ? ' option-wrong' : ' option-locked') : '';
      return `<label class="option-card${isSelected ? ' option-selected' : ''}${lockedClass}"><input type="radio" name="answer" value="${escapeHtml(option)}" ${isSelected ? 'checked' : ''} ${response.checked ? 'disabled' : ''}><span class="option-letter">${String.fromCharCode(65 + i)}</span><span class="option-text">${escapeHtml(option)}</span><span class="option-check" aria-hidden="true">${response.checked && option === question.answer ? '✓' : ''}</span></label>`;
    }).join('')}</div>`;
  } else {
    const placeholder = isWrittenExplanation(question) ? '핵심 개념이나 이유를 직접 적어 보세요.' : question.kind.includes('수식') ? '예: =SUM(A1:A5)' : '답을 입력하세요.';
    answerBody = `<label class="answer-label" for="shortAnswer">내 답안</label><textarea id="shortAnswer" class="answer-input" rows="3" placeholder="${placeholder}" ${response.checked ? 'disabled' : ''}>${escapeHtml(response.value)}</textarea><div class="input-hint">${isFormulaQuestion(question) ? '수식은 대소문자와 공백 차이를 제외하고 확인합니다.' : isWrittenExplanation(question) ? '서술형은 예시 답안을 확인한 뒤 스스로 점검할 수 있어요.' : '정답 확인을 누르면 바로 채점됩니다.'}</div>`;
  }

  let feedback = '';
  if (response.notice) {
    feedback = `<div class="feedback feedback-note" role="status">${escapeHtml(response.notice)}</div>`;
  } else if (response.checked && isWrittenExplanation(question)) {
    const gradePanel = response.selfGrade === null
      ? `<div class="self-grade"><span>내 답안이 예시 답안의 핵심을 담았나요?</span><div><button class="self-grade-btn" data-grade="yes" type="button">맞았어요</button><button class="self-grade-btn" data-grade="no" type="button">복습할게요</button></div></div>`
      : `<div class="self-grade-result ${response.selfGrade ? 'grade-good' : 'grade-review'}">${response.selfGrade ? '자가 채점: 이해했어요' : '자가 채점: 복습 표시했어요'} <button id="changeSelfGrade" class="change-grade" type="button">바꾸기</button></div>`;
    feedback = `<div class="feedback feedback-open"><div class="feedback-title"><span class="feedback-icon">i</span> 예시 답안</div><p class="answer-example">${escapeHtml(question.answer)}</p><p class="explanation-text">${escapeHtml(question.explanation)}</p>${gradePanel}</div>`;
  } else if (response.checked) {
    feedback = `<div class="feedback ${response.correct ? 'feedback-correct' : 'feedback-wrong'}" role="status"><div class="feedback-title"><span class="feedback-icon">${response.correct ? '✓' : '×'}</span>${response.correct ? '정답이에요' : '다시 확인해 보세요'}</div>${!response.correct ? `<p class="answer-example">정답 <strong>${escapeHtml(question.answer)}</strong></p>` : ''}<p class="explanation-text">${escapeHtml(question.explanation)}</p></div>`;
  }

  $('#questionStage').innerHTML = `<article class="question-card">${meta}<div class="question-card-rule"></div><p class="question-kind">${escapeHtml(question.kind)}</p><h1 id="questionTitle" class="question-title">${renderPrompt(question.prompt)}</h1><div class="answer-area">${answerBody}</div>${feedback}</article><div class="question-footer"><span class="mono-label">ITEM ${escapeHtml(question.id.toUpperCase())}</span><span>${escapeHtml(question.topic)} <i aria-hidden="true">/</i> ${question.type}</span></div>`;

  $('#questionStage').querySelectorAll('input[name="answer"]').forEach((radio) => radio.addEventListener('change', (event) => {
    const current = responseFor(question);
    current.value = event.target.value;
    current.checked = false;
    current.correct = null;
    current.notice = '';
    renderQuestion();
  }));
  const textArea = $('#shortAnswer');
  if (textArea) textArea.addEventListener('input', (event) => {
    const current = responseFor(question);
    current.value = event.target.value;
    current.checked = false;
    current.selfGrade = null;
    current.notice = '';
    updateAnswerCount();
  });
  $('#questionStage').querySelectorAll('[data-grade]').forEach((button) => button.addEventListener('click', () => {
    response.selfGrade = button.dataset.grade === 'yes';
    response.checked = true;
    response.notice = '';
    renderQuestion();
  }));
  const changeGrade = $('#changeSelfGrade');
  if (changeGrade) changeGrade.addEventListener('click', () => { response.selfGrade = null; renderQuestion(); });
  $('#checkBtn').textContent = response.checked ? (isWrittenExplanation(question) && response.selfGrade === null ? '자가 채점 대기' : '확인 완료') : '답 확인';
  $('#checkBtn').disabled = response.checked;
}

function updateAnswerCount() {
  const filled = [...state.responses.values()].filter((item) => String(item.value).trim()).length;
  $('#progressAnswered').textContent = `답변 ${filled}개`;
}

function checkCurrentAnswer() {
  const question = state.session[state.index];
  const response = responseFor(question);
  if (response.checked) return;
  if (!String(response.value).trim()) {
    response.notice = question.type === '객관식' ? '선택지 하나를 고른 뒤 확인해 주세요.' : '답을 입력한 뒤 확인해 주세요.';
    renderQuestion();
    return;
  }
  response.notice = '';
  response.revealed = true;
  if (isWrittenExplanation(question)) {
    response.checked = true;
    response.selfGrade = null;
  } else {
    response.correct = question.type === '객관식' ? response.value === question.answer : matchesAnswer(question, response.value);
    response.checked = true;
  }
  renderQuestion();
}

function finishSession() {
  if (!state.session.length) return;
  const rows = state.session.map((question) => ({ question, response: responseFor(question) }));
  let autoCorrect = 0;
  let autoGraded = 0;
  let selfCorrect = 0;
  let selfGraded = 0;
  let unanswered = 0;
  const review = [];
  rows.forEach(({ question, response }) => {
    const hasValue = String(response.value).trim().length > 0;
    if (question.type === '객관식') {
      if (!hasValue) { unanswered += 1; review.push({ question, response, status: '미응답' }); return; }
      autoGraded += 1;
      const correct = response.value === question.answer;
      if (correct) autoCorrect += 1;
      else review.push({ question, response, status: '오답' });
      return;
    }
    if (isWrittenExplanation(question)) {
      if (!hasValue) { unanswered += 1; review.push({ question, response, status: '미응답' }); return; }
      if (response.selfGrade === null) { review.push({ question, response, status: '자가 채점 필요' }); return; }
      selfGraded += 1;
      if (response.selfGrade) selfCorrect += 1;
      else review.push({ question, response, status: '복습 표시' });
      return;
    }
    if (!hasValue) { unanswered += 1; review.push({ question, response, status: '미응답' }); return; }
    autoGraded += 1;
    const correct = matchesAnswer(question, response.value);
    if (correct) autoCorrect += 1;
    else review.push({ question, response, status: '오답' });
  });
  state.lastReviewIds = review.map((item) => item.question.id);
  const totalJudged = autoGraded + selfGraded;
  const totalCorrect = autoCorrect + selfCorrect;
  const score = totalJudged ? Math.round((totalCorrect / totalJudged) * 100) : 0;
  $('#resultsSubtitle').textContent = `${state.session.length}문항을 풀었습니다. 서술형은 직접 예시 답안과 비교해 표시한 결과를 함께 반영합니다.`;
  $('#scoreCards').innerHTML = `<div class="score-card score-main"><span>채점 결과</span><strong>${score}<small>%</small></strong><p>${totalCorrect} / ${totalJudged} 채점 완료</p></div><div class="score-card"><span>자동 채점</span><strong>${autoCorrect}<small> / ${autoGraded}</small></strong><p>객관식 · 짧은 답</p></div><div class="score-card"><span>서술형 자가 채점</span><strong>${selfCorrect}<small> / ${selfGraded}</small></strong><p>${unanswered}문항 미응답</p></div>`;
  const reviewHtml = review.length
    ? `<div class="review-heading"><div><p class="eyebrow"><span class="eyebrow-line"></span> TAKE ANOTHER LOOK</p><h2>다시 볼 문제 <span>${review.length}</span></h2></div><span class="section-note">정답과 해설을 짧게 복기해 보세요.</span></div><div class="review-list">${review.map(({ question, response, status }) => `<article class="review-item"><div class="review-item-head"><span class="question-id">${escapeHtml(question.id)}</span><span class="difficulty-prefix">df</span><span class="level-chip level-${question.difficulty === '상' ? 'high' : question.difficulty === '중' ? 'mid' : 'low'}">${escapeHtml(question.difficulty)}</span><span class="review-status">${escapeHtml(status)}</span><span class="review-topic">${escapeHtml(question.topic)}</span></div><h3>${renderPrompt(question.prompt)}</h3><div class="review-answer"><span>예시 답</span><p>${escapeHtml(question.answer)}</p></div><p class="explanation-text">${escapeHtml(question.explanation)}</p></article>`).join('')}</div>`
    : `<div class="all-clear"><span class="all-clear-mark">✓</span><div><strong>복습 표시된 문제 없이 마쳤어요.</strong><p>다른 난이도나 영역으로 한 회차 더 연습해 볼까요?</p></div></div>`;
  $('#reviewSection').innerHTML = reviewHtml;
  $('#retryMissedBtn').disabled = state.lastReviewIds.length === 0;
  showView('results');
}

function showToast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('toast-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('toast-visible'), 2400);
}

function goHome() {
  showView('home');
  updateSetupSummary();
}

$('#startBtn').addEventListener('click', () => { $('#setupTitle').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#difficultySelect').focus({ preventScroll: true }); });
$('#beginQuizBtn').addEventListener('click', () => startSession());
$('#topHomeBtn').addEventListener('click', goHome);
$('#backToSetupBtn').addEventListener('click', goHome);
$('#resultsHomeBtn').addEventListener('click', goHome);
$('#newRoundBtn').addEventListener('click', goHome);
$('#prevBtn').addEventListener('click', () => { if (state.index > 0) { state.index -= 1; renderQuestion(); } });
$('#nextBtn').addEventListener('click', () => { if (state.index < state.session.length - 1) { state.index += 1; renderQuestion(); } else finishSession(); });
$('#checkBtn').addEventListener('click', checkCurrentAnswer);
$('#finishTopBtn').addEventListener('click', finishSession);
$('#retryMissedBtn').addEventListener('click', () => startSession(state.lastReviewIds));
filterControls.forEach((control) => control.addEventListener('change', updateSetupSummary));

document.addEventListener('keydown', (event) => {
  if (state.view !== 'quiz' || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === 'ArrowLeft' && state.index > 0) { state.index -= 1; renderQuestion(); }
  if (event.key === 'ArrowRight' && state.index < state.session.length - 1) { state.index += 1; renderQuestion(); }
});

async function loadBank() {
  try {
    const response = await fetch('./questions.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('문제 은행을 불러오지 못했습니다.');
    state.bank = await response.json();
    if (state.bank.length !== 300) throw new Error(`문제 수 확인 필요 (${state.bank.length})`);
    populateTopics();
    $('#loadStatus').textContent = '300문항 준비 완료';
    $('#loadStatus').classList.add('load-success');
    updateSetupSummary();
  } catch (error) {
    $('#loadStatus').textContent = '문제 은행을 불러오지 못했어요.';
    $('#loadStatus').classList.add('load-error');
    showToast(error.message || '페이지를 새로고침해 주세요.');
  }
}

loadBank();
