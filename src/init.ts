/**
 * `npx sendpository init` - from nothing to a working setup in one command.
 *
 *   1. Opens the browser; you approve (signing up first if you're new).
 *   2. Writes the new key into your env file, and makes sure git ignores it.
 *   3. Installs the SDK and the agent skill.
 *   4. Sends you a test email, when the account can (the sandbox sender).
 *
 * Every side effect goes through `deps`, so the whole flow is testable
 * without a browser, a network or a package manager.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { hostname } from "node:os";
import { install } from "./cli.js";

export const DEFAULT_APP_URL = "https://app.sendpository.com";
const KEY = "SENDPOSITORY_API_KEY";

export type InitOptions = {
  cwd: string;
  appUrl: string;
  envFile?: string;
  /** Connect and replace a key the project already has. */
  force?: boolean;
  install: boolean;
  agents: boolean;
  test: boolean;
};

export type InitDeps = {
  fetch: typeof fetch;
  openBrowser: (url: string) => void;
  /** Runs a command in cwd, output shown to the user; returns the exit code. */
  run: (command: string, args: string[], cwd: string) => number;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
};

export const realDeps: InitDeps = {
  fetch: (...args) => fetch(...args),
  openBrowser: (url) => {
    const [cmd, args] =
      process.platform === "darwin" ? ["open", [url]] :
      process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] :
      ["xdg-open", [url]];
    try {
      // Detached and ignored: no browser (SSH, CI, containers) is fine - the URL is printed too.
      spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
    } catch {
      /* the printed URL is the fallback */
    }
  },
  run: (command, args, cwd) =>
    spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" }).status ?? 1,
  log: (line) => process.stdout.write(`${line}\n`),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

type Approved = {
  status: "approved";
  api_key: string;
  email: string | null;
  api_url: string;
  app_url: string;
  sandbox_from: string | null;
};

const readJson = (path: string) => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, string> | undefined>;
  } catch {
    return null;
  }
};

/** `.env.local` where one exists or the framework reads it (Next.js); `.env` otherwise. */
export function chooseEnvFile(cwd: string) {
  if (existsSync(join(cwd, ".env.local"))) return ".env.local";
  const pkg = readJson(join(cwd, "package.json"));
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (deps.next || deps.nuxt || deps["@remix-run/node"] || deps.vite) return ".env.local";
  return ".env";
}

/** Sets the key in an env file, replacing an existing line rather than adding a second. */
export function writeEnvKey(path: string, key: string) {
  const line = `${KEY}=${key}`;
  if (!existsSync(path)) {
    writeFileSync(path, `${line}\n`);
    return "created";
  }
  const text = readFileSync(path, "utf8");
  const pattern = new RegExp(`^\\s*(export\\s+)?${KEY}\\s*=.*$`, "m");
  if (pattern.test(text)) {
    writeFileSync(path, text.replace(pattern, line));
    return "replaced";
  }
  writeFileSync(path, `${text}${text.endsWith("\n") || !text ? "" : "\n"}${line}\n`);
  return "added";
}

/**
 * Makes sure the env file can't be committed. Asks git when it's there -
 * it knows every ignore rule - and otherwise reads .gitignore itself.
 */
export function ensureIgnored(cwd: string, file: string) {
  const isRepo = existsSync(join(cwd, ".git"));
  if (isRepo) {
    const status = spawnSync("git", ["check-ignore", "-q", file], { cwd }).status;
    if (status === 0) return "already";
    // Anything but a clear "not ignored" (git missing, an odd repo) falls
    // through to reading .gitignore ourselves.
  }
  const gitignore = join(cwd, ".gitignore");
  const lines = existsSync(gitignore) ? readFileSync(gitignore, "utf8").split(/\r?\n/).map((l) => l.trim()) : [];
  const local = file.endsWith(".local");
  const covered = lines.some(
    (l) => l === file || l === `/${file}` || l === ".env*" || (local && (l === ".env*.local" || l === "*.local")),
  );
  if (covered) return "already";
  if (!isRepo && !existsSync(gitignore)) return "no-git";
  appendFileSync(gitignore, `${lines.length && lines[lines.length - 1] !== "" ? "\n" : ""}${file}\n`);
  return "added";
}

/** `.env.example` documents the variable without its value, when the project keeps one. */
export function documentInExample(cwd: string) {
  const example = join(cwd, ".env.example");
  if (!existsSync(example)) return false;
  const text = readFileSync(example, "utf8");
  if (new RegExp(`^\\s*${KEY}\\s*=`, "m").test(text)) return false;
  appendFileSync(example, `${text.endsWith("\n") || !text ? "" : "\n"}${KEY}=\n`);
  return true;
}

export function packageManager(cwd: string): [string, string[]] {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return ["pnpm", ["add", "sendpository"]];
  if (existsSync(join(cwd, "yarn.lock"))) return ["yarn", ["add", "sendpository"]];
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return ["bun", ["add", "sendpository"]];
  // npm's audit reports on the whole project, not this package (which has no
  // dependencies) - noise that reads as if installing Sendpository caused it.
  return ["npm", ["install", "sendpository", "--no-audit", "--no-fund"]];
}

async function connect(opts: InitOptions, deps: InitDeps): Promise<Approved> {
  const start = await deps.fetch(`${opts.appUrl}/api/cli/auth/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: basename(opts.cwd), client_host: hostname() }),
  });
  if (!start.ok) throw new Error(`Couldn't reach Sendpository (${start.status}). Try again in a minute.`);
  const req = (await start.json()) as {
    device_code: string;
    user_code: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
  };

  deps.log("");
  deps.log(`  Your code:  ${req.user_code}`);
  deps.log("");
  deps.log("  Opening your browser to approve it. If it doesn't open, go to:");
  deps.log(`  ${req.verification_uri_complete}`);
  deps.log("");
  deps.openBrowser(req.verification_uri_complete);

  let interval = Math.max(1, req.interval) * 1000;
  const deadline = Date.now() + req.expires_in * 1000;
  while (Date.now() < deadline) {
    await deps.sleep(interval);
    const res = await deps.fetch(`${opts.appUrl}/api/cli/auth/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: req.device_code }),
    });
    if (!res.ok) continue; // a blip; keep waiting
    const body = (await res.json()) as { status: string } & Partial<Approved>;
    if (body.status === "approved") return body as Approved;
    if (body.status === "slow_down") interval += 2000;
    if (body.status === "denied") throw new Error("The request was denied in the browser. Nothing was changed.");
    if (body.status === "expired") break;
  }
  throw new Error("The code expired before it was approved. Run `npx sendpository init` again.");
}

/** Where the project already sets a non-empty key, if anywhere. */
export function existingKeyFile(cwd: string, preferred?: string) {
  const candidates = [...new Set([preferred, ".env.local", ".env"].filter((f): f is string => Boolean(f)))];
  const pattern = new RegExp(`^\\s*(export\\s+)?${KEY}\\s*=\\s*["']?([^"'\\s#]+)`, "m");
  return candidates.find((f) => {
    const path = join(cwd, f);
    return existsSync(path) && pattern.test(readFileSync(path, "utf8"));
  }) ?? null;
}

export async function runInit(opts: InitOptions, deps: InitDeps = realDeps): Promise<number> {
  deps.log("Sendpository - setting up this project");

  /*
   * A project that already has a key keeps it. Connecting again would mint a
   * second key and quietly swap it in - surprising for a working project, and
   * it leaves the old key live in the account.
   */
  const already = opts.force ? null : existingKeyFile(opts.cwd, opts.envFile);
  let approved: Approved | null = null;
  let envFile = opts.envFile ?? already ?? chooseEnvFile(opts.cwd);
  if (already) {
    envFile = already;
    deps.log(`✓ Found ${KEY} in ${already} - keeping it. Run with --force to connect again and replace it.`);
  } else {
    approved = await connect(opts, deps);
    deps.log(`✓ Connected${approved.email ? ` to ${approved.email}` : ""}`);
    const how = writeEnvKey(join(opts.cwd, envFile), approved.api_key);
    deps.log(`✓ ${how === "replaced" ? "Replaced" : "Saved"} ${KEY} in ${envFile}${how === "replaced" ? " (the old key still works until you revoke it)" : ""}`);
  }
  const ignored = ensureIgnored(opts.cwd, envFile);
  if (ignored === "added") deps.log(`✓ Added ${envFile} to .gitignore so the key is never committed`);
  if (documentInExample(opts.cwd)) deps.log(`✓ Documented ${KEY} in .env.example (no value)`);

  const pkgPath = join(opts.cwd, "package.json");
  const pkg = readJson(pkgPath);
  if (opts.install && pkg && !pkg.dependencies?.sendpository && !pkg.devDependencies?.sendpository) {
    const [cmd, args] = packageManager(opts.cwd);
    deps.log(`… Installing the SDK (${cmd} ${args.join(" ")})`);
    if (deps.run(cmd, args, opts.cwd) === 0) deps.log("✓ Installed sendpository");
    else deps.log(`! Install failed - run \`${cmd} ${args.join(" ")}\` yourself`);
  }

  if (opts.agents) {
    install({ cwd: opts.cwd, global: false, dryRun: false });
    deps.log("✓ Installed the skill for AI coding agents (.claude/skills, AGENTS.md)");
  }

  let tested = false;
  if (approved && opts.test && approved.sandbox_from && approved.email) {
    const res = await deps.fetch(`${approved.api_url}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${approved.api_key}`,
        "content-type": "application/json",
        "idempotency-key": `init-${approved.api_key.slice(0, 16)}`,
      },
      body: JSON.stringify({
        from: `Sendpository <${approved.sandbox_from}>`,
        to: [approved.email],
        // A real-looking email, not a two-line "test": thin test messages are
        // what spam filters learn to distrust.
        subject: "Your project is connected to Sendpository",
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2933;max-width:520px"><p>Hi,</p><p>Your project <strong>${escapeHtml(basename(opts.cwd))}</strong> is now connected to Sendpository, and this email was sent by <code>npx sendpository init</code> to confirm it works.</p><p><strong>Next step:</strong> add your domain so you can send from your own address to anyone.</p><p><a href="${approved.app_url}/domains" style="color:#0b7a55">Add your domain</a></p><p style="color:#6b7780;font-size:13px">You're receiving this because you ran npx sendpository init and approved it in your Sendpository account.</p></div>`,
        text: `Hi,\n\nYour project ${basename(opts.cwd)} is now connected to Sendpository, and this email was sent by npx sendpository init to confirm it works.\n\nNext step: add your domain so you can send from your own address to anyone - ${approved.app_url}/domains\n\nYou're receiving this because you ran npx sendpository init and approved it in your Sendpository account.`,
      }),
    });
    if (res.ok) {
      tested = true;
      deps.log(`✓ Sent a test email to ${approved.email} - check your inbox`);
    } else {
      const err = (await res.json().catch(() => null)) as { error?: { type?: string; message?: string } } | null;
      deps.log(`! Test email not sent: ${err?.error?.message ?? res.status}`);
    }
  }

  deps.log("");
  deps.log("Next:");
  deps.log(`  1. Add your sending domain: ${approved?.app_url ?? opts.appUrl}/domains`);
  deps.log(
    opts.agents
      ? '  2. Ask your coding agent: "Add Sendpository email to this project."'
      : "  2. Send from your code: https://sendpository.com/docs/quickstart",
  );
  if (approved && !tested && !approved.sandbox_from) deps.log("     Sending works once the domain is verified.");
  return 0;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
