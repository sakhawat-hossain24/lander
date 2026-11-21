#!/usr/bin/env python3
"""Bridge LearnHarness sessions to Lander understanding (read-only on LH side).

Subcommands:
  list            List LearnHarness chats found in the data folder.
  next            Print Lander's weakest lessons + a copy-paste LearnHarness goal.
  sync            Compute evidence from a LH chat, suggest a Lander %,
                  then (only with --apply) PUT understanding + log a session.

Safety:
  - LearnHarness data is READ-ONLY. This script never writes there.
  - Graph propositions are context, not mastery. Only scored probe/quiz
    answers count toward the suggestion.
  - Default is dry-run. Nothing is written unless --apply is given.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
import urllib.parse
from collections import Counter
from datetime import datetime
from pathlib import Path

DEFAULT_BASE = "http://127.0.0.1:8040"
SCORED = {"probe", "quiz"}  # recall/explain are ungraded


def lh_data_dir() -> Path:
    env = os.environ.get("LH_DATA_DIR")
    if env:
        return Path(env)
    xdg = os.environ.get("XDG_CONFIG_HOME")
    if xdg:
        return Path(xdg) / "LearnHarness" / "data"
    return Path.home() / ".config" / "LearnHarness" / "data"


def api(method: str, path: str, base: str, body: dict | None = None):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else None


def load_chat(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def scored_answers(chat: dict) -> list[dict]:
    """Return list of scored probe/quiz results (correct present)."""
    out = []
    for m in chat.get("messages", []):
        if m.get("role") != "toolResult" or m.get("toolName") not in SCORED:
            continue
        if m.get("isError"):
            continue
        det = m.get("details") or {}
        # dontKnow with no correct field -> not scored; track separately
        if "correct" not in det:
            continue
        out.append(det)
    return out


def summary(chat: dict) -> dict:
    scored = scored_answers(chat)
    total = len(scored)
    correct = sum(1 for d in scored if d.get("correct") is True)
    confs = [d["confidence"] for d in scored if isinstance(d.get("confidence"), (int, float))]
    dontknow = 0
    total_answers = 0
    for m in chat.get("messages", []):
        if m.get("role") == "toolResult" and m.get("toolName") in SCORED:
            det = m.get("details") or {}
            total_answers += 1
            if det.get("dontKnow") is True:
                dontknow += 1
    accuracy = (correct / total * 100) if total else None
    avg_conf = (sum(confs) / len(confs)) if confs else None
    return {
        "scored": total,
        "correct": correct,
        "accuracy_pct": round(accuracy, 1) if accuracy is not None else None,
        "avg_confidence": round(avg_conf, 1) if avg_conf is not None else None,
        "dontknow": dontknow,
        "total_answers": total_answers,
    }


def suggest_pct(s: dict, current: float) -> float | None:
    if s["scored"] < 3 or s["accuracy_pct"] is None:
        return None  # not enough evidence
    acc = s["accuracy_pct"]
    # Blend accuracy with current so a single short session never 0->100 overnight.
    # Weight: 60% new evidence, 40% prior.
    return round(current * 0.4 + acc * 0.6, 1)


def find_lessons(base: str) -> list[dict]:
    subjects = api("GET", "/api/subjects", base)
    found = []
    for subj in subjects:
        detail = api("GET", f"/api/subjects/{subj['id']}", base)
        for sec in detail.get("sections", []):
            for ch in sec.get("chapters", []):
                for les in ch.get("lessons", []):
                    found.append({
                        "id": les["id"],
                        "name": les["name"],
                        "understanding": les["understanding"],
                        "chapter": ch["name"],
                        "section": sec["name"],
                        "subject": subj["name"],
                        "subject_id": subj["id"],
                    })
    return found


def minutes_between(a: str | None, b: str | None) -> int:
    try:
        t0 = datetime.fromisoformat(str(a).replace("Z", "+00:00"))
        t1 = datetime.fromisoformat(str(b).replace("Z", "+00:00"))
        mins = int((t1 - t0).total_seconds() // 60)
        return max(1, min(480, mins))
    except Exception:
        return 15


def cmd_list(_args):
    root = lh_data_dir()
    chats = sorted((root / "chats").glob("*.json")) if (root / "chats").is_dir() else []
    if not chats:
        print(f"No chats in {root / 'chats'}", file=sys.stderr)
        return 1
    for p in chats:
        try:
            chat = load_chat(p)
        except Exception as exc:
            print(f"{p.stem}: unreadable ({exc})", file=sys.stderr)
            continue
        s = summary(chat)
        print(f"- {chat.get('id')}  title={chat.get('title')!r}  kind={chat.get('kind', 'teach')}")
        print(f"  updated={chat.get('updatedAt')}  scored={s['scored']}/{s['total_answers']}  "
              f"correct={s['correct']}  accuracy={s['accuracy_pct']}%  avg_conf={s['avg_confidence']}  "
              f"dontknow={s['dontknow']}")
    return 0


def cmd_next(args):
    queue = api("GET", f"/api/review-queue?limit={args.limit}", args.base)
    if not queue:
        print("Review queue is empty.")
        return 0
    print(f"Weakest {len(queue)} lesson(s) from Lander ({args.base}):")
    for i, r in enumerate(queue, 1):
        print(f"{i}. {r['subject_name']} / {r['section_name']} / {r['chapter_name']} / {r['name']} "
              f"— {r['understanding']}% ({r['reason']}), id={r['id']}")
    top = queue[0]
    prompt = (
        f"I want to understand '{top['name']}' "
        f"({top['subject_name']}, {top['chapter_name']}) for HSC-2028. "
        f"Probe what I know first, then teach step by step with predictions and checks. "
        f"My current Lander understanding is {top['understanding']}%. "
        f"Use my thinking fields to find gaps."
    )
    print("\nCopy-paste this as your LearnHarness goal:")
    print(prompt)
    return 0


def cmd_sync(args):
    root = lh_data_dir()
    if args.chat.endswith(".json") or "/" in args.chat:
        chat_path = Path(args.chat)
    else:
        chat_path = root / "chats" / f"{args.chat}.json"
    if not chat_path.is_file():
        # allow bare id without .json
        alt = root / "chats" / args.chat
        chat_path = alt if alt.is_file() else chat_path
    if not chat_path.is_file():
        print(f"Chat not found: {chat_path}", file=sys.stderr)
        print(f"Data dir: {root}", file=sys.stderr)
        return 1

    chat = load_chat(chat_path)
    s = summary(chat)
    lessons = find_lessons(args.base)

    lesson_id = args.lesson_id
    candidates = []
    if lesson_id is None:
        query = (args.lesson or chat.get("title") or "").lower().strip()
        candidates = [l for l in lessons if query and query in l["name"].lower()]
        if not candidates and query:
            candidates = [l for l in lessons if any(w in l["name"].lower() for w in query.split() if len(w) > 3)][:5]
        if not candidates:
            print("No Lander lesson matched. Use --lesson or --lesson-id. Candidates (first 5 lessons):")
            for l in lessons[:5]:
                print(f"  id={l['id']} {l['subject']} / {l['chapter']} / {l['name']} ({l['understanding']}%)")
            return 1
        if len(candidates) > 1:
            print(f"Ambiguous — {len(candidates)} matches. Re-run with --lesson-id:")
            for l in candidates:
                print(f"  id={l['id']} {l['subject']} / {l['chapter']} / {l['name']} ({l['understanding']}%)")
            return 1
        lesson_id = candidates[0]["id"]

    lesson = next((l for l in lessons if l["id"] == lesson_id), None)
    if lesson is None:
        print(f"Lesson id={lesson_id} not found on {args.base}", file=sys.stderr)
        return 1

    current = float(lesson["understanding"])
    suggested = suggest_pct(s, current)
    mins = minutes_between(chat.get("createdAt"), chat.get("updatedAt"))
    score = round((s["accuracy_pct"] / 20), 1) if s["accuracy_pct"] is not None else None

    print(f"Chat: {chat.get('id')} title={chat.get('title')!r} kind={chat.get('kind', 'teach')}")
    print(f"Lander: {lesson['subject']} / {lesson['section']} / {lesson['chapter']} / {lesson['name']}")
    print(f"Evidence: scored {s['correct']}/{s['scored']} correct "
          f"(accuracy {s['accuracy_pct']}%), avg confidence {s['avg_confidence']}, "
          f"dontKnow {s['dontknow']}/{s['total_answers']}")
    print(f"Current Lander: {current}%  Suggested: {suggested if suggested is not None else 'not enough evidence (<3 scored)'}")
    print(f"Session log would be: {mins} min, mode=learn, score={score}")

    if suggested is None:
        print("No suggestion — need at least 3 scored probe/quiz answers. Teaches: probe+quiz again, then re-run.")
        return 0

    if not args.apply:
        print("\nDry-run only. Re-run with --apply to PUT understanding and log the session.")
        return 0

    body = {"understanding": suggested}
    out = api("PUT", f"/api/lessons/{lesson_id}/understanding", args.base, body)
    print(f"Updated lesson {lesson_id}: {out}")
    sess = {"lesson_id": lesson_id, "duration_min": mins, "mode": "learn", "score": score}
    logged = api("POST", "/api/sessions", args.base, sess)
    print(f"Logged session: {logged}")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", default=os.environ.get("LANDER_URL", DEFAULT_BASE),
                   help=f"Lander base URL (default {DEFAULT_BASE})")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="List LearnHarness chats")

    pn = sub.add_parser("next", help="Weakest lessons + LearnHarness goal prompt")
    pn.add_argument("--limit", type=int, default=3)

    ps = sub.add_parser("sync", help="Suggest + (optionally apply) Lander percent from a LH chat")
    ps.add_argument("--chat", required=True, help="Chat id (e.g. chat_mw8kms9z_45a25330) or path to chat JSON.")
    ps.add_argument("--lesson", help="Lander lesson name (substring match).")
    ps.add_argument("--lesson-id", type=int, help="Lander lesson id (takes precedence).")
    ps.add_argument("--apply", action="store_true", help="Actually PUT understanding + POST session. Default dry-run.")
    args = p.parse_args(argv)
    if args.cmd == "list":
        return cmd_list(args)
    if args.cmd == "next":
        return cmd_next(args)
    return cmd_sync(args)


if __name__ == "__main__":
    raise SystemExit(main())
