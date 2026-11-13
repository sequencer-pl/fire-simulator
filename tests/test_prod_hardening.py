import os
import subprocess
import sys


def test_healthz_ok(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_docs_enabled_when_not_production(client):
    # Poza produkcją dokumentacja API powinna być dostępna.
    assert client.get("/docs").status_code in (200, 307, 308)
    assert client.get("/openapi.json").status_code == 200


def test_production_docs_disabled():
    code = (
        "import os; os.environ['FIRE_ENV']='production'; "
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
