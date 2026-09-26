# Changelog

## 0.5.1

- `npx sendpository init` keeps a key the project already has instead of
  connecting again and replacing it. `--force` connects and replaces it.
- The SDK install inside `init` no longer runs npm's audit, which reported on
  the whole project (this package has no dependencies) and read as if
  installing Sendpository had caused it.
- The test email `init` sends reads like a real message, which fares better
  with spam filters.
- Agent skill: examples construct the client as
  `new Sendpository(process.env.SENDPOSITORY_API_KEY)`, and a new section
  covers running Sendpository alongside another provider with safe failover.

## 0.5.0

- `npx sendpository init` connects a project in one step: it opens the
  browser to approve (or sign up), saves the new key to `.env.local` or `.env`,
  makes sure git ignores that file, documents the variable in `.env.example`,
  installs the SDK with the project's package manager and the agent skill, and
  sends a test email where the account allows. `--env-file`, `--no-install`,
  `--no-agents` and `--no-test` are supported.
- `npx sendpository agents` installs the Sendpository skill for AI coding
  agents into your project: `.claude/skills/sendpository/` for Claude Code, a
  section in `AGENTS.md` for Codex, Copilot, Gemini CLI and others, and a
  Cursor rule when the project uses Cursor. `--global`, `--dry-run` and
  `--print` are supported. Nothing is written on `npm install`.
- The skill includes a migration guide (`references/migrate.md`) for moving
  from Resend, SendGrid, Postmark, Mailgun, Amazon SES or Nodemailer.
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
