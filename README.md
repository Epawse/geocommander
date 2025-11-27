# GeoCommander

**Natural Language Driven 3D Geospatial Control System**

> An innovative WebGIS application that allows users to control 3D globe visualization through natural language

> **[In Development]** This project is actively under development, features may change

![React](https://img.shields.io/badge/React-19-61dafb)
![Cesium](https://img.shields.io/badge/Cesium-1.124-green)
![Python](https://img.shields.io/badge/Python-3.11+-yellow)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- **Natural Language Control** - Control 3D globe with Chinese commands like "飞到上海外滩" (fly to Shanghai Bund)
- **3D Globe Visualization** - High-performance 3D globe rendering based on Cesium
- **LLM Tool Calling** - Tool calling mechanism inspired by MCP protocol
- **Weather Effects** - Rain, snow, fog particle system weather simulation
- **Day/Night Cycle** - Day/night/dawn/dusk time control
- **POI Markers** - Dynamic add/remove map markers
- **Multiple Basemaps** - Tianditu satellite, vector, terrain, dark layers
- **Multi-LLM Support** - Vertex AI (Gemini), OpenAI, Ollama, etc.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      User Interface (React)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ ChatSidebar │  │  StatusBar  │  │    CesiumViewer         │  │
│  │ (NL Input)  │  │  (Status)   │  │    (3D Render)          │  │
│  └──────┬──────┘  └─────────────┘  └────────────▲────────────┘  │
│         │                                        │               │
│         │                              ┌─────────┴─────────┐     │
│         │                              │  ActionDispatcher │     │
│         │                              │  (JSON→Cesium)    │     │
│         │                              └─────────▲─────────┘     │
└─────────┼────────────────────────────────────────┼───────────────┘
          │ WebSocket                              │ Actions
          │                                        │
┌─────────▼────────────────────────────────────────┴───────────────┐
│                    Backend Service (Python FastAPI)               │
│  ┌───────────────┐  ┌─────────────┐  ┌────────────────────────┐  │
│  │ LLM Integration│  │ Tool Defs   │  │  Location Knowledge    │  │
│  │ (Multi-vendor) │  │ (fly_to,etc)│  │  (Cities/Landmarks)    │  │
│  └───────────────┘  └─────────────┘  └────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## Supported Tools

| Tool | Description | Example Command |
|------|-------------|-----------------|
| `fly_to` | Fly to specified location | "飞到北京天安门" |
| `switch_basemap` | Switch basemap | "切换到卫星影像" |
| `add_marker` | Add marker point | "在上海外滩添加红色标记" |
| `set_weather` | Set weather effect | "显示下雨效果" |
| `set_time` | Set time of day | "切换到夜晚" |
| `clear_markers` | Clear all markers | "清除所有标记" |
| `clear_weather` | Clear weather effects | "清除天气效果" |
| `reset_view` | Reset camera view | "重置视角" |

## Quick Start

### Frontend

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Backend

```bash
cd mcp-server

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/macOS

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
# Edit .env to configure LLM API

# Start server
python server.py
```

### Access Application

- Frontend: http://localhost:5173
- Backend: ws://localhost:8765

## Project Structure

```
geocommander/
├── src/
│   ├── components/           # React components
│   │   ├── CesiumViewer.tsx  # 3D Globe
│   │   ├── ChatSidebar.tsx   # Chat interface
│   │   └── ...
│   ├── services/
│   │   └── WebSocketService.ts
│   ├── dispatcher/
│   │   └── ActionDispatcher.ts
│   └── config/
│       └── mapConfig.ts
├── mcp-server/
│   ├── server.py             # Backend main program
│   ├── llm_providers.py      # LLM provider management
│   ├── requirements.txt
│   └── .env.example
└── package.json
```

## Example Commands

```
飞到北京天安门
切换到卫星图
下雨
夜间模式
在武汉大学添加标记
重置视角
```

## LLM Configuration

Multiple LLM providers are supported, configure in `.env`:

```env
USE_LLM=true

# Google Vertex AI (Gemini) - Recommended
VERTEX_PROJECT_ID=your-project-id
VERTEX_CLIENT_EMAIL=your-service-account@...
VERTEX_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
VERTEX_MODEL=gemini-2.5-flash-lite

# Or OpenAI
# OPENAI_API_KEY=sk-...

# Or local Ollama
# OLLAMA_BASE_URL=http://localhost:11434/v1
# OLLAMA_MODEL=qwen2.5:7b
```

## License

MIT

---

## Related Projects

- [mcp-geo-tools](https://github.com/epawse/mcp-geo-tools) - Standard MCP Server implementation (planned)
