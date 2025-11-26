import { useState, useEffect } from 'react';
import { Wifi, WifiOff, Clock } from 'lucide-react';
import './StatusBar.css';

interface StatusBarProps {
  wsConnected?: boolean;
}

export function StatusBar({ wsConnected = false }: StatusBarProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="status-bar">
      <div className="status-left">
        <span className="status-item">
          {wsConnected ? (
            <><Wifi size={14} className="status-icon connected" /> MCP 已连接</>
          ) : (
            <><WifiOff size={14} className="status-icon disconnected" /> MCP 未连接</>
          )}
        </span>
        <span className="status-divider">|</span>
        <span className="status-item">底图：天地图</span>
      </div>
      <div className="status-right">
        <span className="status-item">
          <Clock size={14} className="status-icon" />
          {currentTime.toLocaleTimeString('zh-CN')}
        </span>
      </div>
    </div>
  );
}
