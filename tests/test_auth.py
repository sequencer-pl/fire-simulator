def test_register_and_session(client):
    r = client.post("/api/register", json={"email": "a@b.pl", "password": "haslo12345"})
    assert r.status_code == 200
    assert r.json()["email"] == "a@b.pl"
    assert client.get("/api/session").json()["email"] == "a@b.pl"


def test_register_duplicate(client):
    payload = {"email": "a@b.pl", "password": "haslo12345"}
    assert client.post("/api/register", json=payload).status_code == 200
    assert client.post("/api/register", json=payload).status_code == 409


def test_register_weak_password(client):
    r = client.post("/api/register", json={"email": "a@b.pl", "password": "short"})
    assert r.status_code == 400


def test_register_invalid_email(client):
    r = client.post("/api/register", json={"email": "nope", "password": "haslo12345"})
    assert r.status_code == 400


def test_login_wrong_password(client):
    client.post("/api/register", json={"email": "a@b.pl", "password": "haslo12345"})
    r = client.post("/api/login", json={"email": "a@b.pl", "password": "zlehaslo1"})
    assert r.status_code == 401


def test_login_unknown_user(client):
    r = client.post("/api/login", json={"email": "x@y.pl", "password": "haslo12345"})
    assert r.status_code == 401


def test_login_and_logout(client):
    client.post("/api/register", json={"email": "a@b.pl", "password": "haslo12345"})
    assert client.post("/api/logout").status_code == 200
    assert client.get("/api/session").json()["email"] is None
    r = client.post("/api/login", json={"email": "a@b.pl", "password": "haslo12345"})
    assert r.status_code == 200
    assert client.get("/api/session").json()["email"] == "a@b.pl"


def test_login_page_renders_auth_panel(client):
    r = client.get("/login")
    assert r.status_code == 200
    html = r.text
    assert "authPanel" in html
    assert "loginForm" in html
    assert "registerForm" in html
    assert "/static/js/login.js" in html


def test_rate_limit_respects_x_forwarded_for(client, monkeypatch):
    monkeypatch.setenv("FIRE_ENV", "production")
    client.post("/api/register", json={"email": "rl@b.pl", "password": "haslo12345"})
    for _ in range(10):
        r = client.post(
            "/api/login",
            json={"email": "rl@b.pl", "password": "zle"},
            headers={"X-Forwarded-For": "10.0.0.1, 203.0.113.10"},
        )
        assert r.status_code == 401
    blocked = client.post(
        "/api/login",
        json={"email": "rl@b.pl", "password": "zle"},
        headers={"X-Forwarded-For": "10.0.0.1, 203.0.113.10"},
    )
    assert blocked.status_code == 429
    # Inny użytkownik za tym samym reverse proxy nie jest zablokowany
    other = client.post(
        "/api/login",
        json={"email": "rl@b.pl", "password": "haslo12345"},
        headers={"X-Forwarded-For": "10.0.0.1, 198.51.100.22"},
    )
    assert other.status_code == 200
