import { useState, useEffect } from 'react';
import { Wifi, WifiOff, Clock, Bot, Wrench } from 'lucide-react';
import './StatusBar.css';

interface StatusBarProps {
  wsConnected?: boolean;
  mcpToolsCount?: number;
  llmModel?: string;
}

export function StatusBar({
  wsConnected = false,
  mcpToolsCount = 0,
  llmModel
}: StatusBarProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="status-bar">
      <div className="status-left">
        {/* WebSocket 连接状态 */}
        <span className={`status-item ${wsConnected ? 'connected' : 'disconnected'}`}>
          {wsConnected ? (
            <><Wifi size={12} className="status-icon" /> 已连接</>
          ) : (
            <><WifiOff size={12} className="status-icon" /> 未连接</>
          )}
        </span>
        <span className="status-divider">|</span>

        {/* MCP 工具数量 */}
        {wsConnected && mcpToolsCount > 0 && (
          <>
            <span className="status-item mcp-tools">
              <Wrench size={12} className="status-icon" />
              {mcpToolsCount} 工具
            </span>
            <span className="status-divider">|</span>
          </>
        )}

        {/* LLM 模型 */}
        {llmModel && (
          <span className="status-item llm-model">
            <Bot size={12} className="status-icon" />
            {llmModel}
          </span>
        )}
      </div>
      <div className="status-right">
        <span className="status-item">
          <Clock size={12} className="status-icon" />
          {currentTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}
