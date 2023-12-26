import { Component, DropdownComponent, HexString, MarkdownRenderer, Notice, PaneType, PluginSettingTab, Setting } from 'obsidian';

import PDFPlus from 'main';
import { getModifierNameInPlatform } from 'utils';


const HOVER_HIGHLIGHT_ACTIONS = {
	'open': 'Open backlink',
	'preview': 'Popover preview of backlink',
} as const;

type ExtendedPaneType = PaneType | '';

const PANE_TYPE: Record<ExtendedPaneType, string> = {
	'': 'Current tab',
	'tab': 'New tab',
	'split': 'Split right',
	'window': 'New window',
};

export const COLOR_PALETTE_ACTIONS = {
	copyQuote: 'Copy as quote',
	copyLink: 'Copy link to selection',
	copyEmbed: 'Copy embed of selection',
};

export interface PDFPlusSettings {
	alias: boolean; // the term "alias" is probably incorrect here. It should be "display text" instead.
	aliasFormat: string;
	trimSelectionEmbed: boolean;
	noSidebarInEmbed: boolean;
	embedUnscrollable: boolean;
	zoomInEmbed: number;
	openLinkCleverly: boolean;
	dontActivateAfterOpenPDF: boolean;
	dontActivateAfterOpenMD: boolean;
	highlightDuration: number;
	persistentHighlightsInEmbed: boolean;
	highlightBacklinks: boolean;
	clickEmbedToOpenLink: boolean;
	highlightBacklinksPane: boolean;
	colors: Record<string, HexString>;
	defaultColor: string;
	colorPaletteInToolbar: boolean;
	colorPaletteInEmbedToolbar: boolean;
	highlightColorSpecifiedOnly: boolean;
	doubleClickHighlightToOpenBacklink: boolean;
	hoverHighlightAction: keyof typeof HOVER_HIGHLIGHT_ACTIONS;
	paneTypeForFirstMDLeaf: ExtendedPaneType;
	defaultColorPaletteAction: keyof typeof COLOR_PALETTE_ACTIONS;
	hoverPDFLinkToOpen: boolean;
	ignoreHeightParamInPopoverPreview: boolean;
	filterBacklinksByPageDefault: boolean;
}

export const DEFAULT_SETTINGS: PDFPlusSettings = {
	alias: true,
	aliasFormat: '',
	trimSelectionEmbed: true,
	noSidebarInEmbed: true,
	embedUnscrollable: false,
	zoomInEmbed: 0,
	openLinkCleverly: true,
	dontActivateAfterOpenPDF: true,
	dontActivateAfterOpenMD: true,
	highlightDuration: 0,
	persistentHighlightsInEmbed: true,
	highlightBacklinks: true,
	clickEmbedToOpenLink: true,
	highlightBacklinksPane: true,
	colors: {
		'Yellow': '#ffd000',
		'Red': '#EA5252',
		'Blue': '#7b89f4'
	},
	defaultColor: '',
	colorPaletteInToolbar: true,
	colorPaletteInEmbedToolbar: false,
	highlightColorSpecifiedOnly: false,
	doubleClickHighlightToOpenBacklink: true,
	hoverHighlightAction: 'open',
	paneTypeForFirstMDLeaf: 'split',
	defaultColorPaletteAction: 'copyQuote',
	hoverPDFLinkToOpen: false,
	ignoreHeightParamInPopoverPreview: true,
	filterBacklinksByPageDefault: true,
};

// Inspired by https://stackoverflow.com/a/50851710/13613783
export type KeysOfType<Obj, Type> = NonNullable<{ [k in keyof Obj]: Obj[k] extends Type ? k : never }[keyof Obj]>;

export class PDFPlusSettingTab extends PluginSettingTab {
	component: Component;
	
	constructor(public plugin: PDFPlus) {
		super(plugin.app, plugin);
		this.component = new Component();
	}

	addSetting() {
		return new Setting(this.containerEl);
	}

	addHeading(heading: string) {
		return this.addSetting().setName(heading).setHeading();
	}

	addTextSetting(settingName: KeysOfType<PDFPlusSettings, string>, placeholder?: string) {
		return this.addSetting()
			.addText((text) => {
				text.setValue(this.plugin.settings[settingName])
					.setPlaceholder(placeholder ?? DEFAULT_SETTINGS[settingName])
					.then((text) => text.inputEl.size = text.inputEl.placeholder.length)
					.onChange(async (value) => {
						// @ts-ignore
						this.plugin.settings[settingName] = value;
						await this.plugin.saveSettings();
					});
			});
	}

	addNumberSetting(settingName: KeysOfType<PDFPlusSettings, number>) {
		return this.addSetting()
			.addText((text) => {
				text.setValue('' + this.plugin.settings[settingName])
					.setPlaceholder('' + DEFAULT_SETTINGS[settingName])
					.then((text) => text.inputEl.type = "number")
					.onChange(async (value) => {
						// @ts-ignore
						this.plugin.settings[settingName] = value === '' ? DEFAULT_SETTINGS[settingName] : +value;
						await this.plugin.saveSettings();
					});
			});
	}

	addToggleSetting(settingName: KeysOfType<PDFPlusSettings, boolean>, extraOnChange?: (value: boolean) => void) {
		return this.addSetting()
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings[settingName])
					.onChange(async (value) => {
						// @ts-ignore
						this.plugin.settings[settingName] = value;
						await this.plugin.saveSettings();
						extraOnChange?.(value);
					});
			});
	}

	addDropdowenSetting(settingName: KeysOfType<PDFPlusSettings, string>, options: readonly string[], display?: (option: string) => string, extraOnChange?: (value: string) => void): Setting;
	addDropdowenSetting(settingName: KeysOfType<PDFPlusSettings, string>, options: Record<string, string>, extraOnChange?: (value: string) => void): Setting;
	addDropdowenSetting(settingName: KeysOfType<PDFPlusSettings, string>, ...args: any[]) {
		let options: string[] = [];
		let display = (optionValue: string) => optionValue;
		let extraOnChange = (value: string) => { };
		if (Array.isArray(args[0])) {
			options = args[0];
			if (typeof args[1] === 'function') display = args[1];
			if (typeof args[2] === 'function') extraOnChange = args[2];
		} else {
			options = Object.keys(args[0]);
			display = (optionValue: string) => args[0][optionValue];
			if (typeof args[1] === 'function') extraOnChange = args[1];
		}
		return this.addSetting()
			.addDropdown((dropdown) => {
				const displayNames = new Set<string>();
				for (const option of options) {
					const displayName = display(option) ?? option;
					if (!displayNames.has(displayName)) {
						dropdown.addOption(option, displayName);
						displayNames.add(displayName);
					}
				};
				dropdown.setValue(this.plugin.settings[settingName])
					.onChange(async (value) => {
						// @ts-ignore
						this.plugin.settings[settingName] = value;
						await this.plugin.saveSettings();
						extraOnChange?.(value);
					});
			});
	}

	addSliderSetting(settingName: KeysOfType<PDFPlusSettings, number>, min: number, max: number, step: number) {
		return this.addSetting()
			.addSlider((slider) => {
				slider.setLimits(min, max, step)
					.setValue(this.plugin.settings[settingName])
					.setDynamicTooltip()
					.onChange(async (value) => {
						// @ts-ignore
						this.plugin.settings[settingName] = value;
						await this.plugin.saveSettings();
					});
			});
	}

	addDesc(desc: string) {
		return this.addSetting()
			.setDesc(desc);
	}

	addColorSetting(name: string, color: HexString) {
		const colors = this.plugin.settings.colors;
		const isDefault = this.plugin.settings.defaultColor === name;
		let previousColor = color;
		return this.addSetting()
			.addText((text) => {
				text.setPlaceholder('Color name (case-insensitive)')
					.setValue(name)
					.onChange(async (newName) => {
						if (newName in colors) {
							new Notice('This color name is already used.');
							text.inputEl.addClass('error');
							return;
						}
						text.inputEl.removeClass('error');
						delete colors[name];
						const optionEl = this.containerEl.querySelector<HTMLOptionElement>(`#pdf-plus-default-color-dropdown > option[value="${name}"]`);
						if (optionEl) {
							optionEl.value = newName;
							optionEl.textContent = newName;
						}
						name = newName;
						colors[name] = color;
						if (isDefault) this.plugin.settings.defaultColor = name;
						await this.plugin.saveSettings();
						this.plugin.loadStyle();
					});
			})
			.addColorPicker((picker) => {
				picker.setValue(color);
				picker.onChange(async (newColor) => {
					previousColor = color;
					color = newColor;
					colors[name] = color;
					await this.plugin.saveSettings();
					this.plugin.loadStyle();
				});
			})
			.addExtraButton((button) => {
				button.setIcon('rotate-ccw')
					.setTooltip('Return to previous color')
					.onClick(async () => {
						color = previousColor;
						colors[name] = color;
						await this.plugin.saveSettings();
						this.plugin.loadStyle();
						this.redisplay();
					});
			})
			.addExtraButton((button) => {
				button.setIcon('trash')
					.setTooltip('Delete')
					.onClick(async () => {
						delete colors[name];
						await this.plugin.saveSettings();
						this.plugin.loadStyle();
						this.redisplay();
					});
			});
	}

	/** Refresh the setting tab and then scroll back to the original position. */
	redisplay() {
		const firstSettingEl = this.containerEl.querySelector('.setting-item:first-child');
		if (firstSettingEl) {
			const { top, left } = firstSettingEl.getBoundingClientRect();
			this.display();
			this.containerEl.querySelector('.setting-item:first-child')?.scroll({ top, left });
		} else {
			this.display();
		}
	}

	display(): void {
		this.containerEl.empty();
		this.component.load();

		this.addDesc('Note: some of the settings below requires reopening tabs to take effect.')

		this.addHeading('Backlinks to PDF files')
			.setDesc('Transform a link to a PDF file into a highlighted annotation.');
		this.addToggleSetting('highlightBacklinks')
			.setName('Highlight backlinks')
			.setDesc('In the PDF viewer, any referenced text will be highlighted for easy identification.');
		this.addDropdowenSetting('hoverHighlightAction', HOVER_HIGHLIGHT_ACTIONS, () => this.redisplay())
			.setName('Action when hovering over highlighted text')
			.setDesc(`Easily open backlinks or display a popover preview of it by pressing ${getModifierNameInPlatform('Mod').toLowerCase()} (by default) while hovering over a highlighted text in PDF viewer.`);
		if (this.plugin.settings.hoverHighlightAction === 'open') {
			this.addDropdowenSetting('paneTypeForFirstMDLeaf', PANE_TYPE)
				.setName(`How to open markdown file with ${getModifierNameInPlatform('Mod').toLowerCase()}+hover when there is no open markdown file`);
			this.addToggleSetting('dontActivateAfterOpenMD')
				.setName('Don\'t move focus to markdown view after opening a backlink')
				.setDesc('This option will be ignored when you open a link in a tab in the same split as the current tab.')
		}
		this.addSetting()
			.setName(`Require ${getModifierNameInPlatform('Mod')} to the above action`)
			.setDesc('You can toggle this on and off in the core Page Preview plugin settings > PDF++ hover action.')
			.addButton((button) => {
				button.setButtonText('Open')
					.onClick(() => {
						this.app.setting.openTabById('page-preview')
					});
			});
		this.addToggleSetting('doubleClickHighlightToOpenBacklink')
			.setName('Double click a piece of highlighted text to open the corresponding backlink');
		this.addToggleSetting('highlightBacklinksPane')
			.setName('Highlight hovered backlinks in the backlinks pane')
			.setDesc('Hovering over highlighted backlinked text will also highlight the corresponding item in the backlink pane. This feature is compatible with the Better Search Views plugin.');
		this.addToggleSetting('filterBacklinksByPageDefault')
			.setName('Filter backlinks by page by default')
			.setDesc('You can toggle this on and off with the "Show only backlinks in the current page" button at the top right of the backlinks pane.')

		this.addSetting()
			.setName('Highlight colors')
			.setDesc('Append "&color={{COLOR NAME}}" to a link text to highlight the selection with a specified color, where {{COLOR NAME}} is one of the colors that you register below. e.g "[[file.pdf#page=1&selection=4,0,5,20&color=red]]"')
			.addExtraButton((button) => {
				button
					.setIcon('plus')
					.setTooltip('Add a new color')
					.onClick(() => {
						this.plugin.settings.colors[''] = '#';
						this.redisplay();
					});
			})
		for (const [name, color] of Object.entries(this.plugin.settings.colors)) {
			this.addColorSetting(name, color)
				.setClass('no-border');
		}

		this.addToggleSetting('highlightColorSpecifiedOnly', () => this.redisplay())
			.setName('Only highlight a backlink when a color is specified')
			.setDesc('By default, all backlinks are highlighted. If this option is enabled, a backlink will be highlighted only when a color is specified in the link text.');

		if (!this.plugin.settings.highlightColorSpecifiedOnly) {
			this.addDropdowenSetting(
				'defaultColor',
				['', ...Object.keys(this.plugin.settings.colors)],
				(option) => option || 'Obsidian default',
				() => this.plugin.loadStyle()
			)
				.setName('Default highlight color')
				.setDesc('If no color is specified in link text, this color will be used.')
				.then((setting) => {
					const dropdown = setting.components[0] as DropdownComponent;
					dropdown.selectEl.id = 'pdf-plus-default-color-dropdown';
				})
		}
		this.addToggleSetting('colorPaletteInToolbar', () => {
			this.redisplay();
			this.plugin.loadStyle();
		})
			.setName('Show color palette in the toolbar')
			.setDesc('A color palette will be added to the toolbar of the PDF viewer. Clicking a color while selecting a range of text will copy a link to the selection with "&color=..." appended.');
		if (this.plugin.settings.colorPaletteInToolbar) {
			this.addToggleSetting('colorPaletteInEmbedToolbar', () => this.plugin.loadStyle())
				.setName('Show color palette for PDF embeds as well');
			this.addDropdowenSetting('defaultColorPaletteAction', COLOR_PALETTE_ACTIONS)
				.setName('Default action when clicking on a color palette item')
				.setDesc('You can change it for each viewer with the dropdown menu in the color palette.')
		}

		this.addHeading('Opening links to PDF files');
		this.addToggleSetting('openLinkCleverly', () => this.redisplay())
			.setName('Open PDF links cleverly')
			.setDesc(createFragment((el) => {
				el.appendText(`When opening a link to a PDF file without pressing any `);
				el.createEl('a', { text: `modifier keys`, attr: { href: 'https://help.obsidian.md/User+interface/Use+tabs+in+Obsidian#Open+a+link' } })
				el.appendText(`, a new tab will not be opened if the file is already opened. Useful for annotating PDFs using "Copy link to selection."`);
			}));
		if (this.plugin.settings.openLinkCleverly) {
			this.addToggleSetting('dontActivateAfterOpenPDF')
				.setName('Don\'t move focus to PDF viewer after opening a PDF link')
				.setDesc('This option will be ignored when you open a PDF link in a tab in the same split as the PDF viewer.')
		}
		this.addToggleSetting('hoverPDFLinkToOpen')
			.setName('Open PDF link instead of showing popover preview when target PDF is already opened')
			.setDesc(`Press ${getModifierNameInPlatform('Mod').toLowerCase()} while hovering a PDF link to actually open it if the target PDF is already opened in another tab.`)

		this.addSetting()
			.setName('Clear highlights after a certain amount of time')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.highlightDuration > 0)
					.onChange(async (value) => {
						this.plugin.settings.highlightDuration = value
							? (this.plugin.settings.highlightDuration > 0
								? this.plugin.settings.highlightDuration
								: 1)
							: 0;
						await this.plugin.saveSettings();
						this.redisplay();
					});
			});
		if (this.plugin.settings.highlightDuration > 0) {
			this.addSliderSetting('highlightDuration', 0.1, 10, 0.1)
				.setName('Highlight duration (sec)');
		}
		this.addToggleSetting('ignoreHeightParamInPopoverPreview')
			.setName('Ignore "height" parameter in popover preview')
			.setDesc('Obsidian lets you specify the height of a PDF embed by appending "&height=..." to a link, and this also applies to popover previews. Enable this option if you want to ignore the height parameter in popover previews.')

		this.addHeading('Copying links to PDF files')
		this.addToggleSetting('alias', () => this.redisplay())
			.setName('Copy link with display text')
			.setDesc('When copying a link to a selection or an annotation in a PDF file, Obsidian appends "|<pdf file title>, page <page number>" to the link text by default. Disable this option if you don\'t like it.');
		if (this.plugin.settings.alias) {
			this.addTextSetting('aliasFormat', 'Leave blank to use default')
				.setName('Display text format')
				.then((setting) => {
					MarkdownRenderer.render(
						this.app,
						'The template format that will be applied to the display text when copying a link to a selection or an annotation in PDF viewer. '
						+ 'Each `{{...}}` will be evaluated as a JavaScript expression given the variables listed below.\n\n'
						+ 'For example, the default format is `{{file.basename}}, page {{page}}`.\n\n'
						+ 'Available variables are:\n\n'
						+ '- `file` or `pdf`: The PDF file ([`TFile`](https://docs.obsidian.md/Reference/TypeScript+API/TFile)). Use `file.basename` for the file name without extension, `file.name` for the file name with extension, `file.path` for the full path relative to the vault root, etc.\n'
						+ '- `page`: The page number (`Number`).\n'
						+ '- `pageCount`: The total number of pages (`Number`).\n'
						+ '- `selection`: The selected text (`String`).\n'
						+ '- `folder`: The folder containing the PDF file ([`TFolder`](https://docs.obsidian.md/Reference/TypeScript+API/TFolder)). This is an alias for `file.parent`.\n'
						+ '- `app`: The global Obsidian app object ([`App`](https://docs.obsidian.md/Reference/TypeScript+API/App)).\n'
						+ '- and other global variables such as:\n'
						+ '  - [`moment`](https://momentjs.com/docs/#/displaying/): For exampe, use `moment().format("YYYY-MM-DD")` to get the current date in the "YYYY-MM-DD" format.\n'
						+ '  - `DataviewAPI`: Available if the [Dataview](https://blacksmithgu.github.io/obsidian-dataview/) plugin is enabled.\n'
						+ '\n\n'
						+ 'Additionally, the following variables are available when the PDF tab is linked to another tab:\n\n'
						+ '- `linkedFile`: The file opened in the linked tab ([`TFile`](https://docs.obsidian.md/Reference/TypeScript+API/TFile)).\n'
						+ '- `properties`: The properties of `linkedFile` as an `Object` mapping each property name to the corresponding value. If `linkedFile` has no properties, this is an empty object `{}`.\n',
						setting.descEl, '', this.component
					);
				});
		}

		this.addHeading('Embedding PDF files');
		this.addToggleSetting('clickEmbedToOpenLink')
			.setName('Click PDF embeds to open links')
			.setDesc('Clicking a PDF embed will open the embedded file.');
		this.addToggleSetting('trimSelectionEmbed')
			.setName('Trim selection/annotation embeds')
			.setDesc('When embedding a selection or an annotation from a PDF file, only the target selection/annotation and its surroundings are displayed rather than the entire page.');
		this.addToggleSetting('noSidebarInEmbed')
			.setName('Never show sidebar in PDF embeds');
		this.addToggleSetting('persistentHighlightsInEmbed')
			.setName('Do not clear highlights in a selection/annotation embeds');
		this.addToggleSetting('embedUnscrollable')
			.setName('Make PDF embeds with a page specified unscrollable');
		this.addSliderSetting('zoomInEmbed', 0, 5, 1)
			.setName('Zoom level for PDF embeds (experimental)');

		this.addHeading('Style settings')
			.setDesc('You can find more options in Style Settings > PDF++.')
			.addButton((button) => {
				button.setButtonText('Open')
					.onClick(() => {
						const styleSettingsTab = this.app.setting.pluginTabs.find((tab) => tab.id === 'obsidian-style-settings');
						if (styleSettingsTab) {
							this.app.setting.openTab(styleSettingsTab);
						} else {
							open('obsidian://show-plugin?id=obsidian-style-settings');
						}
					});
			});
	}

	hide() {
		this.component.unload();
		this.containerEl.empty();
	}
}
