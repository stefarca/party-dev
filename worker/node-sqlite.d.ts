// No @types/node in this repo (see package.json) — this repo does not add
// one just to type a test's node:sqlite usage. Declares only the tiny slice
// of the built-in `node:sqlite` module that worker/match.test.ts uses to
// back MatchDO's `ctx.storage.sql` mock (see that file for why).
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): Record<string, unknown>[];
      run(...params: unknown[]): void;
    };
  }
}
