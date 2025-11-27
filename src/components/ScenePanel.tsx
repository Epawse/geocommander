import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useCesium } from '../context/CesiumContext';
import { SAMPLE_SCENES } from '../config/mapConfig';
import type { Scene } from '../types';
import './ScenePanel.css';

interface ScenePanelProps {
  isOpen: boolean;
  onClose: () => void;
  isChatOpen?: boolean;
}

const RECENT_SCENES_KEY = 'geocommander_recent_scenes';
const MAX_RECENT_SCENES = 6;

export function ScenePanel({ isOpen, onClose, isChatOpen = true }: ScenePanelProps) {
  const { flyTo, setCurrentScene, currentScene } = useCesium();
  const [recentScenes, setRecentScenes] = useState<Scene[]>([]);

  // 加载最近浏览的场景
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SCENES_KEY);
      if (stored) {
        const ids = JSON.parse(stored) as string[];
        const scenes = ids
          .map(id => SAMPLE_SCENES.find(s => s.id === id))
          .filter((s): s is Scene => s !== undefined);
        setRecentScenes(scenes);
      }
    } catch (e) {
      console.warn('Failed to load recent scenes:', e);
    }
  }, [isOpen]);

  // 添加到最近浏览
  const addToRecent = useCallback((scene: Scene) => {
    try {
      const stored = localStorage.getItem(RECENT_SCENES_KEY);
      let ids: string[] = stored ? JSON.parse(stored) : [];

      // 移除已存在的，添加到开头
      ids = ids.filter(id => id !== scene.id);
      ids.unshift(scene.id);

      // 限制数量
      ids = ids.slice(0, MAX_RECENT_SCENES);

      localStorage.setItem(RECENT_SCENES_KEY, JSON.stringify(ids));

      // 更新状态
      const scenes = ids
        .map(id => SAMPLE_SCENES.find(s => s.id === id))
        .filter((s): s is Scene => s !== undefined);
      setRecentScenes(scenes);
    } catch (e) {
      console.warn('Failed to save recent scene:', e);
    }
  }, []);

  const handleSceneClick = (scene: Scene) => {
    setCurrentScene(scene);
    addToRecent(scene);
    if (scene.camera) {
      flyTo(
        scene.camera.longitude,
        scene.camera.latitude,
        scene.camera.height,
        {
          heading: scene.camera.heading ?? 0,
          pitch: scene.camera.pitch ?? -90,
          duration: 2
        }
      );
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className={`scene-panel ${!isChatOpen ? 'chat-collapsed' : ''}`}>
      <div className="scene-panel-header">
        <h2>场景库</h2>
        <button className="close-button" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      
      <div className="scene-panel-content">
        <div className="scene-section">
          <h3>推荐场景</h3>
          <div className="scene-grid">
            {SAMPLE_SCENES.map((scene) => (
              <div
                key={scene.id}
                className={`scene-card ${currentScene?.id === scene.id ? 'active' : ''}`}
                onClick={() => handleSceneClick(scene)}
              >
                <div className="scene-thumbnail">
                  <img src={scene.thumbnail} alt={scene.name} />
                </div>
                <div className="scene-info">
                  <h4>{scene.name}</h4>
                  {scene.description && <p>{scene.description}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {recentScenes.length > 0 && (
          <div className="scene-section">
            <h3>最近浏览</h3>
            <div className="scene-grid">
              {recentScenes.map((scene) => (
                <div
                  key={scene.id}
                  className={`scene-card ${currentScene?.id === scene.id ? 'active' : ''}`}
                  onClick={() => handleSceneClick(scene)}
                >
                  <div className="scene-thumbnail">
                    <img src={scene.thumbnail} alt={scene.name} />
                  </div>
                  <div className="scene-info">
                    <h4>{scene.name}</h4>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
