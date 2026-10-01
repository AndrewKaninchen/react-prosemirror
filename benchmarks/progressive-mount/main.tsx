import { EditorState, TextSelection } from "prosemirror-state";
import { doc, p } from "prosemirror-test-builder";
import { EditorView } from "prosemirror-view";
import React, { forwardRef, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import {
  NodeViewComponentProps,
  ProseMirror,
  ProseMirrorDoc,
  reactKeys,
  useEditorEffect,
  useMergedDOMRefs,
} from "../../src/index.js";

const mount = document.getElementById("root");
if (!mount) throw new Error("Missing benchmark root");
const root = createRoot(mount);

interface BenchmarkSettings {
  count?: number;
  batchSize?: number;
  workMs?: number;
}

declare global {
  interface Window {
    runBenchmark(settings: BenchmarkSettings): Promise<unknown>;
  }
}

// A repeatable workload representing application-specific node-view setup.
// This is deliberately synthetic, and is configurable down to zero.
function burn(milliseconds: number) {
  const end = performance.now() + milliseconds;
  while (performance.now() < end) {
    /* synchronous mount work */
  }
}

window.runBenchmark = ({
  count = 1000,
  batchSize,
  workMs = 0.15,
}: BenchmarkSettings) =>
  new Promise((resolve) => {
    const document = doc(
      ...Array.from({ length: count }, (_, i) => p(`Paragraph ${i + 1}`))
    );
    const state = EditorState.create({
      doc: document,
      selection: TextSelection.create(document, document.content.size - 1),
      plugins: [reactKeys()],
    });
    let mounted = 0;
    let commitsBeforeReady = 0;
    const sizes: number[] = [];
    const frameGaps: number[] = [];
    let finished = false;
    let started = 0;
    let readyAt = 0;
    let lastFrame = 0;
    let selectionValid = false;
    let editValid = false;
    let readyView: EditorView;

    const Paragraph = forwardRef<HTMLParagraphElement, NodeViewComponentProps>(
      function Paragraph({ children, nodeProps, ...props }, ref) {
        const mergedRef = useMergedDOMRefs(ref, nodeProps.contentDOMRef);
        useLayoutEffect(() => {
          burn(workMs);
          mounted++;
        }, []);
        return (
          <p {...props} ref={mergedRef}>
            {children}
          </p>
        );
      }
    );

    function Ready() {
      useEditorEffect((view) => {
        readyAt = performance.now();
        selectionValid =
          view.state.selection.eq(state.selection) &&
          view.domAtPos(state.selection.from).node.textContent ===
            `Paragraph ${count}`;
        const pos = view.state.doc.content.size - 1;
        view.dispatch(view.state.tr.insertText("!", pos));
        readyView = view;
        finished = true;
      }, []);
      return null;
    }

    function heartbeat(now: number) {
      if (lastFrame) frameGaps.push(now - lastFrame);
      lastFrame = now;
      sizes.push(mounted);
      if (!finished) {
        commitsBeforeReady++;
        requestAnimationFrame(heartbeat);
      } else {
        editValid =
          readyView.state.doc.textContent.endsWith("!") &&
          readyView.dom.textContent?.endsWith("!") === true;
        resolve({
          count,
          batchSize: batchSize ?? null,
          workMs,
          totalMs: readyAt - started,
          maxFrameGapMs: Math.max(...frameGaps),
          framesBeforeReady: commitsBeforeReady,
          mounted,
          sizes,
          selectionValid,
          editValid,
        });
      }
    }

    requestAnimationFrame((now) => {
      started = performance.now();
      lastFrame = now;
      requestAnimationFrame(heartbeat);
      flushSync(() =>
        root.render(
          <ProseMirror
            key={Math.random()}
            defaultState={state}
            progressiveMount={batchSize ? { batchSize } : undefined}
            nodeViewComponents={{ paragraph: Paragraph }}
          >
            <Ready />
            <ProseMirrorDoc />
          </ProseMirror>
        )
      );
    });
  });
