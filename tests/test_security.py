def test_security_headers(client):
    response = client.get("/")
    csp = response.headers["content-security-policy"]
    assert "script-src 'self' https://cdn.jsdelivr.net" in csp
    assert "unsafe-inline" not in csp.split("script-src", 1)[1].split(";", 1)[0]
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "geolocation=()" in response.headers["permissions-policy"]


def test_cross_origin_write_is_rejected(client):
    payload = {"stages": [], "max_age": 100}
    blocked = client.post(
        "/api/simulate",
        json=payload,
        headers={"origin": "https://evil.example", "host": "testserver"},
    )
    assert blocked.status_code == 403

    allowed = client.post(
        "/api/simulate",
        json=payload,
        headers={"origin": "http://testserver", "host": "testserver"},
    )
    assert allowed.status_code == 200
