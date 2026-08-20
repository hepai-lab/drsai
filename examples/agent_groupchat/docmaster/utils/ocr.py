"""
RapidOCR pool management for DocMaster.
Manages a shared pool of RapidOCR engines for efficient PDF text extraction.
"""

import queue
import threading
from loguru import logger

from ..constants import RAPIDOCR_POOL_SIZE, RAPIDOCR_POOL, OCR_TOOL_SEMAPHORE


# Module-global lock for pool initialization
_RAPIDOCR_POOL_LOCK = None


def ensure_rapidocr_pool_lock():
    """
    Ensure the RapidOCR pool lock is initialized.

    Thread-safe initialization of the global lock used for pool creation.

    Returns:
        threading.Lock instance
    """
    global _RAPIDOCR_POOL_LOCK
    if _RAPIDOCR_POOL_LOCK is None:
        _RAPIDOCR_POOL_LOCK = threading.Lock()
    return _RAPIDOCR_POOL_LOCK


def warmup_rapidocr_at_boot():
    """
    Pre-load RapidOCR ONNX models into a pool of N engines in a daemon thread.

    Runs at process start so the first 关联业务 audit doesn't burn its
    tool-call timeout on engine initialization. Safe to call multiple times —
    only fills the pool if it's empty.

    The pool contains multiple RapidOCR engine instances to enable real
    parallelism. ONNX Runtime is thread-safe, but a single InferenceSession
    serializes most pre/post-processing, so multiple concurrent callers on
    the same engine end up roughly serial. 4 engines gives 4-way parallelism
    at ~80MB RAM each.
    """
    if not RAPIDOCR_POOL.empty():
        return

    def _do():
        try:
            from rapidocr_onnxruntime import RapidOCR
            lock = ensure_rapidocr_pool_lock()
            with lock:
                if not RAPIDOCR_POOL.empty():
                    return
                for _ in range(RAPIDOCR_POOL_SIZE):
                    RAPIDOCR_POOL.put(RapidOCR())
            print(
                f"[docmaster] RapidOCR warmup complete ({RAPIDOCR_POOL_SIZE} engines)",
                flush=True,
            )
        except Exception as e:
            print(f"[docmaster] RapidOCR warmup failed: {e!r}", flush=True)

    threading.Thread(target=_do, name="rapidocr-warmup", daemon=True).start()


def borrow_engine():
    """
    Borrow a RapidOCR engine from the pool.

    If the pool is empty, creates a new engine on demand. Blocks if the pool
    is being initialized.

    Returns:
        RapidOCR engine instance
    """
    # Ensure pool is initialized (lazy initialization on first borrow)
    if RAPIDOCR_POOL.empty():
        try:
            from rapidocr_onnxruntime import RapidOCR
            lock = ensure_rapidocr_pool_lock()
            with lock:
                # Double-check: another thread may have filled the pool
                if RAPIDOCR_POOL.empty():
                    # Return a fresh engine (don't add to pool)
                    return RapidOCR()
        except Exception as e:
            logger.warning(f"Failed to create RapidOCR engine: {e}")
            raise

    # Pool has engines, get one
    try:
        return RAPIDOCR_POOL.get(timeout=5)
    except queue.Empty:
        logger.warning("RapidOCR pool exhausted, creating new engine on demand")
        try:
            from rapidocr_onnxruntime import RapidOCR
            return RapidOCR()
        except Exception as e:
            logger.error(f"Failed to create RapidOCR engine: {e}")
            raise


def return_engine(engine):
    """
    Return a RapidOCR engine to the pool.

    Only returns the engine if the pool isn't full. Otherwise, the engine
    is discarded to avoid unbounded growth.

    Args:
        engine: RapidOCR instance to return
    """
    try:
        # Only return if pool isn't at capacity
        if RAPIDOCR_POOL.qsize() < RAPIDOCR_POOL_SIZE:
            RAPIDOCR_POOL.put_nowait(engine)
    except queue.Full:
        # Pool is full, discard this engine
        pass
