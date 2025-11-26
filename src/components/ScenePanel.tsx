import { X } from 'lucide-react';
import { useCesium } from '../context/CesiumContext';
import { SAMPLE_SCENES } from '../config/mapConfig';
import type { Scene } from '../types';
import './ScenePanel.css';

interface ScenePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ScenePanel({ isOpen, onClose }: ScenePanelProps) {
  const { flyTo, setCurrentScene, currentScene } = useCesium();

  const handleSceneClick = (scene: Scene) => {
    setCurrentScene(scene);
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
    <div className="scene-panel">
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

        <div className="scene-section">
          <h3>最近浏览</h3>
          <p className="empty-message">暂无最近浏览的场景</p>
        </div>

        <div className="scene-section">
          <h3>我的场景</h3>
          <p className="empty-message">登录后查看我的场景</p>
        </div>
      </div>
    </div>
  );
}
