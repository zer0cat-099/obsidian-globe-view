import { App, FuzzySuggestModal, PluginSettingTab, Setting, TFile } from 'obsidian';
import { cropIsValid } from './model.ts';
import type GlobePlugin from './main.ts';

const IMAGE_EXTENSION = /^(png|jpe?g|webp|avif|gif|svg|bmp)$/i;

export function isMapImage(file: TFile): boolean {
  return IMAGE_EXTENSION.test(file.extension);
}

export class FilePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, placeholder: string, private readonly files: TFile[],
    private readonly choose: (file: TFile) => void) {
    super(app);
    this.setPlaceholder(placeholder);
    this.emptyStateText = '검색에 맞는 파일이 없습니다.';
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.choose(file);
  }
}

export class GlobeSettings extends PluginSettingTab {
  constructor(app: App, private readonly globe: GlobePlugin) {
    super(app, globe);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName('지도 이미지')
      .setDesc(this.globe.settings.imagePath || '볼트에 있는 가로형 세계지도 이미지를 선택하세요.')
      .addButton(button => button.setButtonText('파일 선택').onClick(() => {
        this.globe.chooseImage(() => this.display());
      }));

    if (!this.globe.settings.imagePath) return;
    const { left, right } = this.globe.settings.crop;
    const setting = new Setting(this.containerEl)
      .setName('가로 표시 범위 (%)')
      .setDesc('구에서 맞닿을 왼쪽과 오른쪽 경계를 지정하세요. 전체 이미지는 0과 100입니다.');
    let leftValue = String(Number((left * 100).toFixed(4)));
    let rightValue = String(Number((right * 100).toFixed(4)));
    setting.addText(input => {
      input.setValue(leftValue).onChange(value => { leftValue = value; });
      input.inputEl.setAttribute('aria-label', '왼쪽 경계 (%)');
      input.inputEl.classList.add('globe-view-crop-input');
    });
    setting.addText(input => {
      input.setValue(rightValue).onChange(value => { rightValue = value; });
      input.inputEl.setAttribute('aria-label', '오른쪽 경계 (%)');
      input.inputEl.classList.add('globe-view-crop-input');
    });
    setting.addButton(button => button.setButtonText('적용').onClick(() => {
      const nextLeft = leftValue.trim() === '' ? NaN : Number(leftValue) / 100;
      const nextRight = rightValue.trim() === '' ? NaN : Number(rightValue) / 100;
      if (!cropIsValid(nextLeft, nextRight)) {
        setting.setDesc('0~100% 안에서 오른쪽 경계를 왼쪽보다 1%p 이상 크게 입력하세요.');
        return;
      }
      void this.globe.updateSettings(settings => ({
        ...settings, crop: { left: nextLeft, right: nextRight },
      })).then(() => this.display());
    }));
  }
}
