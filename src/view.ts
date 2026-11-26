import { ItemView, Notice, setIcon } from 'obsidian';
import type { TFile, WorkspaceLeaf } from 'obsidian';
import type GlobePlugin from './main.ts';
import type { MapPosition, Marker } from './model.ts';
import { FilePicker } from './settings.ts';
import { GlobeSurface } from './surface.ts';

export const VIEW_TYPE = 'globe-view';

export class GlobeView extends ItemView {
  private stage!: HTMLDivElement;
  private status!: HTMLDivElement;
  private hint!: HTMLDivElement;
  private addButton!: HTMLButtonElement;
  private resetButton!: HTMLButtonElement;
  private surface: GlobeSurface | null = null;
  private mapKey: string | null = null;
  private ready = false;
  private placing = false;

  constructor(leaf: WorkspaceLeaf, private readonly globe: GlobePlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return 'Globe View'; }
  getIcon(): string { return 'globe'; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: 'globe-view-root' });
    const bar = root.createDiv({ cls: 'globe-view-toolbar' });
    this.addButton = bar.createEl('button', { cls: 'globe-view-add', attr: { type: 'button' } });
    setIcon(this.addButton.createSpan(), 'map-pin-plus');
    this.addButton.createSpan({ text: '마커 추가' });
    this.addButton.addEventListener('click', () => this.setPlacing(!this.placing));
    this.resetButton = bar.createEl('button', {
      cls: 'clickable-icon globe-view-reset', attr: {
        type: 'button', title: '시점 초기화', 'aria-label': '시점 초기화',
      },
    });
    setIcon(this.resetButton, 'rotate-ccw');
    this.resetButton.addEventListener('click', () => this.surface?.reset());
    this.stage = root.createDiv({ cls: 'globe-view-stage' });
    this.status = this.stage.createDiv({ cls: 'globe-view-status', attr: { role: 'status' } });
    this.hint = root.createDiv({ cls: 'globe-view-hint', attr: { 'aria-live': 'polite' } });
    root.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !this.placing) return;
      event.stopPropagation();
      this.setPlacing(false);
    });
    this.refresh();
  }

  async onClose(): Promise<void> {
    this.surface?.dispose();
    this.surface = null;
    this.mapKey = null;
    this.ready = false;
    this.placing = false;
    this.contentEl.empty();
  }

  refresh(force = false): void {
    if (!this.stage || !this.contentEl.contains(this.stage)) return;
    const { imagePath, crop } = this.globe.settings;
    const file = this.app.vault.getFileByPath(imagePath);
    const key = JSON.stringify([imagePath, crop.left, crop.right, !!file]);
    if (!force && key === this.mapKey) {
      if (this.ready) this.refreshMarkers();
      return;
    }

    this.mapKey = key;
    this.ready = false;
    this.setPlacing(false);
    this.surface?.dispose();
    this.surface = null;
    this.addButton.disabled = true;
    this.resetButton.disabled = true;
    if (!file) {
      this.showStatus(imagePath ? '설정한 지도 이미지가 볼트에 없습니다.' : '연결된 지도가 없습니다.');
      const choose = this.status.createEl('button', { text: '지도 선택', attr: { type: 'button' } });
      choose.addEventListener('click', () => this.globe.chooseImage());
      return;
    }

    this.showStatus('지도를 불러오는 중…');
    try {
      this.surface = new GlobeSurface(this.stage, {
        place: position => this.placeMarker(position),
        label: marker => this.markerLabel(marker),
        open: marker => this.openMarker(marker),
      });
    } catch (error) {
      this.showStatus(error instanceof Error ? error.message : '3D 지도를 열 수 없습니다.');
      return;
    }
    void this.loadMap(this.surface, file);
  }

  private async loadMap(surface: GlobeSurface, file: TFile): Promise<void> {
    try {
      await surface.loadMap(this.app.vault.getResourcePath(file), this.globe.settings.crop);
      if (this.surface !== surface) return;
      this.ready = true;
      this.addButton.disabled = false;
      this.resetButton.disabled = false;
      this.status.hidden = true;
      this.refreshMarkers();
    } catch {
      if (this.surface !== surface) return;
      surface.dispose();
      this.surface = null;
      this.showStatus('지도 이미지를 읽을 수 없습니다. 이미지 파일을 확인해 주세요.');
    }
  }

  private showStatus(text: string): void {
    this.status.empty();
    this.status.createDiv({ text });
    this.status.hidden = false;
  }

  private setPlacing(value: boolean): void {
    this.placing = value;
    this.surface?.setPlacing(value);
    this.addButton.setAttribute('aria-pressed', String(value));
    this.addButton.lastElementChild?.setText(value ? '마커 추가 취소' : '마커 추가');
    this.hint.setText(value ? '지도에서 마커를 찍을 위치를 클릭하세요.' : '드래그해 회전 · 휠로 확대');
  }

  private placeMarker(position: MapPosition): void {
    const image = this.app.vault.getFileByPath(this.globe.settings.imagePath);
    this.setPlacing(false);
    if (!image) return;
    new FilePicker(this.app, '연결할 지역 노트 검색', this.app.vault.getMarkdownFiles(), file => {
      void this.globe.updateSettings(settings => {
        if (this.app.vault.getFileByPath(image.path) !== image
          || this.app.vault.getFileByPath(file.path) !== file) {
          new Notice('지도나 연결할 노트가 볼트에 없습니다.');
          return settings;
        }
        const marker: Marker = { id: crypto.randomUUID(), mapPath: image.path, notePath: file.path, position };
        return { ...settings, markers: [...settings.markers, marker] };
      });
    }).open();
  }

  private refreshMarkers(): void {
    const { imagePath, markers } = this.globe.settings;
    this.surface?.setMarkers(markers.filter(marker => marker.mapPath === imagePath));
  }

  private markerLabel(marker: Marker): string {
    return this.app.vault.getFileByPath(marker.notePath)?.basename
      ?? marker.notePath.split('/').pop()?.replace(/\.md$/i, '')
      ?? marker.notePath;
  }

  private openMarker(marker: Marker): void {
    const file = this.app.vault.getFileByPath(marker.notePath);
    if (!file) {
      new Notice('연결된 노트를 찾을 수 없습니다.');
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    void leaf.openFile(file).then(() => this.app.workspace.revealLeaf(leaf)).catch(() => {
      new Notice('연결된 노트를 열 수 없습니다.');
    });
  }
}
