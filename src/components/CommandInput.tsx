/**
 * CommandInput - 自然语言指令输入组件
 * 
 * 用户输入自然语言指令，通过 MCP 协议发送给 LLM 处理
 * 现在支持对话消息展示，具有聊天感
 */

import { useState, useRef, useEffect } from 'react';
import { Send, Mic, MicOff, Loader2, Sparkles, History, X, MessageCircle, Trash2, MapPin } from 'lucide-react';
import ModelSelector from './ModelSelector';
import './CommandInput.css';

// 聊天消息类型 (导出供 App.tsx 使用)
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  hasToolCall?: boolean;  // AI 消息是否包含地图操作
}

// Web Speech API 类型声明
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => ISpeechRecognition;
    webkitSpeechRecognition?: new () => ISpeechRecognition;
  }
}

interface CommandHistory {
  id: string;
  input: string;
  response: string;
  timestamp: Date;
  success: boolean;
}

interface CommandInputProps {
  onSendCommand: (command: string) => Promise<void>;
  isProcessing: boolean;
  isConnected: boolean;
  messages: ChatMessage[];
  onClearMessages: () => void;
}

export default function CommandInput({ 
  onSendCommand, 
  isProcessing, 
  isConnected,
  messages,
  onClearMessages 
}: CommandInputProps) {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showChat, setShowChat] = useState(true);  // 默认显示对话
  const [history, setHistory] = useState<CommandHistory[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);

  // 示例指令
  const exampleCommands = [
    '飞到北京天安门广场上空 1000 米',
    '切换到卫星影像图',
    '在上海东方明珠塔位置添加一个红色标记',
    '显示下雨天气效果',
    '将时间设置为夜晚',
    '测量北京到上海的直线距离',
  ];

  // 初始化语音识别
  useEffect(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognitionCtor) {
      recognitionRef.current = new SpeechRecognitionCtor();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'zh-CN';

      recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
        const results = event.results;
        let transcript = '';
        for (let i = 0; i < results.length; i++) {
          transcript += results[i][0].transcript;
        }
        setInput(transcript);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
      };
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  // 切换语音识别
  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('您的浏览器不支持语音识别');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  // 发送指令
  const handleSend = async () => {
    if (!input.trim() || isProcessing || !isConnected) return;

    const command = input.trim();
    setInput('');

    try {
      await onSendCommand(command);
      
      // 添加到历史记录
      setHistory(prev => [{
        id: crypto.randomUUID(),
        input: command,
        response: '指令已执行',
        timestamp: new Date(),
        success: true
      }, ...prev].slice(0, 20)); // 保留最近 20 条

    } catch (error) {
      setHistory(prev => [{
        id: crypto.randomUUID(),
        input: command,
        response: error instanceof Error ? error.message : '执行失败',
        timestamp: new Date(),
        success: false
      }, ...prev].slice(0, 20));
    }
  };

  // 键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 选择示例指令
  const selectExample = (command: string) => {
    setInput(command);
    inputRef.current?.focus();
  };

  // 选择历史指令
  const selectHistoryItem = (item: CommandHistory) => {
    setInput(item.input);
    setShowHistory(false);
    inputRef.current?.focus();
  };

  // 自动滚动到最新消息
  useEffect(() => {
    if (chatRef.current && messages.length > 0) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  // 格式化时间
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="command-input-container">
      {/* 对话消息面板 */}
      {showChat && messages.length > 0 && (
        <div className="chat-panel">
          <div className="chat-header">
            <div className="chat-title">
              <MessageCircle size={16} />
              <span>对话</span>
            </div>
            <div className="chat-actions">
              <button 
                className="chat-clear-btn" 
                onClick={onClearMessages}
                title="清除对话"
              >
                <Trash2 size={14} />
              </button>
              <button 
                className="chat-close-btn" 
                onClick={() => setShowChat(false)}
                title="收起对话"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="chat-messages" ref={chatRef}>
            {messages.map(msg => (
              <div key={msg.id} className={`chat-message ${msg.role}`}>
                <div className="message-content">
                  {msg.content}
                  {msg.role === 'assistant' && msg.hasToolCall && (
                    <span className="tool-call-badge" title="已执行地图操作">
                      <MapPin size={12} />
                    </span>
                  )}
                </div>
                <div className="message-time">{formatTime(msg.timestamp)}</div>
              </div>
            ))}
            {isProcessing && (
              <div className="chat-message assistant typing">
                <div className="typing-indicator">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 收起时的展开按钮 */}
      {!showChat && messages.length > 0 && (
        <button 
          className="chat-expand-btn"
          onClick={() => setShowChat(true)}
          title="展开对话"
        >
          <MessageCircle size={16} />
          <span>查看对话 ({messages.length})</span>
        </button>
      )}

      {/* 示例指令 */}
      <div className="example-commands">
        <div className="example-header">
          <Sparkles size={14} />
          <span>试试这些指令：</span>
        </div>
        <div className="example-list">
          {exampleCommands.map((cmd, index) => (
            <button
              key={index}
              className="example-item"
              onClick={() => selectExample(cmd)}
              disabled={!isConnected}
            >
              {cmd}
            </button>
          ))}
        </div>
      </div>

      {/* 输入区域 */}
      <div className={`input-area ${!isConnected ? 'disconnected' : ''}`}>
        {/* 模型选择器 */}
        <ModelSelector isConnected={isConnected} />
        
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConnected ? '输入自然语言指令，例如"飞到上海外滩"...' : 'MCP 服务未连接...'}
          disabled={!isConnected || isProcessing}
          rows={1}
        />

        <div className="input-actions">
          {/* 历史记录 */}
          <button
            className={`action-btn ${showHistory ? 'active' : ''}`}
            onClick={() => setShowHistory(!showHistory)}
            title="历史记录"
          >
            <History size={18} />
          </button>

          {/* 语音输入 */}
          <button
            className={`action-btn ${isListening ? 'listening' : ''}`}
            onClick={toggleListening}
            disabled={!isConnected || isProcessing}
            title={isListening ? '停止录音' : '语音输入'}
          >
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>

          {/* 发送 */}
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!input.trim() || isProcessing || !isConnected}
            title="发送指令"
          >
            {isProcessing ? <Loader2 size={18} className="spinning" /> : <Send size={18} />}
          </button>
        </div>
      </div>

      {/* 历史记录面板 */}
      {showHistory && (
        <div className="history-panel">
          <div className="history-header">
            <span>历史指令</span>
            <button onClick={() => setShowHistory(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="history-list">
            {history.length === 0 ? (
              <div className="history-empty">暂无历史记录</div>
            ) : (
              history.map(item => (
                <div
                  key={item.id}
                  className={`history-item ${item.success ? 'success' : 'error'}`}
                  onClick={() => selectHistoryItem(item)}
                >
                  <div className="history-input">{item.input}</div>
                  <div className="history-meta">
                    <span className="history-time">
                      {item.timestamp.toLocaleTimeString()}
                    </span>
                    <span className={`history-status ${item.success ? 'success' : 'error'}`}>
                      {item.success ? '成功' : '失败'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 连接状态提示 */}
      {!isConnected && (
        <div className="connection-hint">
          <span>⚠️ MCP 服务未连接，请先启动后端服务</span>
        </div>
      )}
    </div>
  );
}
