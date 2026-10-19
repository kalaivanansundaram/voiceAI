# Mappls Problem Intake — voice agent

Built for the AI Garage Voice AI Buildathon (challenge **B: Problem Intake**).

> We are helping **Mappls app users** turn **a rough complaint ("the route took me into a closed road")** into **a confirmed problem brief the Mappls team can act on**.

| Decision card | |
|---|---|
| Target user | People using the Mappls (MapmyIndia) app — commuters, drivers, fleet and business users |
| Starting input | What they say first, or one public link |
| Structured output | A problem brief: type, who to route to, where/when/what happened, impact, with **observations, claims and assumptions separated** and **gaps marked unknown** |
| Done means | The person reviews every answer, corrects any of them, and explicitly approves the exact version read back |
| Not building | Ticket creation, emailing the team, fixing the problem, phone calls |

## How it works

```
Browser (mic / text)
   │  audio
   ▼
Sarvam saaras:v4 speech-to-text ──► Sarvam sarvam-105b-conversations (agent, tool calls)
                                              │ tools: start / save / suggest / confirm /
                                              │        unknown / pause / resume / preview / finalize
                                              ▼
                                   Intake workflow (src/intake.js) ──► Supabase (Vercel) or SQLite (local)
   ▲                                          │
   └──── Sarvam bulbul:v3 text-to-speech ◄────┘ reply
```

The four-step loop from the workbook:

1. **Start** — `start_intake` saves a session and a 6-digit resume code. Public links are read; broken or private links stop safely.
2. **Organise** — what the opening statement already says becomes a *suggestion* (problem, problem type); everything else is visibly *missing*.
3. **Ask** — the backend always returns the next question, so the agent never skips or invents. Each answer is split into statements labelled *observation / claim / assumption*. "I don't know" becomes a visible gap.
4. **Check** — the brief is read back; approve only works with the exact preview version (any later change forces a new read-back). Approve only *saves* the brief; nothing is sent or submitted. Cancel locks it.

Three modes in the page: **Voice (Sarvam)**, **Text chat (Sarvam)** — same agent, no speech credit — and **Guided form (free)**, which drives the same tools without any AI.

## Run locally

Needs Node 22+.

```bash
cp .env.example .env      # then put your Sarvam key in .env (never in chat or git)
npm start                 # http://localhost:3000
npm test                  # runs the workbook "Test it" checklist (17 checks, no credit used)
```

Without `SARVAM_API_KEY` the page still works in Guided form mode. Locally, sessions are saved in `data/intake.db`.

## Deploy to Vercel

Serverless functions have no persistent disk, so the hosted version saves sessions in Supabase.

1. In Supabase, create a project and run [supabase/schema.sql](supabase/schema.sql) in the SQL editor.
2. Import this GitHub repo in Vercel (framework preset: **Other**; no build step).
3. In Vercel → Project → Settings → Environment Variables, add:
   - `SARVAM_API_KEY`
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server-side only; the browser never sees it)
   - `ACCESS_CODE` — recommended: a passcode people must type before they can spend your Sarvam credit
4. Deploy, and share the URL plus the access code.

## API (also usable from a hosted voice provider)

| Route | Purpose |
|---|---|
| `POST /api/tools/<name>` | Call one intake tool with a JSON body (`start_intake`, `save_answer`, `get_preview`, …) |
| `POST /api/agent/text` | One typed turn: `{ messages, text }` |
| `POST /api/agent/voice` | One spoken turn: `{ messages, audio_base64, mime }` → transcript, reply, MP3 |
| `GET /api/brief/<session_id>` | Live brief and change history |

`voice/system-prompt.md` and `voice/tools.json` (regenerate with `npm run export:voice`) hold the same prompt and tools for configuring another voice provider.

## Problem types and routing

Routing labels follow the Mappls feedback queue's team split (map data, business listings, search and app feedback, telematics support, account). Verify against current team ownership before using it for real triage.

## Safety

- Fictional test data only; the agent never asks for home address, phone number, email or passwords.
- Keys live in `.env` / Vercel settings, never in the repo or browser.
- Nothing is sent, filed or submitted — approval only marks the brief as approved in the database.
- Known limits: 6-digit resume codes are guessable — keep `ACCESS_CODE` set on a public deployment; no per-IP rate limiting.
