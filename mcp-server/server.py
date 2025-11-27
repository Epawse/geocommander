"""
GeoCommander MCP Server

基于 Model Context Protocol 的自然语言地理空间指令服务
使用 FastAPI 提供 WebSocket 接口，连接 LLM 和前端 Cesium Viewer

支持的 LLM 服务商（参考 Cherry Studio）：
- Ollama（本地部署）
- 阿里云百炼（DashScope）
- 硅基流动（SiliconFlow）
- DeepSeek
- OpenAI / OpenAI 兼容
- Google Vertex AI (Gemini)
"""

import uvicorn
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import asyncio
import json
import os
import uuid
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager

# 加载 .env 环境变量
from dotenv import load_dotenv
load_dotenv()

# MCP 客户端
from mcp_client import get_mcp_client, init_mcp_client, MCPClient

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ===================== 数据模型 =====================


class Location(BaseModel):
    """地理位置"""
    name: str
    longitude: float
    latitude: float
    altitude: Optional[float] = 5000


class MCPTool(BaseModel):
    """MCP 工具定义"""
    name: str
    description: str
    parameters: Dict[str, Any]


class MCPToolCall(BaseModel):
    """MCP 工具调用"""
    id: str
    action: str
    arguments: Dict[str, Any]


class UserCommand(BaseModel):
    """用户指令"""
    text: str
    timestamp: Optional[float] = None


class ChatMessage(BaseModel):
    """对话消息"""
    role: str  # 'user' | 'assistant' | 'system'
    content: str
    timestamp: Optional[str] = None
    tool_call: Optional[MCPToolCall] = None  # 如果有工具调用


class LLMResponse(BaseModel):
    """LLM 响应结构"""
    message: str  # AI 的自然语言回复
    tool_call: Optional[Dict[str, Any]] = None  # 可选的工具调用
    thinking: Optional[str] = None  # 可选的思考过程

# ===================== 知识库 =====================


# 常用地点数据库
LOCATIONS: Dict[str, Location] = {
    "北京": Location(name="北京", longitude=116.4074, latitude=39.9042, altitude=5000),
    "天安门": Location(name="天安门广场", longitude=116.3972, latitude=39.9087, altitude=1000),
    "故宫": Location(name="故宫", longitude=116.3972, latitude=39.9169, altitude=800),
    "上海": Location(name="上海", longitude=121.4737, latitude=31.2304, altitude=5000),
    "外滩": Location(name="上海外滩", longitude=121.4909, latitude=31.2397, altitude=500),
    "东方明珠": Location(name="东方明珠塔", longitude=121.4997, latitude=31.2397, altitude=800),
    "广州": Location(name="广州", longitude=113.2644, latitude=23.1291, altitude=5000),
    "广州塔": Location(name="广州塔", longitude=113.3244, latitude=23.1066, altitude=800),
    "深圳": Location(name="深圳", longitude=114.0579, latitude=22.5431, altitude=5000),
    "香港": Location(name="香港", longitude=114.1694, latitude=22.3193, altitude=5000),
    "维多利亚港": Location(name="维多利亚港", longitude=114.1747, latitude=22.3035, altitude=500),
    "杭州": Location(name="杭州", longitude=120.1551, latitude=30.2741, altitude=5000),
    "西湖": Location(name="西湖", longitude=120.1485, latitude=30.2421, altitude=300),
    "成都": Location(name="成都", longitude=104.0668, latitude=30.5728, altitude=5000),
    "重庆": Location(name="重庆", longitude=106.5516, latitude=29.5630, altitude=5000),
    "南京": Location(name="南京", longitude=118.7969, latitude=32.0603, altitude=5000),
    "武汉": Location(name="武汉", longitude=114.3055, latitude=30.5928, altitude=5000),
    "西安": Location(name="西安", longitude=108.9402, latitude=34.3416, altitude=5000),
    "兵马俑": Location(name="秦始皇兵马俑", longitude=109.2785, latitude=34.3847, altitude=500),
    "珠穆朗玛峰": Location(name="珠穆朗玛峰", longitude=86.9250, latitude=27.9881, altitude=15000),
    "长城": Location(name="八达岭长城", longitude=116.0166, latitude=40.3539, altitude=1500),
    "黄山": Location(name="黄山", longitude=118.1694, latitude=30.1333, altitude=2000),
    "张家界": Location(name="张家界", longitude=110.4792, latitude=29.1170, altitude=2000),
    "九寨沟": Location(name="九寨沟", longitude=103.9180, latitude=33.2600, altitude=3000),
    "布达拉宫": Location(name="布达拉宫", longitude=91.1172, latitude=29.6525, altitude=4000),
    "纽约": Location(name="纽约", longitude=-74.0060, latitude=40.7128, altitude=5000),
    "自由女神": Location(name="自由女神像", longitude=-74.0445, latitude=40.6892, altitude=500),
    "伦敦": Location(name="伦敦", longitude=-0.1276, latitude=51.5074, altitude=5000),
    "巴黎": Location(name="巴黎", longitude=2.3522, latitude=48.8566, altitude=5000),
    "埃菲尔铁塔": Location(name="埃菲尔铁塔", longitude=2.2945, latitude=48.8584, altitude=500),
    "东京": Location(name="东京", longitude=139.6917, latitude=35.6895, altitude=5000),
    "富士山": Location(name="富士山", longitude=138.7274, latitude=35.3606, altitude=6000),
    "悉尼": Location(name="悉尼", longitude=151.2093, latitude=-33.8688, altitude=5000),
    "悉尼歌剧院": Location(name="悉尼歌剧院", longitude=151.2153, latitude=-33.8568, altitude=500),
}

# 底图类型映射
BASEMAP_TYPES = {
    "卫星": "satellite",
    "卫星影像": "satellite",
    "卫星图": "satellite",
    "影像": "satellite",
    "矢量": "vector",
    "矢量图": "vector",
    "街道": "vector",
    "道路": "vector",
    "地形": "terrain",
    "地形图": "terrain",
    "高程": "terrain",
    "深色": "dark",
    "暗色": "dark",
    "夜间": "dark",
}

# 天气类型映射
WEATHER_TYPES = {
    "下雨": "rain",
    "雨天": "rain",
    "降雨": "rain",
    "雨": "rain",
    "下雪": "snow",
    "雪天": "snow",
    "降雪": "snow",
    "雪": "snow",
    "雾": "fog",
    "大雾": "fog",
    "雾天": "fog",
    "晴": "clear",
    "晴天": "clear",
    "清除": "clear",
    "无": "clear",
}

# 时间预设映射
TIME_PRESETS = {
    "白天": "day",
    "日间": "day",
    "中午": "day",
    "黑夜": "night",
    "夜晚": "night",
    "夜间": "night",
    "晚上": "night",
    "黎明": "dawn",
    "日出": "dawn",
    "早晨": "dawn",
    "黄昏": "dusk",
    "日落": "dusk",
    "傍晚": "dusk",
}

# ===================== MCP 工具定义 =====================

MCP_TOOLS: List[MCPTool] = [
    MCPTool(
        name="fly_to",
        description="飞行到指定位置。支持城市名称、景点名称或经纬度坐标。",
        parameters={
            "type": "object",
            "properties": {
                "longitude": {"type": "number", "description": "经度 (-180 到 180)"},
                "latitude": {"type": "number", "description": "纬度 (-90 到 90)"},
                "altitude": {"type": "number", "description": "高度（米）", "default": 5000},
                "duration": {"type": "number", "description": "飞行时间（秒）", "default": 2},
            },
            "required": ["longitude", "latitude"]
        }
    ),
    MCPTool(
        name="switch_basemap",
        description="切换底图类型。支持卫星影像、矢量地图、地形图、深色主题。",
        parameters={
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["satellite", "vector", "terrain", "dark"],
                    "description": "底图类型"
                }
            },
            "required": ["type"]
        }
    ),
    MCPTool(
        name="add_marker",
        description="在地图上添加标记点。",
        parameters={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "标记名称"},
                "longitude": {"type": "number", "description": "经度"},
                "latitude": {"type": "number", "description": "纬度"},
                "color": {"type": "string", "description": "颜色（CSS格式）", "default": "#FF4444"},
                "description": {"type": "string", "description": "描述信息"}
            },
            "required": ["name", "longitude", "latitude"]
        }
    ),
    MCPTool(
        name="set_weather",
        description="设置天气效果。支持雨、雪、雾等天气。",
        parameters={
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["rain", "snow", "fog", "clear"],
                    "description": "天气类型"
                },
                "intensity": {
                    "type": "number",
                    "description": "强度 (0-1)",
                    "default": 0.5
                }
            },
            "required": ["type"]
        }
    ),
    MCPTool(
        name="set_time",
        description="设置场景时间。可以设置具体时间或使用预设（白天、夜晚、黎明、黄昏）。",
        parameters={
            "type": "object",
            "properties": {
                "preset": {
                    "type": "string",
                    "enum": ["day", "night", "dawn", "dusk"],
                    "description": "时间预设"
                },
                "datetime": {
                    "type": "string",
                    "description": "ISO 8601 格式的日期时间"
                }
            }
        }
    ),
    MCPTool(
        name="clear_markers",
        description="清除所有标记点。",
        parameters={
            "type": "object",
            "properties": {}
        }
    ),
    MCPTool(
        name="clear_weather",
        description="清除天气效果。",
        parameters={
            "type": "object",
            "properties": {}
        }
    ),
]

# ===================== 意图解析器 =====================


class ChatAssistant:
    """
    对话式 AI 助手

    功能：
    1. 自然对话 - 回答用户问题，进行友好交流
    2. 指令执行 - 识别并执行地图操作指令
    3. 上下文记忆 - 记住对话历史（可选）

    支持的 LLM 服务商（参考 Cherry Studio）：
    - Ollama（本地部署）
    - 阿里云百炼（DashScope）
    - 硅基流动（SiliconFlow）
    - DeepSeek
    - OpenAI / OpenAI 兼容
    - Google Vertex AI (Gemini)
    """

    # 对话模式的系统提示词
    CONVERSATION_PROMPT = '''你是 GeoCommander，一个智能的地理空间助手。你运行在一个 3D 地球可视化系统中。

## 你的能力
1. **自然对话** - 友好地与用户交流，回答问题
2. **地图操作** - 执行飞行、标记、天气、时间等地图控制指令
3. **地理知识** - 回答关于地理、景点、城市的问题

## 可用的地图操作工具
- fly_to: 飞行到指定位置（需要经纬度和高度）
- switch_basemap: 切换底图（satellite/vector/terrain/dark）
- add_marker: 添加标记点（需要名称、经纬度、颜色）
- set_weather: 设置天气效果（rain/snow/fog/clear）
- set_time: 设置时间（day/night/dawn/dusk）
- clear_markers: 清除所有标记
- clear_weather: 清除天气效果

## 已知地点（可直接使用）
北京(116.4074,39.9042), 天安门(116.3972,39.9087), 故宫(116.3972,39.9169), 
上海(121.4737,31.2304), 外滩(121.4909,31.2397), 东方明珠(121.4997,31.2397),
广州(113.2644,23.1291), 深圳(114.0579,22.5431), 香港(114.1694,22.3193),
杭州(120.1551,30.2741), 西湖(120.1485,30.2421), 成都(104.0668,30.5728),
重庆(106.5516,29.5630), 西安(108.9402,34.3416), 兵马俑(109.2785,34.3847),
珠穆朗玛峰(86.9250,27.9881), 长城(116.0166,40.3539), 黄山(118.1694,30.1333),
纽约(-74.0060,40.7128), 巴黎(2.3522,48.8566), 东京(139.6917,35.6895)

## 回复格式
请以 JSON 格式回复，包含以下字段：
```json
{
  "message": "给用户的自然语言回复",
  "tool_call": {
    "action": "工具名称",
    "arguments": { 工具参数 }
  }
}
```

如果不需要执行工具，tool_call 设为 null：
```json
{
  "message": "你的回复内容",
  "tool_call": null
}
```

## 交互示例

用户: "你好"
回复: {"message": "你好！我是 GeoCommander，你的地理空间助手。我可以帮你浏览地球上的任何地方、添加标记、切换地图样式、设置天气和时间效果。有什么想探索的吗？", "tool_call": null}

用户: "带我去看看巴黎铁塔"
回复: {"message": "好的，正在带你飞往巴黎埃菲尔铁塔！这是世界上最著名的地标之一，建于1889年。", "tool_call": {"action": "fly_to", "arguments": {"longitude": 2.2945, "latitude": 48.8584, "altitude": 800}}}

用户: "下雨了好看吗"
回复: {"message": "让我为你添加雨天效果，看看巴黎雨中的浪漫氛围！", "tool_call": {"action": "set_weather", "arguments": {"type": "rain", "intensity": 0.5}}}

用户: "北京有什么好玩的"
回复: {"message": "北京作为中国的首都，有很多值得游览的地方！\n\n🏛️ **历史文化**：故宫、天安门广场、天坛、颐和园\n🧱 **长城**：八达岭、慕田峪、司马台\n🎭 **现代地标**：鸟巢、水立方、国家大剧院\n🍜 **美食街区**：王府井、南锣鼓巷、簋街\n\n想去哪个地方看看？我可以带你飞过去！", "tool_call": null}

用户: "现在几点了"
回复: {"message": "作为地图助手，我没有实时时钟功能，但我可以帮你设置地图场景的时间！比如设置成白天、夜晚、黎明或黄昏，想试试吗？", "tool_call": null}

## 重要提示
- 始终保持友好、有帮助的语气
- 如果用户意图不明确，可以询问澄清
- 执行操作时简短说明你在做什么
- 可以主动推荐相关的地点或操作
- 回复要简洁但有信息量'''

    # 命令模式的系统提示词 - 严格只执行地图操作（无思考）
    COMMAND_PROMPT = '''你是 GeoCommander 的命令解析器。将用户输入解析为地图操作命令。

## 核心原则
1. **只执行地图操作**，拒绝闲聊问题（如"你好"、"你是谁"、"什么是XX"）
2. **充分利用你的地理知识**，你知道全世界所有地方的坐标
3. 回复简洁

## 工具列表

### fly_to - 飞行到任意位置
用户想去任何地方时使用。你知道世界上所有地方的坐标！
参数：longitude, latitude, altitude（米）, duration（秒，默认2）
高度建议：建筑物300-800m，城市3000-8000m，山峰10000m+

### switch_basemap - 切换底图
参数：type = satellite | vector | terrain | dark
- satellite = 卫星、航拍、影像、遥感、实景
- vector = 矢量、街道、道路、标准、普通、浅色、亮色、白色
- terrain = 地形、高程、等高线
- dark = 深色、暗色、夜间模式、黑色

### set_weather - 天气效果
参数：type = rain | snow | fog | clear, intensity（0-1）
- rain = 下雨、雨天、暴雨、小雨
- snow = 下雪、雪天、暴雪
- fog = 雾、雾霾
- clear = 晴天、放晴、停雨、停雪

### set_time - 时间
参数：preset = day | night | dawn | dusk
- day = 白天、中午、正午
- night = 夜晚、深夜、夜间
- dawn = 黎明、日出、清晨
- dusk = 黄昏、日落、傍晚

### add_marker - 添加标记（会自动飞往该位置）
参数：name, longitude, latitude, color（默认#FF4444）
注意：添加标记后，前端会自动飞往该位置

### clear_markers - 清除标记
### clear_weather - 清除天气（停止天气效果）
### reset_view - 重置视角（回到初始视角、返回初始位置）

## 回复格式 (JSON)
{"message": "简短说明", "tool_call": {"action": "工具名", "arguments": {...}}}

## 示例

"北京" → {"message": "🛫 飞往北京", "tool_call": {"action": "fly_to", "arguments": {"longitude": 116.4074, "latitude": 39.9042, "altitude": 5000, "duration": 2}}}

"白宫" → {"message": "🛫 飞往美国白宫", "tool_call": {"action": "fly_to", "arguments": {"longitude": -77.0365, "latitude": 38.8977, "altitude": 500, "duration": 2}}}

"金字塔" → {"message": "🛫 飞往埃及金字塔", "tool_call": {"action": "fly_to", "arguments": {"longitude": 31.1342, "latitude": 29.9792, "altitude": 1000, "duration": 2}}}

"泰姬陵" → {"message": "🛫 飞往泰姬陵", "tool_call": {"action": "fly_to", "arguments": {"longitude": 78.0421, "latitude": 27.1751, "altitude": 500, "duration": 2}}}

"在武汉大学添加标记" → {"message": "📍 在武汉大学添加标记", "tool_call": {"action": "add_marker", "arguments": {"name": "武汉大学", "longitude": 114.3612, "latitude": 30.5371}}}

"标记故宫" → {"message": "📍 标记故宫", "tool_call": {"action": "add_marker", "arguments": {"name": "故宫", "longitude": 116.3972, "latitude": 39.9169}}}

"浅色" → {"message": "🗺️ 切换到标准地图", "tool_call": {"action": "switch_basemap", "arguments": {"type": "vector"}}}

"暴雪" → {"message": "❄️ 开启暴雪", "tool_call": {"action": "set_weather", "arguments": {"type": "snow", "intensity": 0.8}}}

"日落" → {"message": "🌅 设置黄昏", "tool_call": {"action": "set_time", "arguments": {"preset": "dusk"}}}

"停止天气" → {"message": "☀️ 天气已清除", "tool_call": {"action": "clear_weather", "arguments": {}}}

"重置视角" → {"message": "🔄 视角已重置", "tool_call": {"action": "reset_view", "arguments": {}}}

"你好" → {"message": "❌ 无法识别\\n\\n可用：导航任意地点、底图切换、天气效果、时间设置\\n💡 闲聊请用「对话模式」", "tool_call": null}'''

    # 命令模式的系统提示词 - 带思考过程（深度推理）
    COMMAND_PROMPT_THINKING = '''你是 GeoCommander 的命令解析器。将用户输入解析为地图操作命令。

## 核心原则
1. **只执行地图操作**，拒绝闲聊问题（如"你好"、"你是谁"、"什么是XX"）
2. **充分利用你的地理知识**，你知道全世界所有地方的坐标
3. **先思考再回答**：分析用户意图、识别地点/操作、确定参数

## 工具列表

### fly_to - 飞行到任意位置
用户想去任何地方时使用。你知道世界上所有地方的坐标！
参数：longitude, latitude, altitude（米）, duration（秒，默认2）
高度建议：建筑物300-800m，城市3000-8000m，山峰10000m+

### switch_basemap - 切换底图
参数：type = satellite | vector | terrain | dark

### set_weather - 天气效果
参数：type = rain | snow | fog | clear, intensity（0-1）

### set_time - 时间
参数：preset = day | night | dawn | dusk

### add_marker - 添加标记（会自动飞往该位置）
参数：name, longitude, latitude, color（默认#FF4444）
注意：添加标记后，前端会自动飞往该位置

### clear_markers - 清除标记
### clear_weather - 清除天气（停止天气效果）
### reset_view - 重置视角（回到初始视角、返回初始位置）

## 回复格式 (JSON) - 必须包含 thinking 字段
{
  "thinking": "你的思考过程：1. 识别用户意图 2. 确定操作类型 3. 获取/推断参数",
  "message": "简短说明",
  "tool_call": {"action": "工具名", "arguments": {...}} 或 null
}

## 示例

"武汉大学" → {
  "thinking": "用户想查看武汉大学。武汉大学位于湖北省武汉市，是著名高等学府，主校区坐标约(114.36, 30.54)，建议较低高度500m以便看清校园",
  "message": "🛫 飞往武汉大学",
  "tool_call": {"action": "fly_to", "arguments": {"longitude": 114.3612, "latitude": 30.5371, "altitude": 500, "duration": 2}}
}

"在故宫添加标记" → {
  "thinking": "用户想在故宫位置添加一个标记点。故宫位于北京市中心，坐标约(116.3972, 39.9169)。添加标记后前端会自动飞往",
  "message": "📍 在故宫添加标记",
  "tool_call": {"action": "add_marker", "arguments": {"name": "故宫", "longitude": 116.3972, "latitude": 39.9169}}
}

"暗色地图" → {
  "thinking": "用户想切换底图样式为暗色/深色主题，对应 dark 类型",
  "message": "🗺️ 切换到深色地图",
  "tool_call": {"action": "switch_basemap", "arguments": {"type": "dark"}}
}

"停止天气" → {
  "thinking": "用户想清除当前天气效果，使用 clear_weather 命令",
  "message": "☀️ 天气已清除",
  "tool_call": {"action": "clear_weather", "arguments": {}}
}

"重置视角" → {
  "thinking": "用户想重置视角回到初始位置，使用 reset_view 命令",
  "message": "🔄 视角已重置",
  "tool_call": {"action": "reset_view", "arguments": {}}
}

"你是谁" → {
  "thinking": "这是闲聊问题，不是地图操作命令，应该拒绝并提示用户",
  "message": "❌ 无法识别\\n\\n可用：导航任意地点、底图切换、天气效果、时间设置\\n💡 闲聊请用「对话模式」",
  "tool_call": null
}'''

    # 兼容旧代码
    SYSTEM_PROMPT = CONVERSATION_PROMPT

    def __init__(self, use_llm: bool = False):
        self.use_llm = use_llm
        self.llm_client = None
        self.conversation_history: List[Dict[str, str]] = []
        self.max_history = 10  # 保留最近 10 轮对话
        self._mcp_tools_cache: Optional[str] = None  # MCP 工具描述缓存

        if use_llm:
            from llm_providers import provider_manager
            self.llm_client = provider_manager.get_client()
            if self.llm_client:
                provider = provider_manager.get_active()
                logger.info(
                    f"[ChatAssistant] Using LLM: {provider.name} ({provider.model})")
            else:
                logger.warning(
                    "[ChatAssistant] No LLM provider available, falling back to rules")
                self.use_llm = False

    def _get_mcp_tools_description(self) -> str:
        """获取 MCP 工具描述（用于 System Prompt）"""
        mcp_client = get_mcp_client()
        if mcp_client.connected:
            return mcp_client.get_tools_description()
        return ""

    def _build_dynamic_prompt(self, base_prompt: str) -> str:
        """构建动态 System Prompt，注入 MCP 工具信息"""
        mcp_client = get_mcp_client()

        if not mcp_client.connected:
            return base_prompt

        # 获取 MCP 工具列表
        tools_desc = self._get_mcp_tools_description()

        # 在 prompt 中替换或追加工具信息
        # 查找工具列表标记并替换
        if "## 可用的地图操作工具" in base_prompt:
            # 替换工具列表部分
            import re
            pattern = r"## 可用的地图操作工具\n.*?(?=\n## |\n\n## |$)"
            replacement = f"## 可用的地图操作工具\n{tools_desc}"
            return re.sub(pattern, replacement, base_prompt, flags=re.DOTALL)

        return base_prompt

    def refresh_client(self):
        """刷新 LLM 客户端（模型切换后调用）"""
        from llm_providers import provider_manager
        self.llm_client = provider_manager.get_client()

    async def chat(self, user_input: str, mode: str = 'conversation', thinking: bool = False) -> Dict[str, Any]:
        """
        处理用户输入，返回 AI 回复和可能的工具调用

        Args:
            user_input: 用户输入的文本
            mode: 'command' (命令模式) 或 'conversation' (对话模式)
                  命令模式：使用 LLM 解析指令，但严格只执行地图操作
                  对话模式：使用 LLM 自然对话，可以闲聊也可以执行操作
            thinking: 是否启用思考模式（深度推理），会输出 LLM 的思考过程

        Returns:
            {
                "message": "AI 的回复",
                "tool_call": { "action": ..., "arguments": ... } 或 None,
                "thinking": "思考过程（仅 thinking=True 时）"
            }
        """
        # 根据模式和思考开关选择不同的 system prompt
        if mode == 'command':
            system_prompt = self.COMMAND_PROMPT_THINKING if thinking else self.COMMAND_PROMPT
        else:
            system_prompt = self.CONVERSATION_PROMPT

        # 必须使用 LLM
        if self.use_llm and self.llm_client:
            result = await self._chat_with_llm(user_input, system_prompt, mode)
            if result:
                return result
            # LLM 调用失败
            logger.error("[ChatAssistant] LLM chat failed")
            return {
                "message": "⚠️ AI 服务暂时不可用，请稍后再试。",
                "tool_call": None
            }

        # LLM 未启用或不可用，明确告知用户
        logger.warning("[ChatAssistant] LLM not available")
        return {
            "message": "⚠️ AI 服务未启用。请检查后端配置或联系管理员。",
            "tool_call": None
        }

    # ==================== 以下为内部保留代码，不对外暴露 ====================

    async def _fallback_to_rules(self, user_input: str, mode: str) -> Dict[str, Any]:
        """
        规则解析回退机制（保留但不使用）

        注意：此方法已弃用，保留仅供参考和调试
        生产环境应始终使用 LLM，不应回退到简单规则匹配
        """
        tool_call = self._parse_with_rules(user_input)

        if tool_call:
            action_names = {
                "fly_to": "🛫 飞往目标位置",
                "switch_basemap": "🗺️ 切换底图",
                "add_marker": "📍 添加标记",
                "set_weather": "🌤️ 设置天气效果",
                "set_time": "🕐 设置场景时间",
                "clear_markers": "🗑️ 清除标记",
                "clear_weather": "☀️ 清除天气效果"
            }
            return {
                "message": action_names.get(tool_call.action, f"执行 {tool_call.action}"),
                "tool_call": {
                    "action": tool_call.action,
                    "arguments": tool_call.arguments
                }
            }

        # 无法识别时的回复
        if mode == 'command':
            return {
                "message": "❌ 无法识别的命令\n\n命令模式仅支持地图操作：\n📍 导航：北京、去上海、飞到西湖\n🗺️ 底图：卫星图、矢量、地形\n🌧️ 天气：下雨、下雪、晴天\n🕐 时间：白天、夜晚、黎明\n\n💡 如需自由对话，请切换到「对话模式」",
                "tool_call": None
            }
        else:
            return {
                "message": "抱歉，我暂时无法处理你的请求。可以试试：\n• 飞到北京\n• 切换到卫星图\n• 显示下雨效果",
                "tool_call": None
            }

    async def _chat_with_llm(self, user_input: str, system_prompt: str, mode: str) -> Optional[Dict[str, Any]]:
        """使用 LLM 进行对话"""
        # 构建消息列表，使用传入的 system_prompt
        messages = [
            {"role": "system", "content": system_prompt}
        ]

        # 对话模式下添加历史对话（上下文），命令模式不需要上下文
        if mode == 'conversation':
            messages.extend(self.conversation_history)

        # 添加当前用户输入
        messages.append({"role": "user", "content": user_input})

        try:
            # 命令模式使用较低温度以获得更确定的输出
            temperature = 0.3 if mode == 'command' else 0.7

            response = await self.llm_client.chat(
                messages=messages,
                temperature=temperature,
                max_tokens=1024,
                response_format={"type": "json_object"}
            )

            logger.info(f"[ChatAssistant] LLM response ({mode}): {response}")

            # 解析 JSON 响应
            result = json.loads(response)

            # 对话模式下保存到历史
            if mode == 'conversation':
                self.conversation_history.append(
                    {"role": "user", "content": user_input})
                self.conversation_history.append(
                    {"role": "assistant", "content": result.get("message", "")})

                # 限制历史长度
                if len(self.conversation_history) > self.max_history * 2:
                    self.conversation_history = self.conversation_history[-self.max_history * 2:]

            return {
                "message": result.get("message", "..."),
                "tool_call": result.get("tool_call"),
                "thinking": result.get("thinking"),  # 思考过程（如果有）
                "llm_raw": response  # 添加 LLM 原始输出用于调试
            }

        except json.JSONDecodeError as e:
            logger.error(f"[ChatAssistant] JSON parse error: {e}")
            # 尝试直接返回文本
            return {
                "message": response if isinstance(response, str) else "抱歉，我遇到了一点问题。",
                "tool_call": None
            }
        except Exception as e:
            logger.error(f"[ChatAssistant] LLM error: {e}")
            return None

    # 保留规则解析作为备用
    async def parse(self, user_input: str, mode: str = 'conversation') -> Optional[MCPToolCall]:
        """兼容旧接口：解析用户输入，返回工具调用"""
        result = await self.chat(user_input, mode=mode)
        if result.get("tool_call"):
            tc = result["tool_call"]
            return MCPToolCall(
                id=str(uuid.uuid4()),
                action=tc["action"],
                arguments=tc.get("arguments", {})
            )
        return None

    def _parse_with_rules(self, user_input: str) -> Optional[MCPToolCall]:
        """使用规则匹配解析意图（演示/备用）"""

        text = user_input.strip()
        text_lower = text.lower()

        logger.info(f"[ChatAssistant] Rule parsing: '{text}'")

        # 0. 重置/复位命令
        if text in ["重置", "复位", "reset", "初始化", "恢复默认"]:
            # 清除天气 + 切换到卫星图 (通过返回 clear_weather，让前端处理多步操作)
            return MCPToolCall(
                id=str(uuid.uuid4()),
                action="clear_weather",
                arguments={}
            )

        # 1. 快捷天气命令 - 直接输入天气词
        quick_weather = {
            "下雨": "rain", "雨": "rain", "雨天": "rain",
            "下雪": "snow", "雪": "snow", "雪天": "snow",
            "雾": "fog", "大雾": "fog", "雾天": "fog",
            "晴天": "clear", "晴": "clear", "放晴": "clear", "天晴": "clear"
        }
        if text in quick_weather:
            return MCPToolCall(
                id=str(uuid.uuid4()),
                action="set_weather",
                arguments={"type": quick_weather[text], "intensity": 0.5}
            )

        # 2. 快捷底图命令 - 直接输入底图类型
        quick_basemap = {
            "卫星": "satellite", "卫星图": "satellite", "影像": "satellite",
            "矢量": "vector", "矢量图": "vector", "街道": "vector", "道路": "vector",
            "地形": "terrain", "地形图": "terrain",
            "深色": "dark", "暗色": "dark", "夜间模式": "dark"
        }
        if text in quick_basemap:
            return MCPToolCall(
                id=str(uuid.uuid4()),
                action="switch_basemap",
                arguments={"type": quick_basemap[text]}
            )

        # 3. 快捷地点命令 - 直接输入地名
        if text in LOCATIONS:
            loc = LOCATIONS[text]
            return MCPToolCall(
                id=str(uuid.uuid4()),
                action="fly_to",
                arguments={
                    "longitude": loc.longitude,
                    "latitude": loc.latitude,
                    "altitude": loc.altitude,
                    "duration": 2
                }
            )

        # 4. 底图切换 (带关键词)
        basemap_kw1 = any(kw in text for kw in ["切换", "换成", "显示", "使用"])
        basemap_kw2 = any(kw in text for kw in [
                          "底图", "地图", "影像", "图层", "卫星", "矢量", "地形", "深色"])
        logger.info(
            f"[ChatAssistant] Basemap check: kw1={basemap_kw1}, kw2={basemap_kw2}")
        if basemap_kw1 and basemap_kw2:
            logger.info(f"[ChatAssistant] Matched switch_basemap keywords")
            return self._parse_switch_basemap(text)

        # 5. 飞行指令
        if any(kw in text for kw in ["飞到", "飞往", "前往", "去", "看看"]):
            logger.info(f"[IntentParser] Matched fly_to keywords")
            return self._parse_fly_to(text)

        # 6. 添加标记
        if any(kw in text for kw in ["添加", "标记", "放置", "标注"]) and \
           any(kw in text for kw in ["标记", "点", "图标", "marker"]):
            return self._parse_add_marker(text)

        # 7. 天气效果 (带关键词)
        if any(kw in text for kw in ["天气", "下雨", "下雪", "雾", "晴", "效果"]):
            return self._parse_set_weather(text)

        # 8. 时间设置
        if any(kw in text for kw in ["时间", "白天", "夜晚", "黎明", "黄昏", "日出", "日落"]):
            return self._parse_set_time(text)

        # 9. 清除操作
        if "清除" in text or "清空" in text:
            if "标记" in text:
                return MCPToolCall(
                    id=str(uuid.uuid4()),
                    action="clear_markers",
                    arguments={}
                )
            if "天气" in text:
                return MCPToolCall(
                    id=str(uuid.uuid4()),
                    action="clear_weather",
                    arguments={}
                )

        logger.warning(f"[IntentParser] Could not parse: {text}")
        # 无法解析
        return None

    def _parse_fly_to(self, text: str) -> Optional[MCPToolCall]:
        """解析飞行指令"""

        # 尝试匹配已知地点
        for name, loc in LOCATIONS.items():
            if name in text:
                # 提取高度
                altitude = loc.altitude
                import re
                alt_match = re.search(r'(\d+)\s*(米|m|千米|km)', text)
                if alt_match:
                    value = float(alt_match.group(1))
                    unit = alt_match.group(2)
                    if unit in ['千米', 'km']:
                        value *= 1000
                    altitude = value

                return MCPToolCall(
                    id=str(uuid.uuid4()),
                    action="fly_to",
                    arguments={
                        "longitude": loc.longitude,
                        "latitude": loc.latitude,
                        "altitude": altitude,
                        "duration": 2
                    }
                )

        # 尝试解析经纬度
        import re
        coord_match = re.search(
            r'经度?\s*[:：]?\s*([\d.]+)[°度]?\s*[,，]?\s*纬度?\s*[:：]?\s*([\d.]+)[°度]?',
            text
        )
        if coord_match:
            return MCPToolCall(
                id=str(uuid.uuid4()),
                action="fly_to",
                arguments={
                    "longitude": float(coord_match.group(1)),
                    "latitude": float(coord_match.group(2)),
                    "altitude": 5000,
                    "duration": 2
                }
            )

        return None

    def _parse_switch_basemap(self, text: str) -> Optional[MCPToolCall]:
        """解析底图切换指令"""

        for cn_name, en_type in BASEMAP_TYPES.items():
            if cn_name in text:
                return MCPToolCall(
                    id=str(uuid.uuid4()),
                    action="switch_basemap",
                    arguments={"type": en_type}
                )

        return None

    def _parse_add_marker(self, text: str) -> Optional[MCPToolCall]:
        """解析添加标记指令"""

        # 尝试找到地点
        for name, loc in LOCATIONS.items():
            if name in text:
                # 提取颜色
                color = "#FF4444"  # 默认红色
                color_map = {
                    "红": "#FF4444", "蓝": "#4444FF", "绿": "#44FF44",
                    "黄": "#FFFF44", "橙": "#FF8844", "紫": "#FF44FF",
                    "白": "#FFFFFF", "黑": "#333333"
                }
                for cn_color, hex_color in color_map.items():
                    if cn_color in text:
                        color = hex_color
                        break

                return MCPToolCall(
                    id=str(uuid.uuid4()),
                    action="add_marker",
                    arguments={
                        "name": loc.name,
                        "longitude": loc.longitude,
                        "latitude": loc.latitude,
                        "color": color
                    }
                )

        return None

    def _parse_set_weather(self, text: str) -> Optional[MCPToolCall]:
        """解析天气设置指令"""

        for cn_weather, en_type in WEATHER_TYPES.items():
            if cn_weather in text:
                # 提取强度
                intensity = 0.5
                if "大" in text or "强" in text:
                    intensity = 0.8
                elif "小" in text or "弱" in text:
                    intensity = 0.3

                return MCPToolCall(
                    id=str(uuid.uuid4()),
                    action="set_weather",
                    arguments={
                        "type": en_type,
                        "intensity": intensity
                    }
                )

        return None

    def _parse_set_time(self, text: str) -> Optional[MCPToolCall]:
        """解析时间设置指令"""

        for cn_time, en_preset in TIME_PRESETS.items():
            if cn_time in text:
                return MCPToolCall(
                    id=str(uuid.uuid4()),
                    action="set_time",
                    arguments={"preset": en_preset}
                )

        return None

# ===================== WebSocket 连接管理 =====================


class ConnectionManager:
    """WebSocket 连接管理器"""

    def __init__(self):
        self.active_connections: List[WebSocket] = []
        # 通过环境变量控制是否使用 LLM
        use_llm = os.getenv("USE_LLM", "false").lower() == "true"
        self.assistant = ChatAssistant(use_llm=use_llm)
        # 兼容旧代码
        self.parser = self.assistant

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(
            f"[ConnectionManager] Client connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        print(
            f"[ConnectionManager] Client disconnected. Total: {len(self.active_connections)}")

    async def send_action(self, websocket: WebSocket, tool_call: MCPToolCall):
        """发送动作到客户端"""
        await websocket.send_json({
            "type": "action",
            "id": tool_call.id,
            "payload": {
                "action": tool_call.action,
                "arguments": tool_call.arguments
            }
        })

    async def send_chat_response(self, websocket: WebSocket, message: str, tool_call: Optional[Dict] = None, llm_raw: Optional[str] = None, thinking: Optional[str] = None):
        """发送对话响应到客户端"""
        response_data = {
            "type": "chat_response",
            "message": message,
            "timestamp": datetime.now().isoformat()
        }

        # 如果有工具调用，附加上去
        if tool_call:
            response_data["tool_call"] = {
                "id": str(uuid.uuid4()),
                "action": tool_call.get("action"),
                "arguments": tool_call.get("arguments", {})
            }

        # 添加 LLM 原始输出用于调试
        if llm_raw:
            response_data["llm_raw"] = llm_raw

        # 添加思考过程
        if thinking:
            response_data["thinking"] = thinking

        await websocket.send_json(response_data)

    async def send_system(self, websocket: WebSocket, content: str):
        """发送系统消息"""
        await websocket.send_json({
            "type": "system",
            "content": content,
            "timestamp": datetime.now().isoformat()
        })

    async def handle_message(self, websocket: WebSocket, data: Dict[str, Any]):
        """处理客户端消息"""
        msg_type = data.get("type")

        if msg_type == "ping":
            await websocket.send_json({"type": "pong"})
            return

        if msg_type == "user_command":
            payload = data.get("payload", {})
            user_text = payload.get("text", "")
            mode = payload.get("mode", "conversation")  # 默认对话模式
            thinking = payload.get("thinking", False)   # 是否启用思考模式

            print(
                f"[ConnectionManager] Received message: {user_text} (mode: {mode}, thinking: {thinking})")

            # 使用 ChatAssistant 处理，传入 mode 和 thinking 参数
            result = await self.assistant.chat(user_text, mode=mode, thinking=thinking)

            # 发送对话响应（包含 LLM 原始输出和思考过程用于调试）
            await self.send_chat_response(
                websocket,
                result.get("message", ""),
                result.get("tool_call"),
                result.get("llm_raw"),   # LLM 原始输出
                result.get("thinking")   # 思考过程
            )

            # 如果有工具调用，也发送 action 消息（兼容旧逻辑）
            if result.get("tool_call"):
                tc = result["tool_call"]
                tool_call = MCPToolCall(
                    id=str(uuid.uuid4()),
                    action=tc["action"],
                    arguments=tc.get("arguments", {})
                )
                print(
                    f"[ConnectionManager] Executing action: {tool_call.action}")
                await self.send_action(websocket, tool_call)

        if msg_type == "response":
            # 客户端返回的执行结果
            print(f"[ConnectionManager] Action response: {data}")

# ===================== FastAPI 应用 =====================


manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 GeoCommander Server starting...")

    # 初始化 MCP 客户端
    mcp_command = os.getenv("MCP_SERVER_COMMAND", "python -m mcp_geo_tools")
    print(f"🔌 Connecting to MCP server: {mcp_command}")

    try:
        mcp_client = await init_mcp_client(mcp_command)
        if mcp_client.connected:
            print(f"✅ MCP connected! {len(mcp_client.tools)} tools available")
            for tool in mcp_client.tools:
                print(f"   - {tool.name}")
        else:
            print("⚠️  MCP connection failed, using fallback mode")
    except Exception as e:
        print(f"⚠️  MCP initialization error: {e}")

    # 兼容旧代码的输出
    print(f"📍 Fallback locations: {len(LOCATIONS)}")

    yield

    # 断开 MCP 连接
    mcp_client = get_mcp_client()
    if mcp_client.connected:
        await mcp_client.disconnect()

    print("👋 GeoCommander Server shutting down...")

app = FastAPI(
    title="GeoCommander MCP Server",
    description="基于 MCP 协议的自然语言地理空间指令服务",
    version="1.0.0",
    lifespan=lifespan
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """服务器状态"""
    # 获取 LLM 提供商信息
    llm_info = {"enabled": False, "provider": None}
    try:
        from llm_providers import provider_manager
        provider = provider_manager.get_active()
        if provider:
            llm_info = {
                "enabled": True,
                "provider": provider.name,
                "model": provider.model,
                "type": provider.type.value
            }
    except:
        pass

    # 获取 MCP 状态
    mcp_client = get_mcp_client()
    mcp_info = {
        "connected": mcp_client.connected,
        "tools": [t.name for t in mcp_client.tools] if mcp_client.connected else []
    }

    return {
        "name": "GeoCommander Server",
        "version": "2.0.0",
        "status": "running",
        "mcp": mcp_info,
        "llm": llm_info,
        "fallback_locations": len(LOCATIONS)
    }


@app.get("/tools")
async def get_tools():
    """获取所有 MCP 工具定义"""
    return {
        "tools": [tool.model_dump() for tool in MCP_TOOLS]
    }


@app.get("/locations")
async def get_locations():
    """获取所有已知地点"""
    return {
        "locations": {
            name: loc.model_dump()
            for name, loc in LOCATIONS.items()
        }
    }


# ===================== MCP 相关端点 =====================

@app.get("/mcp/status")
async def mcp_status():
    """获取 MCP 客户端状态"""
    mcp_client = get_mcp_client()
    return {
        "connected": mcp_client.connected,
        "tools_count": len(mcp_client.tools) if mcp_client.connected else 0,
        "tools": [t.name for t in mcp_client.tools] if mcp_client.connected else []
    }


@app.get("/mcp/tools")
async def mcp_tools():
    """获取 MCP 工具列表"""
    mcp_client = get_mcp_client()
    if not mcp_client.connected:
        return {"error": "MCP not connected", "tools": []}

    return {
        "tools": [
            {
                "name": t.name,
                "description": t.description,
                "parameters": t.input_schema
            }
            for t in mcp_client.tools
        ]
    }


@app.get("/mcp/resources")
async def mcp_resources():
    """获取 MCP 资源列表"""
    mcp_client = get_mcp_client()
    if not mcp_client.connected:
        return {"error": "MCP not connected", "resources": []}

    resources = await mcp_client.get_resources()
    return {"resources": resources}


@app.get("/mcp/prompts")
async def mcp_prompts():
    """获取 MCP 提示词列表"""
    mcp_client = get_mcp_client()
    if not mcp_client.connected:
        return {"error": "MCP not connected", "prompts": []}

    prompts = await mcp_client.get_prompts()
    return {"prompts": prompts}


class MCPToolCallRequest(BaseModel):
    """MCP 工具调用请求"""
    tool: str
    arguments: Dict[str, Any] = {}
    broadcast: bool = True  # 是否广播到前端


@app.post("/mcp/call")
async def mcp_call_tool(request: MCPToolCallRequest):
    """
    调用 MCP 工具

    这是测试 MCP 工具的主要端点。
    调用工具后，如果 broadcast=True，会将结果广播到已连接的前端。

    示例请求:
    POST /mcp/call
    {
        "tool": "fly_to_location",
        "arguments": {"name": "北京"},
        "broadcast": true
    }
    """
    mcp_client = get_mcp_client()

    if not mcp_client.connected:
        return {
            "success": False,
            "error": "MCP not connected"
        }

    # 调用 MCP 工具
    result = await mcp_client.call_tool(request.tool, request.arguments)

    logger.info(f"[MCP Call] {request.tool}({request.arguments}) -> {result}")

    # 如果需要广播到前端
    if request.broadcast and result.get("action"):
        tool_call = MCPToolCall(
            id=str(uuid.uuid4()),
            action=result.get("action"),
            arguments=result.get("arguments", {})
        )

        # 广播到所有已连接的客户端
        for ws in manager.active_connections:
            try:
                await manager.send_action(ws, tool_call)
            except Exception as e:
                logger.warning(f"[MCP Call] Failed to broadcast: {e}")

        result["broadcasted"] = True
        result["clients"] = len(manager.active_connections)

    return result


@app.get("/providers")
async def get_providers():
    """获取所有 LLM 服务商"""
    try:
        from llm_providers import provider_manager, check_ollama_available, get_ollama_models

        providers = provider_manager.list_providers()

        # 检查 Ollama 状态
        ollama_available = await check_ollama_available()
        ollama_models = await get_ollama_models() if ollama_available else []

        return {
            "providers": providers,
            "ollama": {
                "available": ollama_available,
                "models": ollama_models
            }
        }
    except Exception as e:
        return {
            "providers": [],
            "error": str(e)
        }


@app.post("/providers/select")
async def select_provider(body: Dict[str, Any]):
    """选择服务商和模型"""
    try:
        from llm_providers import provider_manager

        provider_name = body.get("provider")
        model = body.get("model")

        if provider_name:
            provider_manager.set_active(provider_name)
            logger.info(f"[API] Switched to provider: {provider_name}")

        if model and provider_name:
            provider_manager.set_model(provider_name, model)
            logger.info(f"[API] Set model: {model}")

        # 重新初始化 parser 的 LLM 客户端
        manager.parser.llm_client = provider_manager.get_client()

        active = provider_manager.get_active()
        return {
            "success": True,
            "active_provider": active.name if active else None,
            "model": active.model if active else None
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


class ChatRequest(BaseModel):
    """聊天请求"""
    message: str
    system_prompt: Optional[str] = None


class ExecuteRequest(BaseModel):
    """执行请求 - 用于 MCP Server 远程执行"""
    action: str
    arguments: Dict[str, Any] = {}


@app.post("/execute")
async def execute_action(request: ExecuteRequest):
    """
    执行动作端点 - 供 MCP Server 远程调用

    接收来自 mcp-geo-tools 的动作命令，广播到已连接的 WebSocket 客户端。
    这使得 MCP Server 可以通过 HTTP 直接控制 Cesium 前端。

    Args:
        request: 包含 action 名称和 arguments 参数的请求体

    Returns:
        执行结果，包括成功状态和已通知的客户端数量
    """
    try:
        # 创建工具调用对象
        tool_call = MCPToolCall(
            id=str(uuid.uuid4()),
            action=request.action,
            arguments=request.arguments
        )

        # 广播到所有已连接的 WebSocket 客户端
        connected_count = len(manager.active_connections)

        if connected_count == 0:
            return {
                "success": False,
                "error": "No connected clients",
                "message": "没有已连接的客户端，请确保 Cesium 前端已打开并连接"
            }

        # 向所有客户端发送动作
        for websocket in manager.active_connections:
            try:
                await manager.send_action(websocket, tool_call)
            except Exception as e:
                logger.warning(f"Failed to send action to client: {e}")

        logger.info(f"[Execute API] Executed {request.action} to {connected_count} clients")

        return {
            "success": True,
            "action": request.action,
            "arguments": request.arguments,
            "clients_notified": connected_count,
            "message": f"动作已发送到 {connected_count} 个客户端"
        }

    except Exception as e:
        logger.error(f"[Execute API] Error: {e}")
        return {
            "success": False,
            "error": str(e)
        }


@app.post("/chat")
async def chat(request: ChatRequest):
    """
    简单对话接口 - 测试 LLM 连接

    不涉及 MCP 工具调用，只是纯粹的 LLM 对话
    """
    try:
        from llm_providers import provider_manager

        client = provider_manager.get_client()
        if not client:
            return {
                "success": False,
                "error": "No LLM provider available"
            }

        provider = provider_manager.get_active()

        messages = []
        if request.system_prompt:
            messages.append(
                {"role": "system", "content": request.system_prompt})
        messages.append({"role": "user", "content": request.message})

        try:
            response = await client.chat(messages)
            return {
                "success": True,
                "provider": provider.name if provider else "unknown",
                "model": provider.model if provider else "unknown",
                "response": response
            }
        finally:
            await client.close()

    except Exception as e:
        logger.error(f"[Chat] Error: {e}")
        return {
            "success": False,
            "error": str(e)
        }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket 端点"""
    await manager.connect(websocket)

    try:
        # 发送欢迎消息
        await manager.send_system(
            websocket,
            "已连接到 GeoCommander MCP Server。您可以使用自然语言控制地图，例如：'飞到上海外滩'。"
        )

        while True:
            data = await websocket.receive_json()
            await manager.handle_message(websocket, data)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"[WebSocket] Error: {e}")
        manager.disconnect(websocket)

# ===================== 启动入口 =====================

if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8765,
        reload=True,
        log_level="info"
    )
