import { AsyncLocalStorage } from "node:async_hooks";

function translatePlaceholders(sql) {
  let output = "";
  let parameter = 0;
  let state = "sql";
  let dollarTag = "";

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (state === "single") {
      output += char;
      if (char === "'" && next === "'") {
        output += next;
        index += 1;
      } else if (char === "'") {
        state = "sql";
      }
      continue;
    }

    if (state === "double") {
      output += char;
      if (char === '"' && next === '"') {
        output += next;
        index += 1;
      } else if (char === '"') {
        state = "sql";
      }
      continue;
    }

    if (state === "line-comment") {
      output += char;
      if (char === "\n") state = "sql";
      continue;
    }

    if (state === "block-comment") {
      output += char;
      if (char === "*" && next === "/") {
        output += next;
        index += 1;
        state = "sql";
      }
      continue;
    }

    if (state === "dollar") {
      if (sql.startsWith(dollarTag, index)) {
        output += dollarTag;
        index += dollarTag.length - 1;
        state = "sql";
      } else {
        output += char;
      }
      continue;
    }

    if (char === "'") {
      state = "single";
      output += char;
    } else if (char === '"') {
      state = "double";
      output += char;
    } else if (char === "-" && next === "-") {
      state = "line-comment";
      output += char + next;
      index += 1;
    } else if (char === "/" && next === "*") {
      state = "block-comment";
      output += char + next;
      index += 1;
    } else if (char === "$") {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        state = "dollar";
        output += dollarTag;
        index += dollarTag.length - 1;
      } else {
        output += char;
      }
    } else if (char === "?") {
      parameter += 1;
      output += `$${parameter}`;
    } else {
      output += char;
    }
  }

  return output;
}

const FIELD_NAMES = new Map([
  ["authtype", "authType"],
  ["apikey", "apiKey"],
  ["apikeyname", "apiKeyName"],
  ["completiontokens", "completionTokens"],
  ["connectionid", "connectionId"],
  ["createdat", "createdAt"],
  ["datekey", "dateKey"],
  ["isactive", "isActive"],
  ["machineid", "machineId"],
  ["prompttokens", "promptTokens"],
  ["teststatus", "testStatus"],
  ["updatedat", "updatedAt"],
]);

function normalizeRow(row) {
  if (!row) return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [FIELD_NAMES.get(key) || key, value]),
  );
}

export async function createPgPool(connectionString, options = {}) {
  if (!connectionString) throw new TypeError("A PostgreSQL connection string is required");
  const { Pool } = await import("pg");
  return new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX) || 10,
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 5000,
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 30000,
    ...options,
  });
}

export function createPgAdapter({ pool, onPoolError = () => {}, readOnly = false }) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") {
    throw new TypeError("A PostgreSQL pool is required");
  }

  const transactionContext = new AsyncLocalStorage();
  pool.on("error", onPoolError);

  function assertWritable(sql) {
    if (!readOnly) return;
    const operation = String(sql).trimStart().match(/^([A-Za-z]+)/)?.[1]?.toUpperCase();
    if (!["SELECT", "SHOW", "EXPLAIN"].includes(operation)) {
      throw new Error("Cannot write through read-only PostgreSQL adapter");
    }
  }

  function executor() {
    return transactionContext.getStore() || pool;
  }

  async function query(sql, params = []) {
    assertWritable(sql);
    return executor().query(translatePlaceholders(sql), params);
  }

  return {
    driver: "postgresql",
    readOnly,
    async run(sql, params = []) {
      assertWritable(sql);
      const result = await query(sql, params);
      return { changes: result.rowCount ?? 0, lastInsertRowid: null };
    },
    async get(sql, params = []) {
      const result = await query(sql, params);
      return normalizeRow(result.rows[0]);
    },
    async all(sql, params = []) {
      const result = await query(sql, params);
      return result.rows.map(normalizeRow);
    },
    async exec(sql) {
      assertWritable(sql);
      return query(sql);
    },
    async transaction(fn) {
      if (readOnly) throw new Error("Cannot write through read-only PostgreSQL adapter");
      const client = await pool.connect();
      let failure;
      try {
        await client.query("BEGIN");
        const result = await transactionContext.run(client, fn);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        failure = error;
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          failure = rollbackError;
        }
        throw failure;
      } finally {
        client.release(failure);
      }
    },
    async close() {
      await pool.end();
    },
    raw: pool,
  };
}

export { translatePlaceholders };
