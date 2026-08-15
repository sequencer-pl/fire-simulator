import os
import secrets
from pathlib import Path

_DEFAULT_SECRET_FILE = os.path.join(os.path.dirname(__file__), "..", "..", ".secret_key")


def get_secret_key() -> str:
    """Klucz sesji: env FIRE_SECRET_KEY albo trwały losowy klucz w pliku.

    Plik pozwala przetrwać restarty serwera bez wylogowania użytkowników.
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
