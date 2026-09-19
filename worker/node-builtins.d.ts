// No @types/node in this repo (see package.json) — this repo does not add
// one just to type what the worker tests reach for. Declares only the tiny
// slice of node's built-in modules they actually use: `node:sqlite` backs
// MatchDO's `ctx.storage.sql` mock (worker/match.test.ts,
// worker/history.test.ts), and `node:fs` lets worker/__fixtures__/d1.ts run
// the real migrations/*.sql rather than a hand-copied schema.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): Record<string, unknown>[];
      get(...params: unknown[]): Record<string, unknown> | undefined;
      run(...params: unknown[]): { changes: number };
    };
  }
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
}
