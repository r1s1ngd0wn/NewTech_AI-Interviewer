const { knowledgeIntent } = require('../services/ragService');

const has = (text, pattern) => pattern.test(text);

function classifyCoachRequest(message) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();

  // Document intent takes precedence over incidental references to app data.
  if (knowledgeIntent(text) === 'comparison') return { mode: 'comparison', tools: ['search_knowledge'] };
  if (has(lower, /\b(cv|resume|curriculum vitae|job description|\bjd\b|uploaded document|my document|question bank|sample question|reference answer|my experience|my skills)\b|hồ sơ|cv của tôi|tài liệu|mô tả công việc|câu hỏi mẫu|đáp án mẫu|kinh nghiệm của tôi|kỹ năng của tôi/i)) {
    const requiredSourceKind = has(lower, /\b(cv|resume|curriculum vitae)\b|cv của tôi|hồ sơ/i) ? 'CV'
      : has(lower, /\b(job description|\bjd\b)\b|mô tả công việc/i) ? 'JD'
        : has(lower, /\b(question bank|sample question|reference answer)\b|câu hỏi mẫu|đáp án mẫu/i) ? 'QUESTION' : null;
    return { mode: 'knowledge', tools: ['search_knowledge'], requiredSourceKind };
  }
  if (has(lower, /^(hi|hello|hey|thanks|thank you|help|xin chào|chào|cảm ơn)[.!? ]*$/i)) {
    return { mode: 'greeting', tools: [] };
  }
  if (has(lower, /\b(create|make|build|propose|update|change|reschedule|move)\b.{0,50}\b(plan|schedule|practice|item|session)\b|\b(plan|schedule)\b.{0,50}\b(create|make|update|change|move|practice)\b|tạo.{0,40}(kế hoạch|lịch)|đổi.{0,40}(kế hoạch|buổi)|dời.{0,40}(buổi|lịch)/i)) {
    return { mode: 'plan-write', tools: ['create_practice_plan', 'update_practice_plan_item'] };
  }
  if (has(lower, /\b(feedback|critique|score|rating|my answer|how did i answer|transcript|answer to (the )?first question)\b|nhận xét|điểm số|đánh giá buổi|câu trả lời của tôi/i)) return { mode: 'app-data', tools: ['get_session_feedback'] };
  if (has(lower, /\b(weak|weakest|improve|improvement|progress|performance|missing points)\b|điểm yếu|cần cải thiện|tiến độ/i)) return { mode: 'app-data', tools: ['list_weak_areas'] };
  if (has(lower, /\b(sessions?|practice history|my practices|past practice)\b|buổi luyện|lịch sử luyện|các buổi/i)) return { mode: 'app-data', tools: ['list_sessions'] };
  if (has(lower, /\b(scenario|scenarios|role|job)\b|tình huống|ngành nghề|vị trí/i)) return { mode: 'app-data', tools: ['search_scenarios'] };
  return { mode: 'knowledge', tools: ['search_knowledge'] };
}

function assessAnswerEvidence({ request, completedTools = [], sources = [], hasAction = false }) {
  if (request.mode === 'greeting') return { allowed: true, reason: 'fixed-greeting' };
  if (request.mode === 'plan-write') return { allowed: hasAction, reason: hasAction ? 'validated-action' : 'missing-action' };
  const successful = completedTools.filter(tool => tool?.status === 'done');
  const expected = successful.filter(tool => request.tools.includes(tool.name));
  if (!expected.length) return { allowed: false, reason: 'required-tool-not-completed' };

  if (request.mode === 'knowledge' || request.mode === 'comparison') {
    const search = expected.find(tool => tool.name === 'search_knowledge' && tool.result?.sources?.length);
    if (!search) return { allowed: false, reason: 'knowledge-sources-empty' };
    if (request.mode === 'comparison') {
      const labels = sources.map(source => source.label || '');
      if (!labels.some(label => /^cv(?:\s*:|$)/i.test(label)) || !labels.some(label => /^jd(?:\s*:|$)/i.test(label))) {
        return { allowed: false, reason: 'comparison-needs-cv-and-jd' };
      }
    } else if (!sources.length) return { allowed: false, reason: 'no-valid-citations' };
    else if (request.requiredSourceKind === 'QUESTION' && !sources.some(source => source.sourceType === 'question' || /^Question bank(?:\s*:|$)|^Question\s+\d+\b/i.test(source.label || ''))) {
      return { allowed: false, reason: 'required-source-kind-missing' };
    } else if (request.requiredSourceKind && request.requiredSourceKind !== 'QUESTION' && !sources.some(source => new RegExp(`^${request.requiredSourceKind}(?:\\s*:|$)`, 'i').test(source.label || ''))) {
      return { allowed: false, reason: 'required-source-kind-missing' };
    }
  }
  const data = expected.some(tool => {
    if (tool.name === 'list_weak_areas') return Boolean(tool.result?.weakestCriterion || tool.result?.missingPoints?.length);
    if (tool.name === 'get_session_feedback') return Boolean(tool.result?.feedback || tool.result?.critiques?.length);
    return Array.isArray(tool.result) ? tool.result.length > 0 :
      tool.result && typeof tool.result === 'object' ? Object.keys(tool.result).length > 0 : Boolean(tool.result);
  });
  if (data) return { allowed: true, reason: 'matching-tool-and-evidence' };
  return request.mode === 'app-data'
    ? { allowed: true, reason: 'empty-tool-result' }
    : { allowed: false, reason: 'empty-tool-result' };
}

module.exports = { classifyCoachRequest, assessAnswerEvidence };
