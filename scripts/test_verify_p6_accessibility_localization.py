from __future__ import annotations

from pathlib import Path
import shutil

import pytest

import verify_p6_accessibility_localization as verifier


FILES = (
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteUiLanguage.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteHostStatusPresentation.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteConnectionDiagnostic.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteActionablePresentation.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteWorkspaceScreens.kt",
    "apps/desktop/shared/renderer/src/components/MobilePairingDialog.tsx",
    "apps/desktop/shared/renderer/src/styles.css",
)


def _fixture(tmp_path: Path) -> Path:
    for relative in FILES:
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(verifier.ROOT / relative, target)
    return tmp_path


def test_current_android_and_desktop_contract_passes() -> None:
    report = verifier.verify()
    assert report["passed"] is True
    assert report["android_languages"] == report["desktop_languages"] == 2
    assert report["physical_talkback_pending"] is True
    assert report["physical_200_percent_pending"] is True


@pytest.mark.parametrize(
    ("relative", "old", "new", "code"),
    [
        (FILES[0], "RemoteUiLanguage.EN", "RemoteUiLanguage.ZH", "p6_android_locale_selection_invalid"),
        (FILES[4], "liveRegion = LiveRegionMode.Polite", "", "p6_android_semantics_incomplete"),
        (FILES[5], 'role="timer"', 'role="status"', "p6_desktop_semantics_or_locale_incomplete"),
        (FILES[6], "min-height: 44px", "min-height: 34px", "p6_desktop_zoom_or_target_contract_incomplete"),
    ],
)
def test_regressions_fail_closed(
    tmp_path: Path, relative: str, old: str, new: str, code: str,
) -> None:
    root = _fixture(tmp_path)
    path = root / relative
    source = path.read_text(encoding="utf-8")
    assert old in source
    path.write_text(source.replace(old, new), encoding="utf-8")
    with pytest.raises(verifier.AccessibilityLocalizationError, match=code):
        verifier.verify(root)
