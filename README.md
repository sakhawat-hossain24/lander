# Lander

A beautifully designed, self-hosted web application for tracking learning progress across hierarchical subjects. Replaces manual Markdown-based tracking with an elegant, live-updating interface featuring color-coded understanding metrics, automatic averages, and detailed change history visualization.

**Lander** makes learning progress tracking intuitive and visually engaging, with a polished interface that helps you ground your understanding of complex subjects.

## Features

- **Hierarchical tracking**: Organize learning by subjects, sections, chapters, and individual lessons
- **Visual progress metrics**: Color-coded understanding percentages that update in real-time
- **Automatic averaging**: Instantly see aggregated progress across all levels
- **Change history**: Beautiful charts tracking your learning journey over time
- **Study sessions**: Log learn/recall/apply/review sessions per lesson with time and scores
- **Review queue**: Surface weakest and stalest topics first via `GET /api/review-queue`
- **Markdown import**: Bulk import existing study data from Markdown files
- **Responsive design**: Perfectly scales from desktop to mobile devices
- **Elegant UI**: Modern, polished interface with smooth animations and intuitive interactions

## Setup & Run

```bash
# Install dependencies
pip install -r requirements.txt

# Start the server
python -m uvicorn app:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000 in your browser.

### Docker

Builds from the `Dockerfile` in this repo:

```bash
docker build -t lander .
mkdir -p data
docker run -p 8000:8000 -v $(pwd)/data:/app/data -e LANDER_DB_PATH=/app/data/lander.db lander
```

Or with compose (persists the DB in a named volume):

```bash
docker compose up --build
```

## Data Management

### Import Existing Data

#### CLI import (one-time)
```bash
python import_markdown.py examples/physics.md --subject "Physics"
```

#### In-app import
Click the **Import** button in the top-right corner of the dashboard and paste your Markdown table content directly into the text area.

The importer expects:
- `## Section Name` for sections (e.g. `## Part 1`)
- `### Chapter Name` for chapters (e.g. `### Chapter 1: Advanced Topics`)
- Pipe-delimited tables with lesson name and percentage (e.g. `|Lesson|Understanding|`)

### Export
Currently, data is stored in a SQLite database at `lander.db`. You can backup this file to preserve your data.

## Data Model

```
Subject
├── Section
│   └── Chapter
│       └── Lesson (with understanding %)
```

Each level automatically calculates averages from its children. Understanding percentages range from 0-100% and are displayed with color coding to visualize progress at a glance.

## Development

### Project Structure

```
lander/
├── app.py                 # FastAPI backend
├── database.py            # SQLite database setup & queries
├── logger.py              # Structured request logging
├── import_markdown.py     # Markdown import utility
├── static/
│   ├── index.html        # Application shell
│   ├── style.css         # Modern, responsive styling
│   └── app.js            # Interactive frontend logic
├── examples/
│   ├── physics.md        # Sample Markdown import
│   └── physics.json      # Sample JSON import (POST /api/import)
├── test_api.py            # Backend API tests
├── test_lander.py         # Playwright UI tests (needs live server)
├── Dockerfile             # Production image
├── docker-compose.yml     # One-command self-host
├── requirements.txt       # Runtime dependencies
└── requirements-dev.txt   # Test dependencies
```

### Technology Stack

- **Backend**: FastAPI + SQLite
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Charts**: Chart.js for visualization
- **Styling**: CSS3 with design tokens and responsive grid layout

### Build & Test

```bash
# Run with auto-reload during development
python -m uvicorn app:app --reload

# Run backend tests
python -m pytest test_api.py -v

# UI tests need a live server + browser; see test_lander.py
```

## Roadmap

- [ ] Dark mode toggle
- [ ] Keyboard shortcuts
- [ ] Collaborative features
- [ ] Mobile app
- [ ] Custom color themes
- [ ] Export to PDF

## Configuration

Copy `.env.example` to `.env` to override defaults:

| Variable | Default | Purpose |
|---|---|---|
| `LANDER_DB_PATH` | `./lander.db` | SQLite database file location |
| `HOST` / `PORT` | `0.0.0.0` / `8000` | Dev server bind address (compose maps `${PORT:-8000}`) |

## API

Interactive docs are served automatically at `/docs` (Swagger UI) when the server
is running. Key endpoints: `GET /api/subjects`, `POST /api/import`,
`PUT /api/lessons/{id}/understanding`, `POST /api/sessions`,
`GET /api/review-queue`.

> **Security note:** Lander is a single-user self-hosted app with no
> authentication. Do not expose it directly to the internet — put it behind a
> reverse proxy with auth (e.g. Tailscale, Authelia, basic-auth) if remote
> access is needed.

### Tables (SQLite — `lander.db`)

| Table | Purpose |
|---|---|
| `subjects` | Top-level subject (e.g. Chemistry) |
| `sections` | Major divisions (e.g. Part 1, Part 2) |
| `chapters` | Topic groups within a section |
| `lessons` | Individual lesson/topic with understanding % |
| `lesson_history` | Timestamped record of every understanding change |
| `sessions` | Study sessions (duration, mode, optional score) per lesson |

The database file is created automatically in the project root (override with
`LANDER_DB_PATH`) and can be inspected with any SQLite browser. Back it up by
copying the file while the server is stopped.

## Extending

The data model supports multiple subjects already. To add tags, filtering, export, or richer analytics, add tables/columns alongside the existing schema without breaking existing data.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) and
feel free to submit issues or pull requests.

## License

MIT — see [LICENSE](./LICENSE).
