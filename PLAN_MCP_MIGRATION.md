# MCP Geo Tools 迁移计划

## 一、项目概述

**目标**：将 GeoCommander 的自定义 MCP 实现升级为标准 MCP 协议，并分离到独立仓库。

| 项目 | 仓库 | 说明 |
|------|------|------|
| **GeoCommander** | `Epawse/geocommander` | 前端应用（React + Cesium） |
| **MCP Geo Tools** | `Epawse/mcp-geo-tools` | 标准 MCP Server（新建） |

---

## 二、架构对比

### 2.1 当前架构（自定义实现）

```
┌─────────────────────────────────────────────────────────────┐
│                    GeoCommander 前端                         │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │ ChatSidebar │────│ WebSocket    │────│ ActionDispatcher│ │
│  │             │    │ Service      │    │ (Cesium API)    │ │
│  └─────────────┘    └──────────────┘    └──────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │ WebSocket (ws://localhost:8765)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    mcp-server (自定义)                       │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │ FastAPI     │────│ ChatAssistant│────│ LLM Providers │   │
│  │ WebSocket   │    │ (意图解析)   │    │ (7种服务商)   │   │
│  └─────────────┘    └──────────────┘    └──────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**问题**：
- 不符合 MCP 标准，无法与 Claude Desktop 等客户端集成
- LLM 调用嵌入在 Server 中，耦合度高
- 工具定义是自定义格式

### 2.2 目标架构（标准 MCP）

```
┌────────────────────────────────────────────────────────────────────────┐
│                         MCP 客户端层                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │
│  │ Claude Desktop  │  │ Claude Code     │  │ GeoCommander 前端       │ │
│  │ (stdio)         │  │ (stdio)         │  │ (HTTP/SSE)              │ │
│  └────────┬────────┘  └────────┬────────┘  └───────────┬─────────────┘ │
└───────────┼─────────────────────┼──────────────────────┼───────────────┘
            │                     │                      │
            └──────────────┬──────┴──────────────────────┘
                           │ JSON-RPC 2.0
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    mcp-geo-tools (标准 MCP Server)                      │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        FastMCP Server                           │   │
│  │  ┌────────────────────────────────────────────────────────┐    │   │
│  │  │                      Tools (工具)                       │    │   │
│  │  │  • fly_to          • switch_basemap   • add_marker     │    │   │
│  │  │  • set_weather     • set_time         • clear_markers  │    │   │
│  │  │  • clear_weather   • reset_view       • get_camera     │    │   │
│  │  └────────────────────────────────────────────────────────┘    │   │
│  │  ┌────────────────────────────────────────────────────────┐    │   │
│  │  │                   Resources (资源)                      │    │   │
│  │  │  • locations://   地点数据库                            │    │   │
│  │  │  • basemaps://    底图类型列表                          │    │   │
│  │  │  • weather://     天气类型列表                          │    │   │
│  │  └────────────────────────────────────────────────────────┘    │   │
│  │  ┌────────────────────────────────────────────────────────┐    │   │
│  │  │                    Prompts (提示)                       │    │   │
│  │  │  • geo-assistant  地理助手系统提示词                    │    │   │
│  │  │  • command-parser 命令解析提示词                        │    │   │
│  │  └────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  传输层: stdio (本地) | Streamable HTTP (远程/Web)                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 三、关键设计决策

### 3.1 MCP 工具的本质

**重要理解**：标准 MCP 工具是**描述性的**，不是**执行性的**。

- MCP Server 的工具返回的是**操作指令**（JSON），而非直接执行
- 真正的执行发生在 MCP 客户端（前端/Claude）
- 这与当前实现的核心区别：当前是 Server 调用 LLM 并返回工具调用给前端执行

### 3.2 两种使用场景

| 场景 | 客户端 | 传输 | LLM 调用方 |
|------|--------|------|------------|
| **Claude Desktop/Code** | Claude | stdio | Claude 自身 |
| **GeoCommander 前端** | 自定义 Web 客户端 | HTTP/SSE | 前端调用 LLM API |

### 3.3 传输协议选择

| 协议 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **stdio** | 简单、标准、Claude 原生支持 | 仅限本地 | Claude Desktop/Code |
| **Streamable HTTP** | 支持远程、无状态、Web 友好 | 需要部署 HTTP 服务 | Web 应用 |
| ~~SSE~~ | - | 已弃用 | - |

**建议**：同时支持 stdio 和 Streamable HTTP，通过命令行参数切换。

---

## 四、mcp-geo-tools 仓库结构

```
mcp-geo-tools/
├── src/
│   └── mcp_geo_tools/
│       ├── __init__.py
│       ├── server.py              # MCP Server 主入口
│       ├── tools/
│       │   ├── __init__.py
│       │   ├── navigation.py      # fly_to, reset_view, get_camera
│       │   ├── basemap.py         # switch_basemap
│       │   ├── markers.py         # add_marker, remove_marker, clear_markers
│       │   ├── weather.py         # set_weather, clear_weather
│       │   └── time.py            # set_time
│       ├── resources/
│       │   ├── __init__.py
│       │   └── locations.py       # 地点数据作为 MCP Resource
│       ├── prompts/
│       │   ├── __init__.py
│       │   └── templates.py       # 系统提示词模板
│       └── data/
│           └── locations.json     # 地点数据库
├── tests/
│   ├── __init__.py
│   ├── test_tools.py
│   └── test_resources.py
├── pyproject.toml                 # 项目配置 (PEP 517/518)
├── README.md
├── LICENSE
└── .github/
    └── workflows/
        └── publish.yml            # PyPI 发布
```

---

## 五、核心代码设计

### 5.1 主入口 (server.py)

```python
"""
MCP Geo Tools - 地理空间工具 MCP Server

提供地图导航、标记、天气、时间等地理空间控制工具
"""
from mcp.server.fastmcp import FastMCP

# 创建 MCP Server 实例
mcp = FastMCP(
    name="mcp-geo-tools",
    version="0.1.0",
    description="地理空间工具集，支持地图导航、标记、天气和时间控制"
)

# 导入工具模块（自动注册）
from .tools import navigation, basemap, markers, weather, time
from .resources import locations
from .prompts import templates

def main():
    """启动 MCP Server"""
    import sys

    # 根据参数选择传输方式
    if "--http" in sys.argv:
        # Streamable HTTP 模式（用于 Web 客户端）
        mcp.run(transport="streamable-http", host="0.0.0.0", port=8765)
    else:
        # stdio 模式（用于 Claude Desktop/Code）
        mcp.run()

if __name__ == "__main__":
    main()
```

### 5.2 工具定义示例 (tools/navigation.py)

```python
"""导航相关工具"""
from typing import Optional
from ..server import mcp
from ..resources.locations import LOCATIONS

@mcp.tool()
def fly_to(
    longitude: float,
    latitude: float,
    altitude: float = 5000.0,
    duration: float = 2.0,
    heading: float = 0.0,
    pitch: float = -45.0
) -> dict:
    """
    飞行到指定位置。

    支持通过经纬度坐标定位到地球上的任意位置。

    Args:
        longitude: 经度，范围 -180 到 180
        latitude: 纬度，范围 -90 到 90
        altitude: 相机高度（米），默认 5000m
        duration: 飞行动画时长（秒），默认 2s
        heading: 相机朝向角度，默认 0（正北）
        pitch: 相机俯仰角度，默认 -45（俯视）

    Returns:
        包含飞行参数的动作指令
    """
    return {
        "action": "fly_to",
        "arguments": {
            "longitude": longitude,
            "latitude": latitude,
            "altitude": altitude,
            "duration": duration,
            "heading": heading,
            "pitch": pitch
        }
    }

@mcp.tool()
def fly_to_location(name: str, altitude: Optional[float] = None) -> dict:
    """
    飞行到已知地点。

    支持中国主要城市、著名景点和世界地标。

    Args:
        name: 地点名称，如 "北京"、"故宫"、"埃菲尔铁塔"
        altitude: 可选的相机高度（米），不指定则使用地点默认高度

    Returns:
        包含飞行参数的动作指令，如果地点未找到则返回错误
    """
    location = LOCATIONS.get(name)
    if not location:
        # 尝试模糊匹配
        for loc_name, loc_data in LOCATIONS.items():
            if name in loc_name or loc_name in name:
                location = loc_data
                break

    if not location:
        return {
            "error": f"未找到地点: {name}",
            "available_locations": list(LOCATIONS.keys())[:10]
        }

    return {
        "action": "fly_to",
        "arguments": {
            "longitude": location["longitude"],
            "latitude": location["latitude"],
            "altitude": altitude or location.get("altitude", 5000),
            "duration": 2.0
        }
    }

@mcp.tool()
def reset_view() -> dict:
    """
    重置视角到初始位置（中国全景）。

    Returns:
        重置视角的动作指令
    """
    return {
        "action": "reset_view",
        "arguments": {}
    }

@mcp.tool()
def get_camera_position() -> dict:
    """
    获取当前相机位置。

    注意：此工具需要客户端支持返回当前状态。

    Returns:
        请求获取相机位置的动作指令
    """
    return {
        "action": "get_camera_position",
        "arguments": {}
    }
```

### 5.3 资源定义 (resources/locations.py)

```python
"""地点资源"""
import json
from pathlib import Path
from ..server import mcp

# 加载地点数据
DATA_PATH = Path(__file__).parent.parent / "data" / "locations.json"

LOCATIONS = {
    "北京": {"longitude": 116.4074, "latitude": 39.9042, "altitude": 5000},
    "天安门": {"longitude": 116.3972, "latitude": 39.9087, "altitude": 1000},
    "故宫": {"longitude": 116.3972, "latitude": 39.9169, "altitude": 800},
    "上海": {"longitude": 121.4737, "latitude": 31.2304, "altitude": 5000},
    "外滩": {"longitude": 121.4909, "latitude": 31.2397, "altitude": 500},
    # ... 更多地点
}

@mcp.resource("locations://all")
def get_all_locations() -> str:
    """获取所有已知地点列表"""
    return json.dumps(LOCATIONS, ensure_ascii=False, indent=2)

@mcp.resource("locations://{name}")
def get_location(name: str) -> str:
    """获取指定地点的详细信息"""
    if name in LOCATIONS:
        return json.dumps({name: LOCATIONS[name]}, ensure_ascii=False)
    return json.dumps({"error": f"地点 {name} 未找到"})
```

### 5.4 提示词模板 (prompts/templates.py)

```python
"""提示词模板"""
from ..server import mcp
from ..resources.locations import LOCATIONS

@mcp.prompt()
def geo_assistant() -> str:
    """地理空间助手系统提示词"""
    location_list = ", ".join(list(LOCATIONS.keys())[:20])

    return f"""你是 GeoCommander，一个智能的地理空间助手。

## 可用工具
- fly_to: 飞行到指定经纬度
- fly_to_location: 飞行到已知地点
- switch_basemap: 切换底图 (satellite/vector/terrain/dark)
- add_marker: 添加标记点
- clear_markers: 清除所有标记
- set_weather: 设置天气 (rain/snow/fog/clear)
- clear_weather: 清除天气
- set_time: 设置时间 (day/night/dawn/dusk)
- reset_view: 重置视角

## 已知地点
{location_list} 等 {len(LOCATIONS)} 个地点

## 使用指南
1. 用户说 "去北京" → 使用 fly_to_location("北京")
2. 用户说 "经度116纬度39" → 使用 fly_to(116, 39)
3. 用户说 "下雨" → 使用 set_weather("rain")
4. 用户说 "切换卫星图" → 使用 switch_basemap("satellite")
"""

@mcp.prompt()
def command_parser() -> str:
    """命令解析器提示词（严格模式）"""
    return """你是地图命令解析器，只解析地图操作，拒绝闲聊。

支持的操作：
- 导航：fly_to, fly_to_location, reset_view
- 底图：switch_basemap (satellite/vector/terrain/dark)
- 标记：add_marker, clear_markers
- 天气：set_weather (rain/snow/fog/clear), clear_weather
- 时间：set_time (day/night/dawn/dusk)

如果输入不是地图操作，回复："这不是地图命令，请使用对话模式。"
"""
```

---

## 六、架构分离原则

### 6.1 职责划分

| 组件 | 职责 | 仓库 |
|------|------|------|
| **mcp-geo-tools** | 纯 MCP Server，提供地理空间工具 | `Epawse/mcp-geo-tools` |
| **GeoCommander** | 前端应用 + LLM 管理 + Cesium 渲染 | `Epawse/geocommander` |

### 6.2 mcp-geo-tools 设计原则

**纯粹性**：
- 只实现 MCP 协议，不包含 LLM 调用逻辑
- 工具返回操作指令，由客户端决定如何执行
- 支持任意 MCP 客户端（Claude Desktop、Claude Code、自定义客户端）

**标准性**：
- 完全遵循 MCP 规范
- 支持 stdio（本地）和 Streamable HTTP（远程）传输
- 可通过 `pip install` 或 `uvx` 直接使用

### 6.3 使用场景

**场景 1：Claude Desktop / Claude Code 用户**
```
用户 → Claude → mcp-geo-tools (stdio) → 返回工具调用结果
```
Claude 负责 LLM 推理，mcp-geo-tools 只提供工具定义和执行逻辑。

**场景 2：GeoCommander 完整应用**
```
用户 → GeoCommander 前端 → LLM API (独立管理) → mcp-geo-tools (HTTP) → Cesium 执行
```
GeoCommander 保留 LLM 提供商管理，通过 HTTP 调用 mcp-geo-tools。

**场景 3：第三方开发者集成**
```
开发者应用 → MCP Client SDK → mcp-geo-tools → 自定义执行逻辑
```

### 6.4 GeoCommander 保留的功能

GeoCommander 仓库中保留：
- **前端应用** (React + Cesium)
- **LLM 提供商管理** (llm_providers.py 可保留或重构)
- **ActionDispatcher** (执行 MCP 工具返回的指令)
- **用户界面** (ChatSidebar, 工具面板等)

### 6.5 迁移路径

```
阶段 1: 创建 mcp-geo-tools 仓库
        - 实现标准 MCP Server (stdio + HTTP)
        - 发布到 PyPI
        - 测试与 Claude Desktop 集成
         ↓
阶段 2: 更新 GeoCommander
        - 前端实现 MCP Client 调用逻辑
        - 重构 LLM 管理（独立模块）
        - 移除旧的 mcp-server 目录
         ↓
阶段 3: 文档和示例
        - mcp-geo-tools 使用文档
        - GeoCommander 集成指南
        - 第三方集成示例
```

---

## 七、实现任务清单

### 7.1 mcp-geo-tools 仓库

- [ ] 初始化仓库结构
- [ ] 配置 pyproject.toml（使用 `mcp[cli]` 依赖）
- [ ] 实现 Tools
  - [ ] navigation.py (fly_to, fly_to_location, reset_view, get_camera)
  - [ ] basemap.py (switch_basemap)
  - [ ] markers.py (add_marker, remove_marker, clear_markers)
  - [ ] weather.py (set_weather, clear_weather)
  - [ ] time.py (set_time)
- [ ] 实现 Resources
  - [ ] locations.py (地点数据库)
  - [ ] basemaps.py (底图类型)
  - [ ] weather_types.py (天气类型)
- [ ] 实现 Prompts
  - [ ] geo_assistant (对话模式)
  - [ ] command_parser (命令模式)
- [ ] 添加 Streamable HTTP 传输支持
- [ ] 编写测试
- [ ] 配置 GitHub Actions 发布到 PyPI
- [ ] 编写 README 文档

### 7.2 GeoCommander 适配

- [ ] 移除 mcp-server 目录（迁移到新仓库）
- [ ] 创建 Bridge Server（WebSocket ↔ MCP）
- [ ] 更新前端连接逻辑
- [ ] 测试端到端流程

---

## 八、pyproject.toml 配置

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "mcp-geo-tools"
version = "0.1.0"
description = "MCP Server for geographic spatial tools - map navigation, markers, weather, and time control"
readme = "README.md"
license = "MIT"
requires-python = ">=3.10"
authors = [
    { name = "Epawse", email = "your-email@example.com" }
]
keywords = ["mcp", "geo", "gis", "cesium", "map", "claude"]
classifiers = [
    "Development Status :: 3 - Alpha",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
]
dependencies = [
    "mcp[cli]>=1.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0",
    "pytest-asyncio>=0.21",
]

[project.scripts]
mcp-geo-tools = "mcp_geo_tools.server:main"

[project.urls]
Homepage = "https://github.com/Epawse/mcp-geo-tools"
Repository = "https://github.com/Epawse/mcp-geo-tools"
Issues = "https://github.com/Epawse/mcp-geo-tools/issues"

[tool.hatch.build.targets.wheel]
packages = ["src/mcp_geo_tools"]
```

---

## 九、Claude Desktop 配置示例

安装后，用户可以在 Claude Desktop 配置文件中添加：

```json
{
  "mcpServers": {
    "geo-tools": {
      "command": "mcp-geo-tools",
      "args": []
    }
  }
}
```

或者使用 uvx（无需安装）：

```json
{
  "mcpServers": {
    "geo-tools": {
      "command": "uvx",
      "args": ["mcp-geo-tools"]
    }
  }
}
```

---

## 十、设计决策（已确认）

1. **mcp-geo-tools 定位**
   - ✅ 纯粹的标准 MCP Server，不包含 LLM 调用逻辑
   - ✅ 便于任何开发者使用（Claude Desktop、第三方应用）
   - ✅ 支持 stdio 和 Streamable HTTP 两种传输

2. **LLM 提供商管理**
   - ✅ 独立于 MCP Server，保留在 GeoCommander 仓库
   - ✅ GeoCommander 前端自行管理 LLM 调用
   - ✅ mcp-geo-tools 只提供工具，不关心 LLM

3. **会话状态**
   - MCP Server 无状态（符合标准）
   - 对话历史由客户端（GeoCommander 前端）管理

---

## 十一、时间线建议

| 阶段 | 任务 | 预计工作量 |
|------|------|------------|
| 1 | 初始化 mcp-geo-tools 仓库，实现基础 Tools | 1-2 天 |
| 2 | 实现 Resources 和 Prompts | 0.5 天 |
| 3 | 添加 HTTP 传输，测试 Claude Desktop 集成 | 0.5 天 |
| 4 | 创建 Bridge Server，适配 GeoCommander | 1 天 |
| 5 | 测试、文档、发布 | 1 天 |

**总计**：约 4-5 天

---

## 十二、参考资料

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- [FastMCP 指南](https://modelcontextprotocol.io/docs/develop/build-server)
- [Streamable HTTP 传输](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
