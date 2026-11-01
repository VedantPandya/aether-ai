"""Run independently: python -m uvicorn backend.voice.app:app --port 8001."""

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI

from .api import router

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

app = FastAPI(title="Aether Voice", version="0.1.0")
app.include_router(router)
