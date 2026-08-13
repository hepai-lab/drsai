#!/usr/bin/env python3
"""Fail-closed source gate for the P6 remote-workspace accessibility/i18n contract."""
from __future__ import annotations

import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


class AccessibilityLocalizationError(RuntimeError):
    pass


def _read(relative: str, root: Path = ROOT) -> str:
    path = root / relative
    try:
        value = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as failure:
        raise AccessibilityLocalizationError("p6_a11y_source_missing") from failure
    if not value:
        raise AccessibilityLocalizationError("p6_a11y_source_empty")
    return value


def verify(root: Path = ROOT) -> dict[str, object]:
    language = _read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteUiLanguage.kt", root,
    )
    host = _read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteHostStatusPresentation.kt", root,
    )
    diagnostic = _read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteConnectionDiagnostic.kt", root,
    )
    actionable = _read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteActionablePresentation.kt", root,
    )
    android = _read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteWorkspaceScreens.kt", root,
    )
    desktop = _read(
        "apps/desktop/shared/renderer/src/components/MobilePairingDialog.tsx", root,
    )
    css = _read("apps/desktop/shared/renderer/src/styles.css", root)

    if not all(marker in language for marker in (
        "enum class RemoteUiLanguage { ZH, EN }", "LocalConfiguration.current",
        'startsWith("zh")', "RemoteUiLanguage.EN",
    )):
        raise AccessibilityLocalizationError("p6_android_locale_selection_invalid")
    for source in (host, diagnostic):
        if "RemoteUiLanguage.EN" not in source or not re.search(r"[\u4e00-\u9fff]", source):
            raise AccessibilityLocalizationError("p6_android_bilingual_status_incomplete")
    if not all(marker in actionable for marker in (
        "RemoteUiLanguage.ZH) return state",
        "RemoteRecoveryAction.REASSOCIATE", "Reconnect this computer",
    )):
        raise AccessibilityLocalizationError("p6_android_bilingual_status_incomplete")
    if not all(marker in android for marker in (
        "LiveRegionMode.Polite", "liveRegion = LiveRegionMode.Polite",
        "heading()", "currentRemoteUiLanguage()", "localizedRemoteActionableState",
    )):
        raise AccessibilityLocalizationError("p6_android_semantics_incomplete")
    if not all(marker in desktop for marker in (
        'role="dialog"', 'aria-modal="true"', 'event.key === "Escape"',
        'event.key !== "Tab"', 'role="timer"', 'aria-live="off"',
        'aria-valuetext=', 'aria-live="polite"', "连接 Android", "Connect Android",
    )):
        raise AccessibilityLocalizationError("p6_desktop_semantics_or_locale_incomplete")
    if not all(marker in css for marker in (
        ".mobile-pairing-icon-button", "width: 44px", "height: 44px",
        "min-height: 44px", "@media (max-width: 700px)",
        "grid-template-columns: repeat(2, minmax(0, 1fr))",
        "prefers-reduced-motion: reduce", "prefers-contrast: more", "forced-colors: active",
    )):
        raise AccessibilityLocalizationError("p6_desktop_zoom_or_target_contract_incomplete")
    return {
        "schema_version": "p6-accessibility-localization/1",
        "android_languages": 2,
        "desktop_languages": 2,
        "android_live_region": True,
        "android_heading": True,
        "desktop_focus_trap": True,
        "desktop_quiet_timer": True,
        "desktop_min_target_px": 44,
        "desktop_zoom_layout": True,
        "physical_talkback_pending": True,
        "physical_200_percent_pending": True,
        "passed": True,
    }


if __name__ == "__main__":
    print(json.dumps(verify(), sort_keys=True, separators=(",", ":")))
