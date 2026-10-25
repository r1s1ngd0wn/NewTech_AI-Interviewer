const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateDucCase } = require('../eval/ducChecks');

const run = (extra = {}) => evaluateDucCase({ testCase: { tool: 'list_sessions', resultCheck: 'sessions' },
  events: [{ type: 'tool', name: 'list_sessions', status: 'running' }, { type: 'tool', name: 'list_sessions', status: 'done' }], answer: { text: 'You have one session.' },
  toolResults: [{ name: 'list_sessions', status: 'done', result: [{ id: 's1', status: 'scored' }] }], ...extra });

test('running-only, error, wrong tool and invalid result never pass a read case', () => {
  assert.equal(run({ events: [{ type: 'tool', name: 'list_sessions', status: 'running' }], toolResults: [] }).pass, false);
  assert.equal(run({ events: [{ type: 'tool', name: 'list_sessions', status: 'error' }], toolResults: [{ name: 'list_sessions', status: 'error' }] }).pass, false);
  assert.equal(run({ events: [{ type: 'tool', name: 'search_scenarios', status: 'done' }], toolResults: [{ name: 'search_scenarios', status: 'done', result: [{}] }] }).pass, false);
  assert.equal(run({ toolResults: [{ name: 'list_sessions', status: 'done', result: [] }] }).pass, false);
});

test('provider failure after a successful read fails outcome and transport separately', () => {
  const result = run({ answer: null, transportErrors: [{ code: 'timeout' }] });
  assert.equal(result.checks.execution, true);
  assert.equal(result.checks.outcome, false);
  assert.equal(result.checks.transport, false);
});

test('feedback must target the expected session and authenticated owner', () => {
  const testCase = { tool: 'get_session_feedback', resultCheck: 'feedback', expectedSessionId: 'session-1', expectedOwnerId: 'alice' };
  const events = [{ type: 'tool', name: 'get_session_feedback', status: 'running' }];
  const answer = { text: 'Your feedback is ready.' };
  const base = { testCase, events, answer };
  const wrongSession = evaluateDucCase({ ...base, toolResults: [{ name: testCase.tool, status: 'done', userId: 'alice', args: { sessionId: 'session-2' }, result: { feedback: {} } }] });
  assert.equal(wrongSession.checks.execution, false);
  const wrongOwner = evaluateDucCase({ ...base, toolResults: [{ name: testCase.tool, status: 'done', userId: 'bob', args: { sessionId: 'session-1' }, result: { feedback: {} } }] });
  assert.equal(wrongOwner.checks.execution, false);
  const splitEvidence = evaluateDucCase({ ...base, toolResults: [
    { name: testCase.tool, status: 'done', userId: 'alice', args: { sessionId: 'session-2' }, result: { feedback: {} } },
    { name: testCase.tool, status: 'done', userId: 'bob', args: { sessionId: 'session-1' }, result: { feedback: {} } },
  ] });
  assert.equal(splitEvidence.checks.execution, false);
  const valid = evaluateDucCase({ ...base, toolResults: [{ name: testCase.tool, status: 'done', userId: 'alice', args: { sessionId: 'session-1' }, result: { feedback: {} } }] });
  assert.equal(valid.checks.execution, true);
});

test('valid read, pending proposal without persistence, and refusal contract pass', () => {
  assert.equal(run().pass, true);
  const proposal = evaluateDucCase({ testCase: { tool: 'create_practice_plan', action: true },
    events: [{ type: 'tool', name: 'create_practice_plan', status: 'running' }, { type: 'tool', name: 'create_practice_plan', status: 'done' }],
    toolResults: [{ name: 'create_practice_plan', status: 'done', result: { action: { status: 'pending' } } }],
    answer: { actions: [{ status: 'pending' }] }, plansAfter: [] });
  assert.equal(proposal.pass, true);
  const refusal = evaluateDucCase({ testCase: { refused: true }, answer: { refusalReason: 'injection' }, modelCalls: 0 });
  assert.equal(refusal.pass, true);
});
