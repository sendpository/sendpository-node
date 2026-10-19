# Changelog

## 0.6.0

- Email reads now describe both permission-dependent response shapes. A sending
  key can read delivery status only for messages created by that same key;
  a full-access key can also read message content. Narrow with `"to" in email`
  before accessing recipients or bodies. This corrects the previous types,
  which promised fields the secured API does not return. Rotating a sending
  key does not grant the replacement access to the old key's messages.
- `idempotency_in_progress` retries preserve the original idempotency key.
  `send_outcome_unknown` stops automatic retries and requires checking the
  original operation; a new key could duplicate mail already accepted.
- New error type `idempotency_original_failed` (409): the original attempt under
  that key finished and failed. It replaces the `500 internal_error` that case
  used to return, which `isRetryable` reported as worth retrying - so a client
  retrying 5xx repeated a request whose answer could never change. The new type
  is not retryable; check the named message's delivery state first.
- `init` validates an existing project key before reusing it and preserves the
  file on failure. `--no-test` explicitly skips that check. New projects use
  `.env.local` for Next.js and `.env` otherwise; load it in your server runtime
  and never expose the key to browser code.

These changes require publishing a new SDK/CLI version; changing the workspace
does not update an existing installation or `npx sendpository@latest`.

## 0.5.2

Retries no longer risk doing a write twice.

- Timeouts, 5xx, network errors and unreadable responses are retried only
  for reads and for `emails.send()` (which carries an idempotency key).
  Creating API keys, webhooks and domains, cancelling, updating and deleting
  now throw on those failures instead of retrying - a retry after a request
  that had in fact succeeded could create a second key or webhook, or fail
  with a misleading "already exists". Rate limits are still retried on every
  call.
- A non-JSON error response (a proxy's 502 page, a 404 from a wrong base URL,
  a platform's 413) is typed from its status - `not_found`,
  `validation_error` and so on - instead of `internal_error`, so it is no
  longer retried pointlessly.
- A 2xx whose body can't be read is reported as that, not as a network
  error.
- New test matrix: every operation against every kind of failure (179 cases).

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
