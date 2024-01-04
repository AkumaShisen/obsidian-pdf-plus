import { App, Component, HoverParent, HoverPopover, Keymap, LinkCache, Notice, SectionCache, TFile } from "obsidian";

import PDFPlus from "main";
import { getSubpathWithoutHash, isMouseEventExternal, onAnnotationLayerReady, onTextLayerReady } from "utils";
import { BacklinkView, ObsidianViewer } from "typings";


interface BacklinkInfo {
    sourcePath: string;
    linkCache: LinkCache;
    pageNumber?: number;
    backlinkItemEl: HTMLElement | null;
    annotationEls: HTMLElement[] | null;
}

interface SelectionBacklinkInfo extends BacklinkInfo {
    type: 'selection';
    pageNumber: number;
    beginIndex: number;
    beginOffset: number;
    endIndex: number;
    endOffset: number;
    colorName?: string;
}

interface AnnotationBacklinkInfo extends BacklinkInfo {
    type: 'annotation';
    id: string;
    pageNumber: number;
}

export class BacklinkHighlighter extends Component implements HoverParent {
    app: App;
    file: TFile | null;
    hoverPopover: HoverPopover | null;
    eventManager: Component;
    /** Maps a page number to metadata of all backlinks contained in that page. */
    backlinks: Record<number, { selection: SelectionBacklinkInfo[], annotation: AnnotationBacklinkInfo[] }> = {};
    highlightedTexts: { page: number, index: number }[] = [];
    /** Maps an annotation ID to the corresponding rectangular highlight element. */
    highlightedAnnotations: Map<string, HTMLElement> = new Map();

    constructor(public plugin: PDFPlus, public viewer: ObsidianViewer) {
        super();
        this.app = plugin.app;
        this.file = null;
        this.hoverPopover = null;
        this.eventManager = this.addChild(new Component());
        plugin.addChild(this); // clear highlight on plugin unload
    }

    onload() {
        if (!this.viewer.isEmbed) {
            this.highlightBacklinks();
            this.registerEvent(this.app.metadataCache.on('resolved', () => {
                this.highlightBacklinks();
            }));
        }
    }

    onunload() {
        this.clearTextHighlight();
        for (const id of this.highlightedAnnotations.keys()) {
            this.clearAnnotationHighlight(id);
        }
    }

    setBacklinks(file: TFile) {
        this.backlinks = {};
        const backlinkDict = this.app.metadataCache.getBacklinksForFile(file);
        for (const sourcePath of backlinkDict.keys()) {
            for (const link of backlinkDict.get(sourcePath) ?? []) {
                const linktext = link.link;
                const subpath = getSubpathWithoutHash(linktext);
                const params = new URLSearchParams(subpath);

                if (params.has('page') && params.has('selection')) {
                    const page = parseInt(params.get('page')!);
                    const selection = params.get('selection')!.split(',').map((s) => parseInt(s));
                    const color = params.get('color') ?? undefined;

                    if (selection.length === 4) {
                        if (!this.backlinks[page]) this.backlinks[page] = { selection: [], annotation: [] };

                        this.backlinks[page].selection.push({
                            type: 'selection',
                            sourcePath,
                            linkCache: link,
                            pageNumber: page,
                            beginIndex: selection[0],
                            beginOffset: selection[1],
                            endIndex: selection[2],
                            endOffset: selection[3],
                            colorName: color,
                            annotationEls: null,
                            backlinkItemEl: null
                        });
                    }
                } else if (params.has('page') && params.has('annotation')) {
                    const page = parseInt(params.get('page')!);
                    const annotation = params.get('annotation')!;

                    if (!this.backlinks[page]) this.backlinks[page] = { selection: [], annotation: [] };

                    this.backlinks[page].annotation.push({
                        type: 'annotation',
                        sourcePath,
                        linkCache: link,
                        pageNumber: page,
                        id: annotation,
                        backlinkItemEl: null,
                        annotationEls: null
                    });
                }
            }
        }
    }

    highlightBacklinks() {
        try {
            this._highlightBacklinks();
        } catch (e) {
            new Notice(`${this.plugin.manifest.name}: Failed to highlight backlinks. Reopen the file to retry.`)
            console.error(e);
        }
    }

    _highlightBacklinks() {
        if (!this.file) return;
        if (this.viewer.isEmbed) return;
        if (!this.plugin.settings.highlightBacklinks) return;

        this.setBacklinks(this.file);

        this.clearTextHighlight();
        this.eventManager.unload();
        // reload only if parent (=this) is loaded
        this.removeChild(this.eventManager);
        this.addChild(this.eventManager);

        // register a callback that highlights backlinks when the text layer for the page containing the linked text is ready
        onTextLayerReady(this.viewer, this.eventManager, (pageView, pageNumber) => {
            for (const backlink of this.backlinks[pageNumber]?.selection ?? []) {
                const { beginIndex, beginOffset, endIndex, endOffset, colorName } = backlink;

                if (!backlink.colorName && this.plugin.settings.highlightColorSpecifiedOnly) continue;

                this.highlightText(
                    pageNumber, beginIndex, beginOffset, endIndex, endOffset, colorName,
                    // the callback called right after this backlink is highlighted
                    (highlightedEl) => {
                        if (!backlink.annotationEls) backlink.annotationEls = [];
                        backlink.annotationEls.push(highlightedEl);

                        this.hookEventHandlers(backlink, highlightedEl);
                    });
            }
        });

        onAnnotationLayerReady(this.viewer, this.eventManager, (pageView, pageNumber) => {
            for (const backlink of this.backlinks[pageNumber]?.annotation ?? []) {
                const { id } = backlink;

                this.processAnnotation(
                    pageNumber, id,
                    // the callback called right after this backlink is highlighted
                    (rectEl) => {
                        backlink.annotationEls = [rectEl];
                        this.hookEventHandlers(backlink, rectEl);
                    }
                );
            }
        });
    }

    // This is a modified version of PDFViewerChild.prototype.hightlightText from Obsidian's app.js
    highlightText(pageNumber: number, beginIndex: number, beginOffset: number, endIndex: number, endOffset: number, colorName?: string, onHighlight?: (highlightedEl: HTMLElement) => void) {
        if (!(pageNumber < 1 || pageNumber > this.viewer.pagesCount)) {
            const pageView = this.viewer.pdfViewer?.getPageView(pageNumber - 1);
            if (pageView?.textLayer && pageView.div.dataset.loaded) {
                const { textDivs, textContentItems } = pageView.textLayer;
                const divideAndWrapTextStart = (index: number, offset: number, className?: string): void => {
                    textDivs[index].textContent = "";
                    divideAndWrapText(index, 0, offset, className);
                };
                // out of a text div, wrap the selected range with span, and add a class to highlight it if className is given
                const divideAndWrapText = (index: number, from: number, to?: number, className?: string): void => {
                    this.highlightedTexts.push({ page: pageNumber, index });
                    let textDiv = textDivs[index];
                    // if text node, wrap it with span
                    if (textDiv.nodeType === Node.TEXT_NODE) {
                        const span = createSpan();
                        textDiv.before(span);
                        span.append(textDiv);
                        textDivs[index] = span;
                        textDiv = span;
                    }
                    const text = textContentItems[index].str.substring(from, to);
                    const textNode = document.createTextNode(text);
                    if (className) {
                        const highlightWrapperEl = textDiv.createSpan(className + " appended");
                        if (colorName) highlightWrapperEl.dataset.highlightColor = colorName.toLowerCase();
                        highlightWrapperEl.append(textNode);
                        onHighlight?.(highlightWrapperEl);
                    }
                    else textDiv.append(textNode);
                }

                const cls = 'pdf-plus-backlink';

                divideAndWrapTextStart(beginIndex, beginOffset);
                if (beginIndex === endIndex) divideAndWrapText(beginIndex, beginOffset, endOffset, "mod-focused selected " + cls);
                else {
                    divideAndWrapText(beginIndex, beginOffset, undefined, "mod-focused begin selected " + cls);
                    for (let i = beginIndex + 1; i < endIndex; i++) {
                        this.highlightedTexts.push({ page: pageNumber, index: i });
                        textDivs[i].classList.add("mod-focused", "middle", "selected", cls);
                        if (colorName) textDivs[i].dataset.highlightColor = colorName.toLowerCase();
                        onHighlight?.(textDivs[i]);
                    }
                    divideAndWrapTextStart(endIndex, endOffset, "mod-focused endselected " + cls);
                }
                divideAndWrapText(endIndex, endOffset, void 0);
            }
        }
    }

    // This is a modified version of PDFViewerChild.prototype.clearTextHighlight from Obsidian's app.js
    clearTextHighlight() {
        for (const { page, index } of this.highlightedTexts) {
            const pageView = this.viewer.pdfViewer?.getPageView(page - 1);
            // pageView.textLayer can be null when the page is far away from the current viewport
            if (!pageView?.textLayer) return;
            const { textDivs, textContentItems } = pageView.textLayer;
            const textDiv = textDivs[index];
            textDiv.textContent = textContentItems[index].str;
            textDiv.className = textDiv.hasClass("textLayerNode") ? "textLayerNode" : "";

            this.backlinks[page]?.selection.forEach((backlink) => {
                backlink.annotationEls = null;
            });
        }
        this.highlightedTexts = [];
    }

    // This is a modified version of PDFViewerChild.prototype.highlightAnnotation from Obsidian's app.js
    highlightAnnotation(pageNumber: number, id: string): void {
        const pdfjsLib = this.plugin.pdfjsLib;

        if (!(pageNumber < 1 || pageNumber > this.viewer.pagesCount)) {
            const pageView = this.viewer.pdfViewer?.getPageView(pageNumber - 1);
            if (pageView?.annotationLayer && pageView.div.dataset.loaded) {
                const elem = pageView.annotationLayer.annotationLayer.getAnnotation(id);
                if (elem) {
                    pageView.annotationLayer.div.createDiv("boundingRect mod-focused", (rectEl) => {
                        const rect = elem.data.rect;
                        const view = elem.parent.page.view;
                        const dims = elem.parent.viewport.rawDims as { pageWidth: number, pageHeight: number, pageX: number, pageY: number };
                        const pageWidth = dims.pageWidth;
                        const pageHeight = dims.pageHeight;
                        const pageX = dims.pageX;
                        const pageY = dims.pageY;
                        const normalizedRect = pdfjsLib.Util.normalizeRect([rect[0], view[3] - rect[1] + view[1], rect[2], view[3] - rect[3] + view[1]]);
                        rectEl.setCssStyles({
                            left: (100 * (normalizedRect[0] - pageX) / pageWidth) + "%",
                            top: (100 * (normalizedRect[1] - pageY) / pageHeight) + "%",
                            width: (100 * (normalizedRect[2] - normalizedRect[0]) / pageWidth) + "%",
                            height: (100 * (normalizedRect[3] - normalizedRect[1]) / pageHeight) + "%"
                        });
                        this.highlightedAnnotations.set(id, rectEl);
                    })
                }
            }
        }
    }

    // This is inspired by PDFViewerChild.prototype.clearAnnotationHighlight from Obsidian's app.js
    clearAnnotationHighlight(id: string) {
        if (this.highlightedAnnotations.has(id)) {
            const el = this.highlightedAnnotations.get(id)!;
            el.detach();
            this.highlightedAnnotations.delete(id);
        }
    }

    hookEventHandlers(backlink: SelectionBacklinkInfo | AnnotationBacklinkInfo, annotationEl: HTMLElement) {
        const { sourcePath, linkCache } = backlink;

        // When hovering over an item in the backlink pane, highlight the corresponding text selection in the PDF view
        if (this.plugin.settings.highlightOnHoverBacklinkPane) {
            this.updateBacklinkItemEl(backlink);
            if (backlink.backlinkItemEl) {
                this.registerHoverOverBacklinkItem(backlink.type, backlink.pageNumber, backlink.backlinkItemEl, [annotationEl]);
            }
        }

        this.eventManager.registerDomEvent(annotationEl, 'mouseover', (event) => {
            // highlight the corresponding item in backlink pane
            if (this.plugin.settings.highlightBacklinksPane) {
                this.updateBacklinkItemEl(backlink);
                if (backlink.backlinkItemEl) backlink.backlinkItemEl.addClass('hovered-backlink');
            }
        });

        // clear highlights in backlink pane
        this.eventManager.registerDomEvent(annotationEl, 'mouseout', (event) => {
            backlink.backlinkItemEl?.removeClass('hovered-backlink');
        });

        this.eventManager.registerDomEvent(annotationEl, 'mouseover', (event) => {
            this.app.workspace.trigger('hover-link', {
                event,
                source: 'pdf-plus',
                hoverParent: this,
                targetEl: annotationEl,
                linktext: sourcePath,
                sourcePath: this.file?.path ?? '',
                state: { scroll: linkCache.position.start.line }
            });
        });

        this.eventManager.registerDomEvent(annotationEl, 'dblclick', (event) => {
            if (this.plugin.settings.doubleClickHighlightToOpenBacklink) {
                const paneType = Keymap.isModEvent(event) || 'tab'; // keep the PDF view open
                this.app.workspace.openLinkText(sourcePath, "", paneType, {
                    eState: {
                        line: linkCache.position.start.line
                    }
                });
            }
        });
    }

    processAnnotation(pageNumber: number, id: string, callback?: (annotationEl: HTMLElement) => void) {
        if (!(pageNumber < 1 || pageNumber > this.viewer.pagesCount)) {
            const pageView = this.viewer.pdfViewer?.getPageView(pageNumber - 1);
            if (pageView?.annotationLayer && pageView.div.dataset.loaded) {
                const annotationEl = pageView.annotationLayer.div.querySelector<HTMLElement>(`[data-annotation-id="${id}"]`);
                if (annotationEl) callback?.(annotationEl);
            }
        }
    }

    findBacklinkItemEl(backlink: BacklinkInfo): HTMLElement | null {
        const { linkCache, sourcePath } = backlink;

        const backlinkLeaf = this.app.workspace.getLeavesOfType('backlink')[0];
        if (!backlinkLeaf) return null;

        const backlinkView = backlinkLeaf.view as BacklinkView;
        if (!backlinkView.containerEl.isShown()) return null;

        const backlinkDom = backlinkView.backlink.backlinkDom;
        const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
        if (!(sourceFile instanceof TFile)) return null;

        const fileDom = backlinkDom.getResult(sourceFile);
        if (!fileDom) return null;

        // reliable check than app.plugins.enabledPlugins.has('better-search-views')
        // because Better Search Views does not properly load or unload without reloading the app
        const isBetterSearchViewsEnabled = fileDom.childrenEl.querySelector('.better-search-views-tree');

        if (!isBetterSearchViewsEnabled) {
            const itemDoms = fileDom?.vChildren.children;
            if (!itemDoms) return null;

            const itemDom = itemDoms.find((itemDom) => {
                return itemDom.start <= linkCache.position.start.offset && linkCache.position.end.offset <= itemDom.end;
            });

            return itemDom?.el ?? null;
        } else {
            // Better Search Views destroys fileDom.vChildren!! So we have to take a detour.
            const cache = this.app.metadataCache.getFileCache(sourceFile);
            if (!cache?.sections) return null;

            const sectionsContainingBacklinks = new Set<SectionCache>();
            for (const [start, end] of fileDom.result.content) {
                const sec = cache.sections.find(sec => sec.position.start.offset <= start && end <= sec.position.end.offset);
                if (sec) {
                    sectionsContainingBacklinks.add(sec);
                    if (start === linkCache.position.start.offset && linkCache.position.end.offset === end) {
                        break;
                    }
                }
            }

            const index = sectionsContainingBacklinks.size - 1;
            if (index === -1) return null;

            return fileDom?.childrenEl.querySelectorAll<HTMLElement>('.search-result-file-match')[index] ?? null;
        }
    }

    registerHoverOverBacklinkItem(type: 'selection' | 'annotation', pageNumber: number, backlinkItemEl: HTMLElement, highlightedEls: HTMLElement[]) {
        if (type === 'selection') this.registerHoverOverSelectionBacklinkItem(backlinkItemEl, highlightedEls);
        else if (type === 'annotation') this.registerHoverOverAnnotationBacklinkItem(pageNumber, backlinkItemEl, highlightedEls);
    }

    registerHoverOverSelectionBacklinkItem(backlinkItemEl: HTMLElement, highlightedEls: HTMLElement[]) {
        this.eventManager.registerDomEvent(backlinkItemEl, 'mouseover', (evt) => {
            if (isMouseEventExternal(evt, backlinkItemEl)) {
                for (const el of highlightedEls) el.addClass('hovered-highlight');
            }
        });

        this.eventManager.registerDomEvent(backlinkItemEl, 'mouseout', (evt) => {
            if (isMouseEventExternal(evt, backlinkItemEl)) {
                for (const el of highlightedEls) el.removeClass('hovered-highlight');
            }
        });
    }

    registerHoverOverAnnotationBacklinkItem(pageNumber: number, backlinkItemEl: HTMLElement, annotationEls: HTMLElement[]) {
        const elements = new Set(annotationEls);

        this.eventManager.registerDomEvent(backlinkItemEl, 'mouseover', (evt) => {
            if (isMouseEventExternal(evt, backlinkItemEl)) {
                for (const el of elements) {
                    const id = el.dataset.annotationId;
                    if (id) this.highlightAnnotation(pageNumber, id);
                }
            }
        });

        this.eventManager.registerDomEvent(backlinkItemEl, 'mouseout', (evt) => {
            if (isMouseEventExternal(evt, backlinkItemEl)) {
                for (const el of elements) {
                    const id = el.dataset.annotationId;
                    if (id) this.clearAnnotationHighlight(id);
                }
            }
        });
    }

    /** `backlink.backlinkItemEl` must be updated after `BacklinkPanePDFPageTracker` re-draws the backlink DOM */
    updateBacklinkItemEl(backlink: BacklinkInfo) {
        const backlinkItemEl = this.findBacklinkItemEl(backlink)
        if (backlinkItemEl) backlink.backlinkItemEl = backlinkItemEl;
    }
}
