# KL AI QuizApp — Deployment

## Architecture

```
 Students (browser)            Admin (your laptop)
        │                              │
        ▼                              ▼
  Vercel  ───────► API server (Hostinger VPS) ◄────── Admin desktop app (Electron)
 (React client)         │  Node + Express
                        ▼
              MySQL database (Hostinger)
```

- **Client (student exam)** → **Vercel** (static React build).
- **API server** → **Hostinger VPS** (Express, via Coolify/Docker).
- **Database** → **MySQL on Hostinger**.
- **Admin tool** → **Electron desktop app** on your laptop, pointed at the API.

---

## 1. MySQL database (Hostinger)

1. Create a MySQL database + user (Coolify → add a MySQL resource, or hPanel → Databases).
2. Note: **host, port (3306), user, password, database name**.
3. No schema script needed — the API **creates its tables automatically** on first boot
   (`questions`, `students`, `attempts`).

## 2. API server (Hostinger VPS)

Deploy the repo's **`Dockerfile`** (it builds only the backend) via Coolify, or run with Node/PM2.

Set these environment variables on the server (Coolify → Environment, or `server/.env`):

```
DB_DRIVER=mysql
DB_HOST=<mysql host>
DB_PORT=3306
DB_USER=<mysql user>
DB_PASSWORD=<mysql password>
DB_NAME=<database name>
DB_SSL=false

ADMIN_TOKEN=<a long secret you choose>
ANTHROPIC_API_KEY=<your Claude key>   # only needed to generate questions with AI
CLAUDE_MODEL=claude-haiku-4-5
QUIZ_SIZE=60
QUIZ_DURATION_MIN=60
PORT=4000
```

Expose port **4000** and map a domain, e.g. `https://quiz-api.yourdomain.com`.
Verify: open `https://quiz-api.yourdomain.com/api/health` → should show `"driver":"mysql"`.

## 3. Student client (Vercel)

1. Import the repo into Vercel. Framework preset: **Vite** (auto-detected; `vercel.json` is included).
2. Add an environment variable:
   - `VITE_API_URL = https://quiz-api.yourdomain.com`
3. Deploy. Students open the Vercel URL, enter their **registration number**, read the
   instructions, tick the agree box, and take the exam in full screen.

> The student client only talks to the API over HTTPS; no secrets live in the browser.

## 4. Admin desktop app (your laptop)

```
cd admin-desktop
npm install
npm run dev          # or: npm run dist  → builds a Windows installer in ./release
```

On the connect screen enter:
- **Server URL** = `https://quiz-api.yourdomain.com`
- **Admin token** = the `ADMIN_TOKEN` you set on the server

## 5. First run (in the admin desktop app)

1. **User management → Import student roster** — paste the student CSV
   (`registrationNumber,name,branch,section`). These are the only people who can log in.
2. **Question bank** — either **Import model MCQs** (paste JSON) or **Generate** from a syllabus.
3. Students log in on the Vercel URL and take the exam.
4. Watch **Results** and **Question report**; **Reopen exam** for anyone who needs a re-test.

---

### Local development (no Hostinger/Vercel)

```
cd quiz-app && npm install && npm run dev      # API :4000 (DB_DRIVER=json) + client :5180
cd quiz-app/admin-desktop && npm run dev        # admin window → http://localhost:4000
```
