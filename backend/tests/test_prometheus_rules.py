"""The Prometheus alerting rules file must stay consistent with the metrics
the app actually exposes (backend/app/services/metrics.py)."""

from __future__ import annotations

import pathlib
import re
from typing import Any

import pytest
import yaml
from app.services import metrics

DEPLOY_DIR = pathlib.Path(__file__).resolve().parents[2] / "deploy"
RULES_FILE = DEPLOY_DIR / "prometheus" / "alerting.rules.yml"

_METRIC_TOKEN = re.compile(r"veildrop_[a-z0-9_]+")
_HIST_SUFFIX = re.compile(r"_(?:bucket|sum|count)$")
_DURATION = re.compile(r"^[1-9][0-9]*[smhd]$")


def _load_rules() -> dict[str, Any]:
    if not RULES_FILE.is_file():
        pytest.skip(f"{RULES_FILE} not found")
    with RULES_FILE.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _exposed_families() -> set[str]:
    """Family names the app can emit, from the live render() (# TYPE lines are
    always present; data series only appear once requests have been observed)."""
    families = set()
    for line in metrics.render().splitlines():
        if line.startswith("# TYPE "):
            families.add(line.split()[2])
            continue
        m = re.match(r"^(veildrop_[a-z0-9_]+?)(?:{| )", line)
        if m:
            families.add(m.group(1))
    return families


class TestAlertingRules:
    def test_rules_file_is_valid_yaml(self):
        rules = _load_rules()
        assert isinstance(rules, dict)
        assert "groups" in rules
        assert rules["groups"], "no rule groups defined"

    def test_rules_shape(self):
        for group in _load_rules()["groups"]:
            assert group.get("name"), "group missing name"
            rules = group.get("rules", [])
            assert rules, f"group {group['name']} has no rules"
            for rule in rules:
                assert rule.get("alert"), f"rule in {group['name']} missing alert name"
                assert rule.get("expr"), f"rule {rule['alert']} missing expr"
                labels = rule.get("labels", {})
                assert labels.get("severity") in ("warning", "critical", "info"), (
                    f"rule {rule['alert']} severity must be warning/critical/info"
                )
                annotations = rule.get("annotations", {})
                assert annotations.get("summary") and annotations.get("description"), (
                    f"rule {rule['alert']} needs summary + description annotations"
                )
                if rule.get("for"):
                    assert _DURATION.match(rule["for"]), f"rule {rule['alert']} has invalid 'for' duration"

    def test_all_expr_metrics_are_exposed(self):
        families = _exposed_families()
        assert families, "metrics.render() produced no families - did the service change?"
        for group in _load_rules()["groups"]:
            for rule in group["rules"]:
                referenced = {_HIST_SUFFIX.sub("", t) for t in _METRIC_TOKEN.findall(rule["expr"])}
                missing = referenced - families
                assert not missing, f"rule {rule['alert']} references metrics not exposed by the app: {sorted(missing)}"

    def test_rules_are_lintable_basic(self):
        """Cheap sanity: balanced parentheses/braces in every expr. Full
        PromQL validation happens with `promtool check rules` in CI/ops."""
        for group in _load_rules()["groups"]:
            for rule in group["rules"]:
                expr = rule["expr"]
                for open_ch, close_ch in (("(", ")"), ("{", "}")):
                    assert expr.count(open_ch) == expr.count(close_ch), (
                        f"rule {rule['alert']} has unbalanced {open_ch}{close_ch}"
                    )
