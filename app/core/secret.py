import os
import secrets
from pathlib import Path

_DEFAULT_SECRET_FILE = str(Path(__file__).resolve().parents[2] / ".secret_key")


def get_secret_key(require_env: bool = False) -> str:
    """Session key: FIRE_SECRET_KEY env var or a persistent random key in a file.

    The file allows the key to survive server restarts without logging users out.
    In production (require_env=True) the key MUST come from the FIRE_SECRET_KEY
    environment variable so it is never written to the (ephemeral) filesystem.
    """
    key = os.environ.get("FIRE_SECRET_KEY")
    if key:
        return key

    if require_env:
        raise RuntimeError(
            "FIRE_SECRET_KEY must be set via environment in production mode (FIRE_ENV=production)."
        )

    path = Path(os.environ.get("FIRE_SECRET_FILE", _DEFAULT_SECRET_FILE))
    if path.exists():
        stored = path.read_text().strip()
        if stored:
            return stored
    key = secrets.token_hex(32)
    try:
        path.write_text(key)
        try:
            path.chmod(0o600)
        except OSError:
            pass
    except OSError:
        return key
    return key
