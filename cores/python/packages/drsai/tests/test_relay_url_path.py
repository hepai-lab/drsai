from __future__ import annotations

import pytest

from drsai.relay.url_path import encoded_path


@pytest.mark.parametrize("value", ["a/b", "a%b", "a?b", "a#b", "a b", "\u4f1a\u8bdd/\u4e00"])
def test_opaque_identifier_is_exactly_one_encoded_segment(value: str) -> None:
    path = encoded_path("v1", "sessions", value, "events")
    assert path.startswith("/v1/sessions/")
    assert path.endswith("/events")
    assert path.count("/") == 4
    assert value not in path


def test_query_cannot_inject_another_parameter_or_fragment() -> None:
    assert encoded_path(
        "v1", "events", query=(("cursor", "a&admin=true#fragment"),)
    ) == "/v1/events?cursor=a%26admin%3Dtrue%23fragment"


@pytest.mark.parametrize(
    "segments,query",
    [((), ()), (("v1", ""), ()), (("v1", "bad\x00id"), ()), (("v1",), (("", "x"),))],
)
def test_invalid_path_and_query_fail_closed(segments, query) -> None:
    with pytest.raises(ValueError):
        encoded_path(*segments, query=query)
