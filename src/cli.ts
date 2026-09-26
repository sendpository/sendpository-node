/**
 * `npx sendpository agents` - installs the Sendpository skill for AI coding
 * agents into the current project.
 *
 * Writes instruction files only, never code, and only when asked: nothing
 * here runs on `npm install`. Running it again updates the files in place.
 *
 *   .claude/skills/sendpository/   Claude Code (a skill, loaded on demand)
 *   AGENTS.md                      Codex, Copilot, Gemini CLI, Cursor and others
 *   .cursor/rules/sendpository.mdc Cursor, when the project already uses it
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_APP_URL, runInit, type InitDeps } from "./init.js";

const START = "<!-- sendpository:start -->";
const END = "<!-- sendpository:end -->";

/** The skill as shipped in this package: dist/cli.js -> ../agents/sendpository. */
export function skillSource(from = dirname(fileURLToPath(import.meta.url))) {
  return resolve(from, "..", "agents", "sendpository");
}

/** The section written into AGENTS.md. Short: the detail lives in the skill. */
export function agentsSection(skillPath: string) {
  return [
    START,
    "## Sendpository (email)",
    "",
    "This project sends email with Sendpository. Before writing or changing email",
    `code, read \`${skillPath}/SKILL.md\` and the reference it points to.`,
    "",
    "- `SENDPOSITORY_API_KEY` stays on the server. Never in client code, a",
    "  `NEXT_PUBLIC_`/`VITE_` variable, or a committed file.",
    "- `from` must be on a domain verified in the Sendpository dashboard.",
    "- Branch on `error.type`, never on the message.",
    "- Pass an idempotency key derived from the event on anything that can retry.",
    "- Verify webhook signatures on the raw request body.",
    END,
  ].join("\n");
}

/** Adds the section, or replaces the one already there. Everything else is kept. */
export function upsertSection(existing: string | null, section: string) {
  if (!existing) return `# AGENTS.md\n\n${section}\n`;
  const start = existing.indexOf(START);
  const end = existing.indexOf(END);
  if (start !== -1 && end > start) {
    return existing.slice(0, start) + section + existing.slice(end + END.length);
  }
  return `${existing.replace(/\s*$/, "")}\n\n${section}\n`;
}

export function cursorRule(skillPath: string) {
  return [
    "---",
    "description: Sending or receiving email with Sendpository (SENDPOSITORY_API_KEY, the sendpository package, webhooks)",
    "alwaysApply: false",
    "---",
    "",
    `Before writing Sendpository code, read \`${skillPath}/SKILL.md\` and follow it.`,
    "Keep SENDPOSITORY_API_KEY on the server, send from a verified domain, use",
    "idempotency keys on retries, and verify webhook signatures on the raw body.",
    "",
  ].join("\n");
}

type Options = { cwd: string; global: boolean; dryRun: boolean; home?: string; source?: string };
type Change = { path: string; what: string };

export function install(opts: Options): Change[] {
  const source = opts.source ?? skillSource();
  if (!existsSync(join(source, "SKILL.md"))) {
    throw new Error(`The skill files are missing from this package (${source}). Reinstall sendpository.`);
  }
  const changes: Change[] = [];
  const write = (path: string, content: string, what: string) => {
    changes.push({ path, what });
    if (opts.dryRun) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };

  // 1. The skill itself, for Claude Code.
  const skillDir = opts.global
    ? join(opts.home ?? homedir(), ".claude", "skills", "sendpository")
    : join(opts.cwd, ".claude", "skills", "sendpository");
  const existed = existsSync(skillDir);
  changes.push({ path: skillDir, what: existed ? "updated the skill" : "added the skill" });
  if (!opts.dryRun) {
    mkdirSync(skillDir, { recursive: true });
    cpSync(source, skillDir, { recursive: true });
  }

  // A global install serves every project; project files are left alone.
  if (opts.global) return changes;

  const skillPath = relative(opts.cwd, skillDir).split("\\").join("/");

  // 2. AGENTS.md, which most other agents read.
  const agentsPath = join(opts.cwd, "AGENTS.md");
  const before = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : null;
  const after = upsertSection(before, agentsSection(skillPath));
  if (after !== before) {
    write(agentsPath, after, before === null ? "created with a Sendpository section" : "added or updated the Sendpository section");
  }

  // 3. Cursor, only where the project already has Cursor rules or settings.
  if (existsSync(join(opts.cwd, ".cursor"))) {
    write(join(opts.cwd, ".cursor", "rules", "sendpository.mdc"), cursorRule(skillPath), "added a Cursor rule");
  }

  return changes;
}

const HELP = `Sendpository CLI

  npx sendpository init              Connect this project in one step: approve in the
                                     browser, and the key lands in your .env, the SDK
                                     and the agent skill are installed, and a test
                                     email is sent where your account allows it.
      --env-file <file>              Where to write the key (default .env.local for
                                     Next.js/Vite projects, otherwise .env).
      --no-install                   Don't install the sendpository package.
      --no-agents                    Don't install the agent skill.
      --no-test                      Don't send a test email.

  npx sendpository agents            Install the Sendpository skill for AI coding
                                     agents (Claude Code, Codex, Cursor, Copilot...)
                                     into this project.
      --global                       Install the Claude Code skill for every project
                                     (~/.claude/skills) instead.
      --dry-run                      Show what would be written, write nothing.
  npx sendpository agents --print    Print SKILL.md, for agents that read stdout.

Docs: https://sendpository.com/agents
`;

export async function main(argv: string[], cwd = process.cwd(), deps?: InitDeps): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "init") return init(rest, cwd, deps);
  if (command !== "agents") {
    process.stdout.write(HELP);
    return command === undefined || command === "help" || command === "--help" || command === "-h" ? 0 : 1;
  }
  const unknown = rest.filter((a) => !["--global", "--dry-run", "--print"].includes(a));
  if (unknown.length) {
    process.stderr.write(`Unknown option: ${unknown.join(" ")}\n\n${HELP}`);
    return 1;
  }
  if (rest.includes("--print")) {
    process.stdout.write(readFileSync(join(skillSource(), "SKILL.md"), "utf8"));
    return 0;
  }

  const dryRun = rest.includes("--dry-run");
  const changes = install({ cwd, global: rest.includes("--global"), dryRun });
  process.stdout.write(`${dryRun ? "Would write" : "Sendpository skill installed"}:\n`);
  for (const c of changes) process.stdout.write(`  ${relative(cwd, c.path) || c.path}  - ${c.what}\n`);
  if (!dryRun) {
    process.stdout.write(
      "\nYour coding agent will now follow Sendpository's instructions when it writes email code.\n" +
        "Commit these files so everyone on the project gets them. Run this again to update.\n",
    );
  }
  return 0;
}

async function init(args: string[], cwd: string, deps?: InitDeps) {
  const flags = new Set(["--no-install", "--no-agents", "--no-test"]);
  let envFile: string | undefined;
  let appUrl = process.env.SENDPOSITORY_APP_URL ?? DEFAULT_APP_URL;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--env-file" && args[i + 1]) envFile = args[++i];
    else if (a === "--app-url" && args[i + 1]) appUrl = args[++i]!;
    else if (!flags.has(a)) {
      process.stderr.write(`Unknown option: ${a}\n\n${HELP}`);
      return 1;
    }
  }
  return runInit(
    {
      cwd,
      appUrl: appUrl.replace(/\/$/, ""),
      envFile,
      install: !args.includes("--no-install"),
      agents: !args.includes("--no-agents"),
      test: !args.includes("--no-test"),
    },
    deps,
  );
}
