/**
 * 调试面板 - 测试及演示专用
 * 
 * 用于展示 LLM 和 MCP 的关键信息，验证工作流程
 * 可折叠，便于后续无痛删除
 * 
 * @todo 生产环境删除此组件
 */

import { useState, useEffect, useRef } from 'react';
import type { DebugLogEntry } from '../utils/debugUtils';
import './DebugPanel.css';

// 扩展 Window 类型
declare global {
  interface Window {
    __debugPanel?: {
      addLog: (log: Omit<DebugLogEntry, 'id' | 'timestamp'>) => void;
    };
  }
}

export default function DebugPanel() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [logs, setLogs] = useState<DebugLogEntry[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const logsEndRef = useRef<HTMLDivElement>(null);

  // 添加日志的方法（暴露给外部）
  const addLog = (log: Omit<DebugLogEntry, 'id' | 'timestamp'>) => {
    const entry: DebugLogEntry = {
      ...log,
      id: crypto.randomUUID(),
      timestamp: new Date().toLocaleTimeString('zh-CN', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
      }) + '.' + String(new Date().getMilliseconds()).padStart(3, '0')
    };
    setLogs(prev => [...prev.slice(-99), entry]); // 保留最近 100 条
  };

  // 暴露 addLog 到 window 对象，供其他组件使用
  useEffect(() => {
    window.__debugPanel = { addLog };
    return () => {
      delete window.__debugPanel;
    };
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // 清空日志
  const clearLogs = () => setLogs([]);

  // 复制所有日志
  const copyLogs = () => {
    const text = logs.map(log => 
      `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.title}\n${log.content}${log.raw ? '\n' + JSON.stringify(log.raw, null, 2) : ''}`
    ).join('\n\n---\n\n');
    navigator.clipboard.writeText(text);
  };

  // 过滤日志
  const filteredLogs = filter === 'all' 
    ? logs 
    : logs.filter(log => log.type === filter);

  // 类型对应的颜色和图标
  const typeConfig: Record<string, { icon: string; color: string; label: string }> = {
    user: { icon: '👤', color: '#4CAF50', label: '用户输入' },
    llm: { icon: '🤖', color: '#2196F3', label: 'LLM 响应' },
    mcp: { icon: '🔧', color: '#FF9800', label: 'MCP 工具' },
    system: { icon: '⚙️', color: '#9E9E9E', label: '系统' },
    error: { icon: '❌', color: '#F44336', label: '错误' },
  };

  if (isCollapsed) {
    return (
      <div className="debug-panel-collapsed" onClick={() => setIsCollapsed(false)}>
        <span className="debug-panel-toggle">🔍</span>
        <span className="debug-panel-badge">{logs.length}</span>
      </div>
    );
  }

  return (
    <div className="debug-panel">
      {/* 标题栏 */}
      <div className="debug-panel-header">
        <div className="debug-panel-title">
          <span>🔍 调试面板</span>
          <span className="debug-panel-subtitle">LLM + MCP 验证</span>
        </div>
        <div className="debug-panel-actions">
          <button onClick={copyLogs} title="复制日志">📋</button>
          <button onClick={clearLogs} title="清空">🗑️</button>
          <button onClick={() => setIsCollapsed(true)} title="折叠">◀</button>
        </div>
      </div>

      {/* 过滤器 */}
      <div className="debug-panel-filters">
        <button 
          className={filter === 'all' ? 'active' : ''} 
          onClick={() => setFilter('all')}
        >
          全部 ({logs.length})
        </button>
        {Object.entries(typeConfig).map(([key, config]) => {
          const count = logs.filter(l => l.type === key).length;
          return (
            <button 
              key={key}
              className={filter === key ? 'active' : ''} 
              onClick={() => setFilter(key)}
              style={{ '--type-color': config.color } as React.CSSProperties}
            >
              {config.icon} {count}
            </button>
          );
        })}
      </div>

      {/* 日志列表 */}
      <div className="debug-panel-logs">
        {filteredLogs.length === 0 ? (
          <div className="debug-panel-empty">
            <span>暂无日志</span>
            <span className="debug-panel-hint">发送消息后将在此显示调试信息</span>
          </div>
        ) : (
          filteredLogs.map(log => (
            <div 
              key={log.id} 
              className={`debug-log-entry debug-log-${log.type}`}
              style={{ '--type-color': typeConfig[log.type]?.color } as React.CSSProperties}
            >
              <div className="debug-log-header">
                <span className="debug-log-icon">{typeConfig[log.type]?.icon}</span>
                <span className="debug-log-title">{log.title}</span>
                <span className="debug-log-time">{log.timestamp}</span>
              </div>
              <pre className="debug-log-content">{log.content}</pre>
              {log.raw !== undefined && (
                <details className="debug-log-raw">
                  <summary>原始数据</summary>
                  <pre>{typeof log.raw === 'string' ? log.raw : JSON.stringify(log.raw, null, 2)}</pre>
                </details>
              )}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* 状态栏 */}
      <div className="debug-panel-footer">
        <span className="debug-status">
          <span className="debug-status-dot"></span>
          监听中
        </span>
        <span className="debug-info">
          共 {logs.length} 条记录
        </span>
      </div>
    </div>
  );
}
