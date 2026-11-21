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


def test_log_session_and_totals(client):
    _, _, _, l1, _ = _seed_hierarchy(client)
    r = client.post("/api/sessions", json={"lesson_id": l1["id"], "duration_min": 25, "mode": "recall", "score": 4})
    assert r.status_code == 201
    assert r.json()["duration_min"] == 25

    lst = client.get(f"/api/lessons/{l1['id']}/sessions").json()
    assert lst["count"] == 1
    assert lst["total_minutes"] == 25

    bad = client.post("/api/sessions", json={"lesson_id": 999999, "duration_min": 10})
    assert bad.status_code == 404
    bad_mode = client.post("/api/sessions", json={"lesson_id": l1["id"], "duration_min": 10, "mode": "nap"})
    assert bad_mode.status_code == 422


def test_review_queue_orders_weak_first(client):
    sub, _, _, l1, l2 = _seed_hierarchy(client)
    # l1=20% weak, l2=80% strong
    q = client.get(f"/api/review-queue?subject_id={sub['id']}&limit=10").json()
    assert len(q) == 2
    assert q[0]["id"] == l1["id"]
    assert q[0]["reason"] == "weak"
    assert "total_minutes" in q[0]

    # logging a session keeps weak lesson first but adds evidence
    client.post("/api/sessions", json={"lesson_id": l1["id"], "duration_min": 15, "mode": "learn"})
    q2 = client.get(f"/api/review-queue?subject_id={sub['id']}").json()
    assert q2[0]["id"] == l1["id"]
    assert q2[0]["session_count"] == 1


def test_rename_subject_section_chapter_lesson(client):
    sub, sec, ch, l1, _ = _seed_hierarchy(client)

    r = client.put(f"/api/subjects/{sub['id']}", json={"name": "Renamed Sub"})
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed Sub"

    r = client.put(f"/api/sections/{sec['id']}", json={"name": "Renamed Sec"})
    assert r.status_code == 200

    r = client.put(f"/api/chapters/{ch['id']}", json={"name": "Renamed Ch"})
    assert r.status_code == 200

    r = client.put(f"/api/lessons/{l1['id']}", json={"name": "Renamed Lesson"})
    assert r.status_code == 200

    full = client.get(f"/api/subjects/{sub['id']}").json()
    assert full["name"] == "Renamed Sub"
    assert full["sections"][0]["name"] == "Renamed Sec"
    assert full["sections"][0]["chapters"][0]["name"] == "Renamed Ch"
    assert full["sections"][0]["chapters"][0]["lessons"][0]["name"] == "Renamed Lesson"


def test_rename_validation(client):
    sub, _, _, l1, _ = _seed_hierarchy(client)
    assert client.put(f"/api/subjects/{sub['id']}", json={"name": ""}).status_code == 422
    assert client.put("/api/subjects/999999", json={"name": "X"}).status_code == 404
    assert client.put("/api/sections/999999", json={"name": "X"}).status_code == 404
    assert client.put("/api/chapters/999999", json={"name": "X"}).status_code == 404
    assert client.put(f"/api/lessons/{l1['id']}", json={"name": ""}).status_code == 422
    assert client.put("/api/lessons/999999", json={"name": "X"}).status_code == 404

    client.post("/api/subjects", json={"name": "Other"})
    assert client.put(f"/api/subjects/{sub['id']}", json={"name": "Other"}).status_code == 409


def test_delete_cascade(client):
    sub, sec, ch, l1, _ = _seed_hierarchy(client)
    assert client.delete(f"/api/lessons/{l1['id']}").status_code == 204
    full = client.get(f"/api/subjects/{sub['id']}").json()
    assert full["total_lessons"] == 1

    assert client.delete(f"/api/chapters/{ch['id']}").status_code == 204
    full = client.get(f"/api/subjects/{sub['id']}").json()
    assert full["total_lessons"] == 0

    assert client.delete(f"/api/sections/{sec['id']}").status_code == 204
    assert client.delete(f"/api/sections/999999").status_code == 404
    assert client.delete(f"/api/chapters/999999").status_code == 404
    assert client.delete(f"/api/lessons/999999").status_code == 404
