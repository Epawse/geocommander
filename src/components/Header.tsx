import { useState } from 'react';
import { 
  Home, 
  Search, 
  Menu, 
  User, 
  HelpCircle,
  MapIcon,
  Layers,
  Box
} from 'lucide-react';
import './Header.css';

interface HeaderProps {
  onMenuClick: () => void;
  onSearchChange: (value: string) => void;
  onSearch: () => void;
}

export function Header({ onMenuClick, onSearchChange, onSearch }: HeaderProps) {
  const [searchValue, setSearchValue] = useState('');

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
    onSearchChange(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSearch();
    }
  };

  const navItems = [
    { icon: <Home size={16} />, label: '指挥中心', href: '#', active: true },
    { icon: <Layers size={16} />, label: '场景库', href: '#' },
    { icon: <MapIcon size={16} />, label: '数据源', href: '#' },
    { icon: <Box size={16} />, label: '工具集', href: '#' },
  ];

  return (
    <header className="header">
      <div className="header-left">
        <button className="menu-button" onClick={onMenuClick}>
          <Menu size={20} />
        </button>
        <div className="logo">
          <Box size={24} className="logo-icon" />
          <span className="logo-text">GeoCommander</span>
        </div>
      </div>

      <nav className="header-nav">
        {navItems.map((item, index) => (
          <a 
            key={index} 
            href={item.href} 
            className={`nav-item ${item.active ? 'active' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </a>
        ))}
      </nav>

      <div className="header-right">
        <div className="search-box">
          <input
            type="text"
            placeholder="搜索地址或地点..."
            value={searchValue}
            onChange={handleSearchChange}
            onKeyDown={handleKeyDown}
          />
          <button className="search-button" onClick={onSearch}>
            <Search size={18} />
          </button>
        </div>
        <button className="icon-button">
          <HelpCircle size={20} />
        </button>
        <button className="icon-button user-button">
          <User size={20} />
          <span>登录</span>
        </button>
      </div>
    </header>
  );
}
