"""FastAPI application — F1 AI Race Engineer API."""

from contextlib import asynccontextmanager

import fastf1
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from src.api.routes import chat, race
from src.utils.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown events."""
    logger.info("Starting F1 AI Race Engineer API")

    # Enable FastF1 cache on startup
    cache_dir = settings.get("fastf1", {}).get("cache_dir", "data/.fastf1_cache")
    fastf1.Cache.enable_cache(cache_dir)
    logger.info("FastF1 cache enabled at {}", cache_dir)

    yield

    logger.info("Shutting down F1 AI Race Engineer API")


app = FastAPI(
    title="F1 AI Race Engineer API",
    description="AI-powered F1 race engineer with real historical data",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow frontend to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings["api"]["cors_origins"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(race.router, prefix="/api/race", tags=["race"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


def cli() -> None:
    """CLI entry point for running the API via `uv run f1-api`."""
    import uvicorn

    host = settings.get("api", {}).get("host", "0.0.0.0")
    port = settings.get("api", {}).get("port", 8000)
    uvicorn.run("src.api.main:app", host=host, port=port, reload=True)
