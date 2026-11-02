import logging, os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import router

logging.basicConfig(level=logging.INFO,format="%(levelname)s [%(name)s] %(message)s")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
app = FastAPI(title="OVERBRIEF API", version="1.0.0",
              description="AI cricket match catch-up companion")
origins = ["http://localhost:5173", "http://127.0.0.1:5173",
           os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")]
app.add_middleware(CORSMiddleware, allow_origins=list(set(origins)),
                   allow_credentials=False, allow_methods=["*"], allow_headers=["*"])
app.include_router(router)

@app.get("/")
def root():
    return {"name": "OVERBRIEF API", "docs": "/docs"}

@app.get("/api/health")
def health():
    return {"status": "ok"}
