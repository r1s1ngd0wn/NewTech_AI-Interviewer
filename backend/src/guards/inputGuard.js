// First-line checks on a chat message. These are known phrasings only: a pattern list cannot
// recognise every attack or every off-topic request. The real protection is that answers come only
// from retrieved sources, so an off-topic or hostile message that matches nothing gets "I couldn't
// find an answer" and the model never sees it as an instruction. Keep these patterns specific: a
// bare word such as "weather" or "recipe" also appears in real CV projects ("weather app",
// "recipe-sharing app"), and refusing those is worse than letting a stray question through.
//
// Two lists: DOCUMENT_INJECTION is what sanitizeSourceText() removes from uploaded CVs and other
// sources, so it only holds phrases a real CV would never contain. CHAT_INJECTION adds patterns
// that are fine inside a document ("Developer: Java") but suspicious as a chat message.

const OVERRIDE_WORDS = "(?:previous|prior|earlier|preceding|above|system)";
const DOCUMENT_INJECTION = [
  `(?:ignore|disregard|forget|override)\\s+(?:all\\s+|any\\s+|your\\s+|the\\s+)?${OVERRIDE_WORDS}\\s+(?:instructions?|rules?|prompts?|messages?|directions?|context)`,
  "(?:ignore|disregard|forget|override)\\s+(?:all\\s+|any\\s+|your\\s+|the\\s+)?(?:instructions?|rules?|prompts?)\\s+(?:above|before|earlier)",
  "(?:ignore|disregard|forget)\\s+everything\\s+(?:above|before|earlier|else)",
  // asking for the hidden prompt
  "(?:reveal|show|print|dump|leak|output|repeat|recite|translate|display|tell me|what (?:is|are|was|were))\\b[^.?!\\n]{0,40}?\\b(?:system|initial|original|hidden|developer|internal)\\s+prompt\\b",
  "(?:reveal|show|print|dump|leak|output|repeat|recite|translate|display|tell me)\\b[^.?!\\n]{0,40}?\\b(?:system|developer|hidden)\\s+(?:message|instructions?)\\b",
  "\\b(?:instructions|rules|guidelines)\\s+you\\s+(?:were|are|have been)\\s+given\\b",
  "(?:reveal|show|print|dump|leak)\\s+(?:me\\s+)?(?:your\\s+|the\\s+)?(?:secret|api key)",
  "(?:repeat|print|output|copy)\\s+(?:everything|all|the text|the words|the content)\\s+(?:above|before)",
  "starting with\\s+[\"'“]?you are",
  // persona / jailbreak setups
  "(?:act as|pretend to be|you are now)\\s+(?:a\\s+|an\\s+)?(?:different|unrestricted|new|unfiltered|jailbroken)\\s+(?:assistant|model|ai)",
  "you are now\\s+dan\\b",
  // Vietnamese
  "bỏ qua (?:mọi |các )?(?:hướng dẫn|chỉ thị|quy tắc)",
  "tiết lộ (?:system prompt|api key|khóa api|hướng dẫn ẩn)",
];
const CHAT_INJECTION = [
  ...DOCUMENT_INJECTION,
  "(?:from now on|starting now)[^.?!\\n]{0,40}\\b(?:no restrictions?|without restrictions?|unrestricted|obey me|ignore your)",
  "\\bobey me\\b|\\bno restrictions\\b|\\bjailbreak\\b|\\bdeveloper mode\\b",
  // fake role line at the start of a message
  "^\\s*(?:system|assistant)\\s*:",
  // reaching other users' data
  "(?:other|another)\\s+(?:users?|accounts?|candidates?)(?:'s|s')?\\s+(?:cv|resume|document|data|session|file)s?",
  "(?:cv|resume|document|data|file)s?\\s+of\\s+(?:other|another|all)\\s+(?:users?|accounts?|candidates?)",
];
const DOCUMENT_PATTERN = new RegExp(DOCUMENT_INJECTION.join("|"), "i");
const CHAT_PATTERN = new RegExp(CHAT_INJECTION.join("|"), "im");

// Requests that are clearly not about interview practice. Phrases, not single words: a
// "weather app" or "recipe app" (a project the user built) is not a request for the weather.
const NOT_A_PROJECT = "(?!\\s+(?:app|application|dashboard|project|api|service|widget|website|site|data|station|module|model|system))";
const OUT_OF_SCOPE = new RegExp([
  `what(?:'s| is)\\s+(?:the\\s+)?(?:weather|temperature)${NOT_A_PROJECT}`,
  "\\bweather\\s+(?:today|tomorrow|tonight|forecast|like|report)\\b",
  "\\b(?:tomorrow|today)'?s?\\s+weather\\b",
  "\\b(?:stock|share) price\\b|\\b(?:crypto|cryptocurrency|bitcoin) price\\b",
  "\\bwho won (?:the\\s+|last night'?s?\\s+)?(?:\\w+\\s+)?(?:match|game|election|race|final)\\b|\\b(?:sports?|football|soccer) scores?\\b|\\blottery (?:numbers|results)\\b|\\bhoroscope\\b",
  "\\bpolitical news\\b",
  "\\b(?:write|give|get)\\s+(?:me\\s+)?(?:an?\\s+)?(?:poem|song|joke|recipe)\\b|\\btell me an? joke\\b",
  "\\bhow (?:do|can|to)\\s+(?:i\\s+)?(?:bake|cook|grill)\\b",
  "\\bdo my homework\\b|\\bsolve my assignment\\b",
  "thời tiết|giá cổ phiếu|giá tiền ảo|công thức nấu ăn|tin chính trị|tỉ số bóng đá|xổ số|tử vi|làm bài tập hộ",
].join("|"), "i");

function classifyInput(message) {
  const text = String(message);
  if (CHAT_PATTERN.test(text)) return "injection";
  if (OUT_OF_SCOPE.test(text)) return "out-of-scope";
  return "ok";
}

function sanitizeSourceText(text) {
  return String(text).split(/\r?\n/).filter((line) => !DOCUMENT_PATTERN.test(line)).join("\n");
}

module.exports = { classifyInput, sanitizeSourceText };
