from app.simulation.engine import simulate
from app.simulation.schemas import SimulationInput


def valid_input(roi=0.05):
    return {
        "stages": [
            {
                "stage_type": "akumulacja",
                "name": "Akumulacja",
                "start_age": 40,
                "end_age": 50,
                "accounts": {
                    "broker": {
                        "starting_balance": 100000,
                        "roi": roi,
                        "annual_contribution": 12000,
                    }
                },
            }
        ],
        "max_age": 50,
    }


def register_and_login(client, email="a@b.pl"):
    r = client.post("/api/register", json={"email": email, "password": "haslo12345"})
    assert r.status_code == 200
    return r.json()["email"]


def save(client, name="Test", roi=0.05):
    r = client.post(
        "/api/simulations", json={"name": name, "input": valid_input(roi)}
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_save_requires_login(client):
    r = client.post("/api/simulations", json={"name": "X", "input": valid_input()})
    assert r.status_code == 401


def test_list_requires_login(client):
    assert client.get("/api/simulations").status_code == 401


def test_save_and_list(client):
    register_and_login(client)
    sim = save(client)
    assert sim["id"]
    assert sim["summary"]["start_age"] == 40
    assert sim["summary"]["end_age"] == 49
    assert sim["summary"]["years"] == 10
    lst = client.get("/api/simulations")
    assert lst.status_code == 200
    assert len(lst.json()) == 1
    assert lst.json()[0]["name"] == "Test"


def test_get_returns_input_and_result(client):
    register_and_login(client)
    sim = save(client)
    r = client.get(f"/api/simulations/{sim['id']}")
    assert r.status_code == 200
    data = r.json()
    expected = simulate(SimulationInput(**data["input"]))
    assert data["result"]["final_wealth"] == expected.final_wealth
    assert data["result"]["total_tax"] == expected.total_tax
    assert data["summary"]["years"] == len(expected.years)
    assert data["summary"]["accounts"] == expected.accounts


def test_save_invalid_input(client):
    register_and_login(client)
    bad = {
        "stages": [
            {
                "stage_type": "akumulacja",
                "name": "Akumulacja",
                "start_age": 40,
                "end_age": 50,
                "accounts": {"broker": {"roi": 0.05, "annual_contribution": 1000}},
            },
            {
                "stage_type": "realizacja",
                "name": "Zły start",
                "start_age": 30,
                "end_age": 40,
                "accounts": {"broker": {"roi": 0.02, "buffer": 0}},
            },
        ],
        "max_age": 40,
    }
    r = client.post("/api/simulations", json={"name": "Zła", "input": bad})
    assert r.status_code == 400


def test_rename(client):
    register_and_login(client)
    sim = save(client)
    r = client.patch(f"/api/simulations/{sim['id']}", json={"name": "Nowa nazwa"})
    assert r.status_code == 200
    assert r.json()["name"] == "Nowa nazwa"


def test_duplicate(client):
    register_and_login(client)
    sim = save(client)
    r = client.post(f"/api/simulations/{sim['id']}/duplicate")
    assert r.status_code == 200
    dup = r.json()
    assert dup["id"] != sim["id"]
    assert dup["name"].startswith("Kopia")
    assert len(client.get("/api/simulations").json()) == 2


def test_delete(client):
    register_and_login(client)
    sim = save(client)
    assert client.delete(f"/api/simulations/{sim['id']}").status_code == 200
    assert client.get(f"/api/simulations/{sim['id']}").status_code == 404
    assert client.get("/api/simulations").json() == []


def test_user_isolation(client):
    register_and_login(client, "a@b.pl")
    sim = save(client)
    client.post("/api/logout")
    register_and_login(client, "c@d.pl")
    assert client.get(f"/api/simulations/{sim['id']}").status_code == 404
    assert client.get("/api/simulations").json() == []


def test_compare(client):
    register_and_login(client)
    s1 = save(client, name="A", roi=0.03)
    s2 = save(client, name="B", roi=0.08)
    r = client.get(f"/api/compare?ids={s1['id']},{s2['id']}")
    assert r.status_code == 200
    items = r.json()
    assert [i["id"] for i in items] == [s1["id"], s2["id"]]
    assert items[0]["result"]["final_wealth"] < items[1]["result"]["final_wealth"]


def test_compare_missing(client):
    register_and_login(client)
    assert client.get("/api/compare?ids=999").status_code == 404


def test_compare_bad_ids(client):
    register_and_login(client)
    assert client.get("/api/compare?ids=abc").status_code == 400
    assert client.get("/api/compare?ids=1,2,3,4,5").status_code == 400


def test_summary_contains_stages(client):
    register_and_login(client)
    sim = save(client)
    stages = sim["summary"]["stages"]
    assert len(stages) == 1
    assert stages[0]["label"] == "Akumulacja"
    assert stages[0]["start_age"] == 40
    assert stages[0]["end_age"] == 50
    assert "Broker" in stages[0]["accounts"]
