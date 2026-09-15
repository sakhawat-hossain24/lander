#!/usr/bin/env python3
"""
One-time CLI import script for Markdown study data.

Usage:
    python import_markdown.py path/to/study.md [--subject "Chemistry"]

Expected Markdown format:
    ## Section Name
    ### Chapter Name
    |Lesson|Understanding|
    |---|---|
    |Lesson name|<span style="color:...">XX%</span>|
    |**Chapter average ...**|**...**|
    **Section average ...**
"""

import argparse
import re
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import get_db, init_db
from logger import get_logger

logger = get_logger("import")


def parse_markdown(filepath):
    logger.info("Parsing markdown file", extra={"filepath": filepath})
    with open(filepath, "r", encoding="utf-8") as f:
        text = f.read()

    sections = []
    current_section = None
    current_chapter = None

    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue

        sec_match = re.match(r"^##\s+(.+?)(?:\s*\*{2,})?\s*$", line)
        if sec_match and not line.startswith("###"):
            name = sec_match.group(1).strip()
            current_section = {"name": name, "chapters": []}
            sections.append(current_section)
            current_chapter = None
            continue

        ch_match = re.match(r"^###\s+(.+?)(?:\s*\*{2,})?\s*$", line)
        if ch_match:
            name = ch_match.group(1).strip()
            if current_section is None:
                current_section = {"name": "Default", "chapters": []}
                sections.append(current_section)
            current_chapter = {"name": name, "lessons": []}
            current_section["chapters"].append(current_chapter)
            continue

        if not line.startswith("|"):
            continue

        cells = [c.strip() for c in line.split("|") if c.strip()]
        if len(cells) < 2:
            continue

        if cells[0].startswith("**") or "average" in cells[0].lower():
            continue

        if cells[0].lower() in ("lesson", "lesson name"):
            continue

        if re.match(r"^-+\s*$", cells[0]):
            continue

        if current_chapter is None:
            continue

        pct_match = re.search(r"(\d+(?:\.\d+)?)\s*%", cells[-1])
        if not pct_match:
            continue

        lesson_name = cells[0]
        understanding = float(pct_match.group(1))
        current_chapter["lessons"].append({
            "name": lesson_name,
            "understanding": understanding
        })

    logger.info(
        "Parsed %d section(s), %d chapter(s), %d lesson(s)",
        len(sections),
        sum(len(s["chapters"]) for s in sections),
        sum(len(l) for s in sections for l in (c["lessons"] for c in s["chapters"])),
        extra={"filepath": filepath},
    )

    return sections


def import_to_db(subject_name, sections):
    init_db()
    with get_db() as conn:
        cur = conn.execute("INSERT INTO subjects (name) VALUES (?)",
                           (subject_name,))
        subject_id = cur.lastrowid
        logger.info("Created subject", extra={"subject_id": subject_id, "subject_name": subject_name})

        total_lessons = 0
        for si, section in enumerate(sections):
            cur = conn.execute(
                "INSERT INTO sections (subject_id, name, sort_order) VALUES (?, ?, ?)",
                (subject_id, section["name"], si))
            section_id = cur.lastrowid

            for ci, chapter in enumerate(section.get("chapters", [])):
                cur = conn.execute(
                    "INSERT INTO chapters (section_id, name, sort_order) VALUES (?, ?, ?)",
                    (section_id, chapter["name"], ci))
                chapter_id = cur.lastrowid

                for li, lesson in enumerate(chapter.get("lessons", [])):
                    conn.execute(
                        "INSERT INTO lessons (chapter_id, name, understanding, sort_order) "
                        "VALUES (?, ?, ?, ?)",
                        (chapter_id, lesson["name"],
                         lesson["understanding"], li))
                    total_lessons += 1

        sections_count = len(sections)
        chapters_count = sum(len(s["chapters"]) for s in sections)

        logger.info(
            "Import complete: %d section(s), %d chapter(s), %d lesson(s)",
            sections_count, chapters_count, total_lessons,
            extra={"subject_id": subject_id},
        )

        return {
            "subject_id": subject_id,
            "sections": sections_count,
            "chapters": chapters_count,
            "lessons": total_lessons,
        }


def main():
    parser = argparse.ArgumentParser(
        description="Import study data from a Markdown file into the study tracker database.")
    parser.add_argument("file", help="Path to the Markdown file")
    parser.add_argument("--subject", default="Chemistry",
                        help="Subject name (default: Chemistry)")
    args = parser.parse_args()

    logger.info("Starting import", extra={"file": args.file, "subject": args.subject})

    if not os.path.exists(args.file):
        logger.error("File not found", extra={"filepath": args.file})
        print(f"Error: file not found: {args.file}", file=sys.stderr)
        sys.exit(1)

    print(f"Parsing {args.file}...")
    sections = parse_markdown(args.file)
    print(f"Found {len(sections)} section(s), "
          f"{sum(len(s['chapters']) for s in sections)} chapter(s).")

    print(f"Importing as subject '{args.subject}'...")
    stats = import_to_db(args.subject, sections)
    print(f"Done! Imported {stats['lessons']} lessons across "
          f"{stats['chapters']} chapters in {stats['sections']} sections "
          f"(subject id: {stats['subject_id']}).")

    logger.info("Import completed successfully", extra={"stats": stats})


if __name__ == "__main__":
    main()
