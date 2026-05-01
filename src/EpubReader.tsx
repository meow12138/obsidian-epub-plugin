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
  const [pendingSelection, setPendingSelection] = useState<null | {
    cfiRange: string;
    text: string;
    x: number;
    y: number;
  }>(null);
  const [deleteTarget, setDeleteTarget] = useState<null | {
    id: string;
    x: number;
    y: number;
  }>(null);

  const isDarkMode = document.body.classList.contains('theme-dark');

  useEffect(() => {
    highlightsRef.current = highlights;
  }, [highlights]);

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

  const handleHighlightClick = useCallback((highlightId: string, clientX: number, clientY: number, frameEl: HTMLIFrameElement | null) => {
    const frameRect = frameEl?.getBoundingClientRect();
    setPendingSelection(null);
    setDeleteTarget({
      id: highlightId,
      x: (frameRect?.left ?? 0) + clientX,
      y: (frameRect?.top ?? 0) + clientY,
    });
  }, []);

  const applyHighlight = useCallback((rendition: Rendition, h: Highlight) => {
    try {
      rendition.annotations.add(
        'highlight',
        h.cfiRange,
        { id: h.id },
        (e: MouseEvent) => {
          const frame = (rendition as any).manager?.views?._views?.[0]?.iframe as HTMLIFrameElement | undefined;
          handleHighlightClick(h.id, e.clientX, e.clientY, frame ?? null);
        },
        'epub-highlight',
        HIGHLIGHT_STYLES as any,
      );
    } catch (err) {
      console.warn('[epub-highlight] failed to add annotation', err);
    }
  }, [handleHighlightClick]);

  const confirmHighlight = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition || !pendingSelection) return;
    const h = addHighlight(pendingSelection.cfiRange, pendingSelection.text);
    applyHighlight(rendition, h);
    setPendingSelection(null);
  }, [pendingSelection, addHighlight, applyHighlight]);

  const confirmDelete = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition || !deleteTarget) return;
    const target = highlightsRef.current.find((h) => h.id === deleteTarget.id);
    if (target) {
      try {
        rendition.annotations.remove(target.cfiRange, 'highlight');
      } catch (err) {
        console.warn('[epub-highlight] failed to remove annotation', err);
      }
      removeHighlight(target.id);
    }
    setDeleteTarget(null);
  }, [deleteTarget, removeHighlight]);

  const readerStyles = isDarkMode ? darkReaderTheme : lightReaderTheme;

  return (
    <div style={{ height: "100vh", position: 'relative' }}
         onClick={() => { setPendingSelection(null); setDeleteTarget(null); }}>
      <div style={{ padding: '10px' }}>
        <label htmlFor="fontSizeSlider">Adjust Font Size: </label>
        <input
          id="fontSizeSlider"
          type="range"
          min="80"
          max="160"
          value={fontSize}
          onChange={e => setFontSize(parseInt(e.target.value))}
        />
      </div>
      <ReactReader
        title={title}
        showToc={true}
        location={location}
        locationChanged={locationChanged}
        swipeable={false}
        url={contents}
        getRendition={(rendition: Rendition) => {
          renditionRef.current = rendition;
          rendition.hooks.content.register((contents: Contents) => {
            const body = contents.window.document.body;
            body.oncontextmenu = () => false;
          });
          updateTheme(rendition, isDarkMode ? 'dark' : 'light');
          updateFontSize(fontSize);

          rendition.on('selected', (cfiRange: string, contents: Contents) => {
            const selection = contents.window.getSelection();
            const text = selection?.toString() ?? '';
            if (!text.trim()) return;
            const range = selection?.getRangeAt(0);
            const rect = range?.getBoundingClientRect();
            const frame = contents.window.frameElement as HTMLIFrameElement | null;
            const frameRect = frame?.getBoundingClientRect();
            const x = (frameRect?.left ?? 0) + (rect?.left ?? 0) + (rect?.width ?? 0) / 2;
            const y = (frameRect?.top ?? 0) + (rect?.top ?? 0) - 8;
            setDeleteTarget(null);
            setPendingSelection({ cfiRange, text, x, y });
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

      {pendingSelection && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: pendingSelection.x,
            top: pendingSelection.y,
            transform: 'translate(-50%, -100%)',
            background: '#333',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            zIndex: 9999,
            fontSize: 13,
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <span onClick={confirmHighlight}>🟡 高亮</span>
        </div>
      )}

      {deleteTarget && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: deleteTarget.x,
            top: deleteTarget.y,
            transform: 'translate(-50%, -100%)',
            background: '#333',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            zIndex: 9999,
            fontSize: 13,
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <span onClick={confirmDelete}>🗑 删除高亮</span>
        </div>
      )}
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
