import { useState, useEffect, useCallback, useRef } from 'react';
import * as Cesium from 'cesium';
import { X } from 'lucide-react';
import { useCesium } from '../context/CesiumContext';
import './MeasurePanel.css';

interface MeasurePanelProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'distance' | 'area';
}

export function MeasurePanel({ isOpen, onClose, type }: MeasurePanelProps) {
  const { viewerRef } = useCesium();
  const [result, setResult] = useState<string>('');
  const [isDrawing, setIsDrawing] = useState(false);
  const pointsRef = useRef<Cesium.Cartesian3[]>([]);
  const entitiesRef = useRef<Cesium.Entity[]>([]);
  const handlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);

  const clearMeasurement = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    entitiesRef.current.forEach(entity => {
      viewer.entities.remove(entity);
    });
    entitiesRef.current = [];
    pointsRef.current = [];
    setResult('');
    setIsDrawing(false);
  }, [viewerRef]);

  const formatDistance = (meters: number) => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} 公里`;
    }
    return `${meters.toFixed(2)} 米`;
  };

  const formatArea = (squareMeters: number) => {
    if (squareMeters >= 1000000) {
      return `${(squareMeters / 1000000).toFixed(2)} 平方公里`;
    }
    return `${squareMeters.toFixed(2)} 平方米`;
  };

  const calculateDistance = useCallback((positions: Cesium.Cartesian3[]) => {
    let totalDistance = 0;
    for (let i = 0; i < positions.length - 1; i++) {
      const geodesic = new Cesium.EllipsoidGeodesic(
        Cesium.Cartographic.fromCartesian(positions[i]),
        Cesium.Cartographic.fromCartesian(positions[i + 1])
      );
      totalDistance += geodesic.surfaceDistance;
    }
    return totalDistance;
  }, []);

  const calculateArea = useCallback((positions: Cesium.Cartesian3[]) => {
    if (positions.length < 3) return 0;
    
    // 简化的面积计算（球面多边形）
    const cartographics = positions.map(p => Cesium.Cartographic.fromCartesian(p));
    let area = 0;
    const n = cartographics.length;
    
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += cartographics[i].longitude * cartographics[j].latitude;
      area -= cartographics[j].longitude * cartographics[i].latitude;
    }
    
    area = Math.abs(area) / 2;
    // 转换为平方米（地球平均半径）
    const earthRadius = 6371000;
    return area * earthRadius * earthRadius;
  }, []);

  const startMeasurement = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    clearMeasurement();
    setIsDrawing(true);

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handlerRef.current = handler;

    // 左键点击添加点
    handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
      const ray = viewer.camera.getPickRay(click.position);
      if (!ray) return;
      
      const position = viewer.scene.globe.pick(ray, viewer.scene);
      if (!position) return;

      pointsRef.current.push(position);

      // 添加点标记
      const point = viewer.entities.add({
        position: position,
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString('#60a5fa'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        }
      });
      entitiesRef.current.push(point);

      // 添加线或多边形
      if (type === 'distance' && pointsRef.current.length >= 2) {
        // 移除之前的线
        const lastLine = entitiesRef.current.find(e => e.polyline);
        if (lastLine) {
          viewer.entities.remove(lastLine);
          entitiesRef.current = entitiesRef.current.filter(e => e !== lastLine);
        }

        const line = viewer.entities.add({
          polyline: {
            positions: [...pointsRef.current],
            width: 3,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.2,
              color: Cesium.Color.fromCssColorString('#60a5fa')
            }),
            clampToGround: true
          }
        });
        entitiesRef.current.push(line);

        const distance = calculateDistance(pointsRef.current);
        setResult(formatDistance(distance));
      }

      if (type === 'area' && pointsRef.current.length >= 3) {
        // 移除之前的多边形
        const lastPolygon = entitiesRef.current.find(e => e.polygon);
        if (lastPolygon) {
          viewer.entities.remove(lastPolygon);
          entitiesRef.current = entitiesRef.current.filter(e => e !== lastPolygon);
        }

        const polygon = viewer.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy([...pointsRef.current]),
            material: Cesium.Color.fromCssColorString('#60a5fa').withAlpha(0.3),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString('#60a5fa'),
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
          }
        });
        entitiesRef.current.push(polygon);

        const area = calculateArea(pointsRef.current);
        setResult(formatArea(area));
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // 右键结束测量
    handler.setInputAction(() => {
      setIsDrawing(false);
      if (handlerRef.current) {
        handlerRef.current.destroy();
        handlerRef.current = null;
      }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
  }, [viewerRef, type, clearMeasurement, calculateDistance, calculateArea]);

  // 清理资源的函数（不包含 setState）
  const cleanupResources = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    entitiesRef.current.forEach(entity => {
      viewer.entities.remove(entity);
    });
    entitiesRef.current = [];
    pointsRef.current = [];
    
    if (handlerRef.current) {
      handlerRef.current.destroy();
      handlerRef.current = null;
    }
  }, [viewerRef]);

  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, [cleanupResources]);

  // 当面板关闭时重置状态
  const prevIsOpenRef = useRef(isOpen);
  useEffect(() => {
    if (prevIsOpenRef.current && !isOpen) {
      cleanupResources();
      // 使用 requestAnimationFrame 避免同步 setState
      requestAnimationFrame(() => {
        setResult('');
        setIsDrawing(false);
      });
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, cleanupResources]);

  if (!isOpen) return null;

  return (
    <div className="measure-panel">
      <div className="measure-panel-header">
        <h2>{type === 'distance' ? '直线测量' : '面积测量'}</h2>
        <button className="close-button" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <div className="measure-panel-content">
        <div className="measure-instructions">
          {!isDrawing ? (
            <p>点击"开始测量"按钮，然后在地图上点击添加测量点</p>
          ) : (
            <p>左键点击添加点，右键结束测量</p>
          )}
        </div>

        {result && (
          <div className="measure-result">
            <span className="result-label">{type === 'distance' ? '距离' : '面积'}:</span>
            <span className="result-value">{result}</span>
          </div>
        )}

        <div className="measure-actions">
          <button
            className={`measure-button ${isDrawing ? 'active' : ''}`}
            onClick={startMeasurement}
            disabled={isDrawing}
          >
            {isDrawing ? '测量中...' : '开始测量'}
          </button>
          <button
            className="measure-button secondary"
            onClick={clearMeasurement}
          >
            清除
          </button>
        </div>
      </div>
    </div>
  );
}
