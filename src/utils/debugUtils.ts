/**
 * 调试工具函数 - 测试及演示专用
 * @todo 生产环境删除此文件
 */

// 日志条目类型
export interface DebugLogEntry {
  id: string;
  timestamp: string;
  type: 'user' | 'llm' | 'mcp' | 'system' | 'error';
  title: string;
  content: string;
  raw?: unknown;
}

// 扩展 Window 类型
declare global {
  interface Window {
    __debugPanel?: {
      addLog: (log: Omit<DebugLogEntry, 'id' | 'timestamp'>) => void;
    };
  }
}

/**
 * 添加调试日志
 * 供其他组件调用，将日志显示在调试面板中
 */
export function debugLog(
  type: DebugLogEntry['type'], 
  title: string, 
  content: string, 
  raw?: unknown
): void {
  const panel = window.__debugPanel;
  if (panel?.addLog) {
    panel.addLog({ type, title, content, raw });
  }
}
