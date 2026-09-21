#!/usr/bin/env python3
"""解密 Electron safeStorage 中的 OIDC access token（Windows）。

依赖: pip install pycryptodome
"""
import os
import json
import base64
import ctypes
import ctypes.wintypes
from Crypto.Cipher import AES


# ── Windows DPAPI（ctypes 直接调用，无 pywin32 依赖）──────────────

class _DATA_BLOB(ctypes.Structure):
    """CryptUnprotectData 所需的结构体，ctypes 定义，非应用类。"""
    _fields_ = [
        ("cbData", ctypes.wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_char)),
    ]


def _dpapi_unprotect(data: bytes) -> bytes:
    """调用 Windows DPAPI CryptUnprotectData 解密数据。"""
    blob_in = _DATA_BLOB(
        len(data),
        ctypes.cast(
            ctypes.create_string_buffer(data, len(data)),
            ctypes.POINTER(ctypes.c_char),
        ),
    )
    blob_out = _DATA_BLOB()
    ok = ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)
    )
    if not ok:
        err = ctypes.windll.kernel32.GetLastError()
        raise OSError(f"DPAPI CryptUnprotectData 失败, error code={err}")
    plain = ctypes.string_at(blob_out.pbData, blob_out.cbData)
    ctypes.windll.kernel32.LocalFree(blob_out.pbData)
    return plain


# ── Token 解密 ──────────────────────────────────────────────────

def get_oidc_token() -> str:
    """解密并返回 OIDC access token（JWT 明文）。

    读取路径:
      1. ~/.drsai-dev/electron-user-data/Local State  → AES 密钥
      2. ~/.drsai-dev/auth/auth.json                  → 加密的 token
    """
    home = os.path.expanduser("~")

    # 1. 从 Local State 读取 AES-256 密钥（DPAPI 保护）
    local_state_path = os.path.join(home, ".drsai-dev", "electron-user-data", "Local State")
    with open(local_state_path, "r", encoding="utf-8") as f:
        encrypted_key = base64.b64decode(json.load(f)["os_crypt"]["encrypted_key"])
    # 前5字节是 "DPAPI" 前缀，去掉后用 DPAPI 解密
    aes_key = _dpapi_unprotect(encrypted_key[5:])

    # 2. 从 auth.json 读取并解密 access token（AES-256-GCM, v10 前缀）
    auth_path = os.path.join(home, ".drsai-dev", "auth", "auth.json")
    with open(auth_path, "r", encoding="utf-8") as f:
        encrypted_token = base64.b64decode(json.load(f)["encryptedAccessToken"])

    # v10 格式: "v10"(3字节) + nonce(12字节) + 密文 + GCM tag(16字节)
    nonce = encrypted_token[3:15]
    ct_tag = encrypted_token[15:]       # 密文 + tag
    ciphertext = ct_tag[:-16]           # 去掉末尾16字节tag
    tag = ct_tag[-16:]

    token = AES.new(aes_key, AES.MODE_GCM, nonce=nonce).decrypt_and_verify(ciphertext, tag)
    return token.decode("utf-8")


if __name__ == "__main__":
    token = get_oidc_token()
    print(f"Token length: {len(token)}")
    print(f"Token preview: {token[:80]}...")
    print(f"\nFull token:\n{token}")
