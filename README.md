# OVERBRIEF — Cricket Match Companion

**Missed the match? Get back in the game.**

**Live demo:** https://YOUR-FRONTEND-URL.onrender.com  (replace with your real link; the first load may take about a minute on the free plan)

OVERBRIEF turns cricket scoreboard information, from a screenshot or typed in by hand, plus optional recent deliveries, into a short catch-up briefing:

1. **What happened**: a plain-language recap of the information supplied
2. **Match situation**: run rate, required rate, runs and balls remaining, wickets left (calculated in Python)
3. **Why it matters**: what those numbers mean
4. **What to watch next**: useful context for the next phase
5. **Ask OVERBRIEF**: follow-up questions answered from the same match context

> No live cricket feed is connected. OVERBRIEF only analyses information supplied by the user or extracted from a screenshot, and it does not invent events that were not provided.

## The fan problem

Fans regularly join a match late, or look away for twenty minutes, and come back to a scoreboard that shows numbers but not the story. A scorecard does not say what the chase needs, why it matters or what to watch next, and scrolling through commentary takes too long when the game is live.

OVERBRIEF gives that fan a 30-second catch-up they can trust: the numbers are calculated, the explanation is in plain language, and anything that was not supplied is clearly labelled as unknown instead of being guessed.

## Design decisions

- **Python calculates, the AI explains.** Required run rate, balls remaining and wickets remaining are computed in code, so the key numbers never depend on a language model's arithmetic.
- **Honest about what it cannot know.** A screenshot shows the current state only. Without recent deliveries the briefing says so and does not reconstruct the missed overs.
- **The user confirms what was read.** Screenshot extraction ends in a confirmation card, so a misread value is corrected before it reaches the briefing.
- **Never leave the fan waiting.** Timeouts, a fallback model and a calculated briefing mean a slow or failing API does not freeze the screen.
- **No betting or fantasy advice and no predictions.** The product explains the situation; it does not tell fans what will happen.

## How it works

```
Upload scoreboard  OR  enter details manually
            ↓
   Extract + confirm (screenshot path)
            ↓
Python calculates the facts → Gemini explains them
            ↓
   Briefing + follow-up questions
```

OVERBRIEF keeps three kinds of information separate:

- **Facts**: score, wickets, overs and any deliveries the user supplied
- **Calculations**: required run rate, runs remaining, balls remaining and wickets remaining, all computed in Python
- **AI interpretation**: why the situation matters and what to watch, written by Gemini from the facts and calculations only

If only a screenshot is supplied, the briefing says clearly that recent events were not provided rather than guessing what happened.

## Features

- Scoreboard screenshot extraction with Gemini vision, followed by a confirmation card so the user can correct anything that was misread
- Manual entry with cricket-aware validation (`16.4` means 16 overs and 4 balls, not a decimal)
- Optional last-six-deliveries input
- Sample match scenarios
- Conversational follow-up chat grounded in the supplied match data
- Resilient AI layer: low-latency thinking setting, per-attempt timeout, automatic fallback model, and a calculated briefing if Gemini is unavailable, so the UI never hangs
- Built-in `/api/match/diagnose` page that tests your key and models and reports the response time of each

## Run locally

Requirements: Python 3.10+ and Node 18+.

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
```

Create a file named `backend/.env`:

```dotenv
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_FALLBACK_MODEL=gemini-3.8-flash
GEMINI_THINKING_LEVEL=low
GEMINI_TIMEOUT_SECONDS=12
DEMO_MODE=false
FRONTEND_ORIGIN=http://localhost:5173
```

Start the server from inside the `backend` folder (not by running `main.py` directly):

```bash
python -m uvicorn app.main:app --reload --port 8000
```

- API docs: http://localhost:8000/docs
- Key and model check: http://localhost:8000/api/match/diagnose

`.env` is only read at startup, so restart the server after editing it. Never commit `.env`; it is excluded by `.gitignore`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to the backend on port 8000, so keep the backend running.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | none | Google AI Studio key. Keep it on the backend only. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Primary model. `gemini-3.5-flash-lite` is faster. |
| `GEMINI_FALLBACK_MODEL` | `gemini-3.5-flash-lite` | Used when the primary model fails or times out. |
| `GEMINI_THINKING_LEVEL` | `low` | Lower thinking means faster answers. Set to `off` to skip it. |
| `GEMINI_TIMEOUT_SECONDS` | `25` | How long to wait per model attempt before moving on. |
| `DEMO_MODE` | `true` | When `true`, responses are generated without a key. Set to `false` in production. |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Frontend URL allowed by CORS. Must match exactly, with no trailing slash. |
| `VITE_API_BASE_URL` | empty | Frontend build setting: the backend's public URL. Not needed locally. |

## API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/match/samples` | Sample match scenarios |
| `POST` | `/api/match/extract` | Multipart image upload; reads a scoreboard (needs a Gemini key) |
| `POST` | `/api/match/brief` | Generates the match briefing |
| `POST` | `/api/match/ask` | Answers a follow-up question about the match |
| `GET` | `/api/match/diagnose` | Tests the key and each configured model, with timings |

## Deploy on Render (free)

1. Push the project to GitHub. Do **not** upload `.env`, `node_modules/` or `.venv/`.
2. On Render choose **New → Blueprint** and select the repository. `render.yaml` creates two services: `overbrief-api` (Python web service) and `overbrief-web` (static site).
3. In the backend service, set `GEMINI_API_KEY`. It is deliberately left blank in `render.yaml`.
4. Check that `FRONTEND_ORIGIN` (backend) and `VITE_API_BASE_URL` (frontend) match the URLs Render actually assigned. If you change `VITE_API_BASE_URL`, redeploy the frontend, because it is baked in at build time.
5. Open `<backend-url>/api/match/diagnose` to confirm the key and models work.

Free web services may sleep when idle, so the first request after a pause can take about a minute. Check Render's current free-plan limits before relying on it.

## Troubleshooting

- **Spinner or 504 errors:** open the diagnose page. If the primary model is slow, set `GEMINI_MODEL=gemini-3.5-flash-lite`.
- **Old behaviour after updating code:** an old server may still be running on port 8000. Stop it, then restart from the `backend` folder.
- **`No module named 'app'`:** you ran `main.py` directly. Use `python -m uvicorn app.main:app` from the `backend` folder.
- **Frontend loads but every request fails when deployed:** `FRONTEND_ORIGIN` does not exactly match the frontend URL.

## AI tools used

- **Gemini API** (Google Gen AI SDK): `gemini-3.5-flash-lite` as the primary model, with `gemini-3.8-flash` as the fallback. Used for reading scoreboard screenshots (vision) and for writing the briefing and follow-up answers.
- **Claude**: used as a coding assistant while building and debugging the app.

## Limitations and next steps

- No live data feed. Everything comes from what the user supplies or uploads.
- Recent events are entered as the last six deliveries. Pasting free-text commentary (for example `14.3 - Wicket`) is a planned improvement.
- First-innings briefings do not yet include a Python-calculated chase target and starting required rate; the AI currently states that from the supplied score.
- The free hosting tier sleeps when idle, so the first request after a pause is slow.

## Accuracy notes

- Overs use cricket notation: `16.4` = 100 legal balls.
- The model is instructed not to invent player names, events, pitch conditions or captain intent.
- Recent-event insights are only generated when recent events are supplied.
- No win probability, betting advice or fantasy recommendations.
- If Gemini is unavailable, the briefing falls back to the calculated figures and is labelled accordingly.