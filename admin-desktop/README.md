# KL AI Quiz — Admin (Desktop)

A native **desktop reporting tool** (Electron + React) for running the KL AI QuizApp.
It connects to your quiz server and gives you:

- **Overview** — questions / students / submitted / terminated counts.
- **User management** — every registered student with their attempt status, score, and a
  **Reopen exam** button (clears their attempt so they can take it again).
- **Question bank** — generate from a syllabus (Claude Haiku) **and** import your model MCQs (JSON).
- **Results** — full attempts table, per-student question-wise **Review**, **Reopen**, and **CSV export**.
- **Question report** — item analysis: for each question, how many students answered it and the
  **% who got it right** (red < 40%, amber 40–69%, green ≥ 70%), with CSV export.

## Run on your laptop

Prereqs: Node ≥ 20. The quiz server (`../server`) must be running.

```bash
cd quiz-app/admin-desktop
npm install        # downloads Electron the first time
npm run dev        # opens the desktop window (Vite + Electron)
```

On first launch, enter:
- **Server URL** — `http://localhost:4000` (or the server PC's `http://<LAN-IP>:4000` if it's on another machine).
- **Admin token** — the `ADMIN_TOKEN` from `../server/.env`.

These are remembered between launches.

## Build a standalone installer (.exe)

```bash
npm run dist       # builds the renderer + packages a Windows installer into ./release
```

The installer (NSIS) lets you install "KL AI Quiz — Admin" like any other Windows app.

## Notes

- The desktop app is **admin-only**. Students still take the exam in their browser at the web
  app (`http://<server>:5180`) — full screen, one attempt, auto-graded.
- All data lives on the **server** (`server/data/*.json`); the desktop app just reads/manages it
  over HTTP, so you can run it from any machine that can reach the server.
- It talks to these backend endpoints: `/api/admin/bank/stats`, `/api/admin/students`,
  `/api/admin/attempts`, `/api/admin/report/questions`, `/api/admin/export.csv`,
  `/api/admin/import`, `/api/admin/estimate`, `/api/admin/generate`,
  `/api/admin/attempts/:id/reopen`.
