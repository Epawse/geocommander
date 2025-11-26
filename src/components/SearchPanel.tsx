import { useState, useRef } from 'react';
import { Search, MapPin, X } from 'lucide-react';
import { useCesium } from '../context/CesiumContext';
import type { SearchResult } from '../types';
import './SearchPanel.css';

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
}

// 模拟搜索结果 (实际应用中应该调用地理编码API)
const mockSearch = async (query: string): Promise<SearchResult[]> => {
  const mockData: Record<string, SearchResult[]> = {
    '北京': [
      { name: '北京市', longitude: 116.4, latitude: 39.9, address: '中国北京市' },
      { name: '北京天安门', longitude: 116.397, latitude: 39.909, address: '北京市东城区' },
      { name: '北京故宫', longitude: 116.397, latitude: 39.918, address: '北京市东城区景山前街4号' },
    ],
    '上海': [
      { name: '上海市', longitude: 121.47, latitude: 31.23, address: '中国上海市' },
      { name: '上海外滩', longitude: 121.49, latitude: 31.24, address: '上海市黄浦区' },
      { name: '东方明珠', longitude: 121.50, latitude: 31.24, address: '上海市浦东新区' },
    ],
    '广州': [
      { name: '广州市', longitude: 113.26, latitude: 23.13, address: '中国广东省广州市' },
      { name: '广州塔', longitude: 113.32, latitude: 23.11, address: '广州市海珠区' },
    ],
    '深圳': [
      { name: '深圳市', longitude: 114.07, latitude: 22.62, address: '中国广东省深圳市' },
    ],
    '杭州': [
      { name: '杭州市', longitude: 120.15, latitude: 30.28, address: '中国浙江省杭州市' },
      { name: '西湖', longitude: 120.15, latitude: 30.25, address: '杭州市西湖区' },
    ],
  };

  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 300));

  // 模糊匹配
  const results: SearchResult[] = [];
  for (const [key, values] of Object.entries(mockData)) {
    if (key.includes(query) || query.includes(key)) {
      results.push(...values);
    }
  }

  // 如果没有匹配，返回一个通用结果
  if (results.length === 0 && query.length > 0) {
    results.push({
      name: query,
      longitude: 116.4,
      latitude: 39.9,
      address: '未找到精确结果，显示默认位置'
    });
  }

  return results;
};

export function SearchPanel({ isOpen, onClose, initialQuery = '' }: SearchPanelProps) {
  const { flyTo } = useCesium();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    
    setIsLoading(true);
    try {
      const searchResults = await mockSearch(query);
      setResults(searchResults);
    } catch (error) {
      console.error('Search error:', error);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleResultClick = (result: SearchResult) => {
    flyTo(result.longitude, result.latitude, 50000, {
      pitch: -45,
      duration: 2
    });
    onClose();
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    inputRef.current?.focus();
  };

  if (!isOpen) return null;

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <div className="search-input-container">
          <Search size={18} className="search-icon" />
          <input
            ref={inputRef}
            type="text"
            placeholder="搜索地址或地点..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          {query && (
            <button className="clear-button" onClick={clearSearch}>
              <X size={16} />
            </button>
          )}
        </div>
        <button className="close-panel-button" onClick={onClose}>
          取消
        </button>
      </div>

      <div className="search-panel-content">
        {isLoading && (
          <div className="search-loading">
            <div className="loading-spinner"></div>
            <span>搜索中...</span>
          </div>
        )}

        {!isLoading && results.length > 0 && (
          <div className="search-results">
            {results.map((result, index) => (
              <div
                key={index}
                className="search-result-item"
                onClick={() => handleResultClick(result)}
              >
                <MapPin size={18} className="result-icon" />
                <div className="result-info">
                  <h4>{result.name}</h4>
                  {result.address && <p>{result.address}</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && query && results.length === 0 && (
          <div className="no-results">
            <p>未找到相关结果</p>
            <span>请尝试其他关键词</span>
          </div>
        )}

        {!isLoading && !query && (
          <div className="search-tips">
            <h3>搜索提示</h3>
            <ul>
              <li>输入城市名称，如"北京"、"上海"</li>
              <li>输入地标名称，如"故宫"、"外滩"</li>
              <li>支持中文搜索</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
