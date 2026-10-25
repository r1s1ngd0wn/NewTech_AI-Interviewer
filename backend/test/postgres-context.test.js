const { test } = require('node:test');
const assert = require('node:assert/strict');
const context = require('../src/context/requestContext');

test('document quota transactions preserve verified JWT scope, rollback and release', async t => {
  const clients = [];
  t.mock.method(require('pg').Pool.prototype, 'connect', async function () {
      const calls = []; const client = { calls, released: false,
        async query(sql, values) { calls.push([sql, values]); return { rows: [] }; },
        release() { this.released = true; },
      };
      clients.push(client); return client;
  });
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'postgres://unit-test';
  t.after(() => { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; });
  delete require.cache[require.resolve('../src/db/postgres')];
  const postgres = require('../src/db/postgres');
  for (const user of ['alice', 'bob']) {
    await context.run({ claims: { sub: user } }, () => postgres.withTransaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`library:${user}`]);
      await client.query('INSERT document');
    }));
  }
  for (const [index, user] of ['alice', 'bob'].entries()) {
    assert.deepEqual(clients[index].calls.slice(0, 3), [
      ['BEGIN', undefined], ['SET LOCAL ROLE authenticated', undefined],
      ["SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user })]],
    ]);
    assert.equal(clients[index].calls.at(-1)[0], 'COMMIT'); assert.equal(clients[index].released, true);
  }
  await assert.rejects(context.run({ claims: { sub: 'alice' } }, () => postgres.withTransaction(async () => {
    throw new Error('quota exceeded');
  })), /quota exceeded/);
  assert.equal(clients[2].calls.at(-1)[0], 'ROLLBACK'); assert.equal(clients[2].released, true);
});
