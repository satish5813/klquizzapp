# Load testing the exam (4200 concurrent students)

Prove the VPS holds up **before** the real exam. The script `exam-4200.js` replays the
real student flow (login → start → save answers repeatedly → submit) with thousands of
virtual users.

## VPS sizing (KVM 4 — 4 vCPU / 16 GB / Ubuntu 24.04 + Coolify)

With the cluster bootstrap (`server/start.js`) the API runs **3 workers** by default
(1 core left for MySQL on the same box), so all 4 vCPUs are used. Recommended env on the
Coolify API service:

| Env | Value | Why |
|-----|-------|-----|
| `WEB_CONCURRENCY` | `3` | Node workers (leave 1 core for MySQL). Set `4` if MySQL is on a separate server. |
| `DB_POOL` | `20` | MySQL connections **per worker** → ~60 total across 3 workers. |
| `BANK_TTL_MS` | `30000` | How fast an answer-key fix propagates across workers. |

Also raise MySQL limits (Coolify DB service → my.cnf / env):

```
max_connections = 250
innodb_buffer_pool_size = 6G
```

Keep `DB_POOL * WEB_CONCURRENCY` comfortably **below** `max_connections`.

## Option A — Node driver (no install, easiest)

`drive.mjs` needs only Node (already installed). It seeds an isolated `LoadTest`
domain (students `LOADTEST0001…`, 120 questions, an open schedule) and drives VUS
concurrent students through login → start → save×N → submit, then prints latency
percentiles, error rate and throughput.

```bash
# against the VPS (real MySQL — the meaningful test). Use YOUR admin token.
BASE=https://your-api-host ADMIN_TOKEN=XXXX VUS=1000 node loadtest/drive.mjs

# start smaller and ramp: VUS=500 → 1000 → 2000 → 4200
# re-run without re-seeding:            SEED=0 ...
# tear down (disables the LoadTest schedule):  CLEAN=1 ... node loadtest/drive.mjs
```

Windows PowerShell syntax:
```powershell
$env:BASE="https://your-api-host"; $env:ADMIN_TOKEN="XXXX"; $env:VUS="1000"; node loadtest/drive.mjs
```

> A single laptop can realistically drive ~1000–2000 concurrent connections. For a true
> 4200 test, run the driver (or k6) from a cloud VM near the VPS, or split across 2–3
> machines. Run it in a maintenance window; the `LoadTest` domain is isolated from real
> students, and you clear attempts with the admin "Delete all results" before the real exam.

### Local result (this repo, 2026-07-03)

A 300-VU local run confirmed the app + cluster work end-to-end (login/start/save/submit
all 200 OK). Two findings, both **JSON dev-store artifacts that do NOT exist on MySQL**:
- 3 cluster workers on the JSON store → workers clobber the shared file → errors.
- 1 worker on the JSON store → race-free (0.25% errors) but sync whole-file writes block
  the thread → high latency.

MySQL is concurrent-safe and does indexed single-row updates, so the real capacity number
must come from a run against the VPS (above), not the local JSON store.

## Option B — k6

### Install k6

https://k6.io/docs/get-started/installation/ (Windows: `winget install k6` or `choco install k6`).

## 1. Smoke test (no data needed)

Measures raw request throughput against `/api/health`:

```
k6 run -e BASE=https://your-api-host -e SMOKE=1 loadtest/exam-4200.js
```

## 2. Full exam test (needs seeded data)

On the server under test, first:

1. Import ~4200 test students with registration numbers `LOADTEST0001` … `LOADTEST4200`,
   all in one domain (e.g. `LoadTest`).
2. Add questions for that domain in the admin Question bank.
3. Activate that domain's schedule with a long duration (e.g. 180 min) so nobody
   auto-submits mid-test.

Then run:

```
k6 run -e BASE=https://your-api-host -e VUS=4200 loadtest/exam-4200.js
```

## What to watch

- **On the VPS** (`htop`, Coolify metrics): CPU should spread across all cores; if one
  core is pinned at 100% while others idle, clustering isn't active — check `WEB_CONCURRENCY`.
- **MySQL**: `SHOW STATUS LIKE 'Threads_connected';` should stay under `max_connections`.
  If you see "Too many connections", lower `DB_POOL` or raise `max_connections`.
- **k6 summary**: `http_req_failed` < 2% and `http_req_duration p(95)` < 1.5s = healthy.
  Rising latency or errors as VUs climb = the real ceiling; note the VU count where it
  breaks and either add resources or stagger student start times below that number.

## On exam day

- **Stagger starts**: don't let all 4200 hit "Start" in the same minute. Release by
  section/batch a few minutes apart to flatten the start burst.
- **Coolify**: give the API container the full CPU/RAM (no tight limits), enable
  auto-restart / health checks so a crashed worker recovers instantly.
