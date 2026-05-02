import * as React from "react";
import { useEffect, useRef, useState, useCallback } from 'react';
import { WorkspaceLeaf } from 'obsidian';
import { ReactReader, ReactReaderStyle, type IReactReaderStyle } from 'react-reader';
import type { Contents, Rendition } from 'epubjs';
import useLocalStorageState from 'use-local-storage-state';
import { useHighlights, Highlight } from './useHighlights';

const HIGHLIGHT_CLASS = 'epub-custom-hl';
const HIGHLIGHT_BG = 'rgba(255, 235, 59, 0.38)';

function drawHighlightsInContents(contentsObj: Contents, highlights: Highlight[]) {
  const doc = contentsObj.document;
  if (!doc || !doc.body) return;

  doc.querySelectorAll('.' + HIGHLIGHT_CLASS).forEach((el) => el.remove());

  const bodyRect = doc.body.getBoundingClientRect();

  for (const h of highlights) {
    let range: Range | null = null;
    try {
      range = (contentsObj as any).range(h.cfiRange);
    } catch {
      continue;
    }
    if (!range) continue;

    let rects: DOMRectList | DOMRect[] | null = null;
    try {
      rects = range.getClientRects();
    } catch {
      continue;
    }
    if (!rects || rects.length === 0) continue;

    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r || r.width < 1 || r.height < 1) continue;

      const div = doc.createElement('div');
      div.className = HIGHLIGHT_CLASS;
      div.dataset.highlightId = h.id;
      Object.assign(div.style, {
        position: 'absolute',
        left: `${r.left - bodyRect.left}px`,
        top: `${r.top - bodyRect.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        background: HIGHLIGHT_BG,
        pointerEvents: 'none',
        zIndex: '1',
        borderRadius: '2px',
      } as CSSStyleDeclaration);
      doc.body.appendChild(div);
    }
  }
}

export const EpubReader = ({ contents, title, bookId, scrolled, tocOffset, tocBottomOffset, leaf }: {
  contents: ArrayBuffer;
  title: string;
  bookId: string;
  scrolled: boolean;
  tocOffset: number;
  tocBottomOffset: number;
  leaf: WorkspaceLeaf;
}) => {
  const [location, setLocation] = useLocalStorageState<string | number>(`epub-${bookId}`, { defaultValue: 0 });
  const renditionRef = useRef<Rendition | null>(null);
  const [fontSize, setFontSize] = useState(100);
  const { highlights, addHighlight, removeHighlight } = useHighlights(bookId);
  const highlightsRef = useRef<Highlight[]>(highlights);
  const [pendingSelection, setPendingSelection] = useState<{ cfiRange: string; text: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; cfiRange: string; text: string } | null>(null);

  const isDarkMode = document.body.classList.contains('theme-dark');

  useEffect(() => { highlightsRef.current = highlights; }, [highlights]);

  const redrawAll = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const contentsList: Contents[] = (rendition as any).getContents?.() ?? [];
    contentsList.forEach((c) => drawHighlightsInContents(c, highlightsRef.current));
  }, []);

  useEffect(() => {
    redrawAll();
  }, [highlights, redrawAll]);

  const locationChanged = useCallback((epubcifi: string | number) => {
    setLocation(epubcifi);
  }, [setLocation]);

  const updateTheme = useCallback((rendition: Rendition, theme: 'light' | 'dark') => {
    const themes = rendition.themes;
    themes.override('color', theme === 'dark' ? '#fff' : '#000');
    themes.override('background', theme === 'dark' ? '#000' : '#fff');
  }, []);

  const updateFontSize = useCallback((size: number) => {
    renditionRef.current?.themes.fontSize(`${size}%`);
  }, []);

  useEffect(() => {
    updateFontSize(fontSize);
    const timers = [
      window.setTimeout(redrawAll, 80),
      window.setTimeout(redrawAll, 250),
      window.setTimeout(redrawAll, 600),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [fontSize, updateFontSize, redrawAll]);

  useEffect(() => {
    const handleResize = () => {
      const epubContainer = leaf.view.containerEl.querySelector('div.epub-container');
      if (!epubContainer) return;

      const viewContentStyle = getComputedStyle(epubContainer.parentElement!);
      renditionRef.current?.resize(
        parseFloat(viewContentStyle.width),
        parseFloat(viewContentStyle.height)
      );
      window.setTimeout(redrawAll, 100);
    };

    leaf.view.app.workspace.on('resize', handleResize);
    return () => leaf.view.app.workspace.off('resize', handleResize);
  }, [leaf, redrawAll]);

  const handleHighlightClick = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition || !pendingSelection) return;
    addHighlight(pendingSelection.cfiRange, pendingSelection.text);

    const contentsList: Contents[] = (rendition as any).getContents?.() ?? [];
    contentsList.forEach((c) => c.window.getSelection()?.removeAllRanges());
    setPendingSelection(null);
  }, [pendingSelection, addHighlight]);

  const handleDeleteClick = useCallback(() => {
    if (!pendingDelete) return;
    removeHighlight(pendingDelete.id);
    setPendingDelete(null);
  }, [pendingDelete, removeHighlight]);

  const readerStyles = isDarkMode ? darkReaderTheme : lightReaderTheme;

  const truncate = (s: string) => s.length > 30 ? s.slice(0, 30) + '…' : s;
  const selectionPreview = pendingSelection ? `"${truncate(pendingSelection.text)}"` : '';
  const deletePreview = pendingDelete ? `"${truncate(pendingDelete.text)}"` : '';

  return (
    <div style={{ height: "100vh" }}>
      <div style={{
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        flexWrap: 'wrap',
        borderBottom: isDarkMode ? '1px solid #333' : '1px solid #ddd',
      }}>
        <label htmlFor="fontSizeSlider" style={{ fontSize: 13 }}>字号：</label>
        <input
          id="fontSizeSlider"
          type="range"
          min="80"
          max="160"
          value={fontSize}
          onChange={(e) => setFontSize(parseInt(e.target.value))}
        />

        <div style={{ flex: 1 }} />

        <button
          onClick={handleHighlightClick}
          disabled={!pendingSelection}
          style={{
            padding: '6px 12px',
            borderRadius: 4,
            border: 'none',
            cursor: pendingSelection ? 'pointer' : 'not-allowed',
            background: pendingSelection ? '#ffeb3b' : (isDarkMode ? '#444' : '#eee'),
            color: pendingSelection ? '#000' : (isDarkMode ? '#888' : '#999'),
            fontSize: 13,
            fontWeight: 500,
          }}
          title={pendingSelection ? `点击高亮：${selectionPreview}` : '请先在正文中选中要高亮的文字'}
        >
          🟡 高亮选中文字
        </button>

        {pendingDelete && (
          <button
            onClick={handleDeleteClick}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: 'none',
              cursor: 'pointer',
              background: '#e74c3c',
              color: '#fff',
              fontSize: 13,
              fontWeight: 500,
            }}
            title={`删除高亮：${deletePreview}`}
          >
            🗑 删除此高亮
          </button>
        )}

        <span style={{ fontSize: 12, color: isDarkMode ? '#888' : '#666', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pendingDelete ? `已选中高亮 ${deletePreview}` : pendingSelection ? `已选中文字 ${selectionPreview}` : '选中文字即可高亮'}
        </span>
      </div>

      <div style={{ height: 'calc(100% - 50px)', position: 'relative' }}>
        <ReactReader
          title={title}
          showToc={true}
          location={location}
          locationChanged={locationChanged}
          swipeable={false}
          url={contents}
          getRendition={(rendition: Rendition) => {
            renditionRef.current = rendition;

            rendition.hooks.content.register((contentsObj: Contents) => {
              const doc = contentsObj.document;
              doc.body.oncontextmenu = () => false;

              let downX = 0;
              let downY = 0;
              let downAt = 0;
              doc.addEventListener('mousedown', (e) => {
                downX = e.clientX;
                downY = e.clientY;
                downAt = Date.now();
              });
              doc.addEventListener('mouseup', (e) => {
                const moved = Math.abs(e.clientX - downX) > 3 || Math.abs(e.clientY - downY) > 3;
                const tooLong = Date.now() - downAt > 500;
                if (moved || tooLong) return;

                const rects = doc.querySelectorAll('.' + HIGHLIGHT_CLASS);
                for (let i = 0; i < rects.length; i++) {
                  const el = rects[i] as HTMLElement;
                  const r = el.getBoundingClientRect();
                  if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                    const id = el.dataset.highlightId;
                    if (!id) continue;
                    const h = highlightsRef.current.find((x) => x.id === id);
                    if (!h) continue;
                    setPendingSelection(null);
                    setPendingDelete({ id: h.id, cfiRange: h.cfiRange, text: h.text });
                    return;
                  }
                }
              });
            });

            updateTheme(rendition, isDarkMode ? 'dark' : 'light');
            updateFontSize(fontSize);

            rendition.on('selected', (cfiRange: string, contentsObj: Contents) => {
              const text = contentsObj.window.getSelection()?.toString() ?? '';
              if (!text.trim()) return;
              setPendingDelete(null);
              setPendingSelection({ cfiRange, text });
            });

            rendition.on('relocated', () => {
              setPendingSelection(null);
              setPendingDelete(null);
              window.setTimeout(redrawAll, 30);
            });

            rendition.on('rendered', () => {
              window.setTimeout(redrawAll, 30);
            });

            rendition.on('resized', () => {
              window.setTimeout(redrawAll, 80);
            });

            rendition.once('started', () => {
              window.setTimeout(redrawAll, 100);
            });
          }}
          epubOptions={scrolled ? {
            allowPopups: true,
            flow: "scrolled",
            manager: "continuous",
          } : undefined}
          readerStyles={readerStyles}
        />
      </div>
    </div>
  );
};

const lightReaderTheme: IReactReaderStyle = {
  ...ReactReaderStyle,
  readerArea: {
    ...ReactReaderStyle.readerArea,
    transition: undefined,
  },
};

const darkReaderTheme: IReactReaderStyle = {
  ...ReactReaderStyle,
  arrow: {
    ...ReactReaderStyle.arrow,
    color: 'white',
  },
  arrowHover: {
    ...ReactReaderStyle.arrowHover,
    color: '#ccc',
  },
  readerArea: {
    ...ReactReaderStyle.readerArea,
    backgroundColor: '#000',
    transition: undefined,
  },
  titleArea: {
    ...ReactReaderStyle.titleArea,
    color: '#ccc',
  },
  tocArea: {
    ...ReactReaderStyle.tocArea,
    background: '#111',
  },
  tocButtonExpanded: {
    ...ReactReaderStyle.tocButtonExpanded,
    background: '#222',
  },
  tocButtonBar: {
    ...ReactReaderStyle.tocButtonBar,
    background: '#fff',
  },
  tocButton: {
    ...ReactReaderStyle.tocButton,
    color: 'white',
  },
};
