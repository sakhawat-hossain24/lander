import os
import sqlite3
from contextlib import contextmanager

from logger import get_logger

logger = get_logger("database")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Canonical DB filename is lander.db (matches README + project name).
# Overridable via LANDER_DB_PATH for tests / Docker volumes.
DB_PATH = os.getenv("LANDER_DB_PATH", os.path.join(BASE_DIR, "lander.db"))


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        logger.info("DB connection opened", extra={"db_path": DB_PATH})
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    logger.info("Initializing database schema...")
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS subjects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS sections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS chapters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                understanding REAL NOT NULL DEFAULT 0 CHECK(understanding >= 0 AND understanding <= 100),
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS lesson_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
                old_value REAL NOT NULL,
                new_value REAL NOT NULL,
                timestamp TEXT DEFAULT (datetime('now'))
            );
        """)
    logger.info("Database schema initialized successfully")
