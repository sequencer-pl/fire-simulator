import os
import secrets
from pathlib import Path

_DEFAULT_SECRET_FILE = os.path.join(os.path.dirname(__file__), "..", "..", ".secret_key")


def get_secret_key() -> str:
    """Session key: FIRE_SECRET_KEY env var or a persistent random key in a file.

    The file allows the key to survive server restarts without logging users out.
    """
    key = os.environ.get("FIRE_SECRET_KEY")
    if key:
        return key

    path = Path(os.environ.get("FIRE_SECRET_FILE", _DEFAULT_SECRET_FILE))
    if path.exists():
        stored = path.read_text().strip()
        if stored:
            return stored
    key = secrets.token_hex(32)
    try:
        path.write_text(key)
    except OSError:
        return key
    return key
