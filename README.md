# GeoCommander

**自然语言驱动的三维地理空间控制系统**

> 一个创新的 WebGIS 应用，让用户通过自然语言控制 3D 地球可视化

> **[开发中]** 本项目正在积极开发，功能可能会有变化

![React](https://img.shields.io/badge/React-19-61dafb)
![Cesium](https://img.shields.io/badge/Cesium-1.124-green)
![Python](https://img.shields.io/badge/Python-3.11+-yellow)
![License](https://img.shields.io/badge/License-MIT-blue)

## 特性

- **自然语言控制** - 用中文指令控制 3D 地球，如"飞到上海外滩"
- **3D 地球可视化** - 基于 Cesium 的高性能三维地球渲染
- **LLM 工具调用** - 借鉴 MCP 协议思想的工具调用机制
- **天气效果** - 雨、雪、雾等粒子系统天气模拟
- **昼夜切换** - 白天/夜晚/黎明/黄昏时间控制
- **POI 标注** - 动态添加/删除地图标记点
- **多源底图** - 天地图卫星、矢量、地形、深色图层
- **多 LLM 支持** - Vertex AI (Gemini)、OpenAI、Ollama 等

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户界面 (React)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │  ChatSidebar│  │  StatusBar  │  │    CesiumViewer          │ │
│  │ (自然语言)   │  │  (连接状态) │  │    (3D渲染)             │ │
│  └──────┬──────┘  └─────────────┘  └────────────▲────────────┘ │
│         │                                        │              │
│         │                              ┌─────────┴─────────┐    │
│         │                              │  ActionDispatcher │    │
│         │                              │  (JSON→Cesium)    │    │
│         │                              └─────────▲─────────┘    │
└─────────┼────────────────────────────────────────┼──────────────┘
          │ WebSocket                              │ Actions
          │                                        │
┌─────────▼────────────────────────────────────────┴──────────────┐
│                     后端服务 (Python FastAPI)                    │
│  ┌───────────────┐  ┌─────────────┐  ┌────────────────────────┐ │
│  │  LLM 集成     │  │  工具定义   │  │  地点知识库            │ │
│  │ (多服务商)    │  │  (fly_to等) │  │  (城市/地标)           │ │
│  └───────────────┘  └─────────────┘  └────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

## 支持的工具

| 工具 | 描述 | 示例指令 |
|------|------|---------|
| `fly_to` | 飞行到指定位置 | "飞到北京天安门" |
| `switch_basemap` | 切换底图 | "切换到卫星影像" |
| `add_marker` | 添加标记点 | "在上海外滩添加红色标记" |
| `set_weather` | 设置天气 | "显示下雨效果" |
| `set_time` | 设置时间 | "切换到夜晚" |
| `clear_markers` | 清除标记 | "清除所有标记" |
| `clear_weather` | 清除天气 | "清除天气效果" |

## 快速开始

### 前端

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 后端

```bash
cd mcp-server

# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Linux/macOS

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env 配置 LLM API

# 启动服务
python server.py
```

### 访问应用

- 前端: http://localhost:5173
- 后端: ws://localhost:8765

## 项目结构

```
geocommander/
├── src/
│   ├── components/           # React 组件
│   │   ├── CesiumViewer.tsx  # 3D 地球
│   │   ├── ChatSidebar.tsx   # 聊天界面
│   │   └── ...
│   ├── services/
│   │   └── WebSocketService.ts
│   ├── dispatcher/
│   │   └── ActionDispatcher.ts
│   └── config/
│       └── mapConfig.ts
├── mcp-server/
│   ├── server.py             # 后端主程序
│   ├── llm_providers.py      # LLM 服务商管理
│   ├── requirements.txt
│   └── .env.example
└── package.json
```

## 示例指令

```
飞到北京天安门
切换到卫星图
下雨
夜间模式
在武汉大学添加标记
重置视角
```

## LLM 配置

支持多种 LLM 服务商，在 `.env` 中配置：

```env
USE_LLM=true

# Google Vertex AI (Gemini) - 推荐
VERTEX_PROJECT_ID=your-project-id
VERTEX_CLIENT_EMAIL=your-service-account@...
VERTEX_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
VERTEX_MODEL=gemini-2.5-flash-lite

# 或 OpenAI
# OPENAI_API_KEY=sk-...

# 或本地 Ollama
# OLLAMA_BASE_URL=http://localhost:11434/v1
# OLLAMA_MODEL=qwen2.5:7b
```

## License

MIT
