from __future__ import annotations

import logging
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .database import close_pool, get_pool, init_db
from .middleware.logging import JsonFormatter, RequestLogMiddleware
from .middleware.security import CorrelationMiddleware, SecurityHeadersMiddleware
from .routers import admin, investigator, reporter
from .services import metrics
from .services.case import expire_stale_cases

logger = logging.getLogger(__name__)


def _configure_logging(settings) -> None:
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    if settings.log_format == "json":
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        root = logging.getLogger()
        root.handlers = [handler]
        root.setLevel(level)
    else:
        logging.basicConfig(
            level=level,
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    _configure_logging(s)
    logger.info("Starting VeilDrop v0.1.0")

    pool = await get_pool()
    await init_db(pool)

    stale = await expire_stale_cases()
    if stale:
        logger.info("Expired %d stale cases on startup", stale)

    logger.info("VeilDrop ready (configured address %s:%s; actual bind is logged by uvicorn)", s.host, s.port)

    yield

    await close_pool()
    logger.info("VeilDrop shut down")


app = FastAPI(
    title="VeilDrop API",
    description="Post-Quantum-Ready Zero-Knowledge Anonymous Reporting & Secure Evidence Exchange Platform",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

s = get_settings()
# Only mount CORS when cross-origin access is actually configured. With no
# origins the middleware would still answer preflights, advertising the API to
# origins that are not allowed anything.
if s.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Correlation-ID"],
    )
else:
    logger.info("CORS disabled (VEILDROP_CORS_ORIGINS empty); same-origin only")
app.add_middleware(RequestLogMiddleware)
app.add_middleware(CorrelationMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(reporter.router)
app.include_router(investigator.router)
app.include_router(admin.router)


@app.exception_handler(Exception)
async def global_handler(request: Request, exc: Exception):
    logger.error("Unhandled: %s %s", type(exc).__name__, exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/health")
async def health():
    return {"status": "ok", "service": "veildrop", "version": "0.1.0", "docs": "/docs"}


@app.get("/metrics", include_in_schema=False)
async def metrics_endpoint(authorization: str = Header(None)):
    """Prometheus scrape target. Bearer-token gated; 404 when no token is configured."""
    settings = get_settings()
    if not settings.metrics_token:
        raise HTTPException(status_code=404, detail="Not found")
    presented = authorization.removeprefix("Bearer ") if authorization else ""
    if not secrets.compare_digest(presented, settings.metrics_token):
        raise HTTPException(status_code=401, detail="Authentication required")
    return PlainTextResponse(metrics.render(), media_type="text/plain; version=0.0.4; charset=utf-8")


# Serve the single-page frontend from the repository's frontend directory.
# The SPA uses hash routing, so a plain StaticFiles(html=True) mount is sufficient.
# IMPORTANT: mounted last so explicit routes above are never shadowed.
_frontend_dir = Path(__file__).resolve().parents[2] / "frontend"
if _frontend_dir.is_dir():
    app.mount("/", StaticFiles(directory=_frontend_dir, html=True), name="app")
else:
    logger.warning("frontend directory not found at %s; serving API only", _frontend_dir)
