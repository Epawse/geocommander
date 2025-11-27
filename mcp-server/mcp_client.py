"""
MCP Client Module - 连接到 mcp-geo-tools MCP 服务器

通过 subprocess + stdio 启动并连接 mcp-geo-tools，
获取工具定义并执行工具调用。
"""

import asyncio
import json
import logging
import os
import sys
from contextlib import AsyncExitStack
from typing import Optional, Dict, Any, List
from dataclasses import dataclass

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

logger = logging.getLogger(__name__)


@dataclass
class MCPTool:
    """MCP 工具定义"""
    name: str
    description: str
    input_schema: Dict[str, Any]

    def to_llm_tool(self) -> Dict[str, Any]:
        """转换为 LLM 工具调用格式"""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.input_schema
        }


class MCPClient:
    """
    MCP 客户端

    连接到 mcp-geo-tools MCP 服务器，获取工具并执行调用。
    """

    def __init__(self):
        self.session: Optional[ClientSession] = None
        self.exit_stack: Optional[AsyncExitStack] = None
        self.tools: List[MCPTool] = []
        self._connected = False
        self._server_process = None

    @property
    def connected(self) -> bool:
        """检查是否已连接"""
        return self._connected and self.session is not None

    async def connect(self, server_command: str = "mcp-geo-tools") -> bool:
        """
        连接到 MCP 服务器

        Args:
            server_command: MCP 服务器启动命令
                - "mcp-geo-tools": 已安装的包
                - "python -m mcp_geo_tools": 模块方式
                - "uvx mcp-geo-tools": 使用 uvx

        Returns:
            是否连接成功
        """
        if self._connected:
            logger.warning("[MCPClient] Already connected")
            return True

        try:
            self.exit_stack = AsyncExitStack()
            await self.exit_stack.__aenter__()

            # 解析命令
            parts = server_command.split()
            command = parts[0]
            args = parts[1:] if len(parts) > 1 else []

            # 创建服务器参数
            server_params = StdioServerParameters(
                command=command,
                args=args,
                env={
                    **os.environ,
                    "MCP_GEO_MODE": "instruction",  # 客户端模式下返回指令
                }
            )

            logger.info(f"[MCPClient] Starting MCP server: {server_command}")

            # 建立 stdio 传输
            stdio_transport = await self.exit_stack.enter_async_context(
                stdio_client(server_params)
            )

            # 创建客户端会话
            self.session = await self.exit_stack.enter_async_context(
                ClientSession(stdio_transport[0], stdio_transport[1])
            )

            # 初始化连接
            await self.session.initialize()

            # 获取工具列表
            await self._load_tools()

            self._connected = True
            logger.info(f"[MCPClient] Connected! {len(self.tools)} tools available")
            return True

        except Exception as e:
            logger.error(f"[MCPClient] Connection failed: {e}")
            await self.disconnect()
            return False

    async def disconnect(self):
        """断开连接"""
        if self.exit_stack:
            try:
                await self.exit_stack.aclose()
            except Exception as e:
                logger.warning(f"[MCPClient] Error during disconnect: {e}")

        self.session = None
        self.exit_stack = None
        self.tools = []
        self._connected = False
        logger.info("[MCPClient] Disconnected")

    async def _load_tools(self):
        """加载工具列表"""
        if not self.session:
            return

        try:
            response = await self.session.list_tools()
            self.tools = [
                MCPTool(
                    name=tool.name,
                    description=tool.description or "",
                    input_schema=tool.inputSchema or {}
                )
                for tool in response.tools
            ]
            logger.info(f"[MCPClient] Loaded {len(self.tools)} tools: {[t.name for t in self.tools]}")
        except Exception as e:
            logger.error(f"[MCPClient] Failed to load tools: {e}")
            self.tools = []

    def get_tools_for_llm(self) -> List[Dict[str, Any]]:
        """
        获取 LLM 可用的工具列表

        Returns:
            工具定义列表，格式适合传递给 LLM
        """
        return [tool.to_llm_tool() for tool in self.tools]

    def get_tools_description(self) -> str:
        """
        获取工具描述文本（用于 System Prompt）

        Returns:
            工具描述的格式化文本
        """
        if not self.tools:
            return "No tools available."

        lines = []
        for tool in self.tools:
            lines.append(f"- {tool.name}: {tool.description}")
        return "\n".join(lines)

    async def call_tool(self, name: str, arguments: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        调用 MCP 工具

        Args:
            name: 工具名称
            arguments: 工具参数

        Returns:
            工具执行结果
        """
        if not self.session:
            return {
                "success": False,
                "error": "Not connected to MCP server"
            }

        arguments = arguments or {}

        try:
            logger.info(f"[MCPClient] Calling tool: {name} with {arguments}")

            result = await self.session.call_tool(name=name, arguments=arguments)

            # 解析结果
            if result.content:
                # MCP 返回的是 content 列表
                content = result.content[0] if len(result.content) == 1 else result.content

                # 如果是文本内容，尝试解析 JSON
                if hasattr(content, 'text'):
                    try:
                        return json.loads(content.text)
                    except json.JSONDecodeError:
                        return {"result": content.text}
                else:
                    return {"result": str(content)}

            return {"success": True, "result": None}

        except Exception as e:
            logger.error(f"[MCPClient] Tool call failed: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def get_resources(self) -> List[Dict[str, Any]]:
        """
        获取 MCP 资源列表

        Returns:
            资源列表
        """
        if not self.session:
            return []

        try:
            response = await self.session.list_resources()
            return [
                {
                    "uri": res.uri,
                    "name": res.name,
                    "description": res.description,
                    "mimeType": res.mimeType
                }
                for res in response.resources
            ]
        except Exception as e:
            logger.error(f"[MCPClient] Failed to list resources: {e}")
            return []

    async def read_resource(self, uri: str) -> Optional[str]:
        """
        读取 MCP 资源

        Args:
            uri: 资源 URI

        Returns:
            资源内容
        """
        if not self.session:
            return None

        try:
            response = await self.session.read_resource(uri)
            if response.contents:
                content = response.contents[0]
                if hasattr(content, 'text'):
                    return content.text
            return None
        except Exception as e:
            logger.error(f"[MCPClient] Failed to read resource {uri}: {e}")
            return None

    async def get_prompts(self) -> List[Dict[str, Any]]:
        """
        获取 MCP 提示词列表

        Returns:
            提示词列表
        """
        if not self.session:
            return []

        try:
            response = await self.session.list_prompts()
            return [
                {
                    "name": prompt.name,
                    "description": prompt.description,
                    "arguments": prompt.arguments
                }
                for prompt in response.prompts
            ]
        except Exception as e:
            logger.error(f"[MCPClient] Failed to list prompts: {e}")
            return []

    async def get_prompt(self, name: str, arguments: Dict[str, str] = None) -> Optional[str]:
        """
        获取 MCP 提示词内容

        Args:
            name: 提示词名称
            arguments: 提示词参数

        Returns:
            提示词内容
        """
        if not self.session:
            return None

        try:
            response = await self.session.get_prompt(name=name, arguments=arguments or {})
            if response.messages:
                # 合并所有消息内容
                contents = []
                for msg in response.messages:
                    if hasattr(msg.content, 'text'):
                        contents.append(msg.content.text)
                    elif isinstance(msg.content, str):
                        contents.append(msg.content)
                return "\n\n".join(contents)
            return None
        except Exception as e:
            logger.error(f"[MCPClient] Failed to get prompt {name}: {e}")
            return None


# 全局 MCP 客户端实例
_mcp_client: Optional[MCPClient] = None


def get_mcp_client() -> MCPClient:
    """获取或创建全局 MCP 客户端实例"""
    global _mcp_client
    if _mcp_client is None:
        _mcp_client = MCPClient()
    return _mcp_client


async def init_mcp_client(server_command: str = None) -> MCPClient:
    """
    初始化并连接 MCP 客户端

    Args:
        server_command: MCP 服务器启动命令，默认从环境变量获取

    Returns:
        已连接的 MCP 客户端
    """
    client = get_mcp_client()

    if client.connected:
        return client

    # 从环境变量或参数获取命令
    command = server_command or os.getenv("MCP_SERVER_COMMAND", "mcp-geo-tools")

    await client.connect(command)
    return client


# 测试代码
async def _test():
    """测试 MCP 客户端"""
    logging.basicConfig(level=logging.INFO)

    client = MCPClient()

    # 使用本地开发版本
    # 需要先安装: cd mcp-geo-tools && pip install -e .
    connected = await client.connect("python -m mcp_geo_tools")

    if connected:
        print("\n=== Tools ===")
        for tool in client.tools:
            print(f"  {tool.name}: {tool.description[:50]}...")

        print("\n=== Resources ===")
        resources = await client.get_resources()
        for res in resources:
            print(f"  {res['uri']}: {res['name']}")

        print("\n=== Prompts ===")
        prompts = await client.get_prompts()
        for prompt in prompts:
            print(f"  {prompt['name']}: {prompt.get('description', '')[:50]}...")

        print("\n=== Test Tool Call ===")
        result = await client.call_tool("fly_to_location", {"name": "北京"})
        print(f"  fly_to_location('北京'): {result}")

        await client.disconnect()
    else:
        print("Failed to connect")


if __name__ == "__main__":
    asyncio.run(_test())
