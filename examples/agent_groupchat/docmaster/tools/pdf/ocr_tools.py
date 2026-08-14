"""
OCR Tools for PDF and Image Processing
Provides RapidOCR-based text extraction for scanned PDFs and images.
"""

import queue as _ocr_queue
import threading as _ocr_threading
from pathlib import Path as _Path
from typing import Callable

# Module-global RapidOCR engine pool, shared across every session's
# extract_scanned_pdf_tool closure. The pool size caps real OCR
# parallelism — ONNX Runtime is thread-safe but a single InferenceSession
# serializes most of the pre/post-processing, so >1 concurrent caller on
# the same engine ends up roughly serial. 4 engines gives 4-way real
# parallelism at ~80MB RAM each. Populated either lazily on first OCR
# call or eagerly by _warmup_rapidocr_at_boot() — whichever runs first.
_RAPIDOCR_POOL: "_ocr_queue.Queue" = _ocr_queue.Queue()
_RAPIDOCR_POOL_SIZE = 4
_RAPIDOCR_POOL_LOCK = None  # set to a threading.Lock at module init

# Bound concurrent extract_scanned_pdf_tool invocations. The LLM routinely
# fans out 8+ scanner calls in a single turn; without this gate each call
# pins its own batch of numpy pixmaps and per-thread OCR buffers in RAM
# and we tip past PM2's memory cap. Size 2 lets two PDFs OCR in parallel
# (still useful for the common 关联业务 batch) without runaway RSS.
_OCR_TOOL_SEMAPHORE = _ocr_threading.Semaphore(2)


def _ensure_rapidocr_pool_lock():
    """Ensure a threading lock exists for RapidOCR pool synchronization."""
    global _RAPIDOCR_POOL_LOCK
    if _RAPIDOCR_POOL_LOCK is None:
        import threading
        _RAPIDOCR_POOL_LOCK = threading.Lock()
    return _RAPIDOCR_POOL_LOCK


def _warmup_rapidocr_at_boot():
    """Pre-load RapidOCR ONNX models into a pool of N engines in a daemon
    thread at process start so the first 关联业务 audit doesn't burn its
    tool-call timeout on engine init. Safe to call multiple times — only
    fills the pool if it's empty.
    """
    if not _RAPIDOCR_POOL.empty():
        return
    def _do():
        try:
            from rapidocr_onnxruntime import RapidOCR
            lock = _ensure_rapidocr_pool_lock()
            with lock:
                if not _RAPIDOCR_POOL.empty():
                    return
                for _ in range(_RAPIDOCR_POOL_SIZE):
                    _RAPIDOCR_POOL.put(RapidOCR())
            print(
                f"[docmaster] RapidOCR warmup complete ({_RAPIDOCR_POOL_SIZE} engines)",
                flush=True,
            )
        except Exception as e:
            print(f"[docmaster] RapidOCR warmup failed: {e!r}", flush=True)
    import threading
    threading.Thread(target=_do, name="rapidocr-warmup", daemon=True).start()


def create_extract_scanned_pdf_tool(get_pending_events: Callable) -> Callable:
    """
    Factory function to create the extract_scanned_pdf_tool with event handling.

    Args:
        get_pending_events: Callable that returns the list to append tool events to

    Returns:
        The extract_scanned_pdf_tool function
    """

    def extract_scanned_pdf_tool(
        file_path: str,
        pages: str = "all",
        dpi: int = 150,
        min_text_chars_per_page: int = 40,
    ):
        """
        Extract text from a scanned PDF or an image file (PNG/JPG) via OCR.

        Use this when run_read / standard PDF text extraction returned empty
        or garbled output, which indicates the file is a scan (image-based
        PDF) rather than a text-native PDF. Also use it directly for image
        uploads (.png, .jpg, .jpeg) that need to be read as documents — e.g.
        a photo of a signed 承诺书, a scanned 营业执照, a stamped 情况说明.

        Workflow inside this tool:
          1. If the path is a PDF, first attempt fast native text extraction
             with PyMuPDF (fitz). Pages whose extracted text length is at
             least `min_text_chars_per_page` are returned as-is — no OCR.
          2. Only pages below that threshold (true scans) are rendered to
             images at the given DPI and passed through RapidOCR
             (chi_sim + en, ONNX runtime, no system deps).
          3. Image inputs always go straight through OCR.

        This hybrid keeps cost low: digital PDFs return immediately, scans
        pay the OCR cost only on the pages that need it.

        Args:
            file_path: Absolute path to a .pdf / .png / .jpg / .jpeg file.
            pages: "all" or a 1-based comma list / range, e.g. "1,3-5".
                   Only honored for PDFs; ignored for image inputs.
            dpi: Rendering DPI for OCR-bound pages. 150 is the default speed /
                 quality tradeoff for office scans; raise to 200 or 300 if
                 results look noisy on very small text.
            min_text_chars_per_page: If fitz returns at least this many
                   characters for a page, skip OCR for that page.

        Returns a dict:
            {
              "success": bool,
              "file_path": str,
              "file_type": "pdf" | "image",
              "page_count": int,
              "pages": [
                {"page": 1, "method": "native" | "ocr",
                 "text": "...", "avg_confidence": float | None,
                 "warnings": [str, ...]}
              ],
              "full_text": str,
              "low_confidence": bool,
              "message": str,
            }
        """
        p = _Path(file_path)
        if not p.is_absolute() or not p.is_file():
            return {
                "success": False,
                "message": (
                    f"extract_scanned_pdf_tool: no file at {file_path!r}. "
                    "Pass an absolute path returned by the upload event or "
                    "by run_glob / run_bash."
                ),
            }

        ext = p.suffix.lower()
        is_pdf = ext == ".pdf"
        is_image = ext in {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif", ".webp"}
        if not (is_pdf or is_image):
            return {
                "success": False,
                "message": (
                    f"extract_scanned_pdf_tool only handles PDFs and images "
                    f"(got {ext!r}). For DOCX use extract_docx_content_tool."
                ),
            }

        try:
            import fitz  # PyMuPDF
        except ImportError:
            return {
                "success": False,
                "message": "extract_scanned_pdf_tool requires PyMuPDF. pip install pymupdf",
            }
        try:
            from rapidocr_onnxruntime import RapidOCR
        except ImportError:
            return {
                "success": False,
                "message": (
                    "extract_scanned_pdf_tool requires rapidocr_onnxruntime. "
                    "pip install rapidocr_onnxruntime"
                ),
            }
        try:
            import numpy as np
            from PIL import Image
        except ImportError as e:
            return {
                "success": False,
                "message": f"extract_scanned_pdf_tool missing dep: {e}",
            }

        lock = _ensure_rapidocr_pool_lock()

        def _ensure_pool_capacity(min_ready: int = 1) -> None:
            if _RAPIDOCR_POOL.qsize() >= min_ready:
                return
            with lock:
                current = _RAPIDOCR_POOL.qsize()
                if current >= min_ready:
                    return
                target = min(_RAPIDOCR_POOL_SIZE, max(min_ready, current))
                for _ in range(current, target):
                    _RAPIDOCR_POOL.put(RapidOCR())

        def _borrow_engine():
            _ensure_pool_capacity(1)
            return _RAPIDOCR_POOL.get()

        def _return_engine(engine):
            _RAPIDOCR_POOL.put(engine)

        def _ocr_image(img_array, engine) -> tuple[str, float | None, list[str]]:
            """Execute OCR on a single image array and return text with confidence."""
            result, _elapsed = engine(img_array)
            if not result:
                return "", None, ["OCR returned no text regions"]
            lines, confs = [], []
            for _box, txt, conf in result:
                if txt:
                    lines.append(txt)
                    try:
                        confs.append(float(conf))
                    except (TypeError, ValueError):
                        pass
            text = "\n".join(lines)
            avg = sum(confs) / len(confs) if confs else None
            warns = []
            if avg is not None and avg < 0.70:
                warns.append(f"low avg OCR confidence {avg:.2f}")
            return text, avg, warns

        def _pixmap_to_rgb_array(pix):
            """Convert PyMuPDF pixmap to RGB numpy array."""
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
            if pix.n == 4:
                img = img[:, :, :3]
            elif pix.n == 1:
                img = np.repeat(img, 3, axis=2)
            return np.ascontiguousarray(img)

        with _OCR_TOOL_SEMAPHORE:
            if is_image:
                try:
                    img = np.array(Image.open(str(p)).convert("RGB"))
                except Exception as e:
                    return {"success": False, "message": f"failed to open image: {e}"}
                engine = _borrow_engine()
                try:
                    text, avg, warns = _ocr_image(img, engine)
                finally:
                    _return_engine(engine)
                return {
                    "success": True,
                    "file_path": str(p),
                    "file_type": "image",
                    "page_count": 1,
                    "pages": [{
                        "page": 1, "method": "ocr",
                        "text": text, "avg_confidence": avg,
                        "warnings": warns,
                    }],
                    "full_text": text,
                    "low_confidence": bool(warns),
                    "message": "image OCR complete" if text else "image OCR returned no text",
                }

            try:
                doc = fitz.open(str(p))
            except Exception as e:
                return {"success": False, "message": f"failed to open PDF: {e}"}

            try:
                n = len(doc)

                def _parse_pages(spec: str, total: int) -> list[int]:
                    """Parse page specification string into 0-based page indices."""
                    if not spec or spec.strip().lower() == "all":
                        return list(range(total))
                    out: set[int] = set()
                    for chunk in spec.split(","):
                        chunk = chunk.strip()
                        if not chunk:
                            continue
                        if "-" in chunk:
                            a, b = chunk.split("-", 1)
                            try:
                                lo, hi = int(a), int(b)
                                if lo > hi:
                                    lo, hi = hi, lo
                                for i in range(lo, hi + 1):
                                    if 1 <= i <= total:
                                        out.add(i - 1)
                            except ValueError:
                                continue
                        else:
                            try:
                                i = int(chunk)
                                if 1 <= i <= total:
                                    out.add(i - 1)
                            except ValueError:
                                continue
                    return sorted(out)

                page_idxs = _parse_pages(pages, n)
                if not page_idxs:
                    return {
                        "success": False,
                        "message": f"pages spec {pages!r} resolved to 0 pages (doc has {n})",
                    }

                ordered_results: dict[int, dict] = {}
                ocr_jobs: list[tuple[int, object]] = []

                for idx in page_idxs:
                    page = doc[idx]
                    native = page.get_text() or ""
                    if len(native.strip()) >= min_text_chars_per_page:
                        ordered_results[idx] = {
                            "page": idx + 1,
                            "method": "native",
                            "text": native,
                            "avg_confidence": None,
                            "warnings": [],
                        }
                        continue
                    ocr_jobs.append((idx, page))

                def _ocr_pdf_page(job):
                    """Process a single PDF page with OCR."""
                    idx, page = job
                    try:
                        pix = page.get_pixmap(dpi=dpi, alpha=False)
                        img = _pixmap_to_rgb_array(pix)
                        del pix
                    except Exception as e:
                        return idx, {
                            "page": idx + 1,
                            "method": "ocr",
                            "text": "",
                            "avg_confidence": None,
                            "warnings": [f"render failed: {e}"],
                        }
                    engine = _borrow_engine()
                    try:
                        text, avg, warns = _ocr_image(img, engine)
                    except Exception as e:
                        return idx, {
                            "page": idx + 1,
                            "method": "ocr",
                            "text": "",
                            "avg_confidence": None,
                            "warnings": [f"ocr failed: {e}"],
                        }
                    finally:
                        del img
                        _return_engine(engine)
                    return idx, {
                        "page": idx + 1,
                        "method": "ocr",
                        "text": text,
                        "avg_confidence": avg,
                        "warnings": warns,
                    }

                if ocr_jobs:
                    import concurrent.futures
                    workers = min(2, _RAPIDOCR_POOL_SIZE, len(ocr_jobs))
                    _ensure_pool_capacity(workers)
                    if workers <= 1:
                        for job in ocr_jobs:
                            idx, result = _ocr_pdf_page(job)
                            ordered_results[idx] = result
                    else:
                        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
                            for idx, result in ex.map(_ocr_pdf_page, ocr_jobs):
                                ordered_results[idx] = result

                results = [ordered_results[idx] for idx in page_idxs]
                any_low = any(
                    r.get("avg_confidence") is not None and r["avg_confidence"] < 0.70
                    for r in results
                )
                any_warn = any(bool(r.get("warnings")) for r in results)
                full = "\n\f\n".join(r["text"] for r in results)
                n_ocr = sum(1 for r in results if r["method"] == "ocr")
                return {
                    "success": True,
                    "file_path": str(p),
                    "file_type": "pdf",
                    "page_count": n,
                    "pages": results,
                    "full_text": full,
                    "low_confidence": any_low,
                    "message": (
                        f"extracted {len(results)} page(s); {n_ocr} via OCR, "
                        f"{len(results) - n_ocr} via native text"
                        + ("; warnings present" if any_warn else "")
                    ),
                }
            finally:
                doc.close()

    return extract_scanned_pdf_tool
