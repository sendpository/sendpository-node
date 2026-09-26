import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Sendpository } from "../src/index.js";
import { agentsSection, install, main, upsertSection } from "../src/cli.js";

const source = resolve("agents/sendpository");
const project = () => mkdtempSync(join(tmpdir(), "sp-agents-"));
const read = (...p: string[]) => readFileSync(join(...p), "utf8");

describe("npx sendpository agents", () => {
  it("installs the Claude Code skill and an AGENTS.md section", () => {
    const cwd = project();
    install({ cwd, global: false, dryRun: false, source });
    expect(read(cwd, ".claude/skills/sendpository/SKILL.md")).toContain("name: sendpository");
    expect(existsSync(join(cwd, ".claude/skills/sendpository/references/api.md"))).toBe(true);
    const agents = read(cwd, "AGENTS.md");
    expect(agents).toContain("<!-- sendpository:start -->");
    expect(agents).toContain(".claude/skills/sendpository/SKILL.md");
  });

  it("keeps what AGENTS.md already says, and updates its own section in place", () => {
    const cwd = project();
    writeFileSync(join(cwd, "AGENTS.md"), "# Rules\n\nUse pnpm.\n");
    install({ cwd, global: false, dryRun: false, source });
    install({ cwd, global: false, dryRun: false, source });
    const agents = read(cwd, "AGENTS.md");
    expect(agents.startsWith("# Rules\n\nUse pnpm.")).toBe(true);
    expect(agents.match(/sendpository:start/g)).toHaveLength(1);
  });

  it("replaces an older section rather than adding a second", () => {
    const old = `before\n\n<!-- sendpository:start -->\nold text\n<!-- sendpository:end -->\n\nafter\n`;
    const next = upsertSection(old, agentsSection(".claude/skills/sendpository"));
    expect(next).not.toContain("old text");
    expect(next.startsWith("before")).toBe(true);
    expect(next.trimEnd().endsWith("after")).toBe(true);
  });

  it("adds a Cursor rule only when the project uses Cursor", () => {
    const plain = project();
    install({ cwd: plain, global: false, dryRun: false, source });
    expect(existsSync(join(plain, ".cursor"))).toBe(false);

    const cursor = project();
    mkdirSync(join(cursor, ".cursor"));
    install({ cwd: cursor, global: false, dryRun: false, source });
    expect(read(cursor, ".cursor/rules/sendpository.mdc")).toContain("alwaysApply: false");
  });

  it("writes nothing on a dry run", () => {
    const cwd = project();
    const changes = install({ cwd, global: false, dryRun: true, source });
    expect(changes.length).toBeGreaterThan(0);
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
  });

  it("installs globally without touching the project", () => {
    const cwd = project();
    const home = project();
    install({ cwd, global: true, dryRun: false, source, home });
    expect(existsSync(join(home, ".claude/skills/sendpository/SKILL.md"))).toBe(true);
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
  });

  it("refuses unknown options and prints help for unknown commands", () => {
    expect(main(["agents", "--everything"], project())).toBe(1);
    expect(main(["deploy"], project())).toBe(1);
    expect(main(["--help"], project())).toBe(0);
  });
});

describe("the skill matches this SDK", () => {
  const all = ["SKILL.md", "references/api.md", "references/webhooks.md", "references/frameworks.md", "references/receiving.md"]
    .map((f) => read(source, f))
    .join("\n");
  const client = new Sendpository("sp_test_key") as unknown as Record<string, Record<string, unknown>>;

  it("every SDK call it shows exists", () => {
    const calls = new Set<string>();
    for (const [, path] of all.matchAll(/`((?:emails|domains|apiKeys|webhooks|logs|inbound)(?:\.[a-zA-Z]+)+)\(/g)) calls.add(path!);
    for (const [, path] of all.matchAll(/sendpository\.((?:emails|domains|apiKeys|webhooks|logs|inbound)(?:\.[a-zA-Z]+)+)\(/g)) calls.add(path!);
    expect(calls.size).toBeGreaterThan(15);
    for (const path of calls) {
      const fn = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], client);
      expect(typeof fn, path).toBe("function");
    }
  });

  it("every error type it lists is one the SDK knows", () => {
    const sdkTypes = read("src/errors.ts").match(/"[a-z_]+"/g)!.map((t) => t.slice(1, -1));
    const skillTypes = [...read(source, "SKILL.md").matchAll(/^\| `([a-z_]+)` \| \d{3} \|/gm)].map((m) => m[1]!);
    expect(skillTypes.length).toBeGreaterThan(9);
    for (const t of skillTypes) expect(sdkTypes, t).toContain(t);
  });

  it("the webhook header and signature scheme are the SDK's", () => {
    expect(all).toContain("Sendpository-Signature");
    expect(read("src/verify.ts")).toContain("`${timestamp}.${body}`");
    expect(all).toContain('"{t}.{raw body}"');
  });
});
