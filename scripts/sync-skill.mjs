/**
 * Copies the agent skill from the Sendpository app, where it is written and
 * checked against the docs, into this package. `npm run sync:skill`
 *
 * Expects the app checked out beside this repo (../app); pass another path as
 * the first argument. The copy is committed, so CI and `npm publish` never
 * need the app.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve(process.argv[2] ?? "../app", "content/agents/sendpository");
const target = resolve("agents/sendpository");

if (!existsSync(`${source}/SKILL.md`)) {
  console.error(`No skill at ${source}. Pass the app's path: npm run sync:skill -- /path/to/app`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`Copied ${source} -> ${target}`);
