import {
  CanvasTexture, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, RepeatWrapping,
  Scene, SphereGeometry, Spherical, SRGBColorSpace, Texture, TextureLoader, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cropColumns, mapToPoint, pointToMap, surfaceVisible } from './model.ts';
import type { Crop, MapPosition, Marker, Point } from './model.ts';

const START_CAMERA = new Vector3(1.75, 0.45, 3.2);
const CLICK_TOLERANCE = 6;

interface Pin {
  point: Point;
  button: HTMLButtonElement;
}

interface SurfaceActions {
  place(position: MapPosition): void;
  label(marker: Marker): string;
  open(marker: Marker): void;
}

export class GlobeSurface {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(42, 1, 0.05, 50);
  private readonly scene = new Scene();
  private readonly surface = new Mesh(
    new SphereGeometry(1, 128, 64),
    new MeshBasicMaterial({ color: 0xffffff }),
  );
  private readonly controls: OrbitControls;
  private readonly pinsEl: HTMLDivElement;
  private readonly observer: ResizeObserver;
  private readonly listeners = new AbortController();
  private readonly raycaster = new Raycaster();
  private readonly screenPoint = new Vector3();
  private pins: Pin[] = [];
  private crop: Crop = { left: 0, right: 1 };
  private texture: Texture | null = null;
  private placing = false;
  private disposed = false;
  private pointer: { id: number; x: number; y: number; moved: boolean } | null = null;

  constructor(private readonly stage: HTMLElement, private readonly actions: SurfaceActions) {
    this.canvas = stage.ownerDocument.createElement('canvas');
    this.canvas.className = 'globe-view-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', '3D 행성 지도. 방향키로 회전합니다.');
    try {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    } catch {
      this.surface.geometry.dispose();
      this.surface.material.dispose();
      throw new Error('이 환경에서는 WebGL 2를 사용할 수 없습니다.');
    }
    this.stage.append(this.canvas);
    this.pinsEl = stage.ownerDocument.createElement('div');
    this.pinsEl.className = 'globe-view-pins';
    this.stage.append(this.pinsEl);

    this.camera.position.copy(START_CAMERA);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enablePan = false;
    this.controls.minDistance = 1.12;
    this.controls.maxDistance = 9;
    this.controls.rotateSpeed = 0.65;
    this.controls.update();
    this.controls.saveState();
    this.scene.add(this.surface);
    this.controls.addEventListener('change', this.render);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(this.stage);

    const { signal } = this.listeners;
    this.canvas.addEventListener('pointerdown', this.pointerDown, { signal });
    this.canvas.addEventListener('pointermove', this.pointerMove, { signal });
    this.canvas.addEventListener('pointerup', this.pointerUp, { signal });
    this.canvas.addEventListener('pointercancel', () => { this.pointer = null; }, { signal });
    this.canvas.addEventListener('keydown', this.keyDown, { signal });
    this.canvas.addEventListener('webglcontextrestored', this.render, { signal });
    this.pinsEl.addEventListener('wheel', event => {
      event.preventDefault();
      this.canvas.dispatchEvent(new WheelEvent('wheel', event));
    }, { signal, passive: false });
    this.resize();
  }

  async loadMap(url: string, crop: Crop): Promise<void> {
    const source = await new TextureLoader().loadAsync(url);
    if (this.disposed) {
      source.dispose();
      return;
    }

    const image = source.image as HTMLImageElement;
    const imageWidth = image.naturalWidth;
    const imageHeight = image.naturalHeight;
    const columns = cropColumns(imageWidth, crop);
    this.crop = { left: columns.x / imageWidth, right: (columns.x + columns.width) / imageWidth };
    const limit = this.renderer.capabilities.maxTextureSize;
    const scale = Math.min(1, limit / Math.max(columns.width, imageHeight));

    let texture = source;
    if (columns.width !== imageWidth || scale < 1) {
      const cropped = this.stage.ownerDocument.createElement('canvas');
      cropped.width = Math.max(1, Math.round(columns.width * scale));
      cropped.height = Math.max(1, Math.round(imageHeight * scale));
      const context = cropped.getContext('2d');
      if (!context) {
        source.dispose();
        throw new Error('지도 이미지의 표시 범위를 보정할 수 없습니다.');
      }
      context.drawImage(image, columns.x, 0, columns.width, imageHeight, 0, 0, cropped.width, cropped.height);
      texture = new CanvasTexture(cropped);
      source.dispose();
    }
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    this.texture?.dispose();
    this.texture = texture;
    this.surface.material.map = texture;
    this.surface.material.needsUpdate = true;
    this.render();
  }

  setMarkers(markers: readonly Marker[]): void {
    this.pinsEl.replaceChildren();
    this.pins = [];
    for (const marker of markers) {
      const point = mapToPoint(marker.position, this.crop);
      if (!point) continue;
      const label = this.actions.label(marker);
      const button = this.stage.ownerDocument.createElement('button');
      button.className = 'globe-view-pin';
      button.type = 'button';
      button.title = label;
      button.setAttribute('aria-label', label);
      const caption = this.stage.ownerDocument.createElement('span');
      caption.textContent = label;
      button.append(caption);
      button.addEventListener('click', () => this.actions.open(marker));
      this.pinsEl.append(button);
      this.pins.push({ point, button });
    }
    this.render();
  }

  setPlacing(placing: boolean): void {
    this.placing = placing;
    this.stage.classList.toggle('is-placing', placing);
  }

  reset(): void {
    this.controls.reset();
  }

  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    this.listeners.abort();
    this.controls.dispose();
    this.texture?.dispose();
    this.surface.geometry.dispose();
    this.surface.material.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.pinsEl.remove();
  }

  private resize = (): void => {
    if (this.disposed) return;
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.fov = this.camera.aspect < 1
      ? Math.min(115, 2 * Math.atan(Math.tan(21 * Math.PI / 180) / this.camera.aspect) * 180 / Math.PI)
      : 42;
    this.camera.updateProjectionMatrix();
    const ratio = this.stage.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    this.renderer.setPixelRatio(Math.min(2, ratio));
    this.renderer.setSize(width, height, false);
    this.render();
  };

  private render = (): void => {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
    for (const { button, point } of this.pins) {
      if (!surfaceVisible(point, this.camera.position)) {
        button.hidden = true;
        continue;
      }
      const projected = this.screenPoint.set(point.x, point.y, point.z).project(this.camera);
      button.hidden = Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1;
      button.style.left = ((projected.x + 1) * 50) + '%';
      button.style.top = ((1 - projected.y) * 50) + '%';
    }
  };

  private pointerDown = (event: PointerEvent): void => {
    if (!this.placing || event.button !== 0 || !event.isPrimary) return;
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };

  private pointerMove = (event: PointerEvent): void => {
    const pointer = this.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > CLICK_TOLERANCE) {
      pointer.moved = true;
    }
  };

  private pointerUp = (event: PointerEvent): void => {
    const pointer = this.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    this.pointerMove(event);
    this.pointer = null;
    if (!this.placing || pointer.moved) return;
    const bounds = this.canvas.getBoundingClientRect();
    const coordinates = new Vector2(
      (event.clientX - bounds.left) * 2 / bounds.width - 1,
      1 - (event.clientY - bounds.top) * 2 / bounds.height,
    );
    this.raycaster.setFromCamera(coordinates, this.camera);
    const hit = this.raycaster.intersectObject(this.surface)[0];
    if (hit) this.actions.place(pointToMap(hit.point.normalize(), this.crop));
  };

  private keyDown = (event: KeyboardEvent): void => {
    const step = 0.1;
    const orbit = new Spherical().setFromVector3(this.camera.position);
    switch (event.key) {
      case 'ArrowLeft': orbit.theta -= step; break;
      case 'ArrowRight': orbit.theta += step; break;
      case 'ArrowUp': orbit.phi -= step; break;
      case 'ArrowDown': orbit.phi += step; break;
      default: return;
    }
    event.preventDefault();
    this.camera.position.setFromSpherical(orbit.makeSafe());
    this.controls.update();
  };
}
