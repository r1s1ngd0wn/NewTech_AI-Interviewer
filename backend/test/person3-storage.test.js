process.env.STORE_BACKEND = 'memory';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const postgres = require('../src/db/postgres');
test('forged database paths never reach privileged Storage reads or deletes', async () => {
  const original = postgres.getPool;
  postgres.getPool = () => ({ query: async () => ({ rows: [{ storage_path: 'bob/library/private.txt' }] }) });
  const docs = require('../src/services/documentService');
  try {
    await assert.rejects(docs.deleteUserDocument('alice', 'forged'), { status: 404 });
    await assert.rejects(docs.deleteDocument('alice', 'session', 'forged'), { status: 404 });
    await assert.rejects(docs.exportDocuments('alice', 'session'), { status: 404 });
    await assert.rejects(docs.exportUserDocuments('alice'), { status: 404 });
  } finally { postgres.getPool = original; }
});
