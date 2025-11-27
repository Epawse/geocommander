/**
 * 调试面板 - 测试及演示专用
 * 
 * 用于展示 LLM 和 MCP 的关键信息，验证工作流程
 * 可折叠，便于后续无痛删除
 * 
 * @todo 生产环境删除此组件
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { DebugLogEntry } from '../utils/debugUtils';
import './DebugPanel.css';

// MCP 状态类型
interface MCPStatus {
  connected: boolean;
  tools_count: number;
  tools: string[];
}

// MCP 工具类型
interface MCPTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

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
  const [activeTab, setActiveTab] = useState<'logs' | 'mcp'>('logs');
  const logsEndRef = useRef<HTMLDivElement>(null);

  // MCP 相关状态
  const [mcpStatus, setMcpStatus] = useState<MCPStatus | null>(null);
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([]);
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [toolArgs, setToolArgs] = useState<string>('{}');
  const [mcpLoading, setMcpLoading] = useState(false);

  const API_BASE = 'http://localhost:8765';

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

  // 获取 MCP 状态
  const fetchMcpStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/mcp/status`);
      const data = await res.json();
      setMcpStatus(data);
    } catch (e) {
      console.error('Failed to fetch MCP status:', e);
      setMcpStatus({ connected: false, tools_count: 0, tools: [] });
    }
  }, []);

  // 获取 MCP 工具列表
  const fetchMcpTools = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/mcp/tools`);
      const data = await res.json();
      setMcpTools(data.tools || []);
      if (data.tools?.length > 0 && !selectedTool) {
        setSelectedTool(data.tools[0].name);
        // 设置默认参数示例
        const tool = data.tools[0];
        if (tool.parameters?.properties) {
          const example: Record<string, unknown> = {};
          Object.entries(tool.parameters.properties).forEach(([key, prop]: [string, unknown]) => {
            const p = prop as { default?: unknown; type?: string };
            if (p.default !== undefined) {
              example[key] = p.default;
            } else if (p.type === 'string') {
              example[key] = '';
            } else if (p.type === 'number') {
              example[key] = 0;
            }
          });
          setToolArgs(JSON.stringify(example, null, 2));
        }
      }
    } catch (e) {
      console.error('Failed to fetch MCP tools:', e);
    }
  }, [selectedTool]);

  // 调用 MCP 工具
  const callMcpTool = async () => {
    if (!selectedTool) return;

    setMcpLoading(true);
    try {
      let args = {};
      try {
        args = JSON.parse(toolArgs);
      } catch {
        addLog({
          type: 'error',
          title: 'JSON 解析错误',
          content: '参数格式不正确，请检查 JSON 格式',
        });
        setMcpLoading(false);
        return;
      }

      addLog({
        type: 'mcp',
        title: `调用工具: ${selectedTool}`,
        content: `参数: ${JSON.stringify(args)}`,
      });

      const res = await fetch(`${API_BASE}/mcp/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: selectedTool,
          arguments: args,
          broadcast: true,
        }),
      });

      const result = await res.json();

      addLog({
        type: 'mcp',
        title: `工具响应: ${result.action || selectedTool}`,
        content: result.message || JSON.stringify(result),
        raw: result,
      });

    } catch (e) {
      addLog({
        type: 'error',
        title: 'MCP 调用失败',
        content: String(e),
      });
    } finally {
      setMcpLoading(false);
    }
  };

  // 切换到 MCP 标签时加载数据
  useEffect(() => {
    if (activeTab === 'mcp') {
      fetchMcpStatus();
      fetchMcpTools();
    }
  }, [activeTab, fetchMcpStatus, fetchMcpTools]);

  // 选择工具时更新参数示例
  const handleToolSelect = (toolName: string) => {
    setSelectedTool(toolName);
    const tool = mcpTools.find(t => t.name === toolName);
    if (tool?.parameters?.properties) {
      const example: Record<string, unknown> = {};
      const props = tool.parameters.properties as Record<string, { default?: unknown; type?: string }>;
      Object.entries(props).forEach(([key, prop]) => {
        if (prop.default !== undefined) {
          example[key] = prop.default;
        } else if (prop.type === 'string') {
          example[key] = '';
        } else if (prop.type === 'number') {
          example[key] = 0;
        }
      });
      setToolArgs(JSON.stringify(example, null, 2));
    } else {
      setToolArgs('{}');
    }
  };

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

      {/* 标签页切换 */}
      <div className="debug-panel-tabs">
        <button
          className={activeTab === 'logs' ? 'active' : ''}
          onClick={() => setActiveTab('logs')}
        >
          📝 日志
        </button>
        <button
          className={activeTab === 'mcp' ? 'active' : ''}
          onClick={() => setActiveTab('mcp')}
        >
          🔧 MCP 测试
          {mcpStatus?.connected && <span className="mcp-connected-badge">●</span>}
        </button>
      </div>

      {/* 日志标签页 - 过滤器 */}
      {activeTab === 'logs' && (
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
      )}

      {/* MCP 测试标签页 */}
      {activeTab === 'mcp' && (
        <div className="debug-mcp-panel">
          {/* MCP 状态 */}
          <div className="mcp-status-section">
            <div className="mcp-status-header">
              <span className={`mcp-status-indicator ${mcpStatus?.connected ? 'connected' : 'disconnected'}`}>
                {mcpStatus?.connected ? '● 已连接' : '○ 未连接'}
              </span>
              <button onClick={fetchMcpStatus} className="mcp-refresh-btn">🔄</button>
            </div>
            {mcpStatus?.connected && (
              <div className="mcp-status-info">
                可用工具: {mcpStatus.tools_count} 个
              </div>
            )}
          </div>

          {/* 工具选择 */}
          <div className="mcp-tool-section">
            <label>选择工具:</label>
            <select
              value={selectedTool}
              onChange={(e) => handleToolSelect(e.target.value)}
              disabled={!mcpStatus?.connected}
            >
              {mcpTools.map(tool => (
                <option key={tool.name} value={tool.name}>
                  {tool.name}
                </option>
              ))}
            </select>
          </div>

          {/* 工具描述 */}
          {selectedTool && (
            <div className="mcp-tool-description">
              {mcpTools.find(t => t.name === selectedTool)?.description}
            </div>
          )}

          {/* 参数输入 */}
          <div className="mcp-args-section">
            <label>参数 (JSON):</label>
            <textarea
              value={toolArgs}
              onChange={(e) => setToolArgs(e.target.value)}
              placeholder='{"key": "value"}'
              disabled={!mcpStatus?.connected}
            />
          </div>

          {/* 执行按钮 */}
          <div className="mcp-actions">
            <button
              onClick={callMcpTool}
              disabled={!mcpStatus?.connected || mcpLoading || !selectedTool}
              className="mcp-call-btn"
            >
              {mcpLoading ? '执行中...' : '🚀 执行工具'}
            </button>
          </div>

          {/* 快捷测试按钮 */}
          <div className="mcp-quick-tests">
            <span className="quick-test-label">快捷测试:</span>
            <button onClick={() => {
              setSelectedTool('fly_to_location');
              setToolArgs('{"name": "北京"}');
            }}>飞往北京</button>
            <button onClick={() => {
              setSelectedTool('set_weather');
              setToolArgs('{"weather_type": "rain", "intensity": 0.5}');
            }}>下雨</button>
            <button onClick={() => {
              setSelectedTool('set_time');
              setToolArgs('{"preset": "night"}');
            }}>夜晚</button>
            <button onClick={() => {
              setSelectedTool('switch_basemap');
              setToolArgs('{"basemap_type": "satellite"}');
            }}>卫星图</button>
          </div>
        </div>
      )}

      {/* 状态栏 */}
      <div className="debug-panel-footer">
        <span className="debug-status">
          <span className="debug-status-dot"></span>
          {activeTab === 'mcp' ? (mcpStatus?.connected ? 'MCP 已连接' : 'MCP 未连接') : '监听中'}
        </span>
        <span className="debug-info">
          {activeTab === 'logs' ? `共 ${logs.length} 条记录` : `${mcpStatus?.tools_count || 0} 个工具`}
        </span>
      </div>
    </div>
  );
}
