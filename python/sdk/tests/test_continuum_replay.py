"""Replay Continuum decision receipts through the Python SDK projection."""

from deepseek_harness import latest_continuum_memory_decision


def test_latest_continuum_decision_is_replayed_without_jev() -> None:
    events = [
        {
            "type": "continuum/memory-decision",
            "data": {
                "version": 1,
                "mode": "shadow",
                "selectedIds": [],
                "baselineIds": ["invoice"],
                "outcome": "jev",
            },
        },
        {"type": "turn/end", "data": {"reason": "completed"}},
        {
            "type": "continuum/memory-decision",
            "data": {
                "version": 1,
                "mode": "active",
                "selectedIds": ["migration"],
                "baselineIds": ["invoice"],
                "outcome": "jev",
                "confidence": 0.95,
            },
        },
    ]

    assert latest_continuum_memory_decision(events) == {
        "version": 1,
        "mode": "active",
        "selectedIds": ["migration"],
        "baselineIds": ["invoice"],
        "outcome": "jev",
        "confidence": 0.95,
    }


def test_unknown_events_and_empty_logs_have_no_decision() -> None:
    assert latest_continuum_memory_decision([]) is None
    assert latest_continuum_memory_decision([{"type": "turn/end", "data": {}}]) is None
