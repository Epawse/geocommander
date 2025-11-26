import { 
  Home, 
  Plus, 
  Minus, 
  Navigation, 
  Compass, 
  Ruler,
  Square,
  Scissors,
  Mountain,
  Layers,
  Settings
} from 'lucide-react';
import { useCesium } from '../context/CesiumContext';
import './ToolPanel.css';

interface ToolPanelProps {
  onMeasureDistance: () => void;
  onMeasureArea: () => void;
  onSlice: () => void;
  onElevationProfile: () => void;
  onLayerToggle: () => void;
}

export function ToolPanel({ 
  onMeasureDistance, 
  onMeasureArea,
  onSlice,
  onElevationProfile,
  onLayerToggle
}: ToolPanelProps) {
  const { resetView, zoomIn, zoomOut, viewerRef } = useCesium();

  const handleResetNorth = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    
    viewer.camera.setView({
      orientation: {
        heading: 0,
        pitch: viewer.camera.pitch,
        roll: 0
      }
    });
  };

  const handleToggleRotation = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    
    // 切换3D旋转/2D平移模式
    const screenSpaceCameraController = viewer.scene.screenSpaceCameraController;
    screenSpaceCameraController.enableRotate = !screenSpaceCameraController.enableRotate;
  };

  return (
    <div className="tool-panel">
      {/* 导航控制组 */}
      <div className="tool-group">
        <button className="tool-button" onClick={resetView} title="主页">
          <Home size={18} />
        </button>
        <button className="tool-button" onClick={zoomIn} title="放大">
          <Plus size={18} />
        </button>
        <button className="tool-button" onClick={zoomOut} title="缩小">
          <Minus size={18} />
        </button>
        <button className="tool-button" onClick={handleToggleRotation} title="切换平移/旋转">
          <Navigation size={18} />
        </button>
        <button className="tool-button" onClick={handleResetNorth} title="重置方向">
          <Compass size={18} />
        </button>
      </div>

      {/* 测量工具组 */}
      <div className="tool-group">
        <button className="tool-button" onClick={onMeasureDistance} title="直线测量">
          <Ruler size={18} />
        </button>
        <button className="tool-button" onClick={onMeasureArea} title="面积测量">
          <Square size={18} />
        </button>
        <button className="tool-button" onClick={onSlice} title="剖面">
          <Scissors size={18} />
        </button>
        <button className="tool-button" onClick={onElevationProfile} title="高程剖面">
          <Mountain size={18} />
        </button>
      </div>

      {/* 图层和设置组 */}
      <div className="tool-group">
        <button className="tool-button" onClick={onLayerToggle} title="图层">
          <Layers size={18} />
        </button>
        <button className="tool-button" title="设置">
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
}
