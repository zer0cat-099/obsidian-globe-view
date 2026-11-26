export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface Crop {
  left: number;
  right: number;
}

export interface MapPosition {
  u: number;
  v: number;
}

export interface Marker {
  id: string;
  mapPath: string;
  notePath: string;
  position: MapPosition;
}

export interface Settings {
  imagePath: string;
  crop: Crop;
  markers: Marker[];
  mapCrops: Record<string, Crop>;
}

export const FULL_IMAGE: Crop = { left: 0, right: 1 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function cropIsValid(left: unknown, right: unknown): boolean {
  return typeof left === 'number' && typeof right === 'number'
    && left >= 0 && right <= 1 && right - left >= 0.01;
}

function readCrop(value: unknown): Crop | undefined {
  if (!isRecord(value)) return;
  const { left, right } = value;
  if (typeof left === 'number' && typeof right === 'number' && cropIsValid(left, right)) {
    return { left, right };
  }
}

export function cropColumns(imageWidth: number, crop: Crop): { x: number; width: number } {
  const x = Math.min(imageWidth - 1, Math.round(imageWidth * crop.left));
  const right = Math.round(imageWidth * crop.right);
  return { x, width: Math.max(1, right - x) };
}

function readMarker(value: unknown): Marker | undefined {
  if (!isRecord(value) || !isRecord(value.position)) return;
  const { id, mapPath, notePath, position: { u, v } } = value;
  if (typeof id !== 'string' || !id || typeof mapPath !== 'string' || !mapPath
    || typeof notePath !== 'string' || !notePath
    || !isFraction(u) || !isFraction(v)) return;
  return { id, mapPath, notePath, position: { u, v } };
}

function isFraction(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

export function readSettings(data: unknown): Settings {
  const value = isRecord(data) ? data : {};
  const markers = Array.isArray(value.markers) ? value.markers : [];
  const mapCrops = Object.fromEntries(
    Object.entries(isRecord(value.mapCrops) ? value.mapCrops : {}).flatMap(([path, value]) => {
      const crop = readCrop(value);
      return crop ? [[path, crop] as const] : [];
    }),
  );
  return {
    imagePath: typeof value.imagePath === 'string' ? value.imagePath : '',
    crop: readCrop(value.crop) ?? { ...FULL_IMAGE },
    markers: markers.map(readMarker).filter(marker => marker !== undefined),
    mapCrops,
  };
}

export function selectMap(settings: Settings, imagePath: string): Settings {
  if (settings.imagePath === imagePath) return settings;
  const mapCrops = { ...settings.mapCrops };
  if (settings.imagePath) mapCrops[settings.imagePath] = settings.crop;
  const crop = Object.hasOwn(mapCrops, imagePath) ? mapCrops[imagePath] : { ...FULL_IMAGE };
  return { ...settings, imagePath, crop, mapCrops };
}

export function renamePath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath || path.startsWith(oldPath + '/')) {
    return newPath + path.slice(oldPath.length);
  }
  return path;
}

export function renameVaultPaths(settings: Settings, oldPath: string, newPath: string): Settings {
  const move = (path: string) => renamePath(path, oldPath, newPath);
  const imagePath = move(settings.imagePath);
  let changed = imagePath !== settings.imagePath;
  const markers = settings.markers.map(marker => {
    const mapPath = move(marker.mapPath);
    const notePath = move(marker.notePath);
    if (mapPath === marker.mapPath && notePath === marker.notePath) return marker;
    changed = true;
    return { ...marker, mapPath, notePath };
  });
  const mapCrops = Object.fromEntries(Object.entries(settings.mapCrops).map(([path, crop]) => {
    const moved = move(path);
    changed ||= moved !== path;
    return [moved, crop];
  }));
  return changed ? { ...settings, imagePath, markers, mapCrops } : settings;
}

export function surfaceVisible(point: Point, camera: Point): boolean {
  // For a unit sphere, the surface normal is the point itself.
  return point.x * camera.x + point.y * camera.y + point.z * camera.z > 1;
}

const FULL_TURN = 2 * Math.PI;

export function pointToMap(point: Point, crop: Crop): MapPosition {
  // Match Three.js SphereGeometry's seam and the image's top-down pixel coordinates.
  const turns = Math.atan2(point.z, -point.x) / FULL_TURN;
  const wrapped = turns < 0 ? turns + 1 : turns;
  return {
    u: crop.left + wrapped * (crop.right - crop.left),
    v: Math.acos(Math.max(-1, Math.min(1, point.y))) / Math.PI,
  };
}

export function mapToPoint(position: MapPosition, crop: Crop): Point | null {
  if (position.u < crop.left || position.u > crop.right) return null;
  const phi = FULL_TURN * (position.u - crop.left) / (crop.right - crop.left);
  const theta = Math.PI * position.v;
  return {
    x: -Math.cos(phi) * Math.sin(theta),
    y: Math.cos(theta),
    z: Math.sin(phi) * Math.sin(theta),
  };
}
