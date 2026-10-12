"""Replay-only projections for APUS Continuum Session events.

The Python SDK never calls Jev while replaying a recorded decision.  This
module accepts the event dictionaries already returned by ``RunResult`` and
projects the latest ``continuum/memory-decision`` receipt.
"""

from __future__ import annotations

from typing import Mapping, Sequence

from .models import JsonObject, JsonValue


def latest_continuum_memory_decision(
    events: Sequence[Mapping[str, JsonValue]],
) -> JsonObject | None:
    """Return the newest Continuum decision receipt without invoking Jev.

    Events must be supplied in Session sequence order.  Unknown event types
    are ignored so SDK consumers can replay logs produced by newer runtimes.
    """

    for event in reversed(events):
        if event.get("type") != "continuum/memory-decision":
            continue
        data = event.get("data")
        if isinstance(data, dict):
            return dict(data)
    return None
