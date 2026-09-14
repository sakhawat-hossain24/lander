"""Backend API tests (no live server, no browser).

Run with: .venv/bin/python -m pytest test_api.py -v
Uses an isolated tmp SQLite DB via database.DB_PATH patching.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pytest
from fastapi.testclient import TestClient

import database


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db_path = str(tmp_path / "test_lander.db")
    monkeypatch.setattr(database, "DB_PATH", db_path)
    database.init_db()
    import app as app_module
    with TestClient(app_module.app) as c:
        yield c


def _seed_hierarchy(c):
    sub = c.post("/api/subjects", json={"name": "Physics"}).json()
    sec = c.post("/api/sections", json={"subject_id": sub["id"], "name": "Part 1"}).json()
    ch = c.post("/api/chapters", json={"section_id": sec["id"], "name": "Ch 1"}).json()
    l1 = c.post("/api/lessons", json={"chapter_id": ch["id"], "name": "L1", "understanding": 20}).json()
    l2 = c.post("/api/lessons", json={"chapter_id": ch["id"], "name": "L2", "understanding": 80}).json()
    return sub, sec, ch, l1, l2


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_create_subject_and_duplicate(client):
    r = client.post("/api/subjects", json={"name": "Chemistry"})
    assert r.status_code == 201
    dup = client.post("/api/subjects", json={"name": "Chemistry"})
    assert dup.status_code == 409


def test_reject_empty_names(client):
    assert client.post("/api/subjects", json={"name": ""}).status_code == 422
    sub = client.post("/api/subjects", json={"name": "S"}).json()
    assert client.post("/api/sections", json={"subject_id": sub["id"], "name": ""}).status_code == 422


def test_understanding_cascade(client):
    sub, sec, ch, l1, l2 = _seed_hierarchy(client)
    full = client.get(f"/api/subjects/{sub['id']}").json()
    assert full["total_lessons"] == 2
    assert full["overall_average"] == pytest.approx(50.0)

    upd = client.put(f"/api/lessons/{l1['id']}/understanding", json={"understanding": 60}).json()
    assert upd["chapter_average"] == pytest.approx(70.0)
    assert upd["section_average"] == pytest.approx(70.0)
    assert upd["subject_average"] == pytest.approx(70.0)


def test_understanding_validation(client):
    _, _, _, l1, _ = _seed_hierarchy(client)
    assert client.put(f"/api/lessons/{l1['id']}/understanding", json={"understanding": 150}).status_code == 422
    assert client.put("/api/lessons/999999/understanding", json={"understanding": 10}).status_code == 404


def test_import_and_history(client):
    payload = {
        "name": "Imported",
        "sections": [
            {"name": "Sec", "chapters": [{"name": "Ch", "lessons": [{"name": "A", "understanding": 10}]}]}
        ],
    }
    r = client.post("/api/import", json=payload)
    assert r.status_code == 201
    assert r.json()["lessons"] == 1

    sub_id = r.json()["id"]
    full = client.get(f"/api/subjects/{sub_id}").json()
    lesson_id = full["sections"][0]["chapters"][0]["lessons"][0]["id"]

    client.put(f"/api/lessons/{lesson_id}/understanding", json={"understanding": 90})
    hist = client.get(f"/api/lessons/{lesson_id}/history").json()
    assert len(hist) >= 2
    assert hist[0]["value"] == pytest.approx(10.0)
    assert hist[-1]["value"] == pytest.approx(90.0)
