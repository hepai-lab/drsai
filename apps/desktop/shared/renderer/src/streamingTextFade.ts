import { useLayoutEffect, useRef } from "react";

const RETENTION_MS = 350;
interface StreamingTextSegment { createdAt: number; endOffset: number; key: string; startOffset: number }

export function useStreamingTextSegments(text: string, streaming: boolean): StreamingTextSegment[] {
  const previousRef = useRef<{ segments: StreamingTextSegment[]; text: string | null }>({ segments: [], text: null });
  const previous = previousRef.current;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let segments: StreamingTextSegment[] = [];
  if (streaming && !reducedMotion && text) {
    if (previous.text === null) segments = [{ createdAt: Date.now(), startOffset: 0, endOffset: text.length, key: `0-${text.length}` }];
    else if (text === previous.text) segments = previous.segments;
    else if (text.length > previous.text.length && text.startsWith(previous.text)) {
      const now = Date.now();
      segments = [
        ...previous.segments.filter((segment) => now - segment.createdAt <= RETENTION_MS),
        { createdAt: now, startOffset: previous.text.length, endOffset: text.length, key: `${previous.text.length}-${text.length}` },
      ];
    }
  }
  useLayoutEffect(() => { previousRef.current = { segments, text }; }, [segments, text]);
  return segments;
}

function transformChildren(parent: any, segments: StreamingTextSegment[], blocked = false): void {
  const transformed: any[] = [];
  for (const child of parent.children ?? []) {
    if (child.type === "element") {
      transformChildren(child, segments, blocked || child.tagName === "code" || child.tagName === "pre");
      transformed.push(child);
      continue;
    }
    if (blocked || child.type !== "text" || child.position?.start?.offset === undefined || child.position?.end?.offset === undefined) {
      transformed.push(child);
      continue;
    }
    const startOffset = child.position.start.offset as number;
    const endOffset = child.position.end.offset as number;
    if (endOffset - startOffset !== child.value.length) { transformed.push(child); continue; }
    const overlaps = segments.filter((segment) => segment.endOffset > startOffset && segment.startOffset < endOffset);
    if (!overlaps.length) { transformed.push(child); continue; }
    let cursor = 0;
    for (const segment of overlaps) {
      const segmentStart = Math.max(cursor, segment.startOffset - startOffset, 0);
      const segmentEnd = Math.min(segment.endOffset - startOffset, child.value.length);
      if (segmentEnd <= segmentStart) continue;
      if (segmentStart > cursor) transformed.push({ type: "text", value: child.value.slice(cursor, segmentStart) });
      transformed.push({ type: "element", tagName: "span", properties: { dataStreamingFadeKey: `${segment.key}:${startOffset + segmentStart}` }, children: [{ type: "text", value: child.value.slice(segmentStart, segmentEnd) }] });
      cursor = segmentEnd;
    }
    if (cursor < child.value.length) transformed.push({ type: "text", value: child.value.slice(cursor) });
  }
  parent.children = transformed;
}

export function createStreamingTextFadePlugin(segments: StreamingTextSegment[]) {
  return () => (tree: any): void => transformChildren(tree, segments);
}

