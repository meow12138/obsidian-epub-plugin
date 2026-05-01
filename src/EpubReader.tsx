import * as React from "react";
import { useEffect, useRef, useState, useCallback } from 'react';
import { WorkspaceLeaf } from 'obsidian';
import { ReactReader, ReactReaderStyle, type IReactReaderStyle } from 'react-reader';
import type { Contents, Rendition } from 'epubjs';
import useLocalStorageState from 'use-local-storage-state';
import { useHighlights, HIGHLIGHT_STYLES, Highlight } from './useHighlights';

const TOOLBAR_CLASS = 'epub-highlight-toolbar';

function removeIframeToolbar(doc: Document) {
  doc.querySelectorAll('.' + TOOLBAR_CLASS).forEach((el) => el.remove());
}

function createToolbarEl(
  doc: Document,
  label: string,
  x: number,
  y: number,
  onClick: () => void
): HTMLElement {
  const el = doc.createElement('div');
  el.className = TOOLBAR_CLASS;
  el.textContent = label;
  Object.assign(el.style, {
    position: 'absolute',
    left: `${x}px`,
    top: `${y}px`,
    transform: 'translate(-50%, -100%)',
    marginTop: '-8px',
    background: '#333',
    color: '#fff',
    padding: '6px 12px',
    borderRadius: '4px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
    zIndex: '99999',
    fontSize: '13px',
    cursor: 'pointer',
    userSelect: 'none',
    fontFamily: 'sans-serif',
    whiteSpace: 'nowrap',
  } as CSSStyleDeclaration);
  el.addEventListener('mousedown', (e) => e.preventDefault());
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return el;
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
  const addHighlightRef = useRef(addHighlight);
  const removeHighlightRef = useRef(removeHighlight);

  const isDarkMode = document.body.classList.contains('theme-dark');

  useEffect(() => { highlightsRef.current = highlights; }, [highlights]);
  useEffect(() => { addHighlightRef.current = addHighlight; }, [addHighlight]);
  useEffect(() => { removeHighlightRef.current = removeHighlight; }, [removeHighlight]);

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

  const findContentsByDocument = useCallback((doc: Document): Contents | null => {
    const rendition = renditionRef.current;
    if (!rendition) return null;
    const list: Contents[] = (rendition as any).getContents?.() ?? [];
    return list.find((c) => c.document === doc) ?? null;
  }, []);

  const showDeleteToolbar = useCallback(
    (contentsObj: Contents, highlightId: string, cfiRange: string, clientX: number, clientY: number) => {
      const doc = contentsObj.document;
      removeIframeToolbar(doc);
      const scrollLeft = contentsObj.window.scrollX || doc.documentElement.scrollLeft || 0;
      const scrollTop = contentsObj.window.scrollY || doc.documentElement.scrollTop || 0;
      const x = clientX + scrollLeft;
      const y = clientY + scrollTop;

      const el = createToolbarEl(doc, '🗑 删除高亮', x, y, () => {
        const rendition = renditionRef.current;
        if (!rendition) return;
        try {
          rendition.annotations.remove(cfiRange, 'highlight');
        } catch (err) {
          console.warn('[epub-highlight] failed to remove annotation', err);
        }
        removeHighlightRef.current(highlightId);
        removeIframeToolbar(doc);
      });
      doc.body.appendChild(el);
    },
    []
  );

  const applyHighlight = useCallback((rendition: Rendition, h: Highlight) => {
    try {
      rendition.annotations.add(
        'highlight',
        h.cfiRange,
        { id: h.id },
        (e: MouseEvent) => {
          const target = e.target as Element | null;
          const doc = (target?.ownerDocument ?? null) as Document | null;
          if (!doc) return;
          const contentsObj = findContentsByDocument(doc);
          if (!contentsObj) return;
          showDeleteToolbar(contentsObj, h.id, h.cfiRange, e.clientX, e.clientY);
        },
        'epub-highlight',
        HIGHLIGHT_STYLES as any,
      );
    } catch (err) {
      console.warn('[epub-highlight] failed to add annotation', err);
    }
  }, [findContentsByDocument, showDeleteToolbar]);

  const showHighlightToolbar = useCallback(
    (contentsObj: Contents, cfiRange: string, text: string) => {
      const doc = contentsObj.document;
      removeIframeToolbar(doc);
      const selection = contentsObj.window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;

      const scrollLeft = contentsObj.window.scrollX || doc.documentElement.scrollLeft || 0;
      const scrollTop = contentsObj.window.scrollY || doc.documentElement.scrollTop || 0;
      const x = rect.left + rect.width / 2 + scrollLeft;
      const y = rect.top + scrollTop;

      const el = createToolbarEl(doc, '🟡 高亮', x, y, () => {
        const rendition = renditionRef.current;
        if (!rendition) return;
        const h = addHighlightRef.current(cfiRange, text);
        applyHighlight(rendition, h);
        removeIframeToolbar(doc);
        selection.removeAllRanges();
      });
      doc.body.appendChild(el);
    },
    [applyHighlight]
  );

  const readerStyles = isDarkMode ? darkReaderTheme : lightReaderTheme;

  return (
    <div style={{ height: "100vh", position: 'relative' }}>
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

          rendition.hooks.content.register((contentsObj: Contents) => {
            const doc = contentsObj.document;
            doc.body.oncontextmenu = () => false;
            doc.addEventListener('mousedown', (e) => {
              const target = e.target as Element | null;
              if (!target) return;
              if (target.closest?.('.' + TOOLBAR_CLASS)) return;
              if (target.closest?.('.epub-highlight')) return;
              const tag = (target as Element).tagName;
              if (tag === 'rect' || tag === 'g' || tag === 'svg') return;
              removeIframeToolbar(doc);
            });
          });

          updateTheme(rendition, isDarkMode ? 'dark' : 'light');
          updateFontSize(fontSize);

          rendition.on('selected', (cfiRange: string, contentsObj: Contents) => {
            const selection = contentsObj.window.getSelection();
            const text = selection?.toString() ?? '';
            if (!text.trim()) return;
            showHighlightToolbar(contentsObj, cfiRange, text);
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
