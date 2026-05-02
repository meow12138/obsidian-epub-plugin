import * as React from "react";
import { useEffect, useRef, useState, useCallback } from 'react';
import { WorkspaceLeaf } from 'obsidian';
import { ReactReader, ReactReaderStyle, type IReactReaderStyle } from 'react-reader';
import type { Contents, Rendition } from 'epubjs';
import useLocalStorageState from 'use-local-storage-state';
import { useHighlights, HIGHLIGHT_STYLES, Highlight } from './useHighlights';

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
  }, [fontSize, updateFontSize]);

  useEffect(() => {
    const handleResize = () => {
      const epubContainer = leaf.view.containerEl.querySelector('div.epub-container');
      if (!epubContainer) return;

      const viewContentStyle = getComputedStyle(epubContainer.parentElement!);
      renditionRef.current?.resize(
        parseFloat(viewContentStyle.width),
        parseFloat(viewContentStyle.height)
      );
    };

    leaf.view.app.workspace.on('resize', handleResize);
    return () => leaf.view.app.workspace.off('resize', handleResize);
  }, [leaf]);

  const applyHighlight = useCallback((rendition: Rendition, h: Highlight) => {
    try {
      rendition.annotations.add(
        'highlight',
        h.cfiRange,
        { id: h.id },
        () => {
          setPendingSelection(null);
          setPendingDelete({ id: h.id, cfiRange: h.cfiRange, text: h.text });
        },
        'epub-highlight',
        HIGHLIGHT_STYLES as any,
      );
    } catch (err) {
      console.warn('[epub-highlight] failed to add annotation', err);
    }
  }, []);

  const handleHighlightClick = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition || !pendingSelection) return;
    const h = addHighlight(pendingSelection.cfiRange, pendingSelection.text);
    applyHighlight(rendition, h);

    const contentsList: Contents[] = (rendition as any).getContents?.() ?? [];
    contentsList.forEach((c) => c.window.getSelection()?.removeAllRanges());
    setPendingSelection(null);
  }, [pendingSelection, addHighlight, applyHighlight]);

  const handleDeleteClick = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition || !pendingDelete) return;
    try {
      rendition.annotations.remove(pendingDelete.cfiRange, 'highlight');
    } catch (err) {
      console.warn('[epub-highlight] failed to remove annotation', err);
    }
    removeHighlight(pendingDelete.id);
    setPendingDelete(null);
  }, [pendingDelete, removeHighlight]);

  const readerStyles = isDarkMode ? darkReaderTheme : lightReaderTheme;

  const selectionPreview = pendingSelection
    ? `"${pendingSelection.text.length > 30 ? pendingSelection.text.slice(0, 30) + '…' : pendingSelection.text}"`
    : '';
  const deletePreview = pendingDelete
    ? `"${pendingDelete.text.length > 30 ? pendingDelete.text.slice(0, 30) + '…' : pendingDelete.text}"`
    : '';

  const highlightBtnEnabled = !!pendingSelection;
  const deleteBtnVisible = !!pendingDelete;

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
          onChange={e => setFontSize(parseInt(e.target.value))}
        />

        <div style={{ flex: 1 }} />

        <button
          onClick={handleHighlightClick}
          disabled={!highlightBtnEnabled}
          style={{
            padding: '6px 12px',
            borderRadius: 4,
            border: 'none',
            cursor: highlightBtnEnabled ? 'pointer' : 'not-allowed',
            background: highlightBtnEnabled ? '#ffeb3b' : (isDarkMode ? '#444' : '#eee'),
            color: highlightBtnEnabled ? '#000' : (isDarkMode ? '#888' : '#999'),
            fontSize: 13,
            fontWeight: 500,
          }}
          title={highlightBtnEnabled ? `点击高亮：${selectionPreview}` : '请先在正文中选中要高亮的文字'}
        >
          🟡 高亮选中文字
        </button>

        {deleteBtnVisible && (
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
              const body = contentsObj.window.document.body;
              body.oncontextmenu = () => false;
            });

            updateTheme(rendition, isDarkMode ? 'dark' : 'light');
            updateFontSize(fontSize);

            rendition.on('selected', (cfiRange: string, contentsObj: Contents) => {
              const selection = contentsObj.window.getSelection();
              const text = selection?.toString() ?? '';
              if (!text.trim()) return;
              setPendingDelete(null);
              setPendingSelection({ cfiRange, text });
            });

            rendition.on('relocated', () => {
              setPendingSelection(null);
              setPendingDelete(null);
            });

            rendition.once('started', () => {
              highlightsRef.current.forEach((h) => applyHighlight(rendition, h));
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
