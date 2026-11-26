import { Notice, Plugin } from 'obsidian';
import { readSettings, renameVaultPaths, selectMap } from './model.ts';
import type { Settings } from './model.ts';
import { FilePicker, GlobeSettings, isMapImage } from './settings.ts';
import { GlobeView, VIEW_TYPE } from './view.ts';

export default class GlobePlugin extends Plugin {
  settings: Settings = readSettings(null);
  private writes: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    this.settings = readSettings(await this.loadData());
    this.registerView(VIEW_TYPE, leaf => new GlobeView(leaf, this));
    this.addRibbonIcon('globe', 'Globe View 열기', () => { void this.openGlobe(); });
    this.addCommand({
      id: 'open',
      name: 'Globe View 열기',
      callback: () => { void this.openGlobe(); },
    });
    this.addSettingTab(new GlobeSettings(this.app, this));

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      const newPath = file.path;
      void this.updateSettings(settings => renameVaultPaths(settings, oldPath, newPath));
    }));
    this.registerEvent(this.app.vault.on('modify', file => {
      if (file.path === this.settings.imagePath) this.refreshViews(true);
    }));
    this.registerEvent(this.app.vault.on('delete', file => {
      if (file.path === this.settings.imagePath) this.refreshViews();
    }));
    this.registerEvent(this.app.vault.on('create', file => {
      if (file.path === this.settings.imagePath) this.refreshViews();
    }));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  chooseImage(onChange?: () => void): void {
    const images = this.app.vault.getFiles().filter(isMapImage);
    new FilePicker(this.app, '지도 이미지 검색', images, file => {
      void this.updateSettings(settings => selectMap(settings, file.path)).then(onChange);
    }).open();
  }

  updateSettings(update: (current: Settings) => Settings): Promise<void> {
    this.writes = this.writes.then(async () => {
      const next = update(this.settings);
      if (next === this.settings) return;
      await this.saveData(next);
      this.settings = next;
      this.refreshViews();
    }).catch((error: unknown) => {
      console.error('Globe View could not save its settings', error);
      new Notice('Globe View 설정 또는 마커를 저장할 수 없습니다.');
    });
    return this.writes;
  }

  private async openGlobe(): Promise<void> {
    const { workspace } = this.app;
    try {
      let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
      if (!leaf) {
        leaf = workspace.getLeaf('tab');
        await leaf.setViewState({ type: VIEW_TYPE, active: true });
      }
      await workspace.revealLeaf(leaf);
    } catch (error) {
      console.error('Globe View could not open', error);
      new Notice('Globe View를 열 수 없습니다.');
    }
  }

  private refreshViews(force = false): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof GlobeView) leaf.view.refresh(force);
    }
  }
}
