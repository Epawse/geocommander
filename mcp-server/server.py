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

# Bridge 层 - 原生 Function Calling 支持
from bridge import get_bridge, LLMBridge, ToolCall, ToolCallStatus

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

# ===================== 知识库（从 MCP 动态获取） =====================
# 注意：地点、底图、天气、时间数据现在从 MCP Server (mcp-geo-tools) 动态获取
# 通过 Bridge 层的资源缓存机制获取，无需在此硬编码
#
# 可用的 MCP 资源：
# - geo://locations - 所有地点坐标
# - geo://basemaps - 底图类型和别名
# - geo://weather - 天气效果和别名
# - geo://time-presets - 时间预设和别名

# ===================== MCP 工具 =====================
# 工具定义现在由 mcp-geo-tools 包提供，通过 MCP 协议动态获取
# 参见 /mcp/tools 端点获取当前可用工具列表

# ===================== 意图解析器 =====================


class ChatAssistant:
    """
    对话式 AI 助手

    功能：
    1. 自然对话 - 回答用户问题，进行友好交流
    2. 指令执行 - 识别并执行地图操作指令
    3. 上下文记忆 - 记住对话历史（可选）
    4. 动态 Prompt - 从 MCP 服务器获取 System Prompt

    支持的 LLM 服务商（参考 Cherry Studio）：
    - Ollama（本地部署）
    - 阿里云百炼（DashScope）
    - 硅基流动（SiliconFlow）
    - DeepSeek
    - OpenAI / OpenAI 兼容
    - Google Vertex AI (Gemini)

    Prompt 来源优先级：
    1. MCP Server (mcp-geo-tools) 的 prompts
    2. 本地硬编码的 fallback prompts
    """

    # MCP Prompt 名称映射
    MCP_PROMPT_NAMES = {
        'conversation': 'geo_assistant',
        'command': 'command_parser',
        'command_thinking': 'command_parser_thinking',
    }

    # ============ Fallback Prompts (当 MCP 不可用时使用) ============
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

### zoom_in - 放大视图（拉近镜头）
参数：factor（0-1，默认0.5，值越小放大越多）
- 放大、拉近、closer

### zoom_out - 缩小视图（拉远镜头）
参数：factor（>1，默认2.0，值越大缩小越多）
- 缩小、拉远、farther

### set_pitch - 调整俯仰角
参数：pitch（-90到0度，-90=俯视，0=平视）
- 俯视、鸟瞰、平视

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

"放大" → {"message": "🔍 视图已放大", "tool_call": {"action": "zoom_in", "arguments": {"factor": 0.5}}}

"缩小" → {"message": "🔍 视图已缩小", "tool_call": {"action": "zoom_out", "arguments": {"factor": 2.0}}}

"俯视" → {"message": "👁️ 切换到俯视角度", "tool_call": {"action": "set_pitch", "arguments": {"pitch": -90}}}

"你好" → {"message": "❌ 无法识别\\n\\n可用：导航任意地点、底图切换、天气效果、时间设置\\n💡 闲聊请用「对话模式」", "tool_call": null}'''

    # 命令模式的系统提示词 - 带思考过程（深度推理）
    COMMAND_PROMPT_THINKING = '''你是 GeoCommander 的命令解析器。将用户输入解析为地图操作命令。

## 核心原则
1. **只执行地图操作**，拒绝闲聊问题（如"你好"、"你是谁"、"什么是XX"）
2. **充分利用你的地理知识**，你知道全世界所有地方的坐标
3. **先思考再回答**：分析用户意图、识别地点/操作、确定参数

## 工具列表

### fly_to - 飞行到任意位置（推荐！）
**始终优先使用 fly_to**，你知道世界上所有地方的坐标！
参数：longitude, latitude, altitude（米）, duration（秒，默认2）
高度建议：建筑物300-800m，城市3000-8000m，山峰10000m+

**拼音识别**：用户可能输入拼音，你需要理解并转换为坐标：
- "kelimulingong" → 克里姆林宫 → fly_to(37.62, 55.75, 500)
- "jinzita" → 金字塔 → fly_to(31.13, 29.98, 1000)
- "aifeiertieta" → 埃菲尔铁塔 → fly_to(2.29, 48.86, 300)
- "changcheng" → 长城 → fly_to(116.02, 40.35, 2000)
- "shandongdaxue" → 山东大学 → fly_to(117.16, 36.67, 500)

### switch_basemap - 切换底图
参数：type = satellite | vector | terrain | dark

### set_weather - 天气效果
参数：type = rain | snow | fog | clear, intensity（0-1）

### set_time - 时间
参数：preset = day | night | dawn | dusk

### add_marker - 添加标记（需要坐标）
参数：name, longitude, latitude, color（默认#FF4444）

### clear_markers - 清除标记
### clear_weather - 清除天气
### reset_view - 重置视角
### zoom_in - 放大视图（factor: 0-1）
### zoom_out - 缩小视图（factor: >1）
### set_pitch - 调整俯仰角（pitch: -90到0）

## 回复格式 (JSON) - 必须包含 thinking 字段
{
  "thinking": "你的思考过程：1. 识别用户意图 2. 确定操作类型 3. 获取/推断参数",
  "message": "简短说明",
  "tool_call": {"action": "工具名", "arguments": {...}} 或 null
}

## 示例

"武汉大学" → {
  "thinking": "用户想查看武汉大学。武汉大学位于湖北省武汉市，主校区坐标约(114.36, 30.54)，建议高度500m以便看清校园",
  "message": "🛫 飞往武汉大学",
  "tool_call": {"action": "fly_to", "arguments": {"longitude": 114.3612, "latitude": 30.5371, "altitude": 500, "duration": 2}}
}

"暗色地图" → {
  "thinking": "用户想切换底图样式为暗色/深色主题，对应 dark 类型",
  "message": "🗺️ 切换到深色地图",
  "tool_call": {"action": "switch_basemap", "arguments": {"type": "dark"}}
}

"kelinmulingong" → {
  "thinking": "用户输入拼音 kelinmulingong，这是克里姆林宫的拼音。克里姆林宫位于俄罗斯莫斯科，坐标约(37.62, 55.75)，建议高度500m",
  "message": "🛫 飞往克里姆林宫",
  "tool_call": {"action": "fly_to", "arguments": {"longitude": 37.6176, "latitude": 55.7520, "altitude": 500, "duration": 2}}
}

"你是谁" → {
  "thinking": "这是闲聊问题，不是地图操作命令，应该拒绝并提示用户",
  "message": "❌ 无法识别\\n\\n可用：导航任意地点、底图切换、天气效果、时间设置\\n💡 闲聊请用「对话模式」",
  "tool_call": null
}'''

    # 兼容旧代码
    SYSTEM_PROMPT = CONVERSATION_PROMPT

    def __init__(self, use_llm: bool = False, use_function_calling: bool = True):
        """
        初始化 ChatAssistant

        Args:
            use_llm: 是否使用 LLM
            use_function_calling: 是否优先使用原生 Function Calling（推荐）
        """
        self.use_llm = use_llm
        self.use_function_calling = use_function_calling  # 原生 Function Calling 开关
        self.llm_client = None
        self.conversation_history: List[Dict[str, Any]] = []  # 支持工具调用消息
        self.max_history = 10  # 保留最近 10 轮对话
        self._mcp_tools_cache: Optional[str] = None  # MCP 工具描述缓存
        self._mcp_prompts_cache: Dict[str, str] = {}  # MCP prompts 缓存
        self._bridge: Optional[LLMBridge] = None  # Bridge 层实例

        if use_llm:
            from llm_providers import provider_manager
            self.llm_client = provider_manager.get_client()
            if self.llm_client:
                provider = provider_manager.get_active()
                logger.info(
                    f"[ChatAssistant] Using LLM: {provider.name} ({provider.model})")
                # 检查是否支持 Function Calling
                if use_function_calling:
                    self._bridge = get_bridge()
                    logger.info("[ChatAssistant] Native Function Calling enabled")
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

    async def _get_mcp_prompt(self, prompt_key: str) -> Optional[str]:
        """
        从 MCP Server 获取 System Prompt

        Args:
            prompt_key: 'conversation', 'command', 或 'command_thinking'

        Returns:
            MCP prompt 内容，如果获取失败返回 None
        """
        # 检查缓存
        if prompt_key in self._mcp_prompts_cache:
            return self._mcp_prompts_cache[prompt_key]

        mcp_client = get_mcp_client()
        if not mcp_client.connected:
            logger.warning(f"[ChatAssistant] MCP not connected, cannot fetch prompt: {prompt_key}")
            return None

        # 获取 MCP prompt 名称
        mcp_prompt_name = self.MCP_PROMPT_NAMES.get(prompt_key)
        if not mcp_prompt_name:
            logger.warning(f"[ChatAssistant] Unknown prompt key: {prompt_key}")
            return None

        try:
            prompt_content = await mcp_client.get_prompt(mcp_prompt_name)
            if prompt_content:
                # 缓存 prompt
                self._mcp_prompts_cache[prompt_key] = prompt_content
                logger.info(f"[ChatAssistant] Loaded MCP prompt: {mcp_prompt_name}")
                return prompt_content
            else:
                logger.warning(f"[ChatAssistant] MCP prompt not found: {mcp_prompt_name}")
                return None
        except Exception as e:
            logger.error(f"[ChatAssistant] Failed to fetch MCP prompt {mcp_prompt_name}: {e}")
            return None

    def clear_prompt_cache(self):
        """清除 prompt 缓存（当 MCP 重连时调用）"""
        self._mcp_prompts_cache.clear()
        logger.info("[ChatAssistant] Prompt cache cleared")

    # 工具中文别名映射
    TOOL_CHINESE_ALIASES = {
        "zoom_in": "放大、拉近视角",
        "zoom_out": "缩小、拉远视角",
        "set_pitch": "俯视、调整俯仰角、鸟瞰",
        "fly_to": "飞到、导航到",
        "fly_to_location": "飞往地点",
        "reset_view": "重置视角、回到初始位置",
        "switch_basemap": "切换底图",
        "set_weather": "设置天气、下雨、下雪、起雾",
        "clear_weather": "停止天气、晴天",
        "add_marker": "添加标记",
        "clear_markers": "清除标记",
    }

    def _build_dynamic_prompt(self, base_prompt: str) -> str:
        """构建动态 System Prompt，注入 MCP 工具信息"""
        mcp_client = get_mcp_client()

        if not mcp_client.connected:
            return base_prompt

        # 获取 MCP 工具列表并添加中文别名
        tools_desc = self._get_mcp_tools_description()

        # 添加中文别名说明
        alias_lines = ["\n\n常用指令映射（中文 → 工具）："]
        for tool_name, aliases in self.TOOL_CHINESE_ALIASES.items():
            alias_lines.append(f"- {aliases} → {tool_name}")
        tools_desc += "\n".join(alias_lines)

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
        # 同时刷新 Bridge 缓存
        if self._bridge:
            self._bridge.clear_cache()

    # ===================== 原生 Function Calling 支持 =====================

    async def _chat_with_function_calling(
        self,
        user_input: str,
        mode: str = 'conversation'
    ) -> Optional[Dict[str, Any]]:
        """
        使用原生 Function Calling 进行对话

        优势：
        1. LLM 原生支持，无需 prompt 工程
        2. 更准确的工具调用
        3. 支持多工具并行调用
        4. 更好的错误处理

        Args:
            user_input: 用户输入
            mode: 'command' 或 'conversation'

        Returns:
            响应字典或 None（如果不支持/失败）
        """
        if not self._bridge or not self.llm_client:
            return None

        # 获取 MCP 工具定义（OpenAI 格式）
        tools = self._bridge.get_tools_for_openai()
        if not tools:
            logger.warning("[ChatAssistant] No tools available for Function Calling")
            return None

        # 构建简洁的系统提示
        system_prompt = self._get_function_calling_system_prompt(mode)

        # 构建消息列表
        messages = [{"role": "system", "content": system_prompt}]

        # 对话模式添加历史
        if mode == 'conversation':
            messages.extend(self.conversation_history[-self.max_history * 2:])

        messages.append({"role": "user", "content": user_input})

        try:
            # 调用 LLM（带工具）
            response = await self.llm_client.chat_with_tools(
                messages=messages,
                tools=tools,
                temperature=0.3 if mode == 'command' else 0.7,
                max_tokens=1024,
                tool_choice="auto"
            )

            logger.info(f"[ChatAssistant] Function Calling response: {response.finish_reason}")

            # 处理工具调用
            tool_call_result = None
            if response.tool_calls:
                # 执行工具调用（只执行第一个）
                tc = response.tool_calls[0]
                func = tc.get("function", {})
                tool_name = func.get("name", "")
                tool_args = func.get("arguments", {})

                if isinstance(tool_args, str):
                    tool_args = json.loads(tool_args)

                # 规范化工具名称（Gemini 可能添加 default_api. 前缀）
                if tool_name.startswith("default_api."):
                    tool_name = tool_name[len("default_api."):]
                    logger.info(f"[ChatAssistant] Normalized tool name: {tool_name}")

                logger.info(f"[ChatAssistant] Executing tool: {tool_name}({tool_args})")

                # 通过 Bridge 执行工具
                exec_result = await self._bridge.execute_tool(tool_name, tool_args)

                # 检查 MCP 是否返回错误（如地点未找到）
                if exec_result.get("error"):
                    logger.warning(f"[ChatAssistant] MCP tool error: {exec_result.get('error')}")
                    # 返回错误消息，不执行 action
                    return {
                        "message": exec_result.get("message", f"操作失败: {exec_result.get('error')}"),
                        "tool_call": None,
                        "error": exec_result.get("error")
                    }

                # 使用 MCP 执行结果（如 fly_to_location 解析为 fly_to + 坐标）
                # 如果 MCP 返回了 action，使用它；否则使用原始工具名
                resolved_action = exec_result.get("action", tool_name)
                resolved_args = exec_result.get("arguments", tool_args)

                tool_call_result = {
                    "action": resolved_action,
                    "arguments": resolved_args
                }

                logger.info(f"[ChatAssistant] Resolved action: {resolved_action}({resolved_args})")

            # 构建响应
            result = {
                "message": response.content or "好的，已执行操作。",
                "tool_call": tool_call_result,
                "llm_raw": json.dumps(response.raw_response, ensure_ascii=False) if response.raw_response else None
            }

            # 对话模式更新历史
            if mode == 'conversation':
                self.conversation_history.append({"role": "user", "content": user_input})
                self.conversation_history.append({
                    "role": "assistant",
                    "content": response.content,
                    "tool_calls": response.tool_calls
                })

            return result

        except Exception as e:
            logger.error(f"[ChatAssistant] Function Calling error: {e}")
            return None

    def _get_function_calling_system_prompt(self, mode: str) -> str:
        """
        获取 Function Calling 模式的系统提示

        命令模式：直接执行，不追问，使用默认参数
        对话模式：可以互动，但也应积极执行操作
        """
        if mode == 'command':
            return """你是 GeoCommander 地图命令解析器。

## 核心原则
1. **立即执行** - 收到指令立即调用工具，不追问、不确认
2. **使用默认值** - 参数不明确时使用合理默认值
3. **只处理地图操作** - 拒绝闲聊，只执行地图相关指令

## 关键指令映射（必须直接执行）
- "放大" → zoom_in(factor=0.5)
- "缩小" → zoom_out(factor=2.0)
- "俯视/鸟瞰" → set_pitch(pitch=-90)
- "平视" → set_pitch(pitch=-30)
- "重置" → reset_view()
- "下雨" → set_weather(type="rain", intensity=0.5)
- "下雪" → set_weather(type="snow", intensity=0.5)
- "晴天/停止天气" → clear_weather()
- "白天" → set_time(preset="day")
- "夜晚" → set_time(preset="night")
- "黄昏/日落" → set_time(preset="dusk")
- "黎明/日出" → set_time(preset="dawn")
- "卫星图" → switch_basemap(type="satellite")
- "矢量图/街道图" → switch_basemap(type="vector")
- "地形图" → switch_basemap(type="terrain")
- "深色/暗色" → switch_basemap(type="dark")

## 地点导航 - 极其重要！
**必须使用 fly_to**，直接提供坐标（你知道世界上所有地点的坐标）：
- fly_to(longitude, latitude, altitude) - 适用于任何地点
- 例如：fly_to(116.4, 39.9, 5000) 飞往北京
- 例如：fly_to(37.62, 55.75, 500) 飞往克里姆林宫
- 例如：fly_to(31.13, 29.98, 1000) 飞往吉萨金字塔
- 例如：fly_to(117.16, 36.67, 500) 飞往山东大学

**拼音识别**：用户可能输入拼音，你需要理解并转换为坐标：
- "kelimulingong" → 克里姆林宫 → fly_to(37.62, 55.75, 500)
- "jinzita" → 金字塔 → fly_to(31.13, 29.98, 1000)
- "aifeiertieta" → 埃菲尔铁塔 → fly_to(2.29, 48.86, 300)
- "shandongdaxue" → 山东大学 → fly_to(117.16, 36.67, 500)

## 重要
- **绝对不要使用 fly_to_location**，始终使用 fly_to 并提供坐标
- 绝对不要追问"您想放大多少"之类的问题
- 绝对不要要求用户提供更多信息
- 直接使用默认参数执行操作"""
        else:
            return """你是 GeoCommander，一个智能地理空间助手。

## 你的能力
1. **地图操作** - 导航、底图切换、天气、时间、标记等
2. **自然对话** - 友好交流，回答地理问题
3. **地理知识** - 你知道世界上所有地点的坐标

## 行为准则
- 当用户表达操作意图时，立即调用相应工具
- 可以简短解释正在做什么
- 如果用户闲聊，友好回应并推荐探索功能
- 优先执行操作，而非询问确认

## 默认参数
- 放大: factor=0.5
- 缩小: factor=2.0
- 天气强度: intensity=0.5
- 飞行高度: 建筑物500m, 城市5000m, 山峰10000m"""

    async def chat(self, user_input: str, mode: str = 'conversation', thinking: bool = False) -> Dict[str, Any]:
        """
        处理用户输入，返回 AI 回复和可能的工具调用

        执行策略（按优先级）：
        1. 原生 Function Calling（推荐，更准确）
        2. Prompt-based JSON 响应（回退方案）

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
        if not self.use_llm or not self.llm_client:
            logger.warning("[ChatAssistant] LLM not available")
            return {
                "message": "⚠️ AI 服务未启用。请检查后端配置或联系管理员。",
                "tool_call": None
            }

        # 策略1: 优先使用原生 Function Calling（不支持 thinking 模式时）
        if self.use_function_calling and self._bridge and not thinking:
            logger.info("[ChatAssistant] Trying native Function Calling...")
            result = await self._chat_with_function_calling(user_input, mode)
            if result:
                logger.info("[ChatAssistant] Function Calling succeeded")
                return result
            logger.warning("[ChatAssistant] Function Calling failed, falling back to prompt-based")

        # 策略2: 回退到 Prompt-based JSON 响应
        logger.info("[ChatAssistant] Using prompt-based approach...")

        # 确定 prompt key
        if mode == 'command':
            prompt_key = 'command_thinking' if thinking else 'command'
        else:
            prompt_key = 'conversation'

        # 优先从 MCP 获取 prompt
        mcp_prompt = await self._get_mcp_prompt(prompt_key)

        if mcp_prompt:
            # 使用 MCP prompt（已包含完整信息，不需要额外注入）
            system_prompt = mcp_prompt
            logger.debug(f"[ChatAssistant] Using MCP prompt: {prompt_key}")
        else:
            # 回退到本地硬编码 prompt
            logger.info(f"[ChatAssistant] MCP prompt unavailable, using fallback: {prompt_key}")
            if mode == 'command':
                base_prompt = self.COMMAND_PROMPT_THINKING if thinking else self.COMMAND_PROMPT
            else:
                base_prompt = self.CONVERSATION_PROMPT
            # 动态注入 MCP 工具列表（仅 fallback 模式需要）
            system_prompt = self._build_dynamic_prompt(base_prompt)

        result = await self._chat_with_llm(user_input, system_prompt, mode)
        if result:
            return result

        # LLM 调用失败
        logger.error("[ChatAssistant] LLM chat failed")
        return {
            "message": "⚠️ AI 服务暂时不可用，请稍后再试。",
            "tool_call": None
        }

    # ==================== Prompt-based LLM 调用（回退方案）====================

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

    # 兼容旧接口
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

            # 发送对话响应（包含工具调用、LLM 原始输出和思考过程）
            # 注意：tool_call 已包含在 chat_response 中，前端会处理执行
            await self.send_chat_response(
                websocket,
                result.get("message", ""),
                result.get("tool_call"),
                result.get("llm_raw"),   # LLM 原始输出
                result.get("thinking")   # 思考过程
            )

            if result.get("tool_call"):
                tc = result["tool_call"]
                print(f"[ConnectionManager] Tool call: {tc['action']}({tc.get('arguments', {})})")

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

    # 预热 Bridge 资源缓存
    bridge = get_bridge()
    locations = await bridge.get_locations()
    print(f"📍 MCP locations loaded: {len(locations)}")

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

    # 获取 locations 数量
    bridge = get_bridge()
    locations_count = len(await bridge.get_locations())

    return {
        "name": "GeoCommander Server",
        "version": "2.0.0",
        "status": "running",
        "mcp": mcp_info,
        "llm": llm_info,
        "locations_count": locations_count,
        "function_calling": True  # 新增: 支持原生 Function Calling
    }


@app.get("/tools")
async def get_tools():
    """获取所有 MCP 工具定义（从 MCP Server 获取）"""
    mcp_client = get_mcp_client()
    if mcp_client.connected:
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
    # MCP 未连接时返回空列表
    return {"tools": [], "error": "MCP not connected"}


@app.get("/locations")
async def get_locations():
    """获取所有已知地点（从 MCP 资源获取）"""
    bridge = get_bridge()
    locations = await bridge.get_locations()
    return {"locations": locations}


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


@app.get("/model")
async def get_current_model():
    """获取当前使用的 LLM 模型"""
    try:
        from llm_providers import provider_manager
        provider = provider_manager.get_active()
        if provider:
            return {
                "model": provider.model,
                "provider": provider.name,
                "type": provider.type.value
            }
        return {"model": None, "provider": None}
    except Exception as e:
        return {"model": None, "error": str(e)}


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
