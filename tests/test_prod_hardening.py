import os
import subprocess
import sys

import pytest

from app.core.secret import get_secret_key


def test_healthz_ok(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] is True


def test_docs_enabled_when_not_production(client):
    # Poza produkcją dokumentacja API powinna być dostępna.
    assert client.get("/docs").status_code in (200, 307, 308)
    assert client.get("/openapi.json").status_code == 200


def test_secret_key_from_env():
    os.environ["FIRE_SECRET_KEY"] = "env-key-abc"
    try:
        assert get_secret_key() == "env-key-abc"
        assert get_secret_key(require_env=True) == "env-key-abc"
    finally:
        os.environ.pop("FIRE_SECRET_KEY", None)


def test_secret_key_requires_env_in_production(monkeypatch):
    monkeypatch.delenv("FIRE_SECRET_KEY", raising=False)
    monkeypatch.delenv("FIRE_SECRET_FILE", raising=False)
    with pytest.raises(RuntimeError):
        get_secret_key(require_env=True)


def test_production_docs_disabled():
    code = (
        "import os; os.environ['FIRE_ENV']='production'; "
        "os.environ['FIRE_SECRET_KEY']='x'*64; "
        "from app.main import app, IS_PRODUCTION; "
        "print(IS_PRODUCTION, app.docs_url, app.redoc_url, app.openapi_url)"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    out = result.stdout.strip().split()
    assert out[0] == "True"
    assert out[1] == "None"
    assert out[2] == "None"
    assert out[3] == "None"


def test_production_requires_env_secret(tmp_path):
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    probe = tmp_path / "probe.py"
    probe.write_text(
        "import os\n"
        "import sys\n"
        f"sys.path.insert(0, {root!r})\n"
        "os.environ['FIRE_ENV'] = 'production'\n"
        "os.environ.pop('FIRE_SECRET_KEY', None)\n"
        "os.environ.pop('FIRE_SECRET_FILE', None)\n"
        "from app.core.secret import get_secret_key\n"
        "try:\n"
        "    get_secret_key(require_env=True)\n"
        "except RuntimeError:\n"
        "    raise SystemExit(0)\n"
        "raise SystemExit(1)\n"
    )
    result = subprocess.run(
        [sys.executable, str(probe)],
        cwd=root,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
