# OVERBRIEF - Cricket Match Companion

**Missed the match? Get back in the game.**

🔗 **Live Demo:** https://overbrief-web.onrender.com

## 🏏 The Fan Problem

Cricket fans frequently join a match late or look away for a session, returning to a static scoreboard that shows numbers (score, wickets, overs) but not the story. A scorecard doesn't explain momentum shifts, what a chase requires, or what to watch next, and scrolling through live commentary is too slow.

OVERBRIEF gives fans an instant, trusted 30-second catch-up briefing. It separates hard arithmetic from AI reasoning so the numbers are never hallucinated.

## 🚀 How It Works

1. **Input:** Upload a scoreboard screenshot or enter match details manually (with optional recent deliveries).
2. **Python calculates the facts:** Run rates, required run rates, balls remaining, and wickets remaining are computed deterministically in code.
3. **Gemini explains the context:** Google's Gemini API translates those hard facts into a 3-part structured briefing:
   - **What happened:** Plain-language recap.
   - **Match situation:** Current numbers and metrics.
   - **Why it matters & what to watch next:** Strategic context.
4. **Ask OVERBRIEF:** Interactive chat that lets fans ask follow-up questions grounded entirely in the match data.

## 🏛️ Architecture & Design Decisions

- **Python calculates, AI explains:** Math-heavy metrics (like legal balls remaining or run rates) use deterministic Python code, ensuring zero arithmetic errors from language models.
- **Honest about missing data:** If no recent deliveries are provided, the app states it clearly rather than hallucinating missed overs.
- **Human-in-the-loop verification:** Screenshot OCR extraction populates a confirmation card so users can correct misread values before generating the briefing.
- **Resilient fallback layer:** Per-attempt timeouts, automatic fallback models, and a purely calculated fallback briefing if the AI layer fails or times out.

## 🛠️ Tech Stack

- **Frontend:** React, Vite, Tailwind/CSS, Lucide Icons
- **Backend:** Python, FastAPI, Uvicorn
- **AI/ML:** Google Gemini API (`gemini-3.5-flash-lite` and `gemini-3.8-flash` via Google Gen AI SDK) for vision OCR and context synthesis

## 🚀 Run Locally

### 1. Backend Setup

```bash
cd backend
python -m venv .venv
# Windows:      .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
```

Create a `backend/.env` file:

```dotenv
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_FALLBACK_MODEL=gemini-3.8-flash
GEMINI_TIMEOUT_SECONDS=12
DEMO_MODE=false
FRONTEND_ORIGIN=http://localhost:5173
```

Run the server:

```bash
python -m uvicorn app.main:app --reload --port 8000
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```
