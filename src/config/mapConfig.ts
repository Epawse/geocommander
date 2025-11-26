import * as Cesium from 'cesium';

// 天地图 Token (公开测试Token)
export const TIANDITU_TOKEN = '4267820f43926eaf808d61dc07269beb';

// Cesium Ion Token (可选，用于地形)
export const CESIUM_ION_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYTEyMjIzYi1jZDUzLTRlZjAtOWE0OC00MTU4ODM4ZjA0YjYiLCJpZCI6MjU5LCJpYXQiOjE3MzI1MjUyMDB9.DcKHJc1Rp6iCTjzT1hPfMzVLt7t6Z';

// 天地图底图配置 (使用 {z}, {x}, {y} 作为 Cesium UrlTemplateImageryProvider 的占位符)
export const TiandituLayers = {
  // 矢量底图
  vec: {
    url: `https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=vec&STYLE=default&FORMAT=tiles&TILEMATRIXSET=w&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_TOKEN}`,
    subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
    name: '天地图矢量'
  },
  // 矢量注记
  cva: {
    url: `https://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=cva&STYLE=default&FORMAT=tiles&TILEMATRIXSET=w&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_TOKEN}`,
    subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
    name: '天地图矢量注记'
  },
  // 影像底图
  img: {
    url: `https://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=img&STYLE=default&FORMAT=tiles&TILEMATRIXSET=w&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_TOKEN}`,
    subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
    name: '天地图影像'
  },
  // 影像注记
  cia: {
    url: `https://t{s}.tianditu.gov.cn/cia_w/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=cia&STYLE=default&FORMAT=tiles&TILEMATRIXSET=w&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_TOKEN}`,
    subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
    name: '天地图影像注记'
  },
  // 地形底图
  ter: {
    url: `https://t{s}.tianditu.gov.cn/ter_w/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=ter&STYLE=default&FORMAT=tiles&TILEMATRIXSET=w&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_TOKEN}`,
    subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
    name: '天地图地形'
  },
  // 地形注记
  cta: {
    url: `https://t{s}.tianditu.gov.cn/cta_w/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=cta&STYLE=default&FORMAT=tiles&TILEMATRIXSET=w&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TIANDITU_TOKEN}`,
    subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
    name: '天地图地形注记'
  }
};

// 创建天地图影像提供器
export function createTiandituImageryProvider(type: keyof typeof TiandituLayers) {
  const config = TiandituLayers[type];
  return new Cesium.UrlTemplateImageryProvider({
    url: config.url,
    subdomains: config.subdomains,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    maximumLevel: 18
  });
}

// 默认相机位置 (中国区域)
export const DEFAULT_CAMERA = {
  longitude: 100,
  latitude: 35,
  height: 8000000,
  heading: 0,
  pitch: -90,
  roll: 0
};

// 示例场景配置
export const SAMPLE_SCENES = [
  {
    id: 'china',
    name: '中国全景',
    thumbnail: 'https://images.unsplash.com/photo-1547981609-4b6bfe67ca0b?w=200&h=150&fit=crop',
    description: '中国全境三维场景',
    camera: {
      longitude: 105,
      latitude: 35,
      height: 5000000
    }
  },
  {
    id: 'beijing',
    name: '北京',
    thumbnail: 'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?w=200&h=150&fit=crop',
    description: '北京市三维场景',
    camera: {
      longitude: 116.4,
      latitude: 39.9,
      height: 100000
    }
  },
  {
    id: 'shanghai',
    name: '上海',
    thumbnail: 'https://images.unsplash.com/photo-1545893835-abaa50cbe628?w=200&h=150&fit=crop',
    description: '上海市三维场景',
    camera: {
      longitude: 121.47,
      latitude: 31.23,
      height: 100000
    }
  },
  {
    id: 'guangzhou',
    name: '广州',
    thumbnail: 'https://images.unsplash.com/photo-1583417319070-4a69db38a482?w=200&h=150&fit=crop',
    description: '广州市三维场景',
    camera: {
      longitude: 113.26,
      latitude: 23.13,
      height: 100000
    }
  },
  {
    id: 'himalaya',
    name: '喜马拉雅山',
    thumbnail: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?w=200&h=150&fit=crop',
    description: '喜马拉雅山脉三维场景',
    camera: {
      longitude: 86.92,
      latitude: 27.99,
      height: 50000,
      pitch: -30
    }
  },
  {
    id: 'yellowriver',
    name: '黄河流域',
    thumbnail: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=200&h=150&fit=crop',
    description: '黄河流域三维场景',
    camera: {
      longitude: 110,
      latitude: 37,
      height: 500000
    }
  }
];
