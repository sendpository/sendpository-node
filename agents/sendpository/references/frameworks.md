# Framework recipes

All of these read `SENDPOSITORY_API_KEY` and `EMAIL_FROM` from the environment.
Keep the send on the server in every case.

## A shared client (Node / TypeScript)

```ts
// lib/email.ts
import { Sendpository } from "sendpository";

export const sendpository = new Sendpository(); // reads SENDPOSITORY_API_KEY
export const EMAIL_FROM = process.env.EMAIL_FROM ?? "App <hello@mail.yourdomain.com>";
```

In Next.js, add `import "server-only";` at the top of this file so it can't be
bundled into client code.

## Next.js App Router - server action

```ts
// app/actions/contact.ts
"use server";

import { sendpository, EMAIL_FROM } from "@/lib/email";

export async function sendWelcome(userId: string, email: string) {
  await sendpository.emails.send(
    {
      from: EMAIL_FROM,
      to: [email],
      subject: "Welcome aboard",
      html: "<p>Thanks for signing up.</p>",
      text: "Thanks for signing up.",
    },
    { idempotencyKey: `welcome-${userId}` },
  );
}
```

A server action is a public endpoint. Check the session and validate input
inside it; never let the client choose `from`, or send to arbitrary `to`
addresses from an unauthenticated form (that turns the app into a spam relay).

## Next.js App Router - route handler

```ts
// app/api/send/route.ts
import { sendpository, EMAIL_FROM } from "@/lib/email";
import { SendpositoryError } from "sendpository";

export async function POST(req: Request) {
  const { to } = await req.json();
  // authenticate the caller and validate `to` here
  try {
    const { id } = await sendpository.emails.send({ from: EMAIL_FROM, to: [to], subject: "Hi", text: "Hello" });
    return Response.json({ id });
  } catch (err) {
    if (err instanceof SendpositoryError) {
      return Response.json({ error: err.type }, { status: err.status });
    }
    throw err;
  }
}
```

## React Email or other templates

Render to HTML first, then send the string:

```tsx
import { render } from "@react-email/render";
import WelcomeEmail from "@/emails/welcome";

const html = await render(<WelcomeEmail name={user.name} />);
const text = await render(<WelcomeEmail name={user.name} />, { plainText: true });
await sendpository.emails.send({ from: EMAIL_FROM, to: [user.email], subject: "Welcome", html, text });
```

## Express / Fastify / any Node server

```ts
import express from "express";
import { sendpository, EMAIL_FROM } from "./lib/email";

app.post("/password-reset", async (req, res) => {
  const user = await findUser(req.body.email);
  if (user) {
    const token = await createResetToken(user.id);
    await sendpository.emails.send(
      {
        from: EMAIL_FROM,
        to: [user.email],
        subject: "Reset your password",
        text: `Reset it here: https://yourapp.com/reset?token=${token}\nThis link expires in 30 minutes.`,
      },
      { idempotencyKey: `reset-${token}` },
    );
  }
  res.sendStatus(204); // same response whether or not the account exists
});
```

## Background jobs and queues

Send from the worker, and use the job id as the idempotency key so a retried
job never emails twice:

```ts
await sendpository.emails.send(message, { idempotencyKey: `job-${job.id}` });
```

## Edge and serverless

- Vercel, Netlify, AWS Lambda (Node runtime): works as-is.
- Cloudflare Workers: enable the `nodejs_compat` flag (webhook verification
  uses `node:crypto`). Pass the key explicitly:
  `new Sendpository(env.SENDPOSITORY_API_KEY)`.
- Bun and Deno: works as-is (`npm:sendpository` in Deno).

## Python (no SDK - plain HTTP)

```python
import os, requests

def send_email(to: str, subject: str, html: str, idempotency_key: str | None = None) -> str:
    headers = {"Authorization": f"Bearer {os.environ['SENDPOSITORY_API_KEY']}"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    r = requests.post(
        "https://api.sendpository.com/v1/emails",
        headers=headers,
        json={"from": os.environ["EMAIL_FROM"], "to": [to], "subject": subject, "html": html},
        timeout=30,
    )
    if not r.ok:
        err = r.json()["error"]
        raise RuntimeError(f"{err['type']}: {err['message']}")
    return r.json()["id"]
```

For Django, call this from a view or a Celery task; for FastAPI, from an
endpoint or background task.

## Other languages

Any HTTP client works: `POST https://api.sendpository.com/v1/emails` with
`Authorization: Bearer <key>` and a JSON body. See `api.md`.
