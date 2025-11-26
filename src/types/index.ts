export interface Scene {
  id: string;
  name: string;
  thumbnail: string;
  description?: string;
  camera?: {
    longitude: number;
    latitude: number;
    height: number;
    heading?: number;
    pitch?: number;
    roll?: number;
  };
}

export interface MeasureResult {
  type: 'distance' | 'area';
  value: number;
  unit: string;
  positions: number[][];
}

export interface SearchResult {
  name: string;
  longitude: number;
  latitude: number;
  address?: string;
}
