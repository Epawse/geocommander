/**
 * ActionDispatcher - 动作分发器
 * 
 * 将 MCP Server 发来的 JSON 指令映射到 Cesium API 调用
 * 这是 MCP 协议的核心：tool_call → viewer 操作
 */

import * as Cesium from 'cesium';
import type { MCPAction, MCPResponse } from '../services/WebSocketService';
import { createTiandituImageryProvider } from '../config/mapConfig';

// 支持的动作类型
export type ActionType = 
  | 'fly_to'
  | 'switch_basemap'
  | 'add_marker'
  | 'remove_marker'
  | 'clear_markers'
  | 'set_weather'
  | 'clear_weather'
  | 'set_time'
  | 'get_camera_position'
  | 'measure_distance'
  | 'draw_polygon'
  | 'highlight_area';

// 动作参数类型定义
export interface FlyToParams {
  longitude: number;
  latitude: number;
  altitude?: number;
  heading?: number;
  pitch?: number;
  roll?: number;
  duration?: number;
}

export interface SwitchBasemapParams {
  type: 'satellite' | 'vector' | 'terrain' | 'dark';
}

export interface AddMarkerParams {
  id?: string;
  name: string;
  longitude: number;
  latitude: number;
  altitude?: number;
  icon?: string;
  color?: string;
  description?: string;
}

export interface SetWeatherParams {
  type: 'rain' | 'snow' | 'fog' | 'clear';
  intensity?: number; // 0-1
}

export interface SetTimeParams {
  datetime?: string; // ISO 8601
  preset?: 'day' | 'night' | 'dawn' | 'dusk';
  speed?: number;
}

export interface MeasureDistanceParams {
  points: Array<{ longitude: number; latitude: number }>;
}

export interface DrawPolygonParams {
  id?: string;
  points: Array<{ longitude: number; latitude: number }>;
  color?: string;
  opacity?: number;
  name?: string;
}

export interface HighlightAreaParams {
  type: 'circle' | 'rectangle';
  center?: { longitude: number; latitude: number };
  radius?: number; // meters, for circle
  bounds?: {
    west: number;
    south: number;
    east: number;
    north: number;
  }; // for rectangle
  color?: string;
  duration?: number;
}

/**
 * 动作分发器类
 */
export class ActionDispatcher {
  private markers: Map<string, Cesium.Entity> = new Map();
  private weatherSystem: Cesium.ParticleSystem | null = null;
  private polygons: Map<string, Cesium.Entity> = new Map();

  /**
   * 获取 viewer 实例（从全局存储）
   */
  private get viewer(): Cesium.Viewer | null {
    if (typeof window !== 'undefined') {
      return (window as unknown as { __cesiumViewer: Cesium.Viewer | null }).__cesiumViewer || null;
    }
    return null;
  }

  /**
   * 设置 Cesium Viewer 实例（到全局存储）
   */
  setViewer(viewer: Cesium.Viewer | null): void {
    console.log('[ActionDispatcher] Setting viewer:', viewer ? 'valid' : 'null');
    if (typeof window !== 'undefined') {
      (window as unknown as { __cesiumViewer: Cesium.Viewer | null }).__cesiumViewer = viewer;
    }
  }

  /**
   * 获取 viewer 状态
   */
  hasViewer(): boolean {
    return this.viewer !== null;
  }

  /**
   * 分发动作
   */
  async dispatch(action: MCPAction): Promise<MCPResponse> {
    console.log('[ActionDispatcher] Dispatching action, viewer status:', this.viewer ? 'valid' : 'null');
    
    if (!this.viewer) {
      return {
        id: action.id,
        success: false,
        error: 'Viewer not initialized'
      };
    }

    try {
      const result = await this.executeAction(action.action as ActionType, action.payload);
      return {
        id: action.id,
        success: true,
        result
      };
    } catch (error) {
      return {
        id: action.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 执行具体动作
   */
  private async executeAction(type: ActionType, payload: Record<string, unknown>): Promise<unknown> {
    console.log(`[ActionDispatcher] Executing: ${type}`, payload);

    switch (type) {
      case 'fly_to':
        return this.flyTo(payload as unknown as FlyToParams);
      
      case 'switch_basemap':
        return this.switchBasemap(payload as unknown as SwitchBasemapParams);
      
      case 'add_marker':
        return this.addMarker(payload as unknown as AddMarkerParams);
      
      case 'remove_marker':
        return this.removeMarker(payload.id as string);
      
      case 'clear_markers':
        return this.clearMarkers();
      
      case 'set_weather':
        return this.setWeather(payload as unknown as SetWeatherParams);
      
      case 'clear_weather':
        return this.clearWeather();
      
      case 'set_time':
        return this.setTime(payload as unknown as SetTimeParams);
      
      case 'get_camera_position':
        return this.getCameraPosition();
      
      case 'measure_distance':
        return this.measureDistance(payload as unknown as MeasureDistanceParams);
      
      case 'draw_polygon':
        return this.drawPolygon(payload as unknown as DrawPolygonParams);
      
      case 'highlight_area':
        return this.highlightArea(payload as unknown as HighlightAreaParams);
      
      default:
        throw new Error(`Unknown action type: ${type}`);
    }
  }

  /**
   * 飞行到指定位置
   */
  private async flyTo(params: FlyToParams): Promise<{ message: string }> {
    const { longitude, latitude, altitude = 10000, heading = 0, pitch = -45, roll = 0, duration = 2 } = params;

    await this.viewer!.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude),
      orientation: {
        heading: Cesium.Math.toRadians(heading),
        pitch: Cesium.Math.toRadians(pitch),
        roll: Cesium.Math.toRadians(roll)
      },
      duration
    });

    return { message: `Flew to [${longitude}, ${latitude}] at altitude ${altitude}m` };
  }

  /**
   * 切换底图
   */
  private switchBasemap(params: SwitchBasemapParams): { message: string } {
    const viewer = this.viewer!;
    const layers = viewer.imageryLayers;
    
    // 移除所有现有底图层
    layers.removeAll();
    
    switch (params.type) {
      case 'satellite':
        // 卫星影像 + 注记
        layers.addImageryProvider(createTiandituImageryProvider('img'));
        layers.addImageryProvider(createTiandituImageryProvider('cia'));
        break;
      case 'vector':
        // 矢量底图 + 注记
        layers.addImageryProvider(createTiandituImageryProvider('vec'));
        layers.addImageryProvider(createTiandituImageryProvider('cva'));
        break;
      case 'terrain':
        // 地形底图 + 注记
        layers.addImageryProvider(createTiandituImageryProvider('ter'));
        layers.addImageryProvider(createTiandituImageryProvider('cta'));
        break;
      case 'dark':
        // 深色主题 - 使用 CartoDB 深色底图
        layers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
          url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          subdomains: ['a', 'b', 'c', 'd'],
          credit: 'Map tiles by CartoDB'
        }));
        break;
      default:
        // 默认卫星影像
        layers.addImageryProvider(createTiandituImageryProvider('img'));
        layers.addImageryProvider(createTiandituImageryProvider('cia'));
    }
    
    return { message: `Switched to ${params.type} basemap` };
  }

  /**
   * 添加标记点
   */
  private addMarker(params: AddMarkerParams): { id: string; message: string } {
    const id = params.id || crypto.randomUUID();
    const { name, longitude, latitude, altitude = 0, color = '#FF4444', description = '' } = params;

    // 移除同ID的旧标记
    if (this.markers.has(id)) {
      this.viewer!.entities.remove(this.markers.get(id)!);
    }

    const entity = this.viewer!.entities.add({
      id,
      name,
      position: Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude),
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString(color),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      },
      label: {
        text: name,
        font: '14px Microsoft YaHei',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      },
      description: description
    });

    this.markers.set(id, entity);
    return { id, message: `Added marker "${name}" at [${longitude}, ${latitude}]` };
  }

  /**
   * 移除标记点
   */
  private removeMarker(id: string): { message: string } {
    const entity = this.markers.get(id);
    if (entity) {
      this.viewer!.entities.remove(entity);
      this.markers.delete(id);
      return { message: `Removed marker ${id}` };
    }
    throw new Error(`Marker ${id} not found`);
  }

  /**
   * 清除所有标记点
   */
  private clearMarkers(): { count: number; message: string } {
    const count = this.markers.size;
    this.markers.forEach(entity => {
      this.viewer!.entities.remove(entity);
    });
    this.markers.clear();
    return { count, message: `Cleared ${count} markers` };
  }

  /**
   * 设置天气效果
   */
  private setWeather(params: SetWeatherParams): { message: string } {
    const { type, intensity = 0.5 } = params;

    // 先清除现有天气
    this.clearWeather();

    if (type === 'clear') {
      return { message: 'Weather cleared' };
    }

    // 根据天气类型创建粒子系统
    const scene = this.viewer!.scene;
    const camera = this.viewer!.camera;

    // 粒子发射器配置
    const emitterConfig = this.getWeatherEmitterConfig(type, intensity);
    
    this.weatherSystem = scene.primitives.add(new Cesium.ParticleSystem({
      modelMatrix: this.computeWeatherModelMatrix(camera),
      speed: emitterConfig.speed,
      lifetime: emitterConfig.lifetime,
      emitter: new Cesium.BoxEmitter(new Cesium.Cartesian3(
        emitterConfig.boxWidth,
        emitterConfig.boxWidth,
        emitterConfig.boxHeight
      )),
      emissionRate: emitterConfig.emissionRate,
      startColor: emitterConfig.startColor,
      endColor: emitterConfig.endColor,
      startScale: emitterConfig.startScale,
      endScale: emitterConfig.endScale,
      minimumImageSize: new Cesium.Cartesian2(emitterConfig.imageSize, emitterConfig.imageSize),
      maximumImageSize: new Cesium.Cartesian2(emitterConfig.imageSize * 1.5, emitterConfig.imageSize * 1.5),
      image: emitterConfig.image
    }) as Cesium.ParticleSystem);

    // 跟随相机更新粒子系统位置
    this.viewer!.scene.preUpdate.addEventListener(() => {
      if (this.weatherSystem) {
        this.weatherSystem.modelMatrix = this.computeWeatherModelMatrix(camera);
      }
    });

    return { message: `Set weather to ${type} with intensity ${intensity}` };
  }

  /**
   * 获取天气粒子配置
   */
  private getWeatherEmitterConfig(type: 'rain' | 'snow' | 'fog', intensity: number) {
    const baseRate = 500 * intensity;
    
    const configs = {
      rain: {
        speed: 100,
        lifetime: 1.5,
        boxWidth: 100,
        boxHeight: 100,
        emissionRate: baseRate * 2,
        startColor: new Cesium.Color(0.7, 0.7, 0.9, 0.5),
        endColor: new Cesium.Color(0.5, 0.5, 0.8, 0.3),
        startScale: 0.3,
        endScale: 0.1,
        imageSize: 2,
        image: this.createRaindropImage()
      },
      snow: {
        speed: 20,
        lifetime: 8,
        boxWidth: 100,
        boxHeight: 50,
        emissionRate: baseRate,
        startColor: Cesium.Color.WHITE.withAlpha(0.9),
        endColor: Cesium.Color.WHITE.withAlpha(0.5),
        startScale: 1.0,
        endScale: 0.5,
        imageSize: 8,
        image: this.createSnowflakeImage()
      },
      fog: {
        speed: 5,
        lifetime: 15,
        boxWidth: 200,
        boxHeight: 30,
        emissionRate: baseRate * 0.3,
        startColor: new Cesium.Color(0.8, 0.8, 0.8, 0.3),
        endColor: new Cesium.Color(0.9, 0.9, 0.9, 0.1),
        startScale: 5,
        endScale: 15,
        imageSize: 50,
        image: this.createFogImage()
      }
    };

    return configs[type];
  }

  /**
   * 创建雨滴纹理
   */
  private createRaindropImage(): string {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 16;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(2, 0, 2, 16);
    gradient.addColorStop(0, 'rgba(200, 200, 255, 0.8)');
    gradient.addColorStop(1, 'rgba(150, 150, 200, 0.2)');
    ctx.fillStyle = gradient;
    ctx.fillRect(1, 0, 2, 16);
    return canvas.toDataURL();
  }

  /**
   * 创建雪花纹理
   */
  private createSnowflakeImage(): string {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(8, 8, 8, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL();
  }

  /**
   * 创建雾气纹理
   */
  private createFogImage(): string {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(200, 200, 200, 0.4)');
    gradient.addColorStop(0.5, 'rgba(180, 180, 180, 0.2)');
    gradient.addColorStop(1, 'rgba(160, 160, 160, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(32, 32, 32, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL();
  }

  /**
   * 计算天气粒子系统的模型矩阵
   */
  private computeWeatherModelMatrix(camera: Cesium.Camera): Cesium.Matrix4 {
    const position = camera.positionWC;
    return Cesium.Transforms.eastNorthUpToFixedFrame(position);
  }

  /**
   * 清除天气效果
   */
  private clearWeather(): { message: string } {
    if (this.weatherSystem) {
      this.viewer!.scene.primitives.remove(this.weatherSystem);
      this.weatherSystem = null;
    }
    return { message: 'Weather cleared' };
  }

  /**
   * 设置时间
   */
  private setTime(params: SetTimeParams): { message: string } {
    const clock = this.viewer!.clock;
    
    if (params.datetime) {
      clock.currentTime = Cesium.JulianDate.fromIso8601(params.datetime);
    } else if (params.preset) {
      const now = new Date();
      const presetTimes: Record<string, number> = {
        dawn: 6,
        day: 12,
        dusk: 18,
        night: 0
      };
      now.setHours(presetTimes[params.preset], 0, 0, 0);
      clock.currentTime = Cesium.JulianDate.fromDate(now);
    }

    if (params.speed !== undefined) {
      clock.multiplier = params.speed;
    }

    // 启用光照
    this.viewer!.scene.globe.enableLighting = true;

    return { message: `Time set to ${params.datetime || params.preset}` };
  }

  /**
   * 获取当前相机位置
   */
  private getCameraPosition(): {
    longitude: number;
    latitude: number;
    altitude: number;
    heading: number;
    pitch: number;
    roll: number;
  } {
    const camera = this.viewer!.camera;
    const position = camera.positionCartographic;
    
    return {
      longitude: Cesium.Math.toDegrees(position.longitude),
      latitude: Cesium.Math.toDegrees(position.latitude),
      altitude: position.height,
      heading: Cesium.Math.toDegrees(camera.heading),
      pitch: Cesium.Math.toDegrees(camera.pitch),
      roll: Cesium.Math.toDegrees(camera.roll)
    };
  }

  /**
   * 测量距离
   */
  private measureDistance(params: MeasureDistanceParams): { distance: number; unit: string } {
    const { points } = params;
    if (points.length < 2) {
      throw new Error('At least 2 points required for distance measurement');
    }

    let totalDistance = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const start = Cesium.Cartesian3.fromDegrees(points[i].longitude, points[i].latitude);
      const end = Cesium.Cartesian3.fromDegrees(points[i + 1].longitude, points[i + 1].latitude);
      const geodesic = new Cesium.EllipsoidGeodesic(
        Cesium.Cartographic.fromCartesian(start),
        Cesium.Cartographic.fromCartesian(end)
      );
      totalDistance += geodesic.surfaceDistance;
    }

    return {
      distance: Math.round(totalDistance * 100) / 100,
      unit: 'meters'
    };
  }

  /**
   * 绘制多边形
   */
  private drawPolygon(params: DrawPolygonParams): { id: string; message: string } {
    const id = params.id || crypto.randomUUID();
    const { points, color = '#3388ff', opacity = 0.5, name = 'Polygon' } = params;

    // 移除同ID的旧多边形
    if (this.polygons.has(id)) {
      this.viewer!.entities.remove(this.polygons.get(id)!);
    }

    const positions = points.map(p => Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude));

    const entity = this.viewer!.entities.add({
      id,
      name,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: Cesium.Color.fromCssColorString(color).withAlpha(opacity),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString(color),
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      }
    });

    this.polygons.set(id, entity);
    return { id, message: `Drew polygon "${name}" with ${points.length} vertices` };
  }

  /**
   * 高亮区域
   */
  private highlightArea(params: HighlightAreaParams): { message: string } {
    const { type, color = '#ffff00', duration = 3 } = params;

    let entity: Cesium.Entity;

    if (type === 'circle' && params.center && params.radius) {
      entity = this.viewer!.entities.add({
        position: Cesium.Cartesian3.fromDegrees(params.center.longitude, params.center.latitude),
        ellipse: {
          semiMajorAxis: params.radius,
          semiMinorAxis: params.radius,
          material: Cesium.Color.fromCssColorString(color).withAlpha(0.3),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(color),
          outlineWidth: 3,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        }
      });
    } else if (type === 'rectangle' && params.bounds) {
      entity = this.viewer!.entities.add({
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(
            params.bounds.west,
            params.bounds.south,
            params.bounds.east,
            params.bounds.north
          ),
          material: Cesium.Color.fromCssColorString(color).withAlpha(0.3),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(color),
          outlineWidth: 3,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        }
      });
    } else {
      throw new Error('Invalid highlight parameters');
    }

    // 自动移除高亮
    setTimeout(() => {
      this.viewer!.entities.remove(entity);
    }, duration * 1000);

    return { message: `Highlighted ${type} area for ${duration} seconds` };
  }

  /**
   * 销毁分发器
   */
  destroy(): void {
    this.clearMarkers();
    this.clearWeather();
    this.polygons.forEach(entity => {
      this.viewer?.entities.remove(entity);
    });
    this.polygons.clear();
    this.setViewer(null);
  }
}

// 单例导出
export const actionDispatcher = new ActionDispatcher();

// 全局暴露以便调试
if (typeof window !== 'undefined') {
  (window as unknown as { actionDispatcher: ActionDispatcher }).actionDispatcher = actionDispatcher;
  console.log('[ActionDispatcher] Singleton created and exposed to window');
}

export default ActionDispatcher;
