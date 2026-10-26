import hashlib
import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

# argon2-cffi defaults = RFC 9106 "low memory" Argon2id profile (t=3, m=64 MiB, p=4).
_hasher = PasswordHasher()
_DUMMY_HASH = _hasher.hash("timing-equaliser-not-a-real-password")

PASSWORD_MIN_LEN = 10
PASSWORD_MAX_LEN = 128


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    """Constant-ish time verification; also burns a hash when the user does not exist."""
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def password_problems(password: str, email: str | None = None) -> list[str]:
    problems: list[str] = []
    if len(password) < PASSWORD_MIN_LEN:
        problems.append(f"must be at least {PASSWORD_MIN_LEN} characters")
    if len(password) > PASSWORD_MAX_LEN:
        problems.append(f"must be at most {PASSWORD_MAX_LEN} characters")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        problems.append("must contain at least one letter and one digit")
    if email and password.lower() == email.lower():
        problems.append("must not be the same as the email address")
    return problems


def unusable_password_hash() -> str:
    return hash_password(secrets.token_urlsafe(32))


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
