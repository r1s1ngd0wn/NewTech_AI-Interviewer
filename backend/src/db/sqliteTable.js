// Map-like wrapper around a single (key, value-as-JSON) SQLite table, using node's
// built-in node:sqlite module (no native compilation, ships with Node 22.5+/24).
// Exposes the same get/set/delete/has/values interface the services already use,
// so authService/sessionService/progressService needed zero changes when this
// replaced the plain in-memory Map store.
class SqliteTable {
  constructor(db, tableName, keyColumn) {
    this.getStmt = db.prepare(`SELECT value FROM ${tableName} WHERE ${keyColumn} = ?`);
    this.hasStmt = db.prepare(`SELECT 1 FROM ${tableName} WHERE ${keyColumn} = ?`);
    this.allStmt = db.prepare(`SELECT value FROM ${tableName}`);
    this.entriesStmt = db.prepare(`SELECT ${keyColumn} AS key, value FROM ${tableName}`);
    this.deleteStmt = db.prepare(`DELETE FROM ${tableName} WHERE ${keyColumn} = ?`);
    this.upsertStmt = db.prepare(
      `INSERT INTO ${tableName} (${keyColumn}, value) VALUES (?, ?)
       ON CONFLICT(${keyColumn}) DO UPDATE SET value = excluded.value`
    );
  }

  get(key) {
    const row = this.getStmt.get(key);
    return row ? JSON.parse(row.value) : undefined;
  }

  set(key, value) {
    this.upsertStmt.run(key, JSON.stringify(value));
    return this;
  }

  has(key) {
    return this.hasStmt.get(key) !== undefined;
  }

  delete(key) {
    this.deleteStmt.run(key);
  }

  values() {
    return this.allStmt.all().map((row) => JSON.parse(row.value));
  }

  entries() {
    return this.entriesStmt.all().map((row) => [row.key, JSON.parse(row.value)]);
  }
}

module.exports = { SqliteTable };
