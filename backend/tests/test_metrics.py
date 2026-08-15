"""Metrics: label cardinality, exposition format, and endpoint auth gating."""

from __future__ import annotations

import pytest
from app.config import Settings
from app.main import app
from app.middleware.logging import RequestLogMiddleware, _route_template
from app.services import metrics
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _clean_metrics():
    metrics.reset()
    yield
    metrics.reset()


class TestCollector:
    def test_counts_and_histogram(self) -> None:
        metrics.observe("GET", "/health", 200, 0.004)
        metrics.observe("GET", "/health", 200, 0.3)
        metrics.observe("GET", "/health", 500, 0.3)

        out = metrics.render()
        assert 'veildrop_http_requests_total{method="GET",route="/health",status="200"} 2' in out
        assert 'veildrop_http_requests_total{method="GET",route="/health",status="500"} 1' in out
        # Buckets are cumulative: 1 request <= 5ms, all 3 <= 500ms.
        assert 'route="/health",le="0.005"} 1' in out
        assert 'route="/health",le="0.5"} 3' in out
        assert 'route="/health",le="+Inf"} 3' in out
        assert 'veildrop_http_request_duration_seconds_count{method="GET",route="/health"} 3' in out

    def test_reset_clears(self) -> None:
        metrics.observe("GET", "/health", 200, 0.01)
        metrics.reset()
        assert "veildrop_http_requests_total{" not in metrics.render()


class TestRouteTemplateLabel:
    """The whole point: case IDs must never become metric label values."""

    def test_uses_template_not_resolved_path(self) -> None:
        inner = FastAPI()

        @inner.get("/cases/{case_id}")
        async def get_case(case_id: str):
            return {"case_id": case_id}

        inner.add_middleware(RequestLogMiddleware)
        client = TestClient(inner)
        assert client.get("/cases/VD-7F2A-91K8").status_code == 200
        assert client.get("/cases/VD-OTHER-0001").status_code == 200

        out = metrics.render()
        assert 'route="/cases/{case_id}"' in out
        assert "VD-7F2A-91K8" not in out
        assert 'route="/cases/{case_id}",status="200"} 2' in out

    def test_unmatched_path_collapses(self) -> None:
        inner = FastAPI()
        inner.add_middleware(RequestLogMiddleware)
        client = TestClient(inner)
        client.get("/nope/deep/path")
        out = metrics.render()
        assert 'route="__unmatched__"' in out
        assert "/nope/deep/path" not in out

    def test_route_template_without_route_in_scope(self) -> None:
        class _Req:
            scope: dict = {}

        assert _route_template(_Req()) == "__unmatched__"  # type: ignore[arg-type]


class TestMetricsEndpointAuth:
    def _client(self, monkeypatch, token: str) -> TestClient:
        base = Settings()
        patched = Settings(
            session_secret=base.session_secret or "test-secret-not-for-production",
            metrics_token=token,
        )
        monkeypatch.setattr("app.main.get_settings", lambda: patched)
        # raise_server_exceptions=False so the app's own handlers apply.
        return TestClient(app, raise_server_exceptions=False)

    def test_404_when_no_token_configured(self, monkeypatch) -> None:
        resp = self._client(monkeypatch, "").get("/metrics")
        assert resp.status_code == 404

    def test_401_on_wrong_token(self, monkeypatch) -> None:
        client = self._client(monkeypatch, "scrape-me")
        assert client.get("/metrics").status_code == 401
        resp = client.get("/metrics", headers={"Authorization": "Bearer wrong"})
        assert resp.status_code == 401

    def test_200_with_correct_token(self, monkeypatch) -> None:
        client = self._client(monkeypatch, "scrape-me")
        resp = client.get("/metrics", headers={"Authorization": "Bearer scrape-me"})
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/plain")
        assert "veildrop_http_requests_total" in resp.text
