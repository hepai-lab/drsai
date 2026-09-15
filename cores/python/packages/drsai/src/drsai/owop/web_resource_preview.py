"""Security headers for an isolated Web/DocMaster resource preview origin."""

from __future__ import annotations

from urllib.parse import urlparse

from drsai.owop.resource_service import ResourceServiceError


def isolated_preview_headers(*, mime_type: str, filename: str, app_origin: str, preview_origin: str) -> dict[str, str]:
    app, preview = urlparse(app_origin), urlparse(preview_origin)
    if (app.scheme != "https" or preview.scheme != "https" or not app.netloc or not preview.netloc or app.netloc == preview.netloc):
        raise ResourceServiceError("preview_origin_invalid")
    safe_name = "".join(character for character in filename if character >= " " and character not in {'"', "\\", ";"})[:255] or "resource"
    safe_mime = mime_type if mime_type in {
        "text/plain", "text/markdown", "application/json",
        "image/png", "image/jpeg", "image/gif", "image/webp",
    } else "application/octet-stream"
    return {
        "Content-Type": safe_mime,
        "Content-Disposition": f'inline; filename="{safe_name}"',
        "Content-Security-Policy": (
            "default-src 'none'; script-src 'none'; connect-src 'none'; object-src 'none'; "
            "frame-src 'none'; media-src 'none'; font-src 'none'; img-src 'self' data:; "
            "style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; sandbox; "
            f"frame-ancestors {app_origin}"
        ),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cross-Origin-Resource-Policy": "same-site",
        "Cache-Control": "private, no-store",
    }
