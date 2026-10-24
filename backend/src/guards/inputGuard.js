const INJECTION = /ignore\s+(all\s+|your\s+|the\s+)?(previous|prior|system|above)\s+(instructions|rules|prompts?)|(?:disregard|override|forget)\s+(?:all\s+|your\s+|the\s+)?(?:previous|prior|system|above)\s+(?:instructions|rules|prompts?)|(?:reveal|show|print|dump|leak)\s+(?:me\s+)?(?:your\s+|the\s+)?(?:hidden\s+|internal\s+)?(?:system prompt|developer prompt|secret|api key|instructions)|(?:act as|pretend to be|you are now)\s+(?:a\s+|an\s+)?(?:different|unrestricted|new|unfiltered)\s+(?:assistant|model)|bỏ qua (?:mọi |các )?(?:hướng dẫn|chỉ thị|quy tắc)|tiết lộ (?:system prompt|api key|khóa api|hướng dẫn ẩn)/i;
const OUT_OF_SCOPE = /\b(?:weather|forecast|stock price|crypto price|recipe|political news|sports score|lottery|horoscope|do my homework|solve my assignment)\b|(?:thời tiết|giá cổ phiếu|giá tiền ảo|công thức nấu ăn|tin chính trị|tỉ số bóng đá|xổ số|tử vi|làm bài tập hộ)/i;

function classifyInput(message) {
  if (INJECTION.test(message)) return "injection";
  if (OUT_OF_SCOPE.test(message)) return "out-of-scope";
  return "ok";
}

function sanitizeSourceText(text) {
  return String(text).split(/\r?\n/).filter((line) => !INJECTION.test(line)).join("\n");
}

module.exports = { classifyInput, sanitizeSourceText };
