# F1 AI Race Engineer

AI-powered F1 race engineer that uses real historical data to provide lap-by-lap strategic advice during any race from 2018-2025.

## What It Does

Select an F1 race and driver. Advance through the race lap by lap. Ask your AI race engineer questions as if you're on the pit wall — it queries actual race data (standings, tyres, gaps, weather, track status) and responds with data-backed strategic advice.

## Features

- **Real F1 data** — powered by FastF1 (official timing data)
- **10 AI tools** — standings, gaps, tyre strategy, weather, pit stops, comparisons, and more
- **Lap-by-lap** — data is filtered to the current lap, so the race unfolds live
- **Multi-provider LLM** — swap between OpenAI, Anthropic, Google, Groq via config
- **Radio-style communication** — the AI talks like a real race engineer

## Tech Stack

| Component | Technology |
|---|---|
| Race data | `fastf1` |
| AI agent | `litellm` (tool-calling) |
| Backend | `FastAPI` + `uvicorn` |
| Frontend | `Next.js 14` + `Tailwind` + `shadcn/ui` |
| Package manager | `uv` |

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- [uv](https://docs.astral.sh/uv/)

### Setup

```bash
# Clone and enter
cd f1-ai-assistant

# Install everything
make init

# Set up your API key
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY (or other provider key)
```

### Run

```bash
# Terminal 1: API backend
make dev-api

# Terminal 2: Frontend
make dev-frontend
```

Open [http://localhost:3000](http://localhost:3000), select a race, and start chatting.

### Docker

```bash
make docker-up
```

## Project Structure

```
src/
├── race_state.py      # FastF1 data loading + queryable race state
├── tools.py           # 10 AI tool functions + schemas
├── agent.py           # LiteLLM tool-calling conversation loop
├── api/
│   ├── main.py        # FastAPI app + CORS
│   ├── routes/race.py # Race data endpoints
│   ├── routes/chat.py # Chat endpoint
│   └── services.py    # Race state caching
└── utils/
    ├── config.py      # YAML + env var config
    └── logger.py      # Loguru logging

frontend/
├── app/page.tsx       # Main page layout
├── components/        # React components (7 total)
└── lib/               # API client + types
```

## Configuration

- `config/settings.yaml` — LLM model, FastF1 cache, API settings
- `.env` — API keys (gitignored)

## License

MIT
