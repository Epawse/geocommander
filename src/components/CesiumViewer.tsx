import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useCesium } from '../context/CesiumContext';
import { createTiandituImageryProvider, DEFAULT_CAMERA } from '../config/mapConfig';
import { actionDispatcher } from '../dispatcher/ActionDispatcher';
import './CesiumViewer.css';

export function CesiumViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { setViewer } = useCesium();

  useEffect(() => {
    if (!containerRef.current) return;

    console.log('[CesiumViewer] Initializing Cesium Viewer...');

    // 初始化 Cesium Viewer
    const viewer = new Cesium.Viewer(containerRef.current, {
      // 禁用默认的 UI 组件，我们会自己实现
      animation: false,
      timeline: false,
      fullscreenButton: false,
      vrButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      navigationHelpButton: false,
      baseLayerPicker: false,
      // 启用地形
      terrain: undefined,
      // 渲染设置 - 不使用 requestRenderMode 以支持粒子动画
      requestRenderMode: false,
    });

    // 移除默认的 Cesium 底图
    viewer.imageryLayers.removeAll();

    // 添加天地图影像底图
    const imgLayer = viewer.imageryLayers.addImageryProvider(
      createTiandituImageryProvider('img')
    );
    imgLayer.alpha = 1;

    // 添加天地图影像注记
    const ciaLayer = viewer.imageryLayers.addImageryProvider(
      createTiandituImageryProvider('cia')
    );
    ciaLayer.alpha = 1;

    // 设置初始相机位置
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        DEFAULT_CAMERA.longitude,
        DEFAULT_CAMERA.latitude,
        DEFAULT_CAMERA.height
      ),
      orientation: {
        heading: Cesium.Math.toRadians(DEFAULT_CAMERA.heading),
        pitch: Cesium.Math.toRadians(DEFAULT_CAMERA.pitch),
        roll: Cesium.Math.toRadians(DEFAULT_CAMERA.roll)
      }
    });

    // 启用抗锯齿
    viewer.scene.postProcessStages.fxaa.enabled = true;

    // 设置天空盒和大气效果
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = true;
    }
    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.showGroundAtmosphere = true;

    // 隐藏 Cesium logo
    const creditContainer = viewer.cesiumWidget.creditContainer as HTMLElement;
    creditContainer.style.display = 'none';

    // 设置 viewer 到 context 和 ActionDispatcher
    setViewer(viewer);
    actionDispatcher.setViewer(viewer);
    console.log('[CesiumViewer] Viewer initialized and set to context and ActionDispatcher');

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        viewer.destroy();
      }
      setViewer(null);
      actionDispatcher.setViewer(null as unknown as Cesium.Viewer);
    };
  }, [setViewer]);

  return (
    <div className="cesium-viewer-container" ref={containerRef} />
  );
}
