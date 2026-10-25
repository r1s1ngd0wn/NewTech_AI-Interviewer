const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const { adminClient } = require('../db/supabase');

const router = express.Router();
const PAGE_SIZE = 25;
const LOG_COLUMNS = [
  'id', 'created_at', 'request_id', 'capability', 'operation', 'provider', 'model', 'tools',
  'tokens_in', 'tokens_out', 'latency_ms', 'cost_usd', 'status', 'error_code', 'provider_status',
].join(',');

function rangeDays(value) {
  const days = Number(value || 30);
  if (![7, 30, 90].includes(days)) throw Object.assign(new Error('range must be 7, 30 or 90 days'), { status: 400 });
  const to = new Date();
  return { from: new Date(to.getTime() - days * 24 * 60 * 60 * 1000), to };
}

function positiveInteger(value, fallback, max) {
  const parsed = Number(value || fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw Object.assign(new Error(`value must be between 1 and ${max}`), { status: 400 });
  }
  return parsed;
}

function handle(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
}

async function findAiUsageFile() {
  const cwd = process.cwd();
  const candidates = process.env.AI_USAGE_LOG_PATH
    ? [path.resolve(cwd, process.env.AI_USAGE_LOG_PATH)]
    : [path.resolve(cwd, 'AI_USAGE.md'), path.resolve(cwd, '..', 'AI_USAGE.md')];
  if (!process.env.AI_USAGE_LOG_PATH && cwd.split(path.sep).includes('.worktrees')) {
    candidates.push(path.resolve(cwd, '..', '..', '..', 'AI_USAGE.md'));
  }
  const available = [];
  for (const file of candidates) {
    try {
      const [content, metadata] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
      available.push({ content, updatedAt: metadata.mtime.toISOString(), modifiedAt: metadata.mtimeMs });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (available.length) {
    available.sort((a, b) => b.modifiedAt - a.modifiedAt);
    const { content, updatedAt } = available[0];
    return { content, updatedAt };
  }
  throw Object.assign(new Error('AI_USAGE.md is not available on this server'), { status: 503 });
}

router.get('/ai-usage-log', handle(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await findAiUsageFile());
}));

router.get('/ai-usage', handle(async (req, res) => {
  const { from, to } = rangeDays(req.query.range);
  const { data, error } = await adminClient().rpc('admin_ai_usage_summary', {
    p_from: from.toISOString(), p_to: to.toISOString(),
  });
  if (error) throw Object.assign(new Error('could not load AI usage summary'), { status: 503 });
  res.json(data);
}));

router.get('/ai-logs', handle(async (req, res) => {
  const { from, to } = rangeDays(req.query.range);
  const page = positiveInteger(req.query.page, 1, 1_000_000);
  const offset = (page - 1) * PAGE_SIZE;
  if (!Number.isSafeInteger(offset)) throw Object.assign(new Error('page is out of range'), { status: 400 });

  let query = adminClient().from('ai_logs').select(LOG_COLUMNS, { count: 'exact' })
    .gte('created_at', from.toISOString()).lte('created_at', to.toISOString())
    .order('created_at', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);

  if (req.query.status) {
    if (!['ok', 'error', 'timeout', 'invalid_json', 'refused'].includes(req.query.status)) {
      throw Object.assign(new Error('invalid status filter'), { status: 400 });
    }
    query = query.eq('status', req.query.status);
  }
  if (req.query.capability) {
    if (!['coach', 'critique', 'embed'].includes(req.query.capability)) {
      throw Object.assign(new Error('invalid capability filter'), { status: 400 });
    }
    query = query.eq('capability', req.query.capability);
  }
  if (req.query.provider) {
    if (!['gemini', 'local'].includes(req.query.provider)) {
      throw Object.assign(new Error('invalid provider filter'), { status: 400 });
    }
    query = query.eq('provider', req.query.provider);
  }
  if (req.query.model) query = query.ilike('model', `%${String(req.query.model).slice(0, 80)}%`);
  if (req.query.requestId) {
    const requestId = String(req.query.requestId);
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId)) {
      throw Object.assign(new Error('invalid request ID'), { status: 400 });
    }
    query = query.eq('request_id', requestId);
  }

  const { data, error, count } = await query;
  if (error) throw Object.assign(new Error('could not load AI logs'), { status: 503 });
  res.json({ logs: data || [], page, pageSize: PAGE_SIZE, total: count || 0 });
}));

module.exports = router;
