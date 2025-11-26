/**
 * WebSocket 服务 - 连接 MCP Server
 * 
 * 负责与 Python MCP Server 建立 WebSocket 连接，
 * 接收来自 LLM 的工具调用指令并分发到前端执行
 */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface MCPAction {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface MCPResponse {
  id: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

// AI 聊天消息
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  hasToolCall?: boolean;  // 是否包含地图操作
  llmRaw?: string;        // LLM 原始输出（调试用）
  thinking?: string;      // LLM 思考过程（调试用）
}

type ActionHandler = (action: MCPAction) => Promise<MCPResponse>;
type StatusChangeHandler = (status: ConnectionStatus) => void;
type ChatMessageHandler = (message: ChatMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private actionHandler: ActionHandler | null = null;
  private statusChangeHandler: StatusChangeHandler | null = null;
  private chatMessageHandler: ChatMessageHandler | null = null;
  private status: ConnectionStatus = 'disconnected';
  private heartbeatInterval: number | null = null;
  private messageQueue: MCPAction[] = [];

  constructor(url: string = 'ws://localhost:8765/ws') {
    this.url = url;
  }

  /**
   * 设置动作处理器
   */
  setActionHandler(handler: ActionHandler): void {
    this.actionHandler = handler;
  }

  /**
   * 设置状态变化处理器
   */
  setStatusChangeHandler(handler: StatusChangeHandler): void {
    this.statusChangeHandler = handler;
  }

  /**
   * 设置聊天消息处理器
   */
  setChatMessageHandler(handler: ChatMessageHandler): void {
    this.chatMessageHandler = handler;
  }

  /**
   * 获取当前连接状态
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * 更新状态并通知监听器
   */
  private updateStatus(status: ConnectionStatus): void {
    this.status = status;
    if (this.statusChangeHandler) {
      this.statusChangeHandler(status);
    }
  }

  /**
   * 连接到 MCP Server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.updateStatus('connecting');
      console.log(`[WebSocket] Connecting to ${this.url}...`);

      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[WebSocket] Connected to MCP Server');
          this.updateStatus('connected');
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.flushMessageQueue();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('[WebSocket] Error:', error);
          this.updateStatus('error');
          reject(error);
        };

        this.ws.onclose = (event) => {
          console.log(`[WebSocket] Disconnected (code: ${event.code})`);
          this.stopHeartbeat();
          this.updateStatus('disconnected');
          this.attemptReconnect();
        };
      } catch (error) {
        this.updateStatus('error');
        reject(error);
      }
    });
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }
    this.updateStatus('disconnected');
    this.reconnectAttempts = this.maxReconnectAttempts; // 防止自动重连
  }

  /**
   * 处理收到的消息
   */
  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data);
      
      // 心跳响应
      if (message.type === 'pong') {
        console.debug('[WebSocket] Heartbeat pong received');
        return;
      }

      // AI 聊天响应 (新增)
      if (message.type === 'chat_response') {
        console.log('[WebSocket] Received chat response:', message);
        
        // 通知聊天消息处理器
        if (this.chatMessageHandler && message.message) {
          const chatMsg: ChatMessage = {
            id: message.id || crypto.randomUUID(),
            role: 'assistant',
            content: message.message,
            timestamp: new Date(),
            hasToolCall: !!message.tool_call,
            llmRaw: message.llm_raw,    // LLM 原始输出
            thinking: message.thinking   // LLM 思考过程
          };
          this.chatMessageHandler(chatMsg);
        }

        // 如果有工具调用，也要处理
        if (message.tool_call && this.actionHandler) {
          const action: MCPAction = {
            id: message.id || crypto.randomUUID(),
            action: message.tool_call.action,
            payload: message.tool_call.arguments || {},
            timestamp: Date.now()
          };

          console.log('[WebSocket] Executing tool call from chat:', action);
          const response = await this.actionHandler(action);
          this.sendResponse(response);
        }
        return;
      }

      // MCP 动作 (兼容旧格式 - 当 chat_response 已处理时跳过)
      // 注意：后端同时发送 chat_response 和 action，为避免重复执行，
      // 如果 chat_response 已经处理了 tool_call，这里就不再处理
      if (message.type === 'action' && message.payload) {
        // 检查是否已经通过 chat_response 处理过（通过 ID 判断）
        // 由于后端对 chat_response 和 action 使用不同的 ID，这里简单跳过
        // 因为 chat_response 分支已经处理了工具调用
        console.log('[WebSocket] Skipping duplicate action (handled by chat_response):', message.payload.action);
        return;
      }

      // 系统消息
      if (message.type === 'system') {
        console.log('[WebSocket] System message:', message.content);
      }
    } catch (error) {
      console.error('[WebSocket] Failed to parse message:', error);
    }
  }

  /**
   * 发送响应给 MCP Server
   */
  private sendResponse(response: MCPResponse): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'response',
        ...response
      }));
    }
  }

  /**
   * 发送消息到 MCP Server
   */
  send(type: string, payload: unknown): void {
    const message = JSON.stringify({ type, payload, timestamp: Date.now() });
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      // 连接未就绪时加入队列
      this.messageQueue.push({
        id: crypto.randomUUID(),
        action: type,
        payload: payload as Record<string, unknown>,
        timestamp: Date.now()
      });
    }
  }

  /**
   * 发送队列中的消息
   */
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const message = this.messageQueue.shift();
      if (message) {
        this.ws.send(JSON.stringify({
          type: message.action,
          payload: message.payload,
          timestamp: message.timestamp
        }));
      }
    }
  }

  /**
   * 尝试重新连接
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WebSocket] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
    
    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(() => {
        // 重连失败会触发 onclose，自动继续重连
      });
    }, delay);
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}

// 单例导出
export const wsService = new WebSocketService();
export default WebSocketService;
