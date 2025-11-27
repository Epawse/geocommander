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
  | 'reset_view'
  | 'get_camera_position'
  | 'measure_distance'
  | 'draw_polygon'
  | 'highlight_area'
  | 'zoom_in'
  | 'zoom_out'
  | 'set_pitch';

// 雨效果 Shader - 使用 Cesium GLSL ES 3.0 语法
// Cesium 会自动提供: in vec2 v_textureCoordinates, uniform sampler2D colorTexture
const rainFragmentShader = `
uniform sampler2D colorTexture;
uniform float time;
uniform float intensity;

in vec2 v_textureCoordinates;

// 随机函数
float N21(vec2 p) {
  p = fract(p * vec2(233.34, 851.74));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

// 雨滴图层
vec3 rainLayer(vec2 uv, float t, float scale) {
  vec2 aspect = vec2(2.0, 1.0);
  vec2 uvScaled = uv * scale * aspect;
  uvScaled.y += t * 0.25;
  
  vec2 gv = fract(uvScaled) - 0.5;
  vec2 id = floor(uvScaled);
  
  float n = N21(id);
  t += n * 6.283;
  
  float w = uv.y * 10.0;
  float x = (n - 0.5) * 0.8;
  x += (0.4 - abs(x)) * sin(3.0 * w) * pow(sin(w), 6.0) * 0.45;
  
  float y = -sin(t + sin(t + sin(t) * 0.5)) * 0.45;
  y -= (gv.x - x) * (gv.x - x);
  
  vec2 dropPos = (gv - vec2(x, y)) / aspect;
  float drop = smoothstep(0.05, 0.03, length(dropPos));
  
  vec2 trailPos = (gv - vec2(x, t * 0.25)) / aspect;
  trailPos.y = (fract(trailPos.y * 8.0) - 0.5) / 8.0;
  float trail = smoothstep(0.03, 0.01, length(trailPos));
  
  float fogTrail = smoothstep(-0.05, 0.05, dropPos.y);
  fogTrail *= smoothstep(0.5, y, gv.y);
  trail *= fogTrail;
  fogTrail *= smoothstep(0.05, 0.04, abs(dropPos.x));
  
  return vec3(drop + trail + fogTrail * 0.5);
}

void main(void) {
  vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
  vec2 uv = v_textureCoordinates;
  uv.y = 1.0 - uv.y;
  
  float t = time * 0.5;
  
  vec3 rain = vec3(0.0);
  rain += rainLayer(uv, t, 20.0) * 0.5;
  rain += rainLayer(uv * 1.5 + 0.5, t * 1.2, 30.0) * 0.35;
  rain += rainLayer(uv * 2.0 + 0.3, t * 0.8, 40.0) * 0.25;
  
  vec3 rainColor = vec3(0.7, 0.8, 1.0);
  vec3 finalColor = mix(sceneColor.rgb, rainColor, rain.r * intensity * 0.6);
  finalColor *= 1.0 - intensity * 0.2;
  
  out_FragColor = vec4(finalColor, sceneColor.a);
}
`;

// 雪效果 Shader
const snowFragmentShader = `
uniform sampler2D colorTexture;
uniform float time;
uniform float intensity;

in vec2 v_textureCoordinates;

// 随机函数
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// 雪花图层
float snowLayer(vec2 uv, float scale, float speed, float size) {
  uv = uv * scale;
  uv.y += time * speed;
  uv.x += sin(uv.y * 0.5 + time * 0.3) * 0.3;
  
  vec2 id = floor(uv);
  vec2 gv = fract(uv) - 0.5;
  
  float h = hash(id);
  float xOffset = (h - 0.5) * 0.6;
  float yOffset = sin(time * (0.5 + h) + h * 6.283) * 0.3;
  
  vec2 snowPos = gv - vec2(xOffset, yOffset);
  float snowSize = size * (0.5 + h * 0.5);
  
  return smoothstep(snowSize, snowSize * 0.3, length(snowPos));
}

void main(void) {
    vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
    vec2 uv = v_textureCoordinates;
    
    float snow = 0.0;
    snow += snowLayer(uv, 8.0, 0.15, 0.08) * 1.0;
    snow += snowLayer(uv + 0.1, 12.0, 0.2, 0.06) * 0.8;
    snow += snowLayer(uv + 0.2, 16.0, 0.25, 0.05) * 0.6;
    snow += snowLayer(uv + 0.3, 24.0, 0.3, 0.04) * 0.4;
    
    snow = clamp(snow, 0.0, 1.0);
    
    vec3 snowColor = vec3(1.0, 1.0, 1.0);
    vec3 finalColor = mix(sceneColor.rgb, snowColor, snow * intensity * 0.8);
    finalColor = mix(finalColor, vec3(0.85, 0.88, 0.92), intensity * 0.15);
    
    out_FragColor = vec4(finalColor, sceneColor.a);
  }
`;

// 雾效果 Shader - 使用 Cesium GLSL ES 3.0 语法
const fogFragmentShader = `
uniform sampler2D colorTexture;
uniform float intensity;
uniform float time;

in vec2 v_textureCoordinates;

// 噪声函数
float noise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float smoothNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  
  float a = noise(i);
  float b = noise(i + vec2(1.0, 0.0));
  float c = noise(i + vec2(0.0, 1.0));
  float d = noise(i + vec2(1.0, 1.0));
  
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * smoothNoise(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

void main(void) {
  vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
  
  vec2 uv = v_textureCoordinates;
  float fog = fbm(uv * 3.0 + time * 0.05);
  fog = fog * 0.5 + 0.5;
  vec3 fogColor = vec3(0.8, 0.82, 0.85);
  
  float fogAmount = fog * intensity * 0.7;
  
  vec3 finalColor = mix(sceneColor.rgb, fogColor, fogAmount);
  
  out_FragColor = vec4(finalColor, sceneColor.a);
}
`;

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

export interface ZoomParams {
  factor: number;
}

export interface SetPitchParams {
  pitch: number;
}

/**
 * 动作分发器类
 */
export class ActionDispatcher {
  private markers: Map<string, Cesium.Entity> = new Map();
  private weatherStage: Cesium.PostProcessStage | null = null;
  private weatherStartTime: number = 0;
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
      
      case 'reset_view':
        return this.resetView();
      
      case 'get_camera_position':
        return this.getCameraPosition();
      
      case 'measure_distance':
        return this.measureDistance(payload as unknown as MeasureDistanceParams);
      
      case 'draw_polygon':
        return this.drawPolygon(payload as unknown as DrawPolygonParams);
      
      case 'highlight_area':
        return this.highlightArea(payload as unknown as HighlightAreaParams);

      case 'zoom_in':
        return this.zoomIn(payload as unknown as ZoomParams);

      case 'zoom_out':
        return this.zoomOut(payload as unknown as ZoomParams);

      case 'set_pitch':
        return this.setPitch(payload as unknown as SetPitchParams);

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
   * 添加标记点（添加后自动飞往该位置）
   */
  private async addMarker(params: AddMarkerParams): Promise<{ id: string; message: string }> {
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

    // 添加标记后自动飞往该位置
    await this.flyTo({
      longitude,
      latitude,
      altitude: 1000,  // 使用较低高度以便看清标记
      duration: 2
    });

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
   * 设置天气效果 - 使用 PostProcessStage 实现屏幕空间效果
   * 这种方式比粒子系统更可靠，效果更明显
   */
  private setWeather(params: SetWeatherParams): { message: string } {
    const { type, intensity = 0.5 } = params;

    // 先清除现有天气
    this.clearWeather();

    if (type === 'clear') {
      return { message: 'Weather cleared' };
    }

    const viewer = this.viewer!;
    const scene = viewer.scene;
    
    // 记录开始时间用于动画
    this.weatherStartTime = performance.now();

    // 根据天气类型选择 shader
    let fragmentShader: string;
    let atmosphereSettings: { hue: number; saturation: number; brightness: number };

    if (type === 'snow') {
      fragmentShader = snowFragmentShader;
      atmosphereSettings = { hue: -0.8, saturation: -0.7, brightness: -0.33 };
    } else if (type === 'rain') {
      fragmentShader = rainFragmentShader;
      atmosphereSettings = { hue: -0.97, saturation: 0.25, brightness: -0.4 };
    } else if (type === 'fog') {
      fragmentShader = fogFragmentShader;
      atmosphereSettings = { hue: 0, saturation: -0.3, brightness: -0.2 };
    } else {
      return { message: `Unknown weather type: ${type}` };
    }

    // 保存原始大气设置
    this.originalAtmosphereSettings = {
      hueShift: scene.skyAtmosphere?.hueShift ?? 0,
      saturationShift: scene.skyAtmosphere?.saturationShift ?? 0,
      brightnessShift: scene.skyAtmosphere?.brightnessShift ?? 0,
      fogDensity: scene.fog.density,
      fogMinimumBrightness: scene.fog.minimumBrightness
    };

    // 创建 PostProcessStage
    const startTime = this.weatherStartTime;
    this.weatherStage = new Cesium.PostProcessStage({
      fragmentShader: fragmentShader,
      uniforms: {
        time: () => (performance.now() - startTime) / 1000.0,
        intensity: intensity
      }
    });

    scene.postProcessStages.add(this.weatherStage);

    // 调整大气效果
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.hueShift = atmosphereSettings.hue;
      scene.skyAtmosphere.saturationShift = atmosphereSettings.saturation;
      scene.skyAtmosphere.brightnessShift = atmosphereSettings.brightness;
    }

    // 雾效果特殊处理
    if (type === 'fog') {
      scene.fog.density = 0.0003 * intensity + 0.0001;
      scene.fog.minimumBrightness = 0.8;
    }

    console.log(`[ActionDispatcher] Weather effect created using PostProcessStage: ${type}, intensity: ${intensity}`);
    return { message: `Set weather to ${type} with intensity ${intensity}` };
  }

  // 原始大气设置，用于恢复
  private originalAtmosphereSettings: {
    hueShift: number;
    saturationShift: number;
    brightnessShift: number;
    fogDensity: number;
    fogMinimumBrightness: number;
  } | null = null;

  /**
   * 清除天气效果
   */
  private clearWeather(): { message: string } {
    // 移除 PostProcessStage
    if (this.weatherStage && this.viewer) {
      this.viewer.scene.postProcessStages.remove(this.weatherStage);
      this.weatherStage = null;
      console.log('[ActionDispatcher] Weather PostProcessStage cleared');
    }

    // 恢复大气设置
    if (this.originalAtmosphereSettings && this.viewer) {
      const scene = this.viewer.scene;
      if (scene.skyAtmosphere) {
        scene.skyAtmosphere.hueShift = this.originalAtmosphereSettings.hueShift;
        scene.skyAtmosphere.saturationShift = this.originalAtmosphereSettings.saturationShift;
        scene.skyAtmosphere.brightnessShift = this.originalAtmosphereSettings.brightnessShift;
      }
      scene.fog.density = this.originalAtmosphereSettings.fogDensity;
      scene.fog.minimumBrightness = this.originalAtmosphereSettings.fogMinimumBrightness;
      this.originalAtmosphereSettings = null;
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
   * 重置视角到默认位置（中国全景）
   */
  private resetView(): { message: string } {
    const viewer = this.viewer!;
    
    // 飞到中国中心位置，展示全景
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(104.0, 35.0, 8000000), // 中国中心，高度8000km
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-90), // 俯视
        roll: 0
      },
      duration: 2
    });

    return { message: '视角已重置' };
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
   * 放大视图（减少相机高度）
   */
  private zoomIn(params: ZoomParams): { message: string } {
    const { factor = 0.5 } = params;
    const camera = this.viewer!.camera;
    const position = camera.positionCartographic;

    // 计算新高度
    const newHeight = Math.max(100, position.height * factor);

    camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        position.longitude,
        position.latitude,
        newHeight
      ),
      orientation: {
        heading: camera.heading,
        pitch: camera.pitch,
        roll: camera.roll
      },
      duration: 0.5
    });

    return { message: `视图已放大，高度: ${Math.round(newHeight)}m` };
  }

  /**
   * 缩小视图（增加相机高度）
   */
  private zoomOut(params: ZoomParams): { message: string } {
    const { factor = 2.0 } = params;
    const camera = this.viewer!.camera;
    const position = camera.positionCartographic;

    // 计算新高度（最大不超过 20000km）
    const newHeight = Math.min(20000000, position.height * factor);

    camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        position.longitude,
        position.latitude,
        newHeight
      ),
      orientation: {
        heading: camera.heading,
        pitch: camera.pitch,
        roll: camera.roll
      },
      duration: 0.5
    });

    return { message: `视图已缩小，高度: ${Math.round(newHeight)}m` };
  }

  /**
   * 设置相机俯仰角
   */
  private setPitch(params: SetPitchParams): { message: string } {
    const { pitch = -45 } = params;
    const camera = this.viewer!.camera;
    const position = camera.positionCartographic;

    camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        position.longitude,
        position.latitude,
        position.height
      ),
      orientation: {
        heading: camera.heading,
        pitch: Cesium.Math.toRadians(pitch),
        roll: camera.roll
      },
      duration: 0.5
    });

    return { message: `俯仰角已设置为 ${pitch}°` };
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
