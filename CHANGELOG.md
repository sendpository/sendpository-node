# Changelog

## 0.5.0

- `npx sendpository agents` installs the Sendpository skill for AI coding
  agents into your project: `.claude/skills/sendpository/` for Claude Code, a
  section in `AGENTS.md` for Codex, Copilot, Gemini CLI and others, and a
  Cursor rule when the project uses Cursor. `--global`, `--dry-run` and
  `--print` are supported. Nothing is written on `npm install`.
- The skill ships in the package at `agents/sendpository/`, so an agent reads
  instructions that match the SDK version installed.

## 0.4.0

- `emails.send()` attaches an idempotency key to every call, generated when you
  don't pass one, so the client's own retries can never send an email twice.
- `emails.sendBatch()` no longer retries a timeout or 5xx: the batch endpoint
  can't de-duplicate, so a retry could send the batch twice. Rate limits are
  still retried.
- The `User-Agent` header carries the real package version instead of `0.1.0`.
- Source moved to [github.com/sendpository/sendpository-node](https://github.com/sendpository/sendpository-node).

## 0.3.2 and earlier

Published from the Sendpository application repository.
