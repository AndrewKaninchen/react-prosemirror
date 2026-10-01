import { act, cleanup, render } from "@testing-library/react";
import { EditorState, TextSelection } from "prosemirror-state";
import { doc, p } from "prosemirror-test-builder";
import { EditorView } from "prosemirror-view";
import React from "react";

import { useEditorEffect } from "../../hooks/useEditorEffect.js";
import { reactKeys } from "../../plugins/reactKeys.js";
import { ProseMirror } from "../ProseMirror.js";
import { ProseMirrorDoc } from "../ProseMirrorDoc.js";

describe("progressive mounting in a browser", () => {
  it("preserves the end selection, blocks typing during loading, and edits normally after completion", async () => {
    const originalRequest = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    window.requestAnimationFrame = (callback) => {
      frames.set(++next, callback);
      return next;
    };
    window.cancelAnimationFrame = (id) => {
      frames.delete(id);
    };
    const document = doc(p("first"), p("second"), p("last"));
    const state = EditorState.create({
      doc: document,
      plugins: [reactKeys()],
      selection: TextSelection.create(document, document.content.size - 1),
    });
    let view: EditorView | undefined;
    function Ready() {
      useEditorEffect((v) => {
        view = v;
        v.focus();
      }, []);
      return null;
    }
    try {
      const rendered = render(
        <ProseMirror defaultState={state} progressiveMount={{ batchSize: 1 }}>
          <Ready />
          <ProseMirrorDoc data-testid="editor" />
        </ProseMirror>
      );
      const editor = rendered.getByTestId("editor");
      expect(editor.textContent).toBe("first");
      editor.focus();
      await browser.keys("x");
      expect(editor.textContent).toBe("first");
      expect(view).toBeUndefined();
      function frame() {
        act(() => {
          const pending = [...frames.values()];
          frames.clear();
          pending.forEach((callback) => callback(performance.now()));
        });
      }
      frame();
      expect(editor.textContent).toBe("firstsecond");
      frame();
      expect(editor.textContent).toBe("firstsecondlast");
      expect(view?.state.selection.from).toBe(state.selection.from);
      await browser.keys("!");
      expect(editor.textContent).toBe("firstsecondlast!");
      expect(view?.state.doc.textContent).toBe("firstsecondlast!");
    } finally {
      cleanup();
      window.requestAnimationFrame = originalRequest;
      window.cancelAnimationFrame = originalCancel;
    }
  });
});
