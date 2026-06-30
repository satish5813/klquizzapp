# Quiz App (standalone)

A self-contained **React + Vite** quiz app with a small **Express** backend:

- **Registration** → student fills a form and starts.
- **Quiz** → server hands each student a **random 60** questions (random order) drawn
  from a bank of ~1,000. One-at-a-time UI, jump grid, auto-graded on submit.
- **Result** → score + per-question review with the correct answer and explanation.
- **Admin** → generate the MCQ bank from a **syllabus** via Claude (Haiku), with a
  **cost estimate** before spending and a **live progress** bar. Strictly scoped to the
  syllabus; deduped by question text.

The Claude API key lives **only on the server** (`server/.env`) — it is never sent to
the browser. Storage is plain JSON files under `server/data/` (no database to install).

## Run

Prereqs: Node ≥ 20.

```bash
cd quiz-app
npm install
cp server/.env.example server/.env     # then edit server/.env
npm run dev                              # starts backend (:4000) + frontend (:5180)
```

Open **http://localhost:5180**.

### server/.env

```
ANTHROPIC_API_KEY=sk-ant-...      # your key (only needed to generate the bank)
CLAUDE_MODEL=claude-haiku-4-5     # cheapest model; your choice
ADMIN_TOKEN=change-me-admin       # gate for the admin page — change it
PORT=4000
QUIZ_SIZE=60                      # questions per student (capped to bank size)
```

## Generate the bank

1. Go to **http://localhost:5180/admin**, enter your `ADMIN_TOKEN`.
2. Paste the **syllabus**, set count = **1000**, click **Estimate cost** (≈ $0.95 / ₹84 for 1,000 on Haiku 4.5).
3. Click **Generate** — watch the live progress. Questions are stored in `server/data/questions.json`.

Each student then gets a random 60 of those 1,000 — **no extra API cost per student**
(random selection happens in the database, not via Claude).

## Cost model

- **Bank generation** is the only AI cost: ~**$1 for 1,000 MCQs** (Haiku 4.5, $1/$5 per 1M tokens). One-time.
- **Per-student delivery + grading**: $0 (no API calls).

## API (backend on :4000)

```
GET  /api/health
POST /api/register                 { name, email, rollNumber } → { attemptId, total }
GET  /api/quiz/:attemptId          → questions WITHOUT answers
POST /api/quiz/:attemptId/submit   { answers: {questionId: index} } → { score, total, percentage }
GET  /api/result/:attemptId        → score + review (after submit)

# admin (header: x-admin-token)
GET  /api/admin/bank/stats
POST /api/admin/estimate           { count } → cost estimate (no API call)
POST /api/admin/generate           { syllabus, count, replace } → { jobId }
GET  /api/admin/jobs/:jobId        → { status, collected, target, stats }
```

A 3-question seed bank ships in `server/data/questions.json` so you can try the
student flow immediately, before generating the real bank.
