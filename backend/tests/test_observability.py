"""Observability tests: JSON structured logging and request log middleware."""

from __future__ import annotations

import json
import logging

from app.middleware.logging import JsonFormatter, RequestLogMiddleware
from app.middleware.security import CorrelationMiddleware
from fastapi import FastAPI
from fastapi.testclient import TestClient


class _CaptureHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


class TestJsonFormatter:
    def test_emits_valid_json(self) -> None:
        handler = _CaptureHandler()
        handler.setFormatter(JsonFormatter())
        logger = logging.getLogger("test.json.logger")
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        try:
            logger.info("hello %s", "world")
        finally:
            logger.removeHandler(handler)

        payload = json.loads(handler.format(handler.records[0]))
        assert payload["level"] == "INFO"
        assert payload["logger"] == "test.json.logger"
        assert payload["message"] == "hello world"
        assert "ts" in payload

    def test_extra_fields_flattened(self) -> None:
        handler = _CaptureHandler()
        handler.setFormatter(JsonFormatter())
        logger = logging.getLogger("test.json.extra")
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        try:
            logger.info(
                "request",
                extra={
                    "correlation_id": "abc-123",
                    "method": "GET",
                    "path": "/health",
                    "status_code": 200,
                    "duration_ms": 1.5,
                },
            )
        finally:
            logger.removeHandler(handler)

        payload = json.loads(handler.format(handler.records[0]))
        assert payload["correlation_id"] == "abc-123"
        assert payload["method"] == "GET"
        assert payload["status_code"] == 200
        assert payload["duration_ms"] == 1.5


class TestRequestLogMiddleware:
    def test_health_request_logged_structured(self) -> None:
        handler = _CaptureHandler()
        handler.setLevel(logging.INFO)
        target = logging.getLogger("app.middleware.logging")
        target.addHandler(handler)
        target.setLevel(logging.INFO)
        try:
            app = FastAPI()

            @app.get("/ping")
            async def ping():
                return {"ok": True}

            app.add_middleware(RequestLogMiddleware)
            app.add_middleware(CorrelationMiddleware)

            client = TestClient(app)
            resp = client.get("/ping", headers={"X-Correlation-ID": "corr-42"})
            assert resp.status_code == 200
            assert resp.headers["X-Correlation-ID"] == "corr-42"

            assert len(handler.records) == 1
            record = handler.records[0]
            formatter = JsonFormatter()
            payload = json.loads(formatter.format(record))
            assert payload["method"] == "GET"
            assert payload["path"] == "/ping"
            assert payload["status_code"] == 200
            assert payload["correlation_id"] == "corr-42"
            assert payload["duration_ms"] >= 0
        finally:
            target.removeHandler(handler)
