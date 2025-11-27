import { useState, useCallback, useEffect } from 'react';
import { CesiumProvider } from './context/CesiumContext';
import { CesiumViewer } from './components/CesiumViewer';
import { Header } from './components/Header';
import { ToolPanel } from './components/ToolPanel';
import { ScenePanel } from './components/ScenePanel';
import { LayerPanel } from './components/LayerPanel';
import { MeasurePanel } from './components/MeasurePanel';
import { SearchPanel } from './components/SearchPanel';
import { StatusBar } from './components/StatusBar';
import ChatSidebar from './components/ChatSidebar';
import DebugPanel from './components/DebugPanel';  // @todo 生产环境删除
import { debugLog } from './utils/debugUtils';      // @todo 生产环境删除
import type { ChatMessage, ChatMode, SendMessageOptions } from './components/ChatSidebar';
import { wsService } from './services/WebSocketService';
import { actionDispatcher } from './dispatcher/ActionDispatcher';
import { useTheme } from './hooks/useTheme';
import './App.css';

function App() {
  // 初始化主题（确保在 App 级别应用主题）
  useTheme();

  const [isScenePanelOpen, setIsScenePanelOpen] = useState(false);
  const [isLayerPanelOpen, setIsLayerPanelOpen] = useState(false);
  const [isMeasurePanelOpen, setIsMeasurePanelOpen] = useState(false);
  const [measureType, setMeasureType] = useState<'distance' | 'area'>('distance');
  const [isSearchPanelOpen, setIsSearchPanelOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(true);  // 默认展开对话侧栏
  const [mcpToolsCount, setMcpToolsCount] = useState(0);
  const [llmModel, setLlmModel] = useState<string | undefined>(undefined);

  // 初始化 WebSocket 连接
  useEffect(() => {
    // 设置状态变化处理器
    wsService.setStatusChangeHandler((status) => {
      setWsConnected(status === 'connected');
      console.log('[App] MCP connection status:', status);
      // @todo 生产环境删除
      debugLog('system', 'WebSocket 状态', status === 'connected' ? '✅ 已连接' : '❌ 断开连接');
    });

    // 设置聊天消息处理器
    wsService.setChatMessageHandler((msg) => {
      console.log('[App] Received chat message:', msg);
      setChatMessages(prev => [...prev, {
        id: msg.id,
        role: 'assistant',
        content: msg.content,
        timestamp: new Date(msg.timestamp),
        hasToolCall: msg.hasToolCall,
        thinking: msg.thinking  // 传递思考过程到消息
      }]);
      // @todo 生产环境删除 - 显示 LLM 原始输出和思考过程
      if (msg.thinking) {
        debugLog('llm', '🧠 LLM 思考过程', msg.thinking, {
          parsed_message: msg.content,
          has_tool_call: msg.hasToolCall,
          thinking: msg.thinking,
          raw_json: msg.llmRaw
        });
      }
      debugLog('llm', 'LLM 原始输出', msg.llmRaw || msg.content, {
        parsed_message: msg.content,
        has_tool_call: msg.hasToolCall,
        raw_json: msg.llmRaw
      });
    });

    // 设置动作处理器
    wsService.setActionHandler(async (action) => {
      console.log('[App] Received action from server:', action);
      // @todo 生产环境删除
      debugLog('mcp', `MCP 工具调用: ${action.action}`, 
        JSON.stringify(action.payload, null, 2), 
        action
      );
      
      // 检查 viewer 是否已初始化
      if (!actionDispatcher.hasViewer()) {
        console.warn('[App] Viewer not initialized yet, waiting...');
        // 等待一小段时间让 viewer 初始化
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (!actionDispatcher.hasViewer()) {
          console.error('[App] Viewer still not initialized after waiting');
          return { id: action.id, success: false, error: 'Viewer not initialized yet, please try again' };
        }
      }
      
      setIsProcessing(true);
      try {
        const response = await actionDispatcher.dispatch(action);
        console.log('[App] Action response:', response);
        // @todo 生产环境删除
        const resultMsg = response.result && typeof response.result === 'object' && 'message' in response.result 
          ? (response.result as { message: string }).message 
          : '成功';
        debugLog('mcp', `MCP 执行结果: ${action.action}`, 
          response.success ? `✅ ${resultMsg}` : `❌ ${response.error || '失败'}`,
          response
        );
        return response;
      } finally {
        setIsProcessing(false);
      }
    });

    // 尝试连接
    wsService.connect().catch((error) => {
      console.log('[App] Initial connection failed:', error);
      // 连接失败是正常的，用户可能还没启动后端
    });

    // 开发环境下不断开连接（因为 StrictMode 会导致组件重新挂载）
    // 生产环境会正常清理
    return () => {
      // wsService.disconnect();
    };
  }, []);

  // 获取 MCP 状态（工具数量和 LLM 模型）
  useEffect(() => {
    if (!wsConnected) {
      setMcpToolsCount(0);
      setLlmModel(undefined);
      return;
    }

    const fetchMcpStatus = async () => {
      try {
        const [statusRes, modelRes] = await Promise.all([
          fetch('http://localhost:8765/mcp/status'),
          fetch('http://localhost:8765/model')
        ]);

        if (statusRes.ok) {
          const status = await statusRes.json();
          setMcpToolsCount(status.tools_count || 0);
        }

        if (modelRes.ok) {
          const modelData = await modelRes.json();
          setLlmModel(modelData.model || undefined);
        }
      } catch (e) {
        console.warn('[App] Failed to fetch MCP status:', e);
      }
    };

    fetchMcpStatus();
    // 每 30 秒刷新一次状态
    const interval = setInterval(fetchMcpStatus, 30000);
    return () => clearInterval(interval);
  }, [wsConnected]);

  // 发送自然语言指令到 MCP Server
  const handleSendCommand = useCallback(async (command: string, mode: ChatMode, options?: SendMessageOptions) => {
    // 先添加用户消息到聊天记录
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: command,
      timestamp: new Date()
    };
    setChatMessages(prev => [...prev, userMessage]);
    // @todo 生产环境删除
    debugLog('user', `用户输入 (${mode === 'command' ? '命令模式' : '对话模式'}${options?.thinking ? ' + 思考' : ''})`, command);
    
    setIsProcessing(true);
    try {
      // 发送用户指令到 MCP Server，包含模式信息
      // 命令模式：直接执行，简洁响应
      // 对话模式：自然对话，详细解释
      // 思考模式：输出详细思考过程
      wsService.send('user_command', { 
        text: command,
        mode: mode,  // 'command' | 'conversation'
        thinking: options?.thinking ?? false  // 是否启用思考模式
      });
      
      // 实际响应会通过 WebSocket 的 chatMessageHandler 处理
    } finally {
      // 延迟重置 processing 状态，让用户看到加载效果
      setTimeout(() => setIsProcessing(false), 500);
    }
  }, []);

  const handleMenuClick = useCallback(() => {
    setIsScenePanelOpen(prev => !prev);
    setIsLayerPanelOpen(false);
    setIsMeasurePanelOpen(false);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const handleSearch = useCallback(() => {
    if (searchQuery.trim()) {
      setIsSearchPanelOpen(true);
    }
  }, [searchQuery]);

  const handleMeasureDistance = useCallback(() => {
    setMeasureType('distance');
    setIsMeasurePanelOpen(true);
    setIsLayerPanelOpen(false);
  }, []);

  const handleMeasureArea = useCallback(() => {
    setMeasureType('area');
    setIsMeasurePanelOpen(true);
    setIsLayerPanelOpen(false);
  }, []);

  const handleSlice = useCallback(() => {
    // TODO: 实现剖面功能
    console.log('Slice tool');
  }, []);

  const handleElevationProfile = useCallback(() => {
    // TODO: 实现高程剖面功能
    console.log('Elevation profile tool');
  }, []);

  const handleLayerToggle = useCallback(() => {
    setIsLayerPanelOpen(prev => !prev);
    setIsMeasurePanelOpen(false);
  }, []);

  return (
    <CesiumProvider>
      <div className="app">
        <Header 
          onMenuClick={handleMenuClick}
          onSearchChange={handleSearchChange}
          onSearch={handleSearch}
        />
        
        <main className="main-content">
          <CesiumViewer />
          
          <ToolPanel
            onMeasureDistance={handleMeasureDistance}
            onMeasureArea={handleMeasureArea}
            onSlice={handleSlice}
            onElevationProfile={handleElevationProfile}
            onLayerToggle={handleLayerToggle}
          />

          <ScenePanel
            isOpen={isScenePanelOpen}
            onClose={() => setIsScenePanelOpen(false)}
          />

          <LayerPanel
            isOpen={isLayerPanelOpen}
            onClose={() => setIsLayerPanelOpen(false)}
          />

          <MeasurePanel
            isOpen={isMeasurePanelOpen}
            onClose={() => setIsMeasurePanelOpen(false)}
            type={measureType}
          />

          <SearchPanel
            isOpen={isSearchPanelOpen}
            onClose={() => setIsSearchPanelOpen(false)}
            initialQuery={searchQuery}
          />

          <StatusBar
            wsConnected={wsConnected}
            mcpToolsCount={mcpToolsCount}
            llmModel={llmModel}
          />

          {/* 对话侧边栏 - 替代底部输入框 */}
          <ChatSidebar
            isOpen={isChatOpen}
            onToggle={() => setIsChatOpen(!isChatOpen)}
            messages={chatMessages}
            onSendMessage={handleSendCommand}
            onClearMessages={() => setChatMessages([])}
            isProcessing={isProcessing}
            isConnected={wsConnected}
          />

          {/* 调试面板 - 测试及演示专用 @todo 生产环境删除 */}
          <DebugPanel />
        </main>
      </div>
    </CesiumProvider>
  );
}

export default App;
