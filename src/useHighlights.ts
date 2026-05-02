import { useCallback } from 'react';
import useLocalStorageState from 'use-local-storage-state';

export interface Highlight {
	id: string;
	cfiRange: string;
	text: string;
	createdAt: number;
}

export const HIGHLIGHT_COLOR = '#ffeb3b';
export const HIGHLIGHT_STYLES = {
	fill: HIGHLIGHT_COLOR,
	'fill-opacity': '0.35',
	'mix-blend-mode': 'multiply',
};

export function useHighlights(bookId: string) {
	const [highlights, setHighlights] = useLocalStorageState<Highlight[]>(
		`epub-highlights-${bookId}`,
		{ defaultValue: [] }
	);

	const addHighlight = useCallback(
		(cfiRange: string, text: string): Highlight => {
			const next: Highlight = {
				id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				cfiRange,
				text,
				createdAt: Date.now(),
			};
			setHighlights((prev) => [...(prev ?? []), next]);
			return next;
		},
		[setHighlights]
	);

	const removeHighlight = useCallback(
		(id: string) => {
			setHighlights((prev) => (prev ?? []).filter((h) => h.id !== id));
		},
		[setHighlights]
	);

	return { highlights: highlights ?? [], addHighlight, removeHighlight };
}
