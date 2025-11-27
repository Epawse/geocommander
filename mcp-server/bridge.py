"""
LLM Bridge - 编排层，连接 LLM 和 MCP 工具

核心职责：
1. 从 MCP 获取工具定义，转换为 LLM 原生 Function Calling 格式
2. 处理 LLM 的工具调用响应，通过 MCP 执行工具
3. 支持多轮工具调用（Agent Loop）
4. 管理对话上下文

架构说明：
- LLM 使用原生 Function/Tool Calling（而非 prompt 工程）
- MCP Server 提供工具定义和执行
- Bridge 负责格式转换和编排

支持的 LLM：
- OpenAI / OpenAI 兼容（tools 参数）
- Vertex AI / Gemini（functionDeclarations）
- Anthropic Claude（tools 参数）
"""

import json
import logging
from typing import Optional, Dict, Any, List, Callable, Awaitable
from dataclasses import dataclass
from enum import Enum

from mcp_client import get_mcp_client, MCPTool

logger = logging.getLogger(__name__)


class ToolCallStatus(Enum):
    """工具调用状态"""
    PENDING = "pending"
    SUCCESS = "success"
    ERROR = "error"


@dataclass
class ToolCall:
    """工具调用记录"""
    id: str
    name: str
    arguments: Dict[str, Any]
    status: ToolCallStatus = ToolCallStatus.PENDING
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


@dataclass
class BridgeResponse:
    """Bridge 响应"""
    message: str  # AI 的文本回复
    tool_calls: List[ToolCall]  # 执行的工具调用
    thinking: Optional[str] = None  # 思考过程（如果有）
    raw_response: Optional[str] = None  # LLM 原始响应


class LLMBridge:
    """
    LLM Bridge - 编排 LLM 和 MCP 工具调用

    使用原生 Function Calling 而非 prompt 工程：
    - 更准确的工具调用
    - 支持多工具并行调用
    - 更好的错误处理
    - 支持 Agent Loop（多轮调用）
    """

    def __init__(self, max_tool_calls: int = 5):
        """
        Args:
            max_tool_calls: 单次请求最大工具调用次数（防止无限循环）
        """
        self.max_tool_calls = max_tool_calls
        self._tools_cache: Optional[List[Dict[str, Any]]] = None
        self._resources_cache: Dict[str, Any] = {}

    def clear_cache(self):
        """清除工具和资源缓存"""
        self._tools_cache = None
        self._resources_cache.clear()
        logger.info("[Bridge] Cache cleared")

    # 在 Function Calling 模式下排除的工具
    # 这些工具依赖预定义数据，LLM 应该直接使用 fly_to 等基础工具
    EXCLUDED_TOOLS_FOR_FC = {
        'fly_to_location',      # LLM 应直接用 fly_to 提供坐标
        'add_marker_at_location',  # LLM 应直接用 add_marker 提供坐标
        'switch_basemap_by_name',  # LLM 应直接用 switch_basemap
        'set_weather_by_name',     # LLM 应直接用 set_weather
        'set_time_by_name',        # LLM 应直接用 set_time
    }

    def get_tools_for_openai(self) -> List[Dict[str, Any]]:
        """
        获取 OpenAI 格式的工具定义

        注意：会排除依赖预定义数据的工具（如 fly_to_location），
        让 LLM 直接使用基础工具（如 fly_to）并提供坐标。

        Returns:
            OpenAI tools 格式的工具列表
            [{"type": "function", "function": {"name": "...", "description": "...", "parameters": {...}}}]
        """
        if self._tools_cache is not None:
            return self._tools_cache

        mcp_client = get_mcp_client()
        if not mcp_client.connected:
            logger.warning("[Bridge] MCP not connected, no tools available")
            return []

        tools = []
        for mcp_tool in mcp_client.tools:
            # 跳过依赖预定义数据的工具
            if mcp_tool.name in self.EXCLUDED_TOOLS_FOR_FC:
                logger.debug(f"[Bridge] Excluding tool for FC: {mcp_tool.name}")
                continue

            tool = {
                "type": "function",
                "function": {
                    "name": mcp_tool.name,
                    "description": mcp_tool.description,
                    "parameters": mcp_tool.input_schema
                }
            }
            tools.append(tool)

        self._tools_cache = tools
        logger.info(f"[Bridge] Loaded {len(tools)} tools for OpenAI format (excluded {len(self.EXCLUDED_TOOLS_FOR_FC)} location-based tools)")
        return tools

    def get_tools_for_gemini(self) -> List[Dict[str, Any]]:
        """
        获取 Gemini/Vertex AI 格式的工具定义

        Returns:
            Gemini functionDeclarations 格式
            [{"name": "...", "description": "...", "parameters": {...}}]
        """
        mcp_client = get_mcp_client()
        if not mcp_client.connected:
            return []

        tools = []
        for mcp_tool in mcp_client.tools:
            # Gemini 使用 functionDeclarations 格式
            tool = {
                "name": mcp_tool.name,
                "description": mcp_tool.description,
                "parameters": mcp_tool.input_schema
            }
            tools.append(tool)

        return tools

    async def get_resource(self, uri: str) -> Optional[Any]:
        """
        获取 MCP 资源（带缓存）

        Args:
            uri: 资源 URI，如 "geo://locations"

        Returns:
            解析后的资源数据（JSON -> dict/list）
        """
        if uri in self._resources_cache:
            return self._resources_cache[uri]

        mcp_client = get_mcp_client()
        if not mcp_client.connected:
            return None

        content = await mcp_client.read_resource(uri)
        if content:
            try:
                data = json.loads(content)
                self._resources_cache[uri] = data
                return data
            except json.JSONDecodeError:
                return content

        return None

    async def get_locations(self) -> Dict[str, Dict[str, Any]]:
        """获取所有地点数据"""
        return await self.get_resource("geo://locations") or {}

    async def get_basemap_types(self) -> Dict[str, Dict[str, Any]]:
        """获取底图类型"""
        return await self.get_resource("geo://basemaps") or {}

    async def get_weather_types(self) -> Dict[str, Dict[str, Any]]:
        """获取天气类型"""
        return await self.get_resource("geo://weather") or {}

    async def get_time_presets(self) -> Dict[str, Dict[str, Any]]:
        """获取时间预设"""
        return await self.get_resource("geo://time-presets") or {}

    async def execute_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """
        执行 MCP 工具

        Args:
            name: 工具名称
            arguments: 工具参数

        Returns:
            工具执行结果
        """
        mcp_client = get_mcp_client()
        if not mcp_client.connected:
            return {"success": False, "error": "MCP not connected"}

        try:
            result = await mcp_client.call_tool(name, arguments)
            logger.info(f"[Bridge] Tool {name} executed: {result}")
            return result
        except Exception as e:
            logger.error(f"[Bridge] Tool {name} failed: {e}")
            return {"success": False, "error": str(e)}

    async def process_tool_calls(
        self,
        tool_calls: List[Dict[str, Any]]
    ) -> List[ToolCall]:
        """
        处理 LLM 返回的工具调用列表

        Args:
            tool_calls: LLM 返回的工具调用列表
                OpenAI 格式: [{"id": "...", "function": {"name": "...", "arguments": "..."}}]

        Returns:
            执行后的 ToolCall 列表
        """
        results = []

        for tc in tool_calls:
            # 解析工具调用（OpenAI 格式）
            tc_id = tc.get("id", "")
            func = tc.get("function", {})
            name = func.get("name", "")

            # arguments 可能是字符串或 dict
            args = func.get("arguments", {})
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = {}

            tool_call = ToolCall(
                id=tc_id,
                name=name,
                arguments=args
            )

            # 执行工具
            result = await self.execute_tool(name, args)

            if result.get("success", True) and "error" not in result:
                tool_call.status = ToolCallStatus.SUCCESS
                tool_call.result = result
            else:
                tool_call.status = ToolCallStatus.ERROR
                tool_call.error = result.get("error", "Unknown error")

            results.append(tool_call)

        return results


# 全局 Bridge 实例
_bridge: Optional[LLMBridge] = None


def get_bridge() -> LLMBridge:
    """获取全局 Bridge 实例"""
    global _bridge
    if _bridge is None:
        _bridge = LLMBridge()
    return _bridge
