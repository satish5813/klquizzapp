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

## Install k6

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
