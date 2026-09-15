# Examples

Sample data for trying out Lander's importers.

| File | Format | Use |
|---|---|---|
| `physics.md` | Markdown (`## Section`, `### Chapter`, `\|Lesson\|Understanding\|` tables) | CLI: `python import_markdown.py examples/physics.md --subject "Physics"` |
| `physics.json` | `SubjectImport` JSON (`name` + `sections`) | API: `POST /api/import` with this file as the JSON body |

Both files describe the same Physics subject, so import only one of them
(or import under different subject names).
