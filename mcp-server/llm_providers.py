"""
LLM Providers - 多服务商支持

参考 Cherry Studio 的设计，支持：
- OpenAI 兼容接口（OpenAI, 阿里云百炼, 硅基流动, DeepSeek 等）
- Google Vertex AI (Gemini)
- Ollama 本地部署
- 自定义服务商

所有服务商都使用统一的 OpenAI 兼容格式，只需配置：
- api_key: API 密钥
- base_url: 服务地址
- model: 模型名称
"""

import os
import json
import httpx
import time
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)


class ProviderType(Enum):
    """服务商类型"""
    OPENAI = "openai"
    OLLAMA = "ollama"
    DASHSCOPE = "dashscope"  # 阿里云百炼
    SILICONFLOW = "siliconflow"  # 硅基流动
    DEEPSEEK = "deepseek"
    VERTEX_AI = "vertex_ai"  # Google Vertex AI (Gemini)
    CUSTOM = "custom"  # 自定义 OpenAI 兼容


@dataclass
class LLMProvider:
    """LLM 服务商配置"""
    name: str
    type: ProviderType
    api_key: str
    base_url: str
    model: str
    enabled: bool = True

    # 可选配置
    timeout: int = 30
    max_tokens: int = 1024
    temperature: float = 0.7

    # Vertex AI 专用（两种配置方式）
    # 方式1: JSON 文件路径
    service_account_json: str = ""
    # 方式2: 直接填写（Cherry Studio 风格）
    client_email: str = ""  # 服务账号邮箱
    private_key: str = ""   # 私钥（PEM 格式）
    project_id: str = ""    # GCP 项目 ID
    location: str = "us-central1"  # 区域


# 预设服务商配置
PRESET_PROVIDERS: Dict[ProviderType, Dict[str, str]] = {
    ProviderType.OPENAI: {
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini"
    },
    ProviderType.OLLAMA: {
        "base_url": "http://localhost:11434/v1",
        "default_model": "qwen2.5:7b",
        "api_key": "ollama"  # Ollama 不需要真实 key
    },
    ProviderType.DASHSCOPE: {
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "default_model": "qwen-plus"
    },
    ProviderType.SILICONFLOW: {
        "base_url": "https://api.siliconflow.cn/v1",
        "default_model": "Qwen/Qwen2.5-7B-Instruct"
    },
    ProviderType.DEEPSEEK: {
        "base_url": "https://api.deepseek.com/v1",
        "default_model": "deepseek-chat"
    },
    ProviderType.VERTEX_AI: {
        "default_model": "gemini-2.0-flash-lite",
        "default_location": "us-central1"
    }
}


class VertexAIAuth:
    """
    Google Vertex AI 认证管理

    支持两种配置方式：
    1. 服务账号 JSON 文件（传统方式）
    2. 直接填写邮箱和私钥（Cherry Studio 风格）
    """

    def __init__(
        self,
        service_account_json: str = "",
        client_email: str = "",
        private_key: str = "",
        project_id: str = ""
    ):
        """
        Args:
            service_account_json: 服务账号 JSON 文件路径或 JSON 字符串
            client_email: 服务账号邮箱（直接配置方式）
            private_key: 私钥 PEM 格式（直接配置方式）
            project_id: GCP 项目 ID
        """
        self.credentials: Dict[str, str] = {}

        # 方式1: 使用 JSON 文件
        if service_account_json:
            if os.path.isfile(service_account_json):
                with open(service_account_json, 'r') as f:
                    self.credentials = json.load(f)
            else:
                self.credentials = json.loads(service_account_json)
        # 方式2: 直接填写邮箱和私钥（Cherry Studio 风格）
        elif client_email and private_key:
            self.credentials = {
                "client_email": client_email,
                "private_key": private_key,
                "project_id": project_id
            }
        else:
            raise ValueError("Vertex AI 需要配置服务账号 JSON 或邮箱+私钥")

        self.access_token: Optional[str] = None
        self.token_expiry: float = 0

    def _create_jwt(self) -> str:
        """创建 JWT token 用于获取 access token"""
        import base64
        import hashlib
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        from cryptography.hazmat.backends import default_backend

        now = int(time.time())

        # JWT Header
        header = {
            "alg": "RS256",
            "typ": "JWT"
        }

        # JWT Payload
        payload = {
            "iss": self.credentials["client_email"],
            "sub": self.credentials["client_email"],
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 3600,  # 1 hour
            "scope": "https://www.googleapis.com/auth/cloud-platform"
        }

        # Base64url encode
        def b64url_encode(data: bytes) -> str:
            return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')

        header_b64 = b64url_encode(json.dumps(header).encode())
        payload_b64 = b64url_encode(json.dumps(payload).encode())

        # Sign
        message = f"{header_b64}.{payload_b64}".encode()

        private_key = serialization.load_pem_private_key(
            self.credentials["private_key"].encode(),
            password=None,
            backend=default_backend()
        )

        signature = private_key.sign(
            message,
            padding.PKCS1v15(),
            hashes.SHA256()
        )

        signature_b64 = b64url_encode(signature)

        return f"{header_b64}.{payload_b64}.{signature_b64}"

    async def get_access_token(self) -> str:
        """获取有效的 access token"""
        # 检查现有 token 是否有效
        if self.access_token and time.time() < self.token_expiry - 60:
            return self.access_token

        # 获取新 token
        jwt_token = self._create_jwt()

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": jwt_token
                }
            )
            response.raise_for_status()
            data = response.json()

            self.access_token = data["access_token"]
            self.token_expiry = time.time() + data.get("expires_in", 3600)

            return self.access_token

    @property
    def project_id(self) -> str:
        return self.credentials.get("project_id", "")


@dataclass
class ChatResponse:
    """聊天响应（支持 Function Calling）"""
    content: str  # 文本内容
    tool_calls: Optional[List[Dict[str, Any]]] = None  # 工具调用列表
    finish_reason: str = "stop"  # 结束原因: stop, tool_calls, length
    raw_response: Optional[Dict[str, Any]] = None  # 原始响应


class LLMClient:
    """
    统一的 LLM 客户端

    使用 OpenAI 兼容的 Chat Completions API
    支持 Vertex AI (Gemini) 的特殊处理
    支持原生 Function Calling（tools 参数）
    """

    def __init__(self, provider: LLMProvider):
        self.provider = provider
        self.client = httpx.AsyncClient(timeout=provider.timeout)
        self.vertex_auth: Optional[VertexAIAuth] = None

        # 初始化 Vertex AI 认证（支持两种方式）
        if provider.type == ProviderType.VERTEX_AI:
            if provider.service_account_json:
                # 方式1: JSON 文件
                self.vertex_auth = VertexAIAuth(
                    service_account_json=provider.service_account_json)
            elif provider.client_email and provider.private_key:
                # 方式2: 直接填写邮箱和私钥（Cherry Studio 风格）
                self.vertex_auth = VertexAIAuth(
                    client_email=provider.client_email,
                    private_key=provider.private_key,
                    project_id=provider.project_id
                )

    async def chat_with_tools(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        tool_choice: str = "auto"
    ) -> ChatResponse:
        """
        带工具调用的聊天请求（原生 Function Calling）

        Args:
            messages: 消息列表
            tools: 工具定义列表（OpenAI 格式）
            temperature: 温度参数
            max_tokens: 最大 token 数
            tool_choice: 工具选择策略 ("auto", "none", "required")

        Returns:
            ChatResponse 包含文本内容和可能的工具调用
        """
        if self.provider.type == ProviderType.VERTEX_AI:
            return await self._chat_with_tools_vertex_ai(
                messages, tools, temperature, max_tokens, tool_choice
            )
        else:
            return await self._chat_with_tools_openai(
                messages, tools, temperature, max_tokens, tool_choice
            )

    async def _chat_with_tools_openai(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        tool_choice: str = "auto"
    ) -> ChatResponse:
        """OpenAI 兼容接口的 Function Calling"""
        url = f"{self.provider.base_url.rstrip('/')}/chat/completions"

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.provider.api_key}"
        }

        payload: Dict[str, Any] = {
            "model": self.provider.model,
            "messages": messages,
            "temperature": temperature or self.provider.temperature,
            "max_tokens": max_tokens or self.provider.max_tokens
        }

        # 添加工具定义
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = tool_choice

        try:
            response = await self.client.post(url, headers=headers, json=payload)
            response.raise_for_status()

            data = response.json()
            choice = data["choices"][0]
            message = choice["message"]

            return ChatResponse(
                content=message.get("content", ""),
                tool_calls=message.get("tool_calls"),
                finish_reason=choice.get("finish_reason", "stop"),
                raw_response=data
            )

        except httpx.HTTPStatusError as e:
            raise Exception(
                f"LLM API error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise Exception(f"LLM request failed: {str(e)}")

    async def _chat_with_tools_vertex_ai(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        tool_choice: str = "auto"
    ) -> ChatResponse:
        """Vertex AI (Gemini) 的 Function Calling"""
        if not self.vertex_auth:
            raise Exception("Vertex AI auth not configured")

        access_token = await self.vertex_auth.get_access_token()

        project_id = self.provider.project_id or self.vertex_auth.project_id
        location = self.provider.location
        model = self.provider.model

        url = f"https://{location}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/publishers/google/models/{model}:generateContent"

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}"
        }

        # 转换消息格式
        contents = []
        system_instruction = None

        for msg in messages:
            role = msg["role"]
            content = msg.get("content", "")

            if role == "system":
                system_instruction = {"parts": [{"text": content}]}
            elif role == "user":
                contents.append({"role": "user", "parts": [{"text": content}]})
            elif role == "assistant":
                # 处理 assistant 消息（可能包含工具调用）
                parts = []
                if content:
                    parts.append({"text": content})
                if msg.get("tool_calls"):
                    for tc in msg["tool_calls"]:
                        func = tc.get("function", {})
                        args = func.get("arguments", {})
                        if isinstance(args, str):
                            args = json.loads(args)
                        parts.append({
                            "functionCall": {
                                "name": func.get("name"),
                                "args": args
                            }
                        })
                contents.append({"role": "model", "parts": parts})
            elif role == "tool":
                # 工具响应
                contents.append({
                    "role": "function",
                    "parts": [{
                        "functionResponse": {
                            "name": msg.get("tool_call_id", ""),
                            "response": {"result": content}
                        }
                    }]
                })

        payload: Dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature or self.provider.temperature,
                "maxOutputTokens": max_tokens or self.provider.max_tokens
            }
        }

        if system_instruction:
            payload["systemInstruction"] = system_instruction

        # 添加工具定义（Gemini 格式）
        if tools:
            # 转换 OpenAI 格式到 Gemini 格式
            function_declarations = []
            for tool in tools:
                if tool.get("type") == "function":
                    func = tool["function"]
                    function_declarations.append({
                        "name": func["name"],
                        "description": func.get("description", ""),
                        "parameters": func.get("parameters", {})
                    })

            payload["tools"] = [{"functionDeclarations": function_declarations}]

            # Gemini 的 tool_choice 配置
            if tool_choice == "required":
                payload["toolConfig"] = {"functionCallingConfig": {"mode": "ANY"}}
            elif tool_choice == "none":
                payload["toolConfig"] = {"functionCallingConfig": {"mode": "NONE"}}

        try:
            response = await self.client.post(url, headers=headers, json=payload)
            response.raise_for_status()

            data = response.json()
            candidates = data.get("candidates", [])

            if not candidates:
                return ChatResponse(content="", finish_reason="stop")

            candidate = candidates[0]
            parts = candidate.get("content", {}).get("parts", [])

            # 解析响应
            text_content = ""
            tool_calls = []

            for i, part in enumerate(parts):
                if "text" in part:
                    text_content += part["text"]
                elif "functionCall" in part:
                    fc = part["functionCall"]
                    tool_calls.append({
                        "id": f"call_{i}",
                        "type": "function",
                        "function": {
                            "name": fc["name"],
                            "arguments": json.dumps(fc.get("args", {}))
                        }
                    })

            finish_reason = candidate.get("finishReason", "STOP")
            if tool_calls:
                finish_reason = "tool_calls"

            return ChatResponse(
                content=text_content,
                tool_calls=tool_calls if tool_calls else None,
                finish_reason=finish_reason,
                raw_response=data
            )

        except httpx.HTTPStatusError as e:
            raise Exception(
                f"Vertex AI error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise Exception(f"Vertex AI request failed: {str(e)}")

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        response_format: Optional[Dict] = None
    ) -> str:
        """
        发送聊天请求

        Args:
            messages: 消息列表 [{"role": "system", "content": "..."}, ...]
            temperature: 温度参数
            max_tokens: 最大 token 数
            response_format: 响应格式（如 {"type": "json_object"}）

        Returns:
            模型回复内容
        """
        if self.provider.type == ProviderType.VERTEX_AI:
            return await self._chat_vertex_ai(messages, temperature, max_tokens, response_format)
        else:
            return await self._chat_openai_compatible(messages, temperature, max_tokens, response_format)

    async def _chat_openai_compatible(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        response_format: Optional[Dict] = None
    ) -> str:
        """OpenAI 兼容接口"""
        url = f"{self.provider.base_url.rstrip('/')}/chat/completions"

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.provider.api_key}"
        }

        payload: Dict[str, Any] = {
            "model": self.provider.model,
            "messages": messages,
            "temperature": temperature or self.provider.temperature,
            "max_tokens": max_tokens or self.provider.max_tokens
        }

        if response_format:
            payload["response_format"] = response_format

        try:
            response = await self.client.post(url, headers=headers, json=payload)
            response.raise_for_status()

            data = response.json()
            return data["choices"][0]["message"]["content"]

        except httpx.HTTPStatusError as e:
            raise Exception(
                f"LLM API error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise Exception(f"LLM request failed: {str(e)}")

    async def _chat_vertex_ai(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        response_format: Optional[Dict] = None
    ) -> str:
        """
        Vertex AI (Gemini) 接口

        使用 Gemini REST API
        https://cloud.google.com/vertex-ai/docs/generative-ai/model-reference/gemini
        """
        if not self.vertex_auth:
            raise Exception("Vertex AI auth not configured")

        # 获取 access token
        access_token = await self.vertex_auth.get_access_token()

        # 构建 URL
        project_id = self.provider.project_id or self.vertex_auth.project_id
        location = self.provider.location
        model = self.provider.model

        url = f"https://{location}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/publishers/google/models/{model}:generateContent"

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}"
        }

        # 转换消息格式为 Gemini 格式
        contents = []
        system_instruction = None

        for msg in messages:
            role = msg["role"]
            content = msg["content"]

            if role == "system":
                system_instruction = {"parts": [{"text": content}]}
            elif role == "user":
                contents.append({"role": "user", "parts": [{"text": content}]})
            elif role == "assistant":
                contents.append(
                    {"role": "model", "parts": [{"text": content}]})

        payload: Dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature or self.provider.temperature,
                "maxOutputTokens": max_tokens or self.provider.max_tokens
            }
        }

        if system_instruction:
            payload["systemInstruction"] = system_instruction

        # 如果需要 JSON 输出
        if response_format and response_format.get("type") == "json_object":
            payload["generationConfig"]["responseMimeType"] = "application/json"

        try:
            response = await self.client.post(url, headers=headers, json=payload)
            response.raise_for_status()

            data = response.json()

            # 提取回复内容
            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    return parts[0].get("text", "")

            raise Exception("No response from Vertex AI")

        except httpx.HTTPStatusError as e:
            raise Exception(
                f"Vertex AI error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise Exception(f"Vertex AI request failed: {str(e)}")

    async def close(self):
        await self.client.aclose()


class ProviderManager:
    """
    服务商管理器

    支持：
    - 从环境变量/配置文件加载
    - 多服务商切换
    - 自动选择可用服务商
    """

    def __init__(self):
        self.providers: Dict[str, LLMProvider] = {}
        self.active_provider: Optional[str] = None
        self._load_from_env()

    def _load_from_env(self):
        """从环境变量加载配置"""

        # 1. Ollama（本地，优先检测）
        ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
        ollama_model = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
        self.add_provider(LLMProvider(
            name="ollama",
            type=ProviderType.OLLAMA,
            api_key="ollama",
            base_url=ollama_url,
            model=ollama_model
        ))

        # 2. 阿里云百炼
        dashscope_key = os.getenv("DASHSCOPE_API_KEY")
        if dashscope_key:
            self.add_provider(LLMProvider(
                name="dashscope",
                type=ProviderType.DASHSCOPE,
                api_key=dashscope_key,
                base_url=PRESET_PROVIDERS[ProviderType.DASHSCOPE]["base_url"],
                model=os.getenv("DASHSCOPE_MODEL", "qwen-plus")
            ))

        # 3. 硅基流动
        siliconflow_key = os.getenv("SILICONFLOW_API_KEY")
        if siliconflow_key:
            self.add_provider(LLMProvider(
                name="siliconflow",
                type=ProviderType.SILICONFLOW,
                api_key=siliconflow_key,
                base_url=PRESET_PROVIDERS[ProviderType.SILICONFLOW]["base_url"],
                model=os.getenv("SILICONFLOW_MODEL",
                                "Qwen/Qwen2.5-7B-Instruct")
            ))

        # 4. DeepSeek
        deepseek_key = os.getenv("DEEPSEEK_API_KEY")
        if deepseek_key:
            self.add_provider(LLMProvider(
                name="deepseek",
                type=ProviderType.DEEPSEEK,
                api_key=deepseek_key,
                base_url=PRESET_PROVIDERS[ProviderType.DEEPSEEK]["base_url"],
                model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
            ))

        # 5. OpenAI
        openai_key = os.getenv("OPENAI_API_KEY")
        if openai_key:
            self.add_provider(LLMProvider(
                name="openai",
                type=ProviderType.OPENAI,
                api_key=openai_key,
                base_url=os.getenv(
                    "OPENAI_BASE_URL", PRESET_PROVIDERS[ProviderType.OPENAI]["base_url"]),
                model=os.getenv("OPENAI_MODEL", "gpt-4o-mini")
            ))

        # 6. Vertex AI (Google Gemini) - 两种配置方式
        vertex_json = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        vertex_email = os.getenv("VERTEX_CLIENT_EMAIL")
        vertex_private_key = os.getenv("VERTEX_PRIVATE_KEY")

        if vertex_json and os.path.exists(vertex_json):
            # 方式1: JSON 文件
            self.add_provider(LLMProvider(
                name="vertex_ai",
                type=ProviderType.VERTEX_AI,
                api_key="",
                base_url="",
                model=os.getenv("VERTEX_MODEL", "gemini-2.5-flash-lite"),
                service_account_json=vertex_json,
                project_id=os.getenv("VERTEX_PROJECT_ID") or "",
                location=os.getenv("VERTEX_LOCATION", "us-central1")
            ))
        elif vertex_email and vertex_private_key:
            # 方式2: Cherry Studio 风格 - 直接填写邮箱和私钥
            self.add_provider(LLMProvider(
                name="vertex_ai",
                type=ProviderType.VERTEX_AI,
                api_key="",
                base_url="",
                model=os.getenv("VERTEX_MODEL", "gemini-2.5-flash-lite"),
                client_email=vertex_email,
                private_key=vertex_private_key.replace("\\n", "\n"),  # 处理转义换行符
                project_id=os.getenv("VERTEX_PROJECT_ID") or "",
                location=os.getenv("VERTEX_LOCATION", "us-central1")
            ))

        # 7. 自定义服务商（通用 OpenAI 兼容）
        custom_key = os.getenv("LLM_API_KEY")
        custom_url = os.getenv("LLM_BASE_URL")
        custom_model = os.getenv("LLM_MODEL")
        if custom_key and custom_url and custom_model:
            self.add_provider(LLMProvider(
                name="custom",
                type=ProviderType.CUSTOM,
                api_key=custom_key,
                base_url=custom_url,
                model=custom_model
            ))

        # 设置默认激活的服务商（按优先级）
        priority = ["custom", "vertex_ai", "dashscope",
                    "siliconflow", "deepseek", "openai", "ollama"]
        for name in priority:
            if name in self.providers and self.providers[name].enabled:
                self.active_provider = name
                break

    def add_provider(self, provider: LLMProvider):
        """添加服务商"""
        self.providers[provider.name] = provider

    def set_active(self, name: str):
        """设置激活的服务商"""
        if name not in self.providers:
            raise ValueError(f"Provider '{name}' not found")
        self.active_provider = name

    def set_model(self, name: str, model: str):
        """设置服务商的模型"""
        if name not in self.providers:
            raise ValueError(f"Provider '{name}' not found")
        # 创建新的 provider 副本并更新模型
        old_provider = self.providers[name]
        self.providers[name] = LLMProvider(
            name=old_provider.name,
            type=old_provider.type,
            api_key=old_provider.api_key,
            base_url=old_provider.base_url,
            model=model,
            enabled=old_provider.enabled,
            timeout=old_provider.timeout,
            max_tokens=old_provider.max_tokens,
            temperature=old_provider.temperature,
            service_account_json=old_provider.service_account_json,
            client_email=old_provider.client_email,
            private_key=old_provider.private_key,
            project_id=old_provider.project_id,
            location=old_provider.location
        )
        logger.info(f"[ProviderManager] Set model for {name}: {model}")

    def get_active(self) -> Optional[LLMProvider]:
        """获取当前激活的服务商"""
        if self.active_provider:
            return self.providers.get(self.active_provider)
        return None

    def get_client(self) -> Optional[LLMClient]:
        """获取当前激活服务商的客户端"""
        provider = self.get_active()
        if provider:
            return LLMClient(provider)
        return None

    def list_providers(self) -> List[Dict[str, Any]]:
        """列出所有服务商"""
        return [
            {
                "name": p.name,
                "type": p.type.value,
                "model": p.model,
                "enabled": p.enabled,
                "active": p.name == self.active_provider
            }
            for p in self.providers.values()
        ]


# 全局实例
provider_manager = ProviderManager()


async def check_ollama_available() -> bool:
    """检查 Ollama 是否可用"""
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            response = await client.get("http://localhost:11434/api/tags")
            return response.status_code == 200
    except:
        return False


async def get_ollama_models() -> List[str]:
    """获取 Ollama 已安装的模型列表"""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get("http://localhost:11434/api/tags")
            if response.status_code == 200:
                data = response.json()
                return [m["name"] for m in data.get("models", [])]
    except:
        pass
    return []
