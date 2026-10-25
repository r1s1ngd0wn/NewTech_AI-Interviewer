const { getPool } = require("../db/postgres");

class MemoryTable {
  constructor() { this.data = new Map(); }
  async get(key) { return this.data.get(key); }
  async set(key, value) { this.data.set(key, structuredClone(value)); }
  async updateExisting(key, value) {
    if (!this.data.has(key)) return false;
    this.data.set(key, structuredClone(value));
    return true;
  }
  async insertIfAbsent(key, value) {
    if (this.data.has(key)) return false;
    this.data.set(key, structuredClone(value));
    return true;
  }

  async has(key) { return this.data.has(key); }
  async delete(key) { this.data.delete(key); }
  async values() { return [...this.data.values()].map((value) => structuredClone(value)); }
  async valuesByUser(userId) {
    return (await this.values()).filter((value) => value.userId === userId);
  }
  // Sets turns[index].critique on a stored session without rewriting the rest of it. Returns false
  // when the session or that turn (checked by question id) is gone. Everything below runs with no
  // await, so it cannot interleave with another write.
  async setTurnCritique(sessionId, index, questionId, critique) {
    const session = this.data.get(sessionId);
    const turn = session?.turns?.[index];
    if (!turn || turn.questionId !== questionId) return false;
    turn.critique = structuredClone(critique);
    return true;
  }
  async entries() { return [...this.data.entries()].map(([key, value]) => [key, structuredClone(value)]); }
}

class PostgresTable {
  constructor(tableName, keyColumn) {
    this.tableName = tableName;
    this.keyColumn = keyColumn;
  }

  async get(key) {
    const result = await getPool().query(`SELECT value FROM ${this.tableName} WHERE ${this.keyColumn} = $1`, [key]);
    return result.rows[0]?.value;
  }

  async set(key, value) {
    await getPool().query(
      `INSERT INTO ${this.tableName} (${this.keyColumn}, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (${this.keyColumn}) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)]
    );
  }

  async insertIfAbsent(key, value) {
    const result = await getPool().query(
      `INSERT INTO ${this.tableName} (${this.keyColumn}, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (${this.keyColumn}) DO NOTHING`,
      [key, JSON.stringify(value)]
    );
    return result.rowCount === 1;
  }

  async updateExisting(key, value) {
    const result = await getPool().query(
      `UPDATE ${this.tableName} SET value = $2::jsonb WHERE ${this.keyColumn} = $1`,
      [key, JSON.stringify(value)]
    );
    return result.rowCount === 1;
  }

  async has(key) {
    const result = await getPool().query(`SELECT 1 FROM ${this.tableName} WHERE ${this.keyColumn} = $1`, [key]);
    return result.rowCount > 0;
  }

  async delete(key) {
    await getPool().query(`DELETE FROM ${this.tableName} WHERE ${this.keyColumn} = $1`, [key]);
  }

  async values() {
    const result = await getPool().query(`SELECT value FROM ${this.tableName}`);
    return result.rows.map((row) => row.value);
  }

  async valuesByUser(userId) {
    if (this.tableName !== "interviewai_sessions") throw new Error("owner query is only available for sessions");
    const result = await getPool().query(
      `SELECT value FROM interviewai_sessions WHERE value->>'userId' = $1 ORDER BY value->>'startedAt' DESC`,
      [userId]
    );
    return result.rows.map((row) => row.value);
  }

  // One UPDATE that only touches turns[index].critique, so a review that arrives while the user is
  // answering the next question cannot overwrite that answer (a read-modify-write of the whole
  // session could). The question id guards against a session that changed underneath it.
  async setTurnCritique(sessionId, index, questionId, critique) {
    if (this.tableName !== "interviewai_sessions") throw new Error("turn critiques are only stored on sessions");
    const result = await getPool().query(
      `UPDATE interviewai_sessions
         SET value = jsonb_set(value, ARRAY['turns', $2::text, 'critique'], $3::jsonb)
       WHERE id = $1 AND value #>> ARRAY['turns', $2::text, 'questionId'] = $4`,
      [sessionId, String(index), JSON.stringify(critique), questionId]
    );
    return result.rowCount === 1;
  }

  async entries() {
    const result = await getPool().query(`SELECT ${this.keyColumn} AS key, value FROM ${this.tableName}`);
    return result.rows.map((row) => [row.key, row.value]);
  }
}

function table(tableName, keyColumn) {
  return process.env.STORE_BACKEND === "memory"
    ? new MemoryTable()
    : new PostgresTable(tableName, keyColumn);
}

module.exports = { table };
