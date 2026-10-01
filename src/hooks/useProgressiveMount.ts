import { Node } from "prosemirror-model";
import { useState } from "react";

import { useClientLayoutEffect } from "./useClientLayoutEffect.js";

export interface ProgressiveMountOptions {
  /** Maximum number of top-level document children mounted per frame. Default: 25. */
  batchSize?: number;
}

/** Progressively mount the initial document, without changing its EditorState. */
export function useProgressiveMount(
  doc: Node,
  options: ProgressiveMountOptions | undefined,
  isStatic: boolean,
  canSchedule: boolean
) {
  const batchSize = options?.batchSize ?? 25;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError(
      "progressiveMount.batchSize must be a positive safe integer"
    );
  }

  const enabled = options !== undefined && !isStatic;
  const initialCount = enabled
    ? Math.min(batchSize, doc.childCount)
    : doc.childCount;
  const [progress, setProgress] = useState(() => ({
    doc,
    count: initialCount,
    complete: initialCount === doc.childCount,
  }));

  // A controlled update during loading invalidates the old schedule. Once ready,
  // ordinary editing stays synchronous; use a React key to load another document.
  let current = progress;
  if (!progress.complete && (progress.doc !== doc || !enabled)) {
    current = {
      doc,
      count: initialCount,
      complete: initialCount === doc.childCount,
    };
    setProgress(current);
  }

  const count =
    !enabled || current.complete
      ? doc.childCount
      : Math.min(current.count, doc.childCount);
  const isMounting = count < doc.childCount;

  useClientLayoutEffect(() => {
    if (!isMounting || !canSchedule) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      setProgress((previous) => {
        if (previous.doc !== doc || previous.complete) return previous;
        const nextCount = Math.min(count + batchSize, doc.childCount);
        return {
          doc,
          count: nextCount,
          complete: nextCount === doc.childCount,
        };
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [batchSize, canSchedule, count, doc, isMounting]);

  return { mountedChildCount: count, isMounting };
}
