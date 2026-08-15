import hashlib
import hmac
import os

_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    """Hashuje hasło PBKDF2-HMAC-SHA256 z losową solą (format samoopisujący)."""
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_hex, hash_hex = stored.split("$")
    except (ValueError, AttributeError):
        return False
    if algo != "pbkdf2_sha256":
        return False
    try:
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, int(iterations)
    )
    return hmac.compare_digest(dk, expected)


def is_valid_password(password: str) -> bool:
    return isinstance(password, str) and len(password) >= 8
