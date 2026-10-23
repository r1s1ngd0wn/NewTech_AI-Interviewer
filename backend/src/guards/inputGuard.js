const INJECTION = /ignore\s+(all\s+|your\s+|the\s+)?(previous|prior|system)\s+instructions|reveal\s+(your\s+|the\s+)?(system prompt|secret|api key)|act as\s+(a\s+|an\s+)?(different|unrestricted|new)\s+assistant|bỏ qua (mọi |các )?(hướng dẫn|chỉ thị)|tiết lộ (system prompt|api key|khóa api)/i;
const OUT_OF_SCOPE = /\b(weather forecast|stock price|crypto price|write (me )?a recipe|political news|tomorrow's weather|do my homework|solve my assignment)\b|(?:thời tiết|giá cổ phiếu|công thức nấu ăn|tin chính trị|làm bài tập hộ)/i;

function classifyInput(message) {
  if (INJECTION.test(message)) return "injection";
  if (OUT_OF_SCOPE.test(message)) return "out-of-scope";
  return "ok";
}

function sanitizeSourceText(text) {
  return String(text).split(/\r?\n/).filter((line) => !INJECTION.test(line)).join("\n");
}

module.exports = { classifyInput, sanitizeSourceText };
