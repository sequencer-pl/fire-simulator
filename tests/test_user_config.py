def test_user_config_persists_preset_baseline_and_overrides(client):
    registered = client.post(
        "/api/register",
        json={"email": "config@example.com", "password": "haslo12345"},
    )
    assert registered.status_code == 200
    config = client.get("/api/config").json()
    baseline = {**config, "inflation": 0.025}
    current = {**baseline, "inflation": 0.03}
    payload = {
        "config": current,
        "baseline": baseline,
        "preset_id": None,
        "preset_name": "Domyślne 2026",
        "overrides": ["inflation"],
    }

    saved = client.put("/api/config/user", json=payload)

    assert saved.status_code == 200
    assert client.get("/api/config/user").json() == payload


def test_legacy_user_config_is_returned_as_custom_config(client):
    registered = client.post(
        "/api/register",
        json={"email": "legacy@example.com", "password": "haslo12345"},
    )
    assert registered.status_code == 200
    config = client.get("/api/config").json()

    assert client.put("/api/config/user", json=config).status_code == 200
    loaded = client.get("/api/config/user").json()

    assert loaded["config"] == config
    assert loaded["baseline"] is None
    assert loaded["preset_name"] == "Własna konfiguracja"
    assert loaded["overrides"] == []
