import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { Plugin, PluginSettingTab, App, Setting, TFile, normalizePath, WorkspaceLeaf, ItemView, Notice } from 'obsidian';

interface UrlDropperSettings {
    template: string;
    frontmatterKey: string;
    noteLocation: 'default' | 'vault' | 'custom';
    customNoteLocation: string;
}

const DEFAULT_SETTINGS: UrlDropperSettings = {
    template: '---\n{{frontmatterKey}}: {{url}}\n---\n\n# {{title}}\n\n',
    frontmatterKey: 'url',
    noteLocation: 'default',
    customNoteLocation: ''
}

export default class UrlDropperPlugin extends Plugin {
    settings: UrlDropperSettings;
    app: App;

    async onload() {
        this.app = this.app; 
        await this.loadSettings();

        this.addSettingTab(new UrlDropperSettingTab(this.app, this));

        this.addRibbonIcon('link', 'URL Dropper', () => {
            this.activateView();
        });

        this.registerView(
            'url-dropper-view',
            (leaf) => new UrlDropperView(leaf, this)
        );
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateView() {
        this.app.workspace.detachLeavesOfType('url-dropper-view');

        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({
                type: 'url-dropper-view',
                active: true,
            });
            this.app.workspace.revealLeaf(leaf);
        }
    }
}

class UrlDropperView extends ItemView {
    plugin: UrlDropperPlugin;
    root: ReactDOM.Root | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: UrlDropperPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return 'url-dropper-view';
    }

    getDisplayText() {
        return 'URL Dropper';
    }

    async onOpen() {
        const { contentEl } = this;
        this.root = ReactDOM.createRoot(contentEl);
        this.root.render(
            <React.StrictMode>
                <UrlDropperComponent plugin={this.plugin} />
            </React.StrictMode>
        );
    }

    async onClose() {
        if (this.root) {
            this.root.unmount();
        }
    }
}

interface UrlDropperComponentProps {
    plugin: UrlDropperPlugin;
}

const UrlDropperComponent: React.FC<UrlDropperComponentProps> = ({ plugin }) => {
    const [isDragging, setIsDragging] = React.useState(false);

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isDragging) setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        if (
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom
        ) {
            return;
        }
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const url = e.dataTransfer.getData('text/plain');
        if (url) {
            await processDroppedUrl(url);
        }
    };
    
    const processDroppedUrl = async (url: string) => {
        try {
            const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
            const data = await response.json();
            const html = data.contents;
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            let title = doc.querySelector('title')?.textContent || '';
    
            if (!title) {
                const urlObj = new URL(url);
                title = urlObj.pathname.split('/').pop() || urlObj.hostname;
            }
    
            const fileName = sanitizeFileName(title) + '.md';
            const content = plugin.settings.template
                .replace('{{frontmatterKey}}', plugin.settings.frontmatterKey)
                .replace('{{url}}', url)
                .replace('{{title}}', title);
    
            const filePath = getNotePath(fileName);
            await plugin.app.vault.create(filePath, content);
            new Notice(`Note created: ${filePath}`);
        } catch (error) {
            console.error('Error processing URL:', error);
            new Notice('Error processing URL. Check console for details.');
        }
    };

    const sanitizeFileName = (fileName: string): string => {
        return fileName.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
    };

    const getNotePath = (fileName: string): string => {
        switch (plugin.settings.noteLocation) {
            case 'vault':
                return fileName;
            case 'custom':
                return normalizePath(`${plugin.settings.customNoteLocation}/${fileName}`);
            default:
                const newFileParent = plugin.app.fileManager.getNewFileParent("");
                if (newFileParent) {
                    return normalizePath(`${newFileParent.path}/${fileName}`);
                } else {
                    return fileName; // This will create the file in the vault root
                }
        }
    };

    return (
        <div 
            className={`url-dropper-dropzone ${isDragging ? 'dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div className="dropzone-content">
                <h4>{isDragging ? 'Ready for your URL' : 'Drop URL Here'}</h4>
            </div>
        </div>
    );
};

class UrlDropperSettingTab extends PluginSettingTab {
    plugin: UrlDropperPlugin;

    constructor(app: App, plugin: UrlDropperPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'URL Dropper Settings' });

        new Setting(containerEl)
            .setName('Note Template')
            .setDesc('Template for new notes. Use {{frontmatterKey}}, {{url}}, and {{title}} as placeholders.')
            .addTextArea(text => text
                .setPlaceholder('Enter template here')
                .setValue(this.plugin.settings.template)
                .onChange(async (value) => {
                    this.plugin.settings.template = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Frontmatter Key')
            .setDesc('Key to use in frontmatter for the URL')
            .addText(text => text
                .setPlaceholder('url')
                .setValue(this.plugin.settings.frontmatterKey)
                .onChange(async (value) => {
                    this.plugin.settings.frontmatterKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Note Location')
            .setDesc('Choose where new notes should be placed')
            .addDropdown(dropdown => dropdown
                .addOption('default', 'Use Obsidian default')
                .addOption('vault', 'Vault root')
                .addOption('custom', 'Custom location')
                .setValue(this.plugin.settings.noteLocation)
                .onChange(async (value: 'default' | 'vault' | 'custom') => {
                    this.plugin.settings.noteLocation = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh to show/hide custom location field
                }));

        if (this.plugin.settings.noteLocation === 'custom') {
            new Setting(containerEl)
                .setName('Custom Note Location')
                .setDesc('Enter the path where new notes should be placed')
                .addText(text => text
                    .setPlaceholder('folder/subfolder')
                    .setValue(this.plugin.settings.customNoteLocation)
                    .onChange(async (value) => {
                        this.plugin.settings.customNoteLocation = value;
                        await this.plugin.saveSettings();
                    }));
        }
    }
}