import React, { useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { Plugin, PluginSettingTab, App, Setting, TFile, normalizePath, WorkspaceLeaf, ItemView, Notice } from 'obsidian';

interface UrlDropperSettings {
    template: string;
    frontmatterKey: string;
    noteLocation: 'default' | 'vault' | 'custom';
    customNoteLocation: string;
    openNewNote: boolean;
}

const DEFAULT_SETTINGS: UrlDropperSettings = {
    template: '---\n{{frontmatterKey}}: {{url}}\n---\n\n# {{title}}\n\n',
    frontmatterKey: 'url',
    noteLocation: 'default',
    customNoteLocation: '',
    openNewNote: false,
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
    const [isDragging, setIsDragging] = useState(false);
    const [processingCount, setProcessingCount] = useState(0);

    // Utility functions
    const sanitizeFileName = (fileName: string): string => {
        return fileName
            .replace(/\s*-\s*/g, '—') // Replace " - " or "-" with em dash
            .replace(/[^\w\s—]/g, '') // Remove special characters but keep em dash
            .trim()
            .replace(/\s+/g, '-') // Replace spaces with single dash
            .toLowerCase();
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
                    return fileName;
                }
        }
    };

    const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isDragging) setIsDragging(true);
    }, [isDragging]);

    const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
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
    }, []);

    const processDroppedUrl = useCallback(async (url: string) => {
        setProcessingCount(count => count + 1);
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
            const newFile = await plugin.app.vault.create(filePath, content);
            
            if (plugin.settings.openNewNote && newFile) {
                const leaf = plugin.app.workspace.getLeaf(true);
                await leaf.openFile(newFile);
            }
            
            new Notice(`Note created: ${filePath}`);
        } catch (error) {
            // Check if it's a "File already exists" error
            if (error instanceof Error && error.message.includes('already exists')) {
                new Notice(
                    `URL: ${url}\nError: Note with this title already exists`, 
                    10000  // Show for 10 seconds
                );
            } else {
                // For other errors, still show a notice but with different messaging
                new Notice(`Error processing URL. Please try again.`);
                console.error('Error processing URL:', error);
            }
        } finally {
            setProcessingCount(count => count - 1);
        }
    }, [plugin]);

    const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const urls = e.dataTransfer.getData('text/plain').split('\n').filter(url => url.trim());
        urls.forEach(processDroppedUrl);
    }, [processDroppedUrl]);

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
            {processingCount > 0 && (
                <div className="processing-status">
                    Processing {processingCount} note{processingCount > 1 ? 's' : ''}...
                </div>
            )}
        </div>
    );
};

async function fetchPageTitle(url: string): Promise<string> {
    try {
        const response = await fetch(url, { method: 'GET' });
        const html = await response.text();
        const match = html.match(/<title>(.*?)<\/title>/i);
        return match && match[1] ? match[1] : '';
    } catch (error) {
        console.error('Error fetching page title:', error);
        return '';
    }
}

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

        new Setting(containerEl)
            .setName('Open New Note')
            .setDesc('Automatically open newly created notes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.openNewNote)
                .onChange(async (value) => {
                    this.plugin.settings.openNewNote = value;
                    await this.plugin.saveSettings();
                }));
    }
}