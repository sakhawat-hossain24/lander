import os
import time
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, timezone
from database import get_db, init_db
from logger import get_logger

logger = get_logger("app")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Lander - Learning Progress Tracker", lifespan=lifespan)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    request_id = str(uuid.uuid4())[:8]
    request.state.request_id = request_id
    method = request.method
    path = request.url.path
    query = str(request.url.query) if request.url.query else ""
    qs = f"?{query}" if query else ""
    logger.info(">>> %s %s%s", method, path, qs, extra={"request_id": request_id})
    start = time.time()
    try:
        response = await call_next(request)
        elapsed = time.time() - start
        logger.info(
            "<<< %s %s%s -> %d (%.3fs)",
            method, path, qs, response.status_code, elapsed,
            extra={"request_id": request_id},
        )
        response.headers["X-Request-ID"] = request_id
        return response
    except HTTPException as exc:
        elapsed = time.time() - start
        logger.warning(
            "!!! %s %s%s -> %d (%.3fs): %s",
            method, path, qs, exc.status_code, elapsed, exc.detail,
            extra={"request_id": request_id},
        )
        raise
    except Exception as exc:
        elapsed = time.time() - start
        logger.exception(
            "!!! %s %s%s -> 500 (%.3fs): %s",
            method, path, qs, elapsed, exc,
            extra={"request_id": request_id},
        )
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
async def root(request: Request):
    logger.info("Serving index.html", extra={"request_id": getattr(request.state, "request_id", None)})
    return FileResponse(os.path.join(BASE_DIR, "static", "index.html"))


class SubjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


class SectionCreate(BaseModel):
    subject_id: int
    name: str = Field(..., min_length=1, max_length=200)
    sort_order: int = 0


class ChapterCreate(BaseModel):
    section_id: int
    name: str = Field(..., min_length=1, max_length=200)
    sort_order: int = 0


class LessonCreate(BaseModel):
    chapter_id: int
    name: str = Field(..., min_length=1, max_length=200)
    understanding: float = Field(default=0, ge=0, le=100)
    sort_order: int = 0


class UnderstandingUpdate(BaseModel):
    understanding: float = Field(..., ge=0, le=100)


class LessonImport(BaseModel):
    name: str
    understanding: float = 0
    sort_order: int = 0


class ChapterImport(BaseModel):
    name: str
    sort_order: int = 0
    lessons: list[LessonImport] = []


class SectionImport(BaseModel):
    name: str
    sort_order: int = 0
    chapters: list[ChapterImport] = []


class SubjectImport(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    sections: list[SectionImport] = []


@app.post("/api/import", status_code=201)
def import_subject(data: SubjectImport, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Importing subject '%s' with %d section(s)",
        data.name, len(data.sections),
        extra={"request_id": rid},
    )
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM subjects WHERE name = ?",
                                (data.name,)).fetchone()
        if existing:
            logger.warning(
                "Import conflict: subject '%s' already exists (id=%s)",
                data.name, existing["id"],
                extra={"request_id": rid},
            )
            raise HTTPException(409, f"Subject '{data.name}' already exists")
        cur = conn.execute("INSERT INTO subjects (name) VALUES (?)", (data.name,))
        subject_id = cur.lastrowid
        logger.info(
            "Created subject id=%d name='%s'",
            subject_id, data.name,
            extra={"request_id": rid},
        )
        for si, section in enumerate(data.sections):
            cur = conn.execute(
                "INSERT INTO sections (subject_id, name, sort_order) VALUES (?, ?, ?)",
                (subject_id, section.name, si))
            section_id = cur.lastrowid
            for ci, chapter in enumerate(section.chapters):
                cur = conn.execute(
                    "INSERT INTO chapters (section_id, name, sort_order) VALUES (?, ?, ?)",
                    (section_id, chapter.name, ci))
                chapter_id = cur.lastrowid
                for li, lesson in enumerate(chapter.lessons):
                    conn.execute(
                        "INSERT INTO lessons (chapter_id, name, understanding, sort_order) "
                        "VALUES (?, ?, ?, ?)",
                        (chapter_id, lesson.name, lesson.understanding, li))
        lesson_count = sum(len(l.lessons) for s in data.sections for l in s.chapters)
        logger.info(
            "Import complete: subject=%s sections=%d chapters=%d lessons=%d",
            data.name, len(data.sections),
            sum(len(s.chapters) for s in data.sections),
            lesson_count,
            extra={"request_id": rid},
        )
        return {
            "id": subject_id,
            "name": data.name,
            "sections": len(data.sections),
            "chapters": sum(len(s.chapters) for s in data.sections),
            "lessons": lesson_count,
        }


@app.get("/api/subjects")
def list_subjects(request: Request):
    rid = getattr(request.state, "request_id", None)
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM subjects ORDER BY id").fetchall()
        result = [dict(r) for r in rows]
        logger.info(
            "Listed %d subject(s)", len(result),
            extra={"request_id": rid},
        )
        return result


@app.post("/api/subjects", status_code=201)
def create_subject(data: SubjectCreate, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info("Creating subject '%s'", data.name, extra={"request_id": rid})
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM subjects WHERE name = ?",
                                (data.name,)).fetchone()
        if existing:
            logger.warning(
                "Subject '%s' already exists (id=%s)", data.name, existing["id"],
                extra={"request_id": rid},
            )
            raise HTTPException(409, f"Subject '{data.name}' already exists")
        cur = conn.execute("INSERT INTO subjects (name) VALUES (?)", (data.name,))
        subject_id = cur.lastrowid
        logger.info(
            "Created subject id=%d name='%s'", subject_id, data.name,
            extra={"request_id": rid},
        )
        return {"id": subject_id, "name": data.name}


@app.get("/api/subjects/{subject_id}")
def get_subject(subject_id: int, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Fetching subject id=%d", subject_id,
        extra={"request_id": rid},
    )
    with get_db() as conn:
        subject = conn.execute("SELECT * FROM subjects WHERE id = ?",
                               (subject_id,)).fetchone()
        if not subject:
            logger.warning(
                "Subject id=%d not found", subject_id,
                extra={"request_id": rid},
            )
            raise HTTPException(404, "Subject not found")

        result = dict(subject)

        sections = conn.execute("""
            SELECT s.*,
                   COUNT(l.id) AS lesson_count,
                   COALESCE(AVG(l.understanding), 0) AS average
            FROM sections s
            LEFT JOIN chapters c ON c.section_id = s.id
            LEFT JOIN lessons l ON l.chapter_id = c.id
            WHERE s.subject_id = ?
            GROUP BY s.id
            ORDER BY s.sort_order
        """, (subject_id,)).fetchall()

        result["sections"] = []
        for section in sections:
            s = dict(section)

            chapters = conn.execute("""
                SELECT c.*,
                       COUNT(l.id) AS lesson_count,
                       COALESCE(AVG(l.understanding), 0) AS average
                FROM chapters c
                LEFT JOIN lessons l ON l.chapter_id = c.id
                WHERE c.section_id = ?
                GROUP BY c.id
                ORDER BY c.sort_order
            """, (s["id"],)).fetchall()

            s["chapters"] = []
            for chapter in chapters:
                ch = dict(chapter)
                lessons = conn.execute("""
                    SELECT id, name, understanding, sort_order
                    FROM lessons
                    WHERE chapter_id = ?
                    ORDER BY sort_order
                """, (ch["id"],)).fetchall()
                ch["lessons"] = [dict(l) for l in lessons]
                s["chapters"].append(ch)

            result["sections"].append(s)

        overall = conn.execute("""
            SELECT COUNT(l.id) AS total_lessons,
                   COALESCE(AVG(l.understanding), 0) AS overall_average
            FROM subjects sub
            JOIN sections s ON s.subject_id = sub.id
            JOIN chapters c ON c.section_id = s.id
            JOIN lessons l ON l.chapter_id = c.id
            WHERE sub.id = ?
        """, (subject_id,)).fetchone()

        result["total_lessons"] = overall["total_lessons"]
        result["overall_average"] = round(overall["overall_average"], 2)

        logger.info(
            "Returning subject id=%d name='%s': %d sections, %d lessons, avg=%.1f%%",
            subject_id, result["name"],
            len(result["sections"]), result["total_lessons"],
            result["overall_average"],
            extra={"request_id": rid},
        )

        return result


@app.delete("/api/subjects/{subject_id}", status_code=204)
def delete_subject(subject_id: int, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Deleting subject id=%d", subject_id,
        extra={"request_id": rid},
    )
    with get_db() as conn:
        cur = conn.execute("DELETE FROM subjects WHERE id = ?", (subject_id,))
        if cur.rowcount == 0:
            logger.warning(
                "Subject id=%d not found for deletion", subject_id,
                extra={"request_id": rid},
            )
            raise HTTPException(404, "Subject not found")
        logger.info(
            "Deleted subject id=%d", subject_id,
            extra={"request_id": rid},
        )


@app.delete("/api/sections/{section_id}", status_code=204)
def delete_section(section_id: int, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Deleting section id=%d", section_id,
        extra={"request_id": rid},
    )
    with get_db() as conn:
        cur = conn.execute("DELETE FROM sections WHERE id = ?", (section_id,))
        if cur.rowcount == 0:
            logger.warning(
                "Section id=%d not found for deletion", section_id,
                extra={"request_id": rid},
            )
            raise HTTPException(404, "Section not found")
        logger.info(
            "Deleted section id=%d", section_id,
            extra={"request_id": rid},
        )


@app.delete("/api/chapters/{chapter_id}", status_code=204)
def delete_chapter(chapter_id: int, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Deleting chapter id=%d", chapter_id,
        extra={"request_id": rid},
    )
    with get_db() as conn:
        cur = conn.execute("DELETE FROM chapters WHERE id = ?", (chapter_id,))
        if cur.rowcount == 0:
            logger.warning(
                "Chapter id=%d not found for deletion", chapter_id,
                extra={"request_id": rid},
            )
            raise HTTPException(404, "Chapter not found")
        logger.info(
            "Deleted chapter id=%d", chapter_id,
            extra={"request_id": rid},
        )


@app.delete("/api/lessons/{lesson_id}", status_code=204)
def delete_lesson(lesson_id: int, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Deleting lesson id=%d", lesson_id,
        extra={"request_id": rid},
    )
    with get_db() as conn:
        cur = conn.execute("DELETE FROM lessons WHERE id = ?", (lesson_id,))
        if cur.rowcount == 0:
            logger.warning(
                "Lesson id=%d not found for deletion", lesson_id,
                extra={"request_id": rid},
            )
            raise HTTPException(404, "Lesson not found")
        logger.info(
            "Deleted lesson id=%d", lesson_id,
            extra={"request_id": rid},
        )


@app.post("/api/sections", status_code=201)
def create_section(data: SectionCreate, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Creating section name='%s' for subject id=%d",
        data.name, data.subject_id,
        extra={"request_id": rid},
    )
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO sections (subject_id, name, sort_order) VALUES (?, ?, ?)",
            (data.subject_id, data.name, data.sort_order))
        section_id = cur.lastrowid
        logger.info(
            "Created section id=%d name='%s' for subject id=%d",
            section_id, data.name, data.subject_id,
            extra={"request_id": rid},
        )
        return {"id": section_id}


@app.post("/api/chapters", status_code=201)
def create_chapter(data: ChapterCreate, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Creating chapter name='%s' for section id=%d",
        data.name, data.section_id,
        extra={"request_id": rid},
    )
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO chapters (section_id, name, sort_order) VALUES (?, ?, ?)",
            (data.section_id, data.name, data.sort_order))
        chapter_id = cur.lastrowid
        logger.info(
            "Created chapter id=%d name='%s' for section id=%d",
            chapter_id, data.name, data.section_id,
            extra={"request_id": rid},
        )
        return {"id": chapter_id}


@app.post("/api/lessons", status_code=201)
def create_lesson(data: LessonCreate, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Creating lesson name='%s' for chapter id=%d (understanding=%.1f%%)",
        data.name, data.chapter_id, data.understanding,
        extra={"request_id": rid},
    )
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO lessons (chapter_id, name, understanding, sort_order) VALUES (?, ?, ?, ?)",
            (data.chapter_id, data.name, data.understanding, data.sort_order))
        lesson_id = cur.lastrowid
        logger.info(
            "Created lesson id=%d name='%s' for chapter id=%d",
            lesson_id, data.name, data.chapter_id,
            extra={"request_id": rid},
        )
        return {"id": lesson_id}


@app.put("/api/lessons/{lesson_id}/understanding")
def update_understanding(lesson_id: int, data: UnderstandingUpdate, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Updating understanding for lesson id=%d: new=%.1f%%",
        lesson_id, data.understanding,
        extra={"request_id": rid},
    )
    with get_db() as conn:
        lesson = conn.execute("SELECT * FROM lessons WHERE id = ?",
                              (lesson_id,)).fetchone()
        if not lesson:
            logger.warning(
                "Lesson id=%d not found for understanding update", lesson_id,
                extra={"request_id": rid},
            )
            raise HTTPException(404, "Lesson not found")

        old_value = lesson["understanding"]
        new_value = data.understanding

        if old_value == new_value:
            logger.info(
                "Lesson id=%d understanding unchanged (%.1f%%)",
                lesson_id, old_value,
                extra={"request_id": rid},
            )
            return {"id": lesson_id, "understanding": new_value}

        conn.execute(
            "UPDATE lessons SET understanding = ?, updated_at = datetime('now') WHERE id = ?",
            (new_value, lesson_id))

        conn.execute(
            "INSERT INTO lesson_history (lesson_id, old_value, new_value) VALUES (?, ?, ?)",
            (lesson_id, old_value, new_value))
        logger.info(
            "Lesson id=%d understanding: %.1f%% -> %.1f%% (delta=%+.1f%%)",
            lesson_id, old_value, new_value, new_value - old_value,
            extra={"request_id": rid},
        )

        chapter_id = lesson["chapter_id"]

        conn.execute(
            "UPDATE chapters SET updated_at = datetime('now') WHERE id = ?",
            (chapter_id,))

        chapter_avg = conn.execute(
            "SELECT COALESCE(AVG(understanding), 0) AS avg FROM lessons WHERE chapter_id = ?",
            (chapter_id,)).fetchone()["avg"]

        section_id = conn.execute(
            "SELECT section_id FROM chapters WHERE id = ?",
            (chapter_id,)).fetchone()["section_id"]

        section_avg = conn.execute(
            "SELECT COALESCE(AVG(l.understanding), 0) AS avg FROM lessons l "
            "JOIN chapters c ON l.chapter_id = c.id WHERE c.section_id = ?",
            (section_id,)).fetchone()["avg"]

        subject_id = conn.execute(
            "SELECT subject_id FROM sections WHERE id = ?",
            (section_id,)).fetchone()["subject_id"]

        subject_avg = conn.execute(
            "SELECT COALESCE(AVG(l.understanding), 0) AS avg FROM lessons l "
            "JOIN chapters c ON l.chapter_id = c.id "
            "JOIN sections s ON c.section_id = s.id WHERE s.subject_id = ?",
            (subject_id,)).fetchone()["avg"]

        logger.info(
            "Cascade averages after lesson id=%d update: chapter=%.1f%% section=%.1f%% subject=%.1f%%",
            lesson_id, chapter_avg, section_avg, subject_avg,
            extra={"request_id": rid},
        )

        return {
            "id": lesson_id,
            "understanding": new_value,
            "old_value": old_value,
            "chapter_id": chapter_id,
            "chapter_average": round(chapter_avg, 2),
            "section_id": section_id,
            "section_average": round(section_avg, 2),
            "subject_id": subject_id,
            "subject_average": round(subject_avg, 2),
        }


@app.get("/api/lessons/{lesson_id}/history")
def get_lesson_history(lesson_id: int, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Fetching history for lesson id=%d", lesson_id,
        extra={"request_id": rid},
    )
    with get_db() as conn:
        lesson = conn.execute("SELECT understanding FROM lessons WHERE id = ?",
                              (lesson_id,)).fetchone()
        if not lesson:
            logger.warning(
                "Lesson id=%d not found for history", lesson_id,
                extra={"request_id": rid},
            )
            raise HTTPException(404, "Lesson not found")

        history = conn.execute("""
            SELECT old_value, new_value, timestamp
            FROM lesson_history
            WHERE lesson_id = ?
            ORDER BY timestamp ASC
        """, (lesson_id,)).fetchall()

        if history:
            points = [{"value": history[0]["old_value"],
                       "timestamp": history[0]["timestamp"]}]
            for h in history:
                points.append({"value": h["new_value"],
                               "timestamp": h["timestamp"]})
        else:
            points = [{"value": lesson["understanding"],
                       "timestamp": "now"}]

        logger.info(
            "Returning %d history point(s) for lesson id=%d",
            len(points), lesson_id,
            extra={"request_id": rid},
        )

        return points


def _compute_aggregate_history(conn, lesson_ids):
    if not lesson_ids:
        return []

    placeholders = ",".join("?" * len(lesson_ids))

    current = {}
    for lid in lesson_ids:
        first = conn.execute("""
            SELECT old_value FROM lesson_history
            WHERE lesson_id = ? ORDER BY timestamp ASC LIMIT 1
        """, (lid,)).fetchone()
        if first:
            current[lid] = first["old_value"]
        else:
            cur = conn.execute(
                "SELECT understanding FROM lessons WHERE id = ?",
                (lid,)).fetchone()
            current[lid] = cur["understanding"] if cur else 0

    history = conn.execute(f"""
        SELECT lesson_id, new_value, timestamp
        FROM lesson_history
        WHERE lesson_id IN ({placeholders})
        ORDER BY timestamp ASC
    """, lesson_ids).fetchall()

    if not history:
        avg = sum(current.values()) / len(current) if current else 0
        return [{"value": round(avg, 2), "timestamp": "now"}]

    points = []
    for entry in history:
        current[entry["lesson_id"]] = entry["new_value"]
        avg = sum(current.values()) / len(current) if current else 0
        points.append({"value": round(avg, 2), "timestamp": entry["timestamp"]})

    return points


@app.get("/api/chapters/{chapter_id}/history")
def get_chapter_history(chapter_id: int, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Fetching aggregate history for chapter id=%d", chapter_id,
        extra={"request_id": rid},
    )
    with get_db() as conn:
        lesson_ids = [
            r["id"] for r in conn.execute(
                "SELECT id FROM lessons WHERE chapter_id = ? ORDER BY sort_order",
                (chapter_id,)).fetchall()
        ]
        points = _compute_aggregate_history(conn, lesson_ids)
        logger.info(
            "Returning %d aggregate history point(s) for chapter id=%d",
            len(points), chapter_id,
            extra={"request_id": rid},
        )
        return points


@app.get("/api/sections/{section_id}/history")
def get_section_history(section_id: int, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Fetching aggregate history for section id=%d", section_id,
        extra={"request_id": rid},
    )
    with get_db() as conn:
        lesson_ids = [
            r["id"] for r in conn.execute(
                "SELECT l.id FROM lessons l "
                "JOIN chapters c ON l.chapter_id = c.id "
                "WHERE c.section_id = ? ORDER BY l.sort_order",
                (section_id,)).fetchall()
        ]
        points = _compute_aggregate_history(conn, lesson_ids)
        logger.info(
            "Returning %d aggregate history point(s) for section id=%d",
            len(points), section_id,
            extra={"request_id": rid},
        )
        return points


@app.get("/api/subjects/{subject_id}/history")
def get_subject_history(subject_id: int, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Fetching aggregate history for subject id=%d", subject_id,
        extra={"request_id": rid},
    )
    with get_db() as conn:
        lesson_ids = [
            r["id"] for r in conn.execute(
                "SELECT l.id FROM lessons l "
                "JOIN chapters c ON l.chapter_id = c.id "
                "JOIN sections s ON c.section_id = s.id "
                "WHERE s.subject_id = ? ORDER BY l.sort_order",
                (subject_id,)).fetchall()
        ]
        points = _compute_aggregate_history(conn, lesson_ids)
        logger.info(
            "Returning %d aggregate history point(s) for subject id=%d",
            len(points), subject_id,
            extra={"request_id": rid},
        )
        return points


class SessionCreate(BaseModel):
    lesson_id: int
    duration_min: int = Field(default=15, ge=1, le=480)
    mode: str = Field(default="review", pattern="^(learn|recall|apply|review)$")
    score: Optional[float] = Field(default=None, ge=0, le=5)


def _reason_for_lesson(understanding: float, session_count: int, last_activity: Optional[str]) -> str:
    if understanding < 50:
        return "weak"
    if session_count == 0:
        return "unstarted"
    if last_activity:
        try:
            ts = last_activity.replace("Z", "")
            # SQLite datetime('now') -> "YYYY-MM-DD HH:MM:SS"
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
                try:
                    dt = datetime.strptime(ts[:19], fmt[:19] if len(fmt) > 19 else fmt)
                    break
                except ValueError:
                    continue
            else:
                return "review due"
            age_days = (datetime.now(timezone.utc).replace(tzinfo=None) - dt).days
            if age_days > 14:
                return "stalled"
        except Exception:
            pass
    return "review due"


@app.post("/api/sessions", status_code=201)
def create_session(data: SessionCreate, request: Request):
    rid = getattr(request.state, "request_id", None)
    logger.info(
        "Logging session lesson_id=%d %dmin %s",
        data.lesson_id, data.duration_min, data.mode,
        extra={"request_id": rid},
    )
    with get_db() as conn:
        lesson = conn.execute("SELECT id FROM lessons WHERE id = ?",
                              (data.lesson_id,)).fetchone()
        if not lesson:
            raise HTTPException(404, "Lesson not found")
        cur = conn.execute(
            "INSERT INTO sessions (lesson_id, duration_min, mode, score) VALUES (?, ?, ?, ?)",
            (data.lesson_id, data.duration_min, data.mode, data.score))
        session_id = cur.lastrowid
        conn.execute(
            "UPDATE lessons SET updated_at = datetime('now') WHERE id = ?",
            (data.lesson_id,))
        row = conn.execute("SELECT * FROM sessions WHERE id = ?",
                           (session_id,)).fetchone()
        return dict(row)


@app.get("/api/lessons/{lesson_id}/sessions")
def list_lesson_sessions(lesson_id: int, request: Request):
    with get_db() as conn:
        lesson = conn.execute("SELECT id FROM lessons WHERE id = ?",
                              (lesson_id,)).fetchone()
        if not lesson:
            raise HTTPException(404, "Lesson not found")
        rows = conn.execute(
            "SELECT * FROM sessions WHERE lesson_id = ? ORDER BY created_at DESC",
            (lesson_id,)).fetchall()
        total = conn.execute(
            "SELECT COALESCE(SUM(duration_min), 0) AS total FROM sessions WHERE lesson_id = ?",
            (lesson_id,)).fetchone()["total"]
        return {"sessions": [dict(r) for r in rows], "total_minutes": total,
                "count": len(rows)}


@app.get("/api/review-queue")
def get_review_queue(
    request: Request,
    subject_id: Optional[int] = Query(default=None),
    limit: int = Query(default=10, ge=1, le=100),
):
    rid = getattr(request.state, "request_id", None)
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT l.id, l.name, l.understanding, l.updated_at,
                   c.name AS chapter_name, s.name AS section_name,
                   sub.id AS subject_id, sub.name AS subject_name,
                   COALESCE(SUM(sess.duration_min), 0) AS total_minutes,
                   COUNT(sess.id) AS session_count,
                   MAX(sess.created_at) AS last_session_at
            FROM lessons l
            JOIN chapters c ON l.chapter_id = c.id
            JOIN sections s ON c.section_id = s.id
            JOIN subjects sub ON s.subject_id = sub.id
            LEFT JOIN sessions sess ON sess.lesson_id = l.id
            WHERE (? IS NULL OR sub.id = ?)
            GROUP BY l.id
            ORDER BY l.understanding ASC, last_session_at ASC, l.updated_at ASC
            LIMIT ?
            """,
            (subject_id, subject_id, limit)).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            last_activity = d["last_session_at"] or d["updated_at"]
            d["last_activity"] = last_activity
            d["reason"] = _reason_for_lesson(
                float(d["understanding"]), int(d["session_count"]), last_activity)
            result.append(d)
        logger.info(
            "Returning review queue: %d item(s) subject_id=%s",
            len(result), subject_id,
            extra={"request_id": rid},
        )
        return result
