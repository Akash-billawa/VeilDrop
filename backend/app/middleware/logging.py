from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import UTC, datetime

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from ..services import metrics

logger = logging.getLogger(__name__)


class JsonFormatter(logging.Formatter):
    """One JSON object per log record, safe for structured log pipelines.

    Extra fields (e.g. correlation_id) are flattened into the record as
    ``record.correlation_id`` by the middleware; only non-mystery fields are
    emitted. Never include request bodies, headers, or query strings.
    """

    RESERVED = frozenset(logging.LogRecord("", 0, "", 0, "", (), None).__dict__.keys()) | {
        "message",
        "asctime",
        "taskName",
    }
    ALLOWED_EXTRA = {
        "correlation_id",
        "method",
        "path",
        "status_code",
        "duration_ms",
        "client_ip",
        "user_agent",
    }

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created, tz=UTC).isoformat()
        payload: dict = {
            "ts": ts,
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if (
                key in self.ALLOWED_EXTRA
                and key not in self.RESERVED
                and not key.startswith("_")
                and (isinstance(value, (str, int, float, bool)) or value is None)
            ):
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, separators=(",", ":"))


def _route_template(request: Request) -> str:
    """The matched route's path template, e.g. ``/api/v1/cases/{case_id}``.

    Only valid after the request has passed through the router. Using the
    template (not ``request.url.path``) keeps case IDs out of metric labels,
    which would otherwise grow unbounded.
    """
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else "__unmatched__"


class RequestLogMiddleware(BaseHTTPMiddleware):
    """Structured per-request logging: method, path, status, duration, correlation.

    Query strings, headers, and bodies are deliberately never logged.
    """

    async def dispatch(self, request: Request, call_next):
        start = time.monotonic()
        correlation_id = (
            getattr(request.state, "correlation_id", None)
            or request.headers.get("X-Correlation-ID")
            or str(uuid.uuid4())
        )
        response = await call_next(request)
        elapsed = time.monotonic() - start
        duration_ms = elapsed * 1000.0
        metrics.observe(request.method, _route_template(request), response.status_code, elapsed)
        logger.info(
            "request",
            extra={
                "correlation_id": correlation_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round(duration_ms, 2),
                "client_ip": request.client.host if request.client else None,
            },
        )
        return response
