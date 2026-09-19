import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// A D1 binding over an in-memory node:sqlite database, for tests of code
// whose correctness lives in the SQL itself: a unique index, a partial index,
// a join. Such code is tested against the real schema rather than a
// hand-written stand-in that would happily agree with it, so every
// `migrations/*.sql` is applied in name order, exactly as
// `wrangler d1 migrations apply` would. A new migration is picked up with no
// change here.
//
// Covers the slice of the binding the Worker uses: prepare().bind() then
// .first(), .all() or .run(). D1 rejects on a constraint violation, which is
// the branch every write in worker/players.ts is built around, so this does
// too.
export function createMigratedDb(): D1Database {
  const db = new DatabaseSync(":memory:");
  const migrations = readdirSync("migrations").filter((f) => f.endsWith(".sql"));
  for (const file of migrations.sort()) {
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
  }

  // Synchronous throws become rejections, which is how the real binding
  // reports a failed statement.
  function settle<T>(run: () => T): Promise<T> {
    try {
      return Promise.resolve(run());
    } catch (err) {
      return Promise.reject(err);
    }
  }

  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first<T>(): Promise<T | null> {
              return settle(() => (db.prepare(sql).get(...args) as T) ?? null);
            },
            all<T>(): Promise<{ results: T[] }> {
              return settle(() => ({ results: db.prepare(sql).all(...args) as T[] }));
            },
            run() {
              return settle(() => ({ meta: db.prepare(sql).run(...args) }));
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}
