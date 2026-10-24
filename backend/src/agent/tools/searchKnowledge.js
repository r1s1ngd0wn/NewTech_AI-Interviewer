const ragService = require("../../services/ragService");

async function searchKnowledge({ userId, query, limit = 5 }) {
  if (!userId) throw new Error("searchKnowledge requires an authenticated userId");
  const matches = await ragService.retrieveKnowledge(userId, query, limit);
  return matches.map((match, index) => ({ citation: index + 1, id: match.id,
    sourceType: match.sourceType, label: match.label, excerpt: match.text,
    similarity: match.similarity }));
}

module.exports = { searchKnowledge };
