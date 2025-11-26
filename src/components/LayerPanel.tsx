import { useState } from 'react';
import { X, Image, Map, Mountain } from 'lucide-react';
import { useCesium } from '../context/CesiumContext';
import { createTiandituImageryProvider } from '../config/mapConfig';
import * as Cesium from 'cesium';
import './LayerPanel.css';

interface LayerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type BaseMapType = 'img' | 'vec' | 'ter';

export function LayerPanel({ isOpen, onClose }: LayerPanelProps) {
  const { viewerRef } = useCesium();
  const [activeBaseMap, setActiveBaseMap] = useState<BaseMapType>('img');
  const [showLabels, setShowLabels] = useState(true);
  const [showTerrain, setShowTerrain] = useState(false);

  const baseMaps = [
    { id: 'img' as const, name: '影像', icon: <Image size={20} /> },
    { id: 'vec' as const, name: '矢量', icon: <Map size={20} /> },
    { id: 'ter' as const, name: '地形', icon: <Mountain size={20} /> },
  ];

  const handleBaseMapChange = (type: BaseMapType) => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    setActiveBaseMap(type);

    // 移除所有影像图层
    viewer.imageryLayers.removeAll();

    // 添加新的底图
    viewer.imageryLayers.addImageryProvider(
      createTiandituImageryProvider(type)
    );

    // 添加注记图层
    if (showLabels) {
      const labelType = type === 'img' ? 'cia' : type === 'vec' ? 'cva' : 'cta';
      viewer.imageryLayers.addImageryProvider(
        createTiandituImageryProvider(labelType)
      );
    }
  };

  const handleToggleLabels = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const newShowLabels = !showLabels;
    setShowLabels(newShowLabels);

    // 移除所有图层并重新添加
    viewer.imageryLayers.removeAll();
    
    viewer.imageryLayers.addImageryProvider(
      createTiandituImageryProvider(activeBaseMap)
    );

    if (newShowLabels) {
      const labelType = activeBaseMap === 'img' ? 'cia' : activeBaseMap === 'vec' ? 'cva' : 'cta';
      viewer.imageryLayers.addImageryProvider(
        createTiandituImageryProvider(labelType)
      );
    }
  };

  const handleToggleTerrain = async () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const newShowTerrain = !showTerrain;
    setShowTerrain(newShowTerrain);

    if (newShowTerrain) {
      // 使用 Cesium World Terrain
      try {
        const terrain = await Cesium.createWorldTerrainAsync();
        viewer.terrainProvider = terrain;
      } catch (error) {
        console.error('Failed to load terrain:', error);
        // 回退到椭球体地形
        viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
      }
    } else {
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="layer-panel">
      <div className="layer-panel-header">
        <h2>图层控制</h2>
        <button className="close-button" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <div className="layer-panel-content">
        <div className="layer-section">
          <h3>底图</h3>
          <div className="basemap-grid">
            {baseMaps.map((map) => (
              <button
                key={map.id}
                className={`basemap-button ${activeBaseMap === map.id ? 'active' : ''}`}
                onClick={() => handleBaseMapChange(map.id)}
              >
                {map.icon}
                <span>{map.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="layer-section">
          <h3>显示选项</h3>
          <div className="layer-options">
            <label className="layer-option">
              <input
                type="checkbox"
                checked={showLabels}
                onChange={handleToggleLabels}
              />
              <span className="checkmark"></span>
              <span className="label-text">显示注记</span>
            </label>
            <label className="layer-option">
              <input
                type="checkbox"
                checked={showTerrain}
                onChange={handleToggleTerrain}
              />
              <span className="checkmark"></span>
              <span className="label-text">显示地形</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
