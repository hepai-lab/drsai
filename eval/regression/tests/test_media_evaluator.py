from pathlib import Path

from opendrsai_regression.media_evaluator import inspect_artifact


ROOT = Path(__file__).resolve().parents[1]


def test_presentation_baseline_is_openable_and_structural() -> None:
    evidence = inspect_artifact(ROOT / "assets" / "presentation" / "opendrsai-runtime-core-concepts.pptx")
    assert evidence["slide_count"] == 4
    assert evidence["editable"] is True
    assert "OpenDrSai Runtime" in " ".join(evidence["slide_text"][0])


def test_input_png_metadata_is_deterministic() -> None:
    evidence = inspect_artifact(ROOT / "assets" / "images" / "opendrsai-runtime-model-unauthorized.png")
    assert (evidence["width"], evidence["height"]) == (1598, 1021)
    assert evidence["format"] == "png"
