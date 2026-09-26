import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseEnvFile, ensureIgnored, packageManager, runInit, writeEnvKey, type InitDeps } from "../src/init.js";

const project = (files: Record<string, string> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "sp-init-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
};
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");
const KEY = "sp_test_0123456789abcdefghijklmnopqr";

/** A fake Sendpository: start → N pending polls → the given final poll reply. */
function fakeServer(final: Record<string, unknown>, opts: { pendingPolls?: number } = {}) {
  const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  let polls = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body, headers: init.headers as Record<string, string> });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/api/cli/auth/start")) {
      return json({ device_code: "d".repeat(43), user_code: "BCDF-GHJK", verification_uri_complete: "https://app.test/cli/approve?code=BCDF-GHJK", expires_in: 600, interval: 1 });
    }
    if (url.endsWith("/api/cli/auth/poll")) {
      polls++;
      return json(polls <= (opts.pendingPolls ?? 1) ? { status: "pending" } : final);
    }
    if (url.endsWith("/emails")) return json({ id: "e1" });
    return json({}, 404);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function deps(fetchFn: typeof fetch) {
  const log: string[] = [];
  const runs: string[] = [];
  const opened: string[] = [];
  const sleeps: number[] = [];
  const d: InitDeps = {
    fetch: fetchFn,
    openBrowser: (u) => opened.push(u),
    run: (cmd, args) => (runs.push([cmd, ...args].join(" ")), 0),
    log: (l) => log.push(l),
    sleep: async (ms) => void sleeps.push(ms),
  };
  return { d, log, runs, opened, sleeps };
}

const approved = { status: "approved", api_key: KEY, email: "dev@example.com", api_url: "https://api.test/v1", app_url: "https://app.test", sandbox_from: "onboarding@sandbox.test" };
const options = (cwd: string) => ({ cwd, appUrl: "https://app.test", install: true, agents: true, test: true });

describe("npx sendpository init", () => {
  it("connects, writes the key, protects it, installs, and sends a test email", async () => {
    const cwd = project({
      "package.json": JSON.stringify({ name: "acme", dependencies: { next: "16.0.0" } }),
      ".gitignore": "node_modules\n",
      ".env.example": "DATABASE_URL=\n",
    });
    const { fetchFn, calls } = fakeServer(approved);
    const { d, log, runs, opened } = deps(fetchFn);

    expect(await runInit(options(cwd), d)).toBe(0);

    expect(opened).toEqual(["https://app.test/cli/approve?code=BCDF-GHJK"]);
    expect(log.join("\n")).toContain("BCDF-GHJK");
    expect(calls[0]!.body.client_name).toBe(cwd.split("/").pop());
    expect(read(cwd, ".env.local")).toBe(`SENDPOSITORY_API_KEY=${KEY}\n`);
    expect(read(cwd, ".gitignore")).toContain(".env.local");
    expect(read(cwd, ".env.example")).toContain("SENDPOSITORY_API_KEY=\n");
    expect(read(cwd, ".env.example")).not.toContain(KEY);
    expect(runs).toEqual(["npm install sendpository"]);
    expect(existsSync(join(cwd, ".claude/skills/sendpository/SKILL.md"))).toBe(true);
    const send = calls.find((c) => c.url === "https://api.test/v1/emails")!;
    expect(send.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(send.body.to).toEqual(["dev@example.com"]);
    expect(send.body.from).toContain("onboarding@sandbox.test");
    // The key itself is never printed.
    expect(log.join("\n")).not.toContain(KEY);
  });

  it("skips the test email when the account has no sandbox sender", async () => {
    const cwd = project();
    const { fetchFn, calls } = fakeServer({ ...approved, sandbox_from: null });
    await runInit(options(cwd), deps(fetchFn).d);
    expect(calls.some((c) => c.url.endsWith("/emails"))).toBe(false);
  });

  it("honours --no-install, --no-agents and --no-test", async () => {
    const cwd = project({ "package.json": JSON.stringify({ name: "x" }) });
    const { fetchFn, calls } = fakeServer(approved);
    const { d, runs } = deps(fetchFn);
    await runInit({ ...options(cwd), install: false, agents: false, test: false }, d);
    expect(runs).toEqual([]);
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/emails"))).toBe(false);
  });

  it("doesn't reinstall the SDK when the project already has it", async () => {
    const cwd = project({ "package.json": JSON.stringify({ dependencies: { sendpository: "^0.5.0" } }) });
    const { d, runs } = deps(fakeServer(approved).fetchFn);
    await runInit(options(cwd), d);
    expect(runs).toEqual([]);
  });

  it("stops on a denied request without touching the project", async () => {
    const cwd = project();
    const { d } = deps(fakeServer({ status: "denied" }).fetchFn);
    await expect(runInit(options(cwd), d)).rejects.toThrow(/denied/);
    expect(existsSync(join(cwd, ".env"))).toBe(false);
  });

  it("reports an expired code", async () => {
    const { d } = deps(fakeServer({ status: "expired" }).fetchFn);
    await expect(runInit(options(project()), d)).rejects.toThrow(/expired/);
  });

  it("backs off when told to slow down", async () => {
    const { fetchFn } = fakeServer(approved, { pendingPolls: 0 });
    let first = true;
    const slowing = (async (url: string, init: RequestInit) => {
      if (url.endsWith("/poll") && first) {
        first = false;
        return new Response(JSON.stringify({ status: "slow_down" }), { status: 200 });
      }
      return fetchFn(url, init);
    }) as unknown as typeof fetch;
    const { d, sleeps } = deps(slowing);
    await runInit(options(project()), d);
    expect(sleeps[1]!).toBeGreaterThan(sleeps[0]!);
  });
});

describe("init helpers", () => {
  it("replaces an existing key line instead of adding a second", () => {
    const cwd = project({ ".env": "A=1\nexport SENDPOSITORY_API_KEY=sp_old\nB=2\n" });
    expect(writeEnvKey(join(cwd, ".env"), "sp_new")).toBe("replaced");
    expect(read(cwd, ".env")).toBe("A=1\nSENDPOSITORY_API_KEY=sp_new\nB=2\n");
  });

  it("appends to an env file without a trailing newline", () => {
    const cwd = project({ ".env": "A=1" });
    writeEnvKey(join(cwd, ".env"), "sp_new");
    expect(read(cwd, ".env")).toBe("A=1\nSENDPOSITORY_API_KEY=sp_new\n");
  });

  it("picks .env.local for Next.js and Vite, .env otherwise", () => {
    expect(chooseEnvFile(project({ "package.json": JSON.stringify({ dependencies: { next: "1" } }) }))).toBe(".env.local");
    expect(chooseEnvFile(project({ "package.json": JSON.stringify({ devDependencies: { vite: "1" } }) }))).toBe(".env.local");
    expect(chooseEnvFile(project({ "package.json": JSON.stringify({ dependencies: { express: "1" } }) }))).toBe(".env");
    expect(chooseEnvFile(project({ ".env.local": "" }))).toBe(".env.local");
  });

  it("recognises an env file already ignored by a wildcard", () => {
    const cwd = project({ ".gitignore": ".env*\n" });
    expect(ensureIgnored(cwd, ".env.local")).toBe("already");
    expect(read(cwd, ".gitignore")).toBe(".env*\n");
  });

  it("leaves a folder that isn't a repo and has no .gitignore alone", () => {
    const cwd = project();
    expect(ensureIgnored(cwd, ".env")).toBe("no-git");
    expect(existsSync(join(cwd, ".gitignore"))).toBe(false);
  });

  it("uses the project's package manager", () => {
    expect(packageManager(project({ "pnpm-lock.yaml": "" }))[0]).toBe("pnpm");
    expect(packageManager(project({ "yarn.lock": "" }))[0]).toBe("yarn");
    expect(packageManager(project({ "bun.lock": "" }))[0]).toBe("bun");
    expect(packageManager(project())[0]).toBe("npm");
  });

  it("asks git whether the env file is ignored, when it's a repo", () => {
    const cwd = project({ ".gitignore": "*.local\n" });
    mkdirSync(join(cwd, ".git"));
    // Not a real repo, so git can't answer - the .gitignore fallback still sees *.local.
    expect(ensureIgnored(cwd, ".env.local")).toBe("already");
  });
});
