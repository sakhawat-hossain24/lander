# Lander

A beautifully designed, self-hosted web application for tracking learning progress across hierarchical subjects. Replaces manual Markdown-based tracking with an elegant, live-updating interface featuring color-coded understanding metrics, automatic averages, and detailed change history visualization.

**Lander** makes learning progress tracking intuitive and visually engaging, with a polished interface that helps you ground your understanding of complex subjects.

## Features

- **Hierarchical tracking**: Organize learning by subjects, sections, chapters, and individual lessons
- **Visual progress metrics**: Color-coded understanding percentages that update in real-time
- **Automatic averaging**: Instantly see aggregated progress across all levels
- **Change history**: Beautiful charts tracking your learning journey over time
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

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
```

```bash
docker build -t lander .
docker run -p 8000:8000 -v $(pwd)/lander.db:/app/lander.db lander
```

## Data Management

### Import Existing Data

#### CLI import (one-time)
```bash
python import_markdown.py path/to/study.md --subject "Chemistry"
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
├── import_markdown.py     # Markdown import utility
├── static/
│   ├── index.html        # Application shell
│   ├── style.css         # Modern, responsive styling
│   └── app.js            # Interactive frontend logic
├── lander.db             # SQLite database (auto-created)
└── requirements.txt      # Python dependencies
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

# Run tests
playwright test
```

## Roadmap

- [ ] Dark mode toggle
- [ ] Keyboard shortcuts
- [ ] Collaborative features
- [ ] Mobile app
- [ ] Custom color themes
- [ ] Export to PDF

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT
Subject
 └── Section (e.g. "Part 1")
      └── Chapter (e.g. "Chapter 1: Safe use of the laboratory")
           └── Lesson
                ├── name: string
                └── understanding: float (0-100)
```

### Tables (SQLite — `lander.db`)

| Table | Purpose |
|---|---|
| `subjects` | Top-level subject (e.g. Chemistry) |
| `sections` | Major divisions (e.g. Part 1, Part 2) |
| `chapters` | Topic groups within a section |
| `lessons` | Individual lesson/topic with understanding % |
| `lesson_history` | Timestamped record of every understanding change |

The database file `lander.db` is created automatically in the project root (override with `LANDER_DB_PATH`) and can be inspected or edited directly with any SQLite browser.

## Features

- **Hierarchical display** — expand/collapse sections and chapters
- **Color-coded percentages** — continuous gradient from red (0%) through orange and yellow to green (100%)
- **Live averages** — chapter, section, and subject averages update instantly when any lesson is changed
- **Inline editing** — click a percentage to edit it inline (Enter to save, Escape to cancel, arrow keys to nudge by 5)
- **History tracking** — every change is recorded with a timestamp; click the Chart button to view a line chart
- **Aggregate history** — view how chapter, section, or subject averages have changed over time

## Extending

The data model supports multiple subjects already. To add tags, filtering, export, or richer analytics, add tables/columns alongside the existing schema without breaking existing data.
