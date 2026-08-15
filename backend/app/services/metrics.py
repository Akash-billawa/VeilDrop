"""In-process request metrics in Prometheus text exposition format.

ponytail: plain dicts + a module-level lock, no prometheus_client dependency.
Counters are per-process and reset on restart — correct for a scrape-based
model where the scraper computes rates, and adequate for a single-worker
deployment. Upgrade path if you run multiple workers or want histograms
across restarts: swap this for prometheus_client with a multiprocess dir.

Labels are deliberately low-cardinality: the *route template* (``/api/v1/
cases/{case_id}``), never the resolved path, so case IDs never become label
values. Unmatched paths collapse to ``__unmatched__``.
"""

from __future__ import annotations

import threading
from collections import defaultdict

# Bucket bounds in seconds; last bucket (+Inf) is implicit.
_BUCKETS: tuple[float, ...] = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)

_lock = threading.Lock()
_requests: dict[tuple[str, str, int], int] = defaultdict(int)
_bucket_counts: dict[tuple[str, str], list[int]] = {}
_duration_sum: dict[tuple[str, str], float] = defaultdict(float)
_duration_count: dict[tuple[str, str], int] = defaultdict(int)


def observe(method: str, route: str, status_code: int, duration_seconds: float) -> None:
    """Record one completed request. Never raises — metrics must not break a response."""
    key = (method, route)
    with _lock:
        _requests[(method, route, status_code)] += 1
        _duration_sum[key] += duration_seconds
        _duration_count[key] += 1
        counts = _bucket_counts.get(key)
        if counts is None:
            counts = [0] * len(_BUCKETS)
            _bucket_counts[key] = counts
        # Store per-bucket (non-cumulative) counts; render() cumulates.
        for i, bound in enumerate(_BUCKETS):
            if duration_seconds <= bound:
                counts[i] += 1
                break


def reset() -> None:
    """Clear all counters. Test-only."""
    with _lock:
        _requests.clear()
        _bucket_counts.clear()
        _duration_sum.clear()
        _duration_count.clear()


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def render() -> str:
    """Serialise current counters as Prometheus text exposition format v0.0.4."""
    with _lock:
        requests = dict(_requests)
        buckets = {k: list(v) for k, v in _bucket_counts.items()}
        sums = dict(_duration_sum)
        counts = dict(_duration_count)

    lines: list[str] = [
        "# HELP veildrop_http_requests_total Total HTTP requests by method, route and status.",
        "# TYPE veildrop_http_requests_total counter",
    ]
    for (method, route, status), n in sorted(requests.items()):
        lines.append(
            f'veildrop_http_requests_total{{method="{_escape(method)}",route="{_escape(route)}",status="{status}"}} {n}'
        )

    lines += [
        "# HELP veildrop_http_request_duration_seconds HTTP request latency.",
        "# TYPE veildrop_http_request_duration_seconds histogram",
    ]
    for key in sorted(buckets):
        method, route = key
        labels = f'method="{_escape(method)}",route="{_escape(route)}"'
        cumulative = 0
        for bound, n in zip(_BUCKETS, buckets[key], strict=True):
            cumulative += n
            lines.append(f'veildrop_http_request_duration_seconds_bucket{{{labels},le="{bound}"}} {cumulative}')
        total = counts.get(key, 0)
        lines.append(f'veildrop_http_request_duration_seconds_bucket{{{labels},le="+Inf"}} {total}')
        lines.append(f"veildrop_http_request_duration_seconds_sum{{{labels}}} {sums.get(key, 0.0):.6f}")
        lines.append(f"veildrop_http_request_duration_seconds_count{{{labels}}} {total}")

    return "\n".join(lines) + "\n"
