import { createContext, useContext, useRef, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import * as Cesium from 'cesium';
import type { Scene } from '../types';

interface CesiumContextType {
  viewerRef: React.RefObject<Cesium.Viewer | null>;
  viewer: Cesium.Viewer | null;
  setViewer: (viewer: Cesium.Viewer | null) => void;
  currentScene: Scene | null;
  setCurrentScene: (scene: Scene | null) => void;
  flyTo: (longitude: number, latitude: number, height: number, options?: {
    heading?: number;
    pitch?: number;
    roll?: number;
    duration?: number;
  }) => void;
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

const CesiumContext = createContext<CesiumContextType | null>(null);

export function CesiumProvider({ children }: { children: ReactNode }) {
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const [viewer, setViewerState] = useState<Cesium.Viewer | null>(null);
  const [currentScene, setCurrentScene] = useState<Scene | null>(null);

  const setViewer = useCallback((v: Cesium.Viewer | null) => {
    viewerRef.current = v;
    setViewerState(v);
  }, []);

  const flyTo = useCallback((
    longitude: number,
    latitude: number,
    height: number,
    options?: {
      heading?: number;
      pitch?: number;
      roll?: number;
      duration?: number;
    }
  ) => {
    if (!viewerRef.current) return;
    
    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
      orientation: {
        heading: Cesium.Math.toRadians(options?.heading ?? 0),
        pitch: Cesium.Math.toRadians(options?.pitch ?? -90),
        roll: Cesium.Math.toRadians(options?.roll ?? 0)
      },
      duration: options?.duration ?? 2
    });
  }, []);

  const resetView = useCallback(() => {
    flyTo(100, 35, 8000000);
  }, [flyTo]);

  const zoomIn = useCallback(() => {
    if (!viewerRef.current) return;
    const camera = viewerRef.current.camera;
    const currentHeight = camera.positionCartographic.height;
    camera.zoomIn(currentHeight * 0.3);
  }, []);

  const zoomOut = useCallback(() => {
    if (!viewerRef.current) return;
    const camera = viewerRef.current.camera;
    const currentHeight = camera.positionCartographic.height;
    camera.zoomOut(currentHeight * 0.3);
  }, []);

  const contextValue = useMemo(() => ({
    viewerRef,
    viewer,
    setViewer,
    currentScene,
    setCurrentScene,
    flyTo,
    resetView,
    zoomIn,
    zoomOut
  }), [viewer, currentScene, setViewer, flyTo, resetView, zoomIn, zoomOut]);

  return (
    <CesiumContext.Provider value={contextValue}>
      {children}
    </CesiumContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCesium() {
  const context = useContext(CesiumContext);
  if (!context) {
    throw new Error('useCesium must be used within a CesiumProvider');
  }
  return context;
}
