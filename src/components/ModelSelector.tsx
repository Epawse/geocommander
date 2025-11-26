/**
 * ModelSelector - 模型选择器组件
 * 
 * 参考 Cherry Studio 的设计风格，显示当前模型并支持切换
 */

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Sparkles, Check, Loader2, AlertCircle } from 'lucide-react';
import './ModelSelector.css';

// 模型信息
interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  providerType: string;
  description?: string;
  active: boolean;
}

// 服务商图标映射
const providerIcons: Record<string, string> = {
  'vertex_ai': '💎',  // Gemini 钻石
  'openai': '🤖',
  'ollama': '🦙',
  'dashscope': '☁️',
  'siliconflow': '⚡',
  'deepseek': '🔍',
  'custom': '🔧'
};

// 服务商显示名称
const providerNames: Record<string, string> = {
  'vertex_ai': 'Gemini',
  'openai': 'OpenAI',
  'ollama': 'Ollama',
  'dashscope': '通义千问',
  'siliconflow': '硅基流动',
  'deepseek': 'DeepSeek',
  'custom': '自定义'
};

// 服务商响应类型
interface ProviderResponse {
  name: string;
  model: string;
  type: string;
  active: boolean;
}

interface ModelSelectorProps {
  isConnected: boolean;
}

export default function ModelSelector({ isConnected }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [activeModel, setActiveModel] = useState<ModelInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 获取可用模型列表
  const fetchModels = async () => {
    if (!isConnected) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('http://localhost:8765/providers');
      if (!response.ok) throw new Error('获取模型列表失败');
      
      const data = await response.json();
      const modelList: ModelInfo[] = data.providers.map((p: ProviderResponse) => ({
        id: p.name,
        name: p.model,
        provider: p.name,
        providerType: p.type,
        active: p.active
      }));
      
      setModels(modelList);
      setActiveModel(modelList.find(m => m.active) || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 切换模型
  const selectModel = async (model: ModelInfo) => {
    if (model.active) {
      setIsOpen(false);
      return;
    }
    
    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:8765/providers/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: model.provider })
      });
      
      if (!response.ok) throw new Error('切换模型失败');
      
      // 更新状态
      setModels(prev => prev.map(m => ({
        ...m,
        active: m.id === model.id
      })));
      setActiveModel(model);
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 初始加载
  useEffect(() => {
    if (isConnected) {
      fetchModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 未连接状态
  if (!isConnected) {
    return (
      <div className="model-selector disabled">
        <div className="model-selector-trigger">
          <AlertCircle size={16} className="model-icon" />
          <span className="model-name">未连接</span>
        </div>
      </div>
    );
  }

  return (
    <div className="model-selector" ref={dropdownRef}>
      <button 
        className={`model-selector-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 size={16} className="model-icon spinning" />
        ) : activeModel ? (
          <span className="provider-icon">{providerIcons[activeModel.provider] || '🤖'}</span>
        ) : (
          <Sparkles size={16} className="model-icon" />
        )}
        <span className="model-name">
          {activeModel ? activeModel.name : '选择模型'}
        </span>
        <ChevronDown size={14} className={`chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="model-dropdown">
          <div className="model-dropdown-header">
            <Sparkles size={14} />
            <span>选择模型</span>
          </div>
          
          {error && (
            <div className="model-error">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          <div className="model-list">
            {models.length === 0 ? (
              <div className="model-empty">暂无可用模型</div>
            ) : (
              models.map(model => (
                <button
                  key={model.id}
                  className={`model-item ${model.active ? 'active' : ''}`}
                  onClick={() => selectModel(model)}
                >
                  <span className="provider-icon">
                    {providerIcons[model.provider] || '🤖'}
                  </span>
                  <div className="model-info">
                    <span className="model-item-name">{model.name}</span>
                    <span className="model-provider">
                      {providerNames[model.provider] || model.provider}
                    </span>
                  </div>
                  {model.active && (
                    <Check size={16} className="check-icon" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
