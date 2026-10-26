"""AES-256-GCM encryption for biometric templates with key rotation support."""

import base64
import os
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings


class BiometricKeyError(RuntimeError):
    pass


@dataclass(frozen=True)
class EncryptedTemplate:
    key_id: str
    nonce: bytes
    ciphertext: bytes


def _aad(student_id: int, model_name: str, model_version: str) -> bytes:
    return f"smartattend:template:{student_id}:{model_name}:{model_version}".encode()


class TemplateCipher:
    def __init__(self, spec: str):
        self._keys: dict[str, AESGCM] = {}
        self._active: str | None = None
        for part in (p.strip() for p in spec.split(",") if p.strip()):
            key_id, _, b64 = part.partition(":")
            try:
                raw = base64.b64decode(b64, validate=True)
            except Exception as exc:  # noqa: BLE001
                raise BiometricKeyError(f"key {key_id!r} is not valid base64") from exc
            if len(raw) != 32 or not key_id:
                raise BiometricKeyError(f"key {key_id!r} must be 32 bytes")
            self._keys[key_id] = AESGCM(raw)
            self._active = self._active or key_id
        if not self._active:
            raise BiometricKeyError("BIOMETRIC_ENCRYPTION_KEYS is not configured")

    def encrypt(self, student_id: int, model_name: str, model_version: str, embedding: np.ndarray) -> EncryptedTemplate:
        assert self._active is not None
        nonce = os.urandom(12)
        data = np.asarray(embedding, dtype=np.float32).tobytes()
        ct = self._keys[self._active].encrypt(nonce, data, _aad(student_id, model_name, model_version))
        return EncryptedTemplate(self._active, nonce, ct)

    def decrypt(self, student_id: int, model_name: str, model_version: str, tpl: EncryptedTemplate) -> np.ndarray:
        key = self._keys.get(tpl.key_id)
        if key is None:
            raise BiometricKeyError(f"unknown key id {tpl.key_id!r}")
        data = key.decrypt(tpl.nonce, tpl.ciphertext, _aad(student_id, model_name, model_version))
        return np.frombuffer(data, dtype=np.float32).copy()


@lru_cache
def get_cipher() -> TemplateCipher:
    return TemplateCipher(get_settings().biometric_encryption_keys)
