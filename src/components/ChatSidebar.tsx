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
  Wrench
} from 'lucide-react';
import ModelSelector from './ModelSelector';
import './ChatSidebar.css';

// 消息类型
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'thinking';
  content: string;
  timestamp: Date;
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

interface ChatSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  messages: ChatMessage[];
  onSendMessage: (message: string, mode: ChatMode, options?: SendMessageOptions) => void;
  onClearMessages: () => void;
  isProcessing: boolean;
  isConnected: boolean;
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
  isConnected
}: ChatSidebarProps) {
  const [input, setInput] = useState('');
  const [chatMode, setChatMode] = useState<ChatMode>('command'); // 默认命令模式
  const [thinkingEnabled, setThinkingEnabled] = useState(false); // 思考模式开关
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    onSendMessage(input.trim(), chatMode, { thinking: thinkingEnabled });
    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  // 折叠状态的按钮
  if (!isOpen) {
    return (
      <button className="chat-sidebar-toggle collapsed" onClick={onToggle} title="打开对话">
        <MessageSquare size={20} />
        {messages.length > 0 && (
          <span className="message-badge">{messages.length}</span>
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
            className="header-btn"
            onClick={onClearMessages}
            title="清除对话"
            disabled={messages.length === 0}
          >
            <Trash2 size={16} />
          </button>
          <button className="header-btn" onClick={onToggle} title="收起">
            <ChevronLeft size={18} />
          </button>
        </div>
      </div>

      {/* 模型选择器 + 模式切换 */}
      <div className="chat-controls">
        <div className="chat-model-selector">
          <ModelSelector isConnected={isConnected} />
        </div>
        <ModeSwitcher mode={chatMode} onChange={setChatMode} />
      </div>

      {/* 消息列表 */}
      <div className="chat-messages-container">
        {messages.length === 0 ? (
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
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                formatTime={formatTime}
              />
            ))}
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
