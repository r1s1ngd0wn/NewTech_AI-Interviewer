const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyCoachRequest, assessAnswerEvidence } = require('../src/agent/answerPolicy');

test('request classifier prioritizes document intent and distinguishes app data, writes and greetings', () => {
  assert.equal(classifyCoachRequest('What does my CV say about a weather app?').mode, 'knowledge');
  assert.equal(classifyCoachRequest('List my practice sessions').mode, 'app-data');
  assert.equal(classifyCoachRequest('Create a practice plan').mode, 'plan-write');
  assert.equal(classifyCoachRequest('Hello').mode, 'greeting');
  assert.equal(classifyCoachRequest('Help me prepare for an interview').mode, 'knowledge');
  assert.equal(classifyCoachRequest('How did I answer the first question?').tools[0], 'get_session_feedback');
});

test('knowledge needs successful search and at least one validated source', () => {
  const request = classifyCoachRequest('What does my CV say?');
  const source = [{ id: 'cv1', label: 'CV', number: 1 }];
  assert.equal(assessAnswerEvidence({ request, completedTools: [], sources: source }).allowed, false);
  assert.equal(assessAnswerEvidence({ request, completedTools: [{ name: 'search_knowledge', status: 'error', result: { sources: [{}] } }], sources: source }).allowed, false);
  assert.equal(assessAnswerEvidence({ request, completedTools: [{ name: 'search_knowledge', status: 'done', result: { sources: [{}] } }], sources: [] }).allowed, false);
  assert.equal(assessAnswerEvidence({ request, completedTools: [{ name: 'search_knowledge', status: 'done', result: { sources: [{}] } }], sources: source }).allowed, true);
});

test('a CV request cannot be satisfied by a shared question-bank source', () => {
  const request = classifyCoachRequest('What does my CV say?');
  const result = [{ name: 'search_knowledge', status: 'done', result: { sources: [{}] } }];
  assert.equal(assessAnswerEvidence({ request, completedTools: result, sources: [{ label: 'Junior Engineer / q1', sourceType: 'question' }] }).reason, 'required-source-kind-missing');
  assert.equal(assessAnswerEvidence({ request, completedTools: result, sources: [{ label: 'Question 1 and answer' }] }).reason, 'required-source-kind-missing');
  assert.equal(assessAnswerEvidence({ request, completedTools: result, sources: [{ label: 'CV: resume.pdf' }] }).allowed, true);
});

test('a question-bank request cannot be satisfied by a private CV source', () => {
  const request = classifyCoachRequest('Find a sample question from the question bank');
  const result = [{ name: 'search_knowledge', status: 'done', result: { sources: [{}] } }];
  assert.equal(assessAnswerEvidence({ request, completedTools: result, sources: [{ label: 'CV: resume.pdf' }] }).reason, 'required-source-kind-missing');
  assert.equal(assessAnswerEvidence({ request, completedTools: result, sources: [{ label: 'Junior Software Engineer - Behavioral / q1', sourceType: 'question' }] }).allowed, true);
});

test('comparison needs both CV and JD, while session requests need the session tool', () => {
  const comparison = classifyCoachRequest('Compare my CV and JD');
  const result = [{ name: 'search_knowledge', status: 'done', result: { sources: [{}, {}] } }];
  assert.equal(assessAnswerEvidence({ request: comparison, completedTools: result, sources: [{ label: 'CV' }] }).allowed, false);
  assert.equal(assessAnswerEvidence({ request: comparison, completedTools: result, sources: [{ label: 'CV' }, { label: 'JD: role' }] }).allowed, true);
  const sessions = classifyCoachRequest('List my practice sessions');
  assert.equal(assessAnswerEvidence({ request: sessions, completedTools: [{ name: 'search_scenarios', status: 'done', result: [{}] }] }).allowed, false);
  assert.equal(assessAnswerEvidence({ request: sessions, completedTools: [{ name: 'list_sessions', status: 'done', result: [{}] }] }).allowed, true);
});
