/**
 * ChatSidebar - 对话侧边栏组件
 * 
 * 类似 ChatGPT 的对话体验：
 * - 流式输出显示
 * - 显示思考过程
 * - 支持滚动浏览历史
 * - 可折叠侧边栏
 * - 命令模式 / 对话模式切换
 * - 系统/深色/浅色主题切换
 */

import { useState, useRef, useEffect } from 'react';
import {
  MessageSquare,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Trash2,
  Send,
  Loader2,
  Bot,
  Sparkles,
  Terminal,
  MessageCircle,
  Brain,
  Wrench,
  WifiOff,
  RefreshCw,
  Clock
} from 'lucide-react';
import ModelSelector from './ModelSelector';
import { wsService } from '../services/WebSocketService';
import { API_URL } from '../config/mapConfig';
import './ChatSidebar.css';

// 消息类型
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'thinking';
  content: string;
  timestamp: Date;
  mode?: ChatMode;
  hasToolCall?: boolean;
  isStreaming?: boolean;
  thinking?: string;  // LLM 思考过程
}

// 对话模式
export type ChatMode = 'command' | 'conversation';

// 发送消息的选项
export interface SendMessageOptions {
  thinking?: boolean;  // 是否启用思考模式
}

interface ChatLogEntry {
  id: number;
  session_id: string | null;
  direction: 'user' | 'assistant' | 'system';
  role: string | null;
  message: string;
  tool_action?: string | null;
  tool_arguments?: Record<string, unknown> | null;
  thinking?: string | null;
  llm_provider?: string | null;
  llm_model?: string | null;
  created_at: string;
  mode?: 'command' | 'conversation' | null;
}

interface ChatSessionSummary {
  session_id: string;
  title: string;
  start_time?: string | null;
  end_time?: string | null;
  message_count: number;
  mode?: 'command' | 'conversation' | null;
}

interface ChatSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  messages: ChatMessage[];
  onSendMessage: (message: string, mode: ChatMode, options?: SendMessageOptions) => void;
  onClearMessages: (mode: ChatMode) => void;
  isProcessing: boolean;
  isConnected: boolean;
  onLoadHistory?: (messages: ChatMessage[]) => void;
}

// 模式切换组件
function ModeSwitcher({ mode, onChange }: { mode: ChatMode; onChange: (mode: ChatMode) => void }) {
  return (
    <div className="mode-switcher">
      <button 
        className={`mode-btn ${mode === 'command' ? 'active' : ''}`}
        onClick={() => onChange('command')}
        title="命令模式：直接执行地图操作，简洁响应"
      >
        <Terminal size={14} />
        <span>命令</span>
      </button>
      <button 
        className={`mode-btn ${mode === 'conversation' ? 'active' : ''}`}
        onClick={() => onChange('conversation')}
        title="对话模式：自然对话，详细解释"
      >
        <MessageCircle size={14} />
        <span>对话</span>
      </button>
    </div>
  );
}

// 思考模式开关组件
function ThinkingToggle({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  return (
    <label className="thinking-toggle" title="启用后，LLM 会输出详细的思考过程">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <Sparkles size={14} className={enabled ? 'thinking-active' : ''} />
      <span>思考</span>
    </label>
  );
}

// 消息气泡组件
function MessageBubble({
  message,
  formatTime
}: {
  message: ChatMessage;
  formatTime: (date: Date) => string;
}) {
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  // 用户消息
  if (message.role === 'user') {
    return (
      <div className="message user">
        <div className="message-bubble user-bubble">
          <div className="message-content">{message.content}</div>
          <div className="message-time">{formatTime(message.timestamp)}</div>
        </div>
      </div>
    );
  }

  // 思考中状态
  if (message.role === 'thinking') {
    return (
      <div className="message assistant">
        <div className="message-avatar">
          <Loader2 size={16} className="spinning" />
        </div>
        <div className="message-bubble assistant-bubble">
          <div className="message-content thinking-text">
            <Brain size={14} />
            <span>正在思考...</span>
          </div>
        </div>
      </div>
    );
  }

  // AI 消息
  return (
    <div className="message assistant">
      <div className="message-avatar">
        <Bot size={16} />
      </div>
      <div className="message-bubble assistant-bubble">
        {/* 思考过程（可折叠） */}
        {message.thinking && (
          <div className="thinking-section">
            <button
              className="thinking-header"
              onClick={() => setThinkingExpanded(!thinkingExpanded)}
            >
              <Brain size={12} />
              <span>思考过程</span>
              {thinkingExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {thinkingExpanded && (
              <div className="thinking-content">
                {message.thinking}
              </div>
            )}
          </div>
        )}

        {/* 消息内容 */}
        <div className="message-content">
          {message.content}
          {message.isStreaming && <span className="cursor" />}
        </div>

        {/* 工具调用标记 */}
        {message.hasToolCall && (
          <div className="tool-call-badge">
            <Wrench size={12} />
            <span>已执行地图操作</span>
          </div>
        )}

        <div className="message-time">{formatTime(message.timestamp)}</div>
      </div>
    </div>
  );
}

export default function ChatSidebar({
  isOpen,
  onToggle,
  messages,
  onSendMessage,
  onClearMessages,
  isProcessing,
  isConnected,
  onLoadHistory
}: ChatSidebarProps) {
  const [input, setInput] = useState('');
  const [chatMode, setChatMode] = useState<ChatMode>('command');
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historySessions, setHistorySessions] = useState<ChatSessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<ChatSessionSummary | null>(null);
  const [sessionMessages, setSessionMessages] = useState<ChatLogEntry[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 重连处理
  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      await wsService.connect();
    } catch (e) {
      console.error('Reconnect failed:', e);
    } finally {
      setIsReconnecting(false);
    }
  };

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 自动调整输入框高度
  const adjustTextareaHeight = () => {
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }
  };

  const handleSend = () => {
    if (!input.trim() || isProcessing || !isConnected) return;
    // 如果当前处于历史记录视图，发送新消息时自动回到正常聊天视图
    if (showHistory) {
      setShowHistory(false);
      setSelectedSession(null);
      setSessionMessages([]);
      setHistoryError(null);
    }
    onSendMessage(input.trim(), chatMode, { thinking: thinkingEnabled });
    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // 在中文等输入法正在组合时，不触发发送
      // 同时兼容浏览器提供的 isComposing 标志
      const nativeEvent = e.nativeEvent as unknown as { isComposing?: boolean };
      if (isComposing || nativeEvent.isComposing) {
        return;
      }
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const formatHistoryTime = (iso?: string | null) => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const formatSessionTitle = (session: ChatSessionSummary) => {
    const base = session.start_time || session.end_time;
    const prefix = session.mode === 'command' ? '命令' : '对话';
    if (base) {
      const date = new Date(base);
      if (!Number.isNaN(date.getTime())) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        return `${prefix} ${y}-${m}-${d} ${hh}:${mm}`;
      }
    }
    return `${prefix} 会话`;
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`${API_URL}/logs/sessions?limit=20`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setHistorySessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (e) {
      console.error('Failed to load history logs:', e);
      setHistoryError('加载历史记录失败');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleToggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && historySessions.length === 0 && isConnected) {
      void fetchHistory();
    }
    if (!next) {
      setSelectedSession(null);
      setSessionMessages([]);
    }
  };

  const handleSelectSession = async (session: ChatSessionSummary) => {
    setSelectedSession(session);
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`${API_URL}/logs/session/${encodeURIComponent(session.session_id)}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setSessionMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (e) {
      console.error('Failed to load session messages:', e);
      setHistoryError('加载会话详情失败');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleBackToSessions = () => {
    setSelectedSession(null);
    setSessionMessages([]);
    setHistoryError(null);
  };

  const handleDeleteSession = async (session: ChatSessionSummary, e: any) => {
    e.preventDefault();
    e.stopPropagation();

    if (!window.confirm('确认删除该会话？此操作不可恢复。')) {
      return;
    }

    try {
      const res = await fetch(
        `${API_URL}/logs/session/${encodeURIComponent(session.session_id)}/delete`,
        { method: 'POST' }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      setHistorySessions(prev =>
        prev.filter(s => s.session_id !== session.session_id)
      );
      if (selectedSession && selectedSession.session_id === session.session_id) {
        setSelectedSession(null);
        setSessionMessages([]);
        setHistoryError(null);
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
      setHistoryError('删除会话失败');
    }
  };

  const handleContinueSession = () => {
    if (!selectedSession) return;
    const modeToUse: ChatMode =
      selectedSession.mode === 'conversation' ? 'conversation' : 'command';
    setChatMode(modeToUse);

    if (sessionMessages.length && onLoadHistory) {
      const historyMessages: ChatMessage[] = sessionMessages
        .filter(
          (m) =>
            (m.direction === 'user' || m.direction === 'assistant') &&
            (!m.mode || m.mode === modeToUse)
        )
        .map((m) => ({
          id: String(m.id),
          role: m.direction === 'user' ? 'user' : 'assistant',
          content: m.message,
          timestamp: new Date(m.created_at),
          mode: modeToUse,
          hasToolCall: !!m.tool_action,
          thinking: m.direction === 'assistant' ? m.thinking ?? undefined : undefined,
        }));
      onLoadHistory(historyMessages);
    }

    // 通知后端将当前 WebSocket 会话绑定到选中的历史会话 ID
    if (selectedSession.session_id) {
      wsService.send('switch_session', {
        session_id: selectedSession.session_id,
        mode: modeToUse,
      });
    }

    setShowHistory(false);
    setSelectedSession(null);
    setSessionMessages([]);
    setHistoryError(null);
    // 聚焦输入框，方便继续输入
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  const visibleMessages = messages.filter(
    (m) => !m.mode || m.mode === chatMode
  );

  // 折叠状态的按钮
  if (!isOpen) {
    return (
      <button className="chat-sidebar-toggle collapsed" onClick={onToggle} title="打开对话">
        <MessageSquare size={20} />
        {visibleMessages.length > 0 && (
          <span className="message-badge">{visibleMessages.length}</span>
        )}
      </button>
    );
  }

  return (
    <div className="chat-sidebar">
      {/* 头部 */}
      <div className="chat-sidebar-header">
        <div className="header-left">
          <Bot size={20} className="bot-icon" />
          <span className="header-title">GeoCommander</span>
        </div>
        <div className="header-actions">
          <button
            className={`header-btn ${showHistory ? 'active' : ''}`}
            onClick={handleToggleHistory}
            title="查看历史记录"
          >
            <Clock size={16} />
          </button>
          <button
            className="header-btn"
            onClick={() => onClearMessages(chatMode)}
            title="清除对话"
            disabled={visibleMessages.length === 0}
          >
            <Trash2 size={16} />
          </button>
          <button className="header-btn" onClick={onToggle} title="收起">
            <ChevronLeft size={18} />
          </button>
        </div>
      </div>

      {/* 断连提示横幅 */}
      {!isConnected && (
        <div className="disconnect-banner">
          <WifiOff size={16} />
          <span>MCP 服务未连接</span>
          <button
            className="reconnect-btn"
            onClick={handleReconnect}
            disabled={isReconnecting}
          >
            <RefreshCw size={14} className={isReconnecting ? 'spinning' : ''} />
            {isReconnecting ? '连接中...' : '重连'}
          </button>
        </div>
      )}

      {/* 模型选择器 + 模式切换 */}
      <div className="chat-controls">
        <div className="chat-model-selector">
          <ModelSelector isConnected={isConnected} />
        </div>
        <ModeSwitcher mode={chatMode} onChange={setChatMode} />
      </div>

      {/* 消息列表 */}
      <div className="chat-messages-container">
        {showHistory ? (
          <div className="chat-history">
            <div className="chat-history-header">
              <div className="chat-history-title">
                <Clock size={14} />
                <span>历史记录</span>
              </div>
              <button
                className="chat-history-refresh"
                onClick={selectedSession ? handleBackToSessions : fetchHistory}
                disabled={historyLoading || !isConnected}
                title={
                  selectedSession
                    ? '返回会话列表'
                    : isConnected
                    ? '刷新会话列表'
                    : '未连接服务'
                }
              >
                {selectedSession ? (
                  <>
                    <ChevronLeft size={14} />
                    <span>返回</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={14} className={historyLoading ? 'spinning' : ''} />
                    <span>刷新</span>
                  </>
                )}
              </button>
            </div>
            <div className="chat-history-body">
              {historyError && (
                <div className="chat-history-error">
                  {historyError}
                </div>
              )}
              {historyLoading && (
                <div className="chat-history-loading">
                  <Loader2 size={16} className="spinning" />
                  <span>加载中...</span>
                </div>
              )}
              {!historyLoading && !historyError && !selectedSession && historySessions.length === 0 && (
                <div className="chat-history-empty">
                  暂无历史记录
                </div>
              )}
              {!historyLoading && !historyError && !selectedSession && historySessions.length > 0 && (
                <div className="chat-history-list">
                  {historySessions
                    .filter((s) => (s.mode ? s.mode === chatMode : true))
                    .map((session) => (
                      <div
                        key={session.session_id}
                        className={`chat-history-item ${
                          session.mode === 'command'
                            ? 'command'
                            : session.mode === 'conversation'
                            ? 'conversation'
                            : ''
                        }`}
                        onClick={() => handleSelectSession(session)}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="chat-history-meta">
                          <span className="chat-history-role">
                            {session.mode === 'command'
                              ? '命令模式'
                              : session.mode === 'conversation'
                              ? '对话模式'
                              : '混合模式'}
                          </span>
                          <span className="chat-history-time">
                            {formatHistoryTime(session.end_time || session.start_time)}
                          </span>
                          <button
                            type="button"
                            className="chat-history-delete"
                            onClick={(e) => handleDeleteSession(session, e)}
                            title="删除该会话"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <div className="chat-history-message">
                          <div className="chat-history-message-text">
                            {formatSessionTitle(session)}
                          </div>
                        </div>
                      </div>
                    ))}
                  {historySessions.filter((s) =>
                    s.mode ? s.mode === chatMode : true
                  ).length === 0 && (
                    <div className="chat-history-empty">
                      当前模式暂无历史记录
                    </div>
                  )}
                </div>
              )}
              {!historyLoading && !historyError && selectedSession && (
                <div className="chat-history-list">
                  <div className="chat-history-session-title">
                    <div className="chat-history-session-main">
                      <span className="chat-history-session-name">
                        {formatSessionTitle(selectedSession)}
                      </span>
                      <span className="chat-history-session-meta">
                        {selectedSession.mode === 'command'
                          ? '命令模式'
                          : selectedSession.mode === 'conversation'
                          ? '对话模式'
                          : '混合模式'}{' '}
                        · 共 {selectedSession.message_count} 条消息
                      </span>
                    </div>
                    <button
                      type="button"
                      className="chat-history-continue"
                      onClick={handleContinueSession}
                      title="在该会话中继续对话"
                    >
                      继续对话
                    </button>
                  </div>
                  {sessionMessages.map((log) => (
                    <div
                      key={log.id}
                      className={`chat-history-item ${
                        log.direction === 'user'
                          ? 'command'
                          : log.direction === 'assistant'
                          ? 'conversation'
                          : ''
                      }`}
                    >
                      <div className="chat-history-meta">
                        <span className="chat-history-role">
                          {log.direction === 'user'
                            ? '用户'
                            : log.direction === 'assistant'
                            ? '助手'
                            : '系统'}
                        </span>
                        <span className="chat-history-time">
                          {formatHistoryTime(log.created_at)}
                        </span>
                      </div>
                      <div className="chat-history-message">
                        <div className="chat-history-message-text">
                          {log.message}
                        </div>
                      </div>
                      {log.tool_action && (
                        <div className="chat-history-tool">
                          <Wrench size={12} />
                          <span>{log.tool_action}</span>
                        </div>
                      )}
                    </div>
                  ))}
                  {!sessionMessages.length && (
                    <div className="chat-history-empty">
                      该会话暂无可显示的消息
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            {chatMode === 'command' ? (
              <>
                <Terminal size={32} className="empty-icon" />
                <h3>命令模式</h3>
                <p>输入简短命令，直接执行地图操作</p>
                <div className="command-categories">
                  <div className="command-category">
                    <div className="category-title">📍 导航</div>
                    <div className="command-list">
                      <button onClick={() => setInput('飞到北京')}>飞到北京</button>
                      <button onClick={() => setInput('飞到上海')}>飞到上海</button>
                      <button onClick={() => setInput('重置视角')}>重置视角</button>
                    </div>
                  </div>
                  <div className="command-category">
                    <div className="category-title">🗺️ 图层</div>
                    <div className="command-list">
                      <button onClick={() => setInput('切换卫星图')}>切换卫星图</button>
                      <button onClick={() => setInput('切换矢量图')}>切换矢量图</button>
                      <button onClick={() => setInput('切换地形图')}>切换地形图</button>
                    </div>
                  </div>
                  <div className="command-category">
                    <div className="category-title">🌤️ 天气</div>
                    <div className="command-list">
                      <button onClick={() => setInput('下雨')}>下雨</button>
                      <button onClick={() => setInput('下雪')}>下雪</button>
                      <button onClick={() => setInput('停止天气')}>停止天气</button>
                    </div>
                  </div>
                  <div className="command-category">
                    <div className="category-title">🔧 控制</div>
                    <div className="command-list">
                      <button onClick={() => setInput('放大')}>放大</button>
                      <button onClick={() => setInput('缩小')}>缩小</button>
                      <button onClick={() => setInput('俯视')}>俯视</button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <Sparkles size={32} className="empty-icon" />
                <h3>开始对话</h3>
                <p>用自然语言与 AI 交流</p>
                <div className="example-prompts">
                  <button onClick={() => setInput('你好，介绍一下你自己')}>
                    👋 你好，介绍一下你自己
                  </button>
                  <button onClick={() => setInput('飞到北京天安门，并介绍一下它的历史')}>
                    🗼 飞到北京天安门
                  </button>
                  <button onClick={() => setInput('切换到卫星影像，告诉我这是什么图层')}>
                    🛰️ 切换到卫星影像
                  </button>
                  <button onClick={() => setInput('显示下雨效果，并解释一下这个功能')}>
                    🌧️ 显示下雨效果
                  </button>
                </div>
              </>
            )}
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="chat-empty">
            {chatMode === 'command' ? (
              <>
                <Terminal size={32} className="empty-icon" />
                <h3>命令模式</h3>
                <p>输入简短命令，直接执行地图操作</p>
                <div className="command-categories">
                  <div className="command-category">
                    <div className="category-title">📍 导航</div>
                    <div className="command-list">
                      <button onClick={() => setInput('飞到北京')}>飞到北京</button>
                      <button onClick={() => setInput('飞到上海')}>飞到上海</button>
                      <button onClick={() => setInput('重置视角')}>重置视角</button>
                    </div>
                  </div>
                  <div className="command-category">
                    <div className="category-title">🗺️ 图层</div>
                    <div className="command-list">
                      <button onClick={() => setInput('切换卫星图')}>切换卫星图</button>
                      <button onClick={() => setInput('切换矢量图')}>切换矢量图</button>
                      <button onClick={() => setInput('切换地形图')}>切换地形图</button>
                    </div>
                  </div>
                  <div className="command-category">
                    <div className="category-title">🌤️ 天气</div>
                    <div className="command-list">
                      <button onClick={() => setInput('下雨')}>下雨</button>
                      <button onClick={() => setInput('下雪')}>下雪</button>
                      <button onClick={() => setInput('停止天气')}>停止天气</button>
                    </div>
                  </div>
                  <div className="command-category">
                    <div className="category-title">🔧 控制</div>
                    <div className="command-list">
                      <button onClick={() => setInput('放大')}>放大</button>
                      <button onClick={() => setInput('缩小')}>缩小</button>
                      <button onClick={() => setInput('俯视')}>俯视</button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <Sparkles size={32} className="empty-icon" />
                <h3>开始对话</h3>
                <p>用自然语言与 AI 交流</p>
                <div className="example-prompts">
                  <button onClick={() => setInput('你好，介绍一下你自己')}>
                    👋 你好，介绍一下你自己
                  </button>
                  <button onClick={() => setInput('飞到北京天安门，并介绍一下它的历史')}>
                    🗼 飞到北京天安门
                  </button>
                  <button onClick={() => setInput('切换到卫星影像，告诉我这是什么图层')}>
                    🛰️ 切换到卫星影像
                  </button>
                  <button onClick={() => setInput('显示下雨效果，并解释一下这个功能')}>
                    🌧️ 显示下雨效果
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="chat-messages">
            {visibleMessages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                formatTime={formatTime}
              />
            ))}
            {/* 处理中的加载状态 */}
            {isProcessing && (
              <div className="message assistant">
                <div className="message-avatar processing">
                  <Loader2 size={16} className="spinning" />
                </div>
                <div className="message-bubble assistant-bubble processing-bubble">
                  <div className="processing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 命令模式快捷栏 - 始终显示 */}
      {chatMode === 'command' && (
        <div className="command-shortcuts">
          <div className="shortcuts-scroll">
            <button onClick={() => setInput('飞到北京')} title="导航到北京">📍 北京</button>
            <button onClick={() => setInput('飞到上海')} title="导航到上海">📍 上海</button>
            <button onClick={() => setInput('切换卫星图')} title="切换卫星图层">🛰️ 卫星</button>
            <button onClick={() => setInput('切换矢量图')} title="切换矢量图层">🗺️ 矢量</button>
            <button onClick={() => setInput('下雨')} title="显示下雨效果">🌧️ 下雨</button>
            <button onClick={() => setInput('下雪')} title="显示下雪效果">❄️ 下雪</button>
            <button onClick={() => setInput('停止天气')} title="停止天气效果">☀️ 晴天</button>
            <button onClick={() => setInput('重置视角')} title="重置相机视角">🔄 重置</button>
          </div>
        </div>
      )}

      {/* 输入区域 */}
      <div className="chat-input-container">
        <div className={`chat-input-wrapper ${!isConnected ? 'disconnected' : ''}`}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              adjustTextareaHeight();
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onKeyDown={handleKeyDown}
            placeholder={
              !isConnected 
                ? '未连接服务' 
                : chatMode === 'command' 
                  ? '输入命令，如：飞到北京' 
                  : '输入消息...'
            }
            disabled={!isConnected || isProcessing}
            rows={1}
          />
          <button
            className="send-button"
            onClick={handleSend}
            disabled={!input.trim() || isProcessing || !isConnected}
          >
            {isProcessing ? (
              <Loader2 size={16} className="spinning" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
        <div className="input-footer">
          <div className="input-footer-left">
            {!isConnected ? (
              <div className="connection-warning">
                ⚠️ MCP 服务未连接
              </div>
            ) : chatMode === 'command' ? (
              <span className="mode-hint">
                ⌨️ 命令模式 · 简短指令
              </span>
            ) : (
              <span className="mode-hint">
                💬 对话模式 · Shift+Enter 换行
              </span>
            )}
          </div>
          {chatMode === 'command' && (
            <ThinkingToggle enabled={thinkingEnabled} onChange={setThinkingEnabled} />
          )}
        </div>
      </div>
    </div>
  );
}
