import { it } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react";
import { EditorState, Plugin, TextSelection } from "prosemirror-state";
import { doc, p } from "prosemirror-test-builder";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import React, { StrictMode, forwardRef } from "react";

import { useEditorEffect } from "../../hooks/useEditorEffect.js";
import { useEditorEventCallback } from "../../hooks/useEditorEventCallback.js";
import { useIsEditorMounting } from "../../hooks/useIsEditorMounting.js";
import { reactKeys } from "../../plugins/reactKeys.js";
import {
  setupProseMirrorView,
  teardownProseMirrorView,
} from "../../testing/setupProseMirrorView.js";
import { Props, ProseMirror } from "../ProseMirror.js";
import { ProseMirrorDoc } from "../ProseMirrorDoc.js";
import { NodeViewComponentProps } from "../nodes/NodeViewComponentProps.js";

describe("progressive mounting", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let view: EditorView | undefined;
  let onReady: jest.Mock;
  let eventCallback: () => void;

  function Probe() {
    const mounting = useIsEditorMounting();
    useEditorEffect((v) => {
      view = v;
      onReady(v.state.doc);
    }, []);
    eventCallback = useEditorEventCallback(() => {
      onReady("event");
    });
    return <output data-testid="loading">{String(mounting)}</output>;
  }

  function Editor(props: Partial<Props>) {
    return (
      <ProseMirror
        defaultState={EditorState.create({
          doc: doc(p("a"), p("b"), p("c"), p("d"), p("e")),
          plugins: [reactKeys()],
        })}
        progressiveMount={{ batchSize: 2 }}
        {...props}
      >
        <Probe />
        <ProseMirrorDoc data-testid="editor" />
      </ProseMirror>
    );
  }

  function frame() {
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(performance.now()));
    });
  }

  beforeEach(() => {
    setupProseMirrorView();
    frames = new Map();
    nextFrame = 0;
    view = undefined;
    onReady = jest.fn();
    jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
      });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    teardownProseMirrorView();
  });

  it("commits successive batches and runs editor effects only after the final batch", () => {
    const rendered = render(<Editor />);
    const editor = rendered.getByTestId("editor");
    expect(editor.textContent).toBe("ab");
    expect(editor.getAttribute("contenteditable")).toBe("false");
    expect(editor.getAttribute("aria-busy")).toBe("true");
    expect(onReady).not.toHaveBeenCalled();
    expect(() => eventCallback()).toThrow(
      "ProseMirror document is not mounted"
    );
    frame();
    expect(editor.textContent).toBe("abcd");
    expect(onReady).not.toHaveBeenCalled();
    frame();
    expect(editor.textContent).toBe("abcde");
    expect(editor.getAttribute("contenteditable")).toBe("true");
    expect(editor.hasAttribute("aria-busy")).toBe(false);
    expect(rendered.getByTestId("loading").textContent).toBe("false");
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(view?.state.doc.textContent).toBe("abcde");
    // Editing after loading is synchronous and maps the formerly unmounted tail.
    act(() => {
      view?.dispatch(
        view.state.tr.insertText("!", view.state.doc.content.size - 1)
      );
    });
    expect(editor.textContent).toBe("abcde!");
    expect(frames.size).toBe(0);
  });

  it("preserves plugin state, end selections, decorations and read-only policy", () => {
    const pluginView = jest.fn(() => ({ destroy: jest.fn() }));
    const document = doc(p("a"), p("b"), p("c"));
    const state = EditorState.create({
      doc: document,
      selection: TextSelection.create(document, document.content.size - 1),
      plugins: [
        reactKeys(),
        new Plugin({
          state: { init: () => "preserved", apply: (_tr, value) => value },
          props: {
            editable: () => false,
            decorations: () =>
              DecorationSet.create(document, [
                Decoration.inline(7, 8, { class: "tail" }),
              ]),
          },
          view: pluginView,
        }),
      ],
    });
    const rendered = render(<Editor state={state} defaultState={undefined} />);
    expect(pluginView).not.toHaveBeenCalled();
    frame();
    expect(view?.state).toBe(state);
    expect(pluginView).toHaveBeenCalledTimes(1);
    expect(view?.editable).toBe(false);
    expect(rendered.getByTestId("editor").getAttribute("contenteditable")).toBe(
      "false"
    );
    expect(rendered.container.querySelector(".tail")?.textContent).toBe("c");
    expect(view?.domAtPos(state.doc.content.size - 1).node.textContent).toBe(
      "c"
    );
  });

  it("cancels stale frames on document replacement and unmount", () => {
    const rendered = render(
      <StrictMode>
        <Editor />
      </StrictMode>
    );
    const stale = [...frames.values()];
    const state = EditorState.create({
      doc: doc(p("x"), p("y"), p("z")),
      plugins: [reactKeys()],
    });
    rendered.rerender(
      <StrictMode>
        <Editor state={state} defaultState={undefined} />
      </StrictMode>
    );
    expect(rendered.getByTestId("editor").textContent).toBe("xy");
    act(() => {
      stale.forEach((callback) => callback(0));
    });
    expect(rendered.getByTestId("editor").textContent).toBe("xy");
    expect(frames.size).toBe(1);
    rendered.unmount();
    expect(frames.size).toBe(0);
  });

  it("blocks editor input and custom handlers during mounting", () => {
    const keydown = jest.fn();
    const rendered = render(<Editor handleDOMEvents={{ keydown }} />);
    expect(
      fireEvent.keyDown(rendered.getByTestId("editor"), { key: "a" })
    ).toBe(false);
    expect(keydown).not.toHaveBeenCalled();
    frame();
    frame();
    fireEvent.keyDown(rendered.getByTestId("editor"), { key: "a" });
    expect(keydown).toHaveBeenCalledTimes(1);
  });

  it("keeps mounted React components alive between batches", () => {
    const mounted = jest.fn();
    const destroyed = jest.fn();
    const Paragraph = forwardRef<HTMLParagraphElement, NodeViewComponentProps>(
      function Paragraph({ children }, ref) {
        React.useEffect(() => {
          mounted();
          return () => {
            destroyed();
          };
        }, []);
        return <p ref={ref}>{children}</p>;
      }
    );
    render(<Editor nodeViewComponents={{ paragraph: Paragraph }} />);
    frame();
    frame();
    expect(mounted).toHaveBeenCalledTimes(5);
    expect(destroyed).not.toHaveBeenCalled();
  });

  it.each([{ progressiveMount: undefined }, { static: true }])(
    "renders synchronously with %o",
    (props) => {
      const rendered = render(<Editor {...props} />);
      expect(rendered.getByTestId("editor").textContent).toBe("abcde");
      expect(frames.size).toBe(0);
    }
  );

  it("responds to changes in editability during loading", () => {
    const rendered = render(<Editor editable={() => true} />);
    rendered.rerender(<Editor editable={() => false} />);
    frame();
    frame();
    expect(view?.editable).toBe(false);
  });

  it("renders widgets at batch boundaries and at the document end exactly once", () => {
    const documentNode = doc(p("a"), p("b"), p("c"), p("d"), p("e"));
    const widgetDOM = (text: string) => {
      const span = document.createElement("span");
      span.textContent = text;
      return span;
    };
    const decorations = DecorationSet.create(documentNode, [
      Decoration.widget(6, () => widgetDOM("W"), { key: "boundary", side: -1 }),
      Decoration.node(6, 9, { class: "third" }),
      Decoration.widget(15, () => widgetDOM("E"), { key: "end" }),
    ]);
    const state = EditorState.create({
      doc: documentNode,
      plugins: [reactKeys()],
    });
    const rendered = render(
      <Editor
        state={state}
        defaultState={undefined}
        decorations={() => decorations}
      />
    );
    expect(rendered.getByTestId("editor").textContent).toBe("ab");
    frame();
    expect(rendered.container.querySelector(".third")?.textContent).toBe("c");
    frame();
    expect(rendered.getByTestId("editor").textContent).toBe("abWcdeE");
    expect(
      rendered.container.querySelectorAll(".ProseMirror-widget")
    ).toHaveLength(2);
    expect(view?.domAtPos(7).node.textContent).toBe("c");
  });

  it("finishes immediately when batching is disabled and does not restart when re-enabled", () => {
    const rendered = render(<Editor />);
    rendered.rerender(<Editor progressiveMount={undefined} />);
    expect(rendered.getByTestId("editor").textContent).toBe("abcde");
    expect(frames.size).toBe(0);
    rendered.rerender(<Editor />);
    expect(rendered.getByTestId("editor").textContent).toBe("abcde");
    expect(frames.size).toBe(0);
  });

  it("does not schedule more work until ProseMirrorDoc mounts", () => {
    const state = EditorState.create({ doc: doc(p("a"), p("b"), p("c")) });
    const rendered = render(
      <ProseMirror state={state} progressiveMount={{ batchSize: 1 }} />
    );
    expect(frames.size).toBe(0);
    rendered.rerender(
      <ProseMirror state={state} progressiveMount={{ batchSize: 1 }}>
        <ProseMirrorDoc data-testid="editor" />
      </ProseMirror>
    );
    expect(rendered.getByTestId("editor").textContent).toBe("a");
    expect(frames.size).toBe(1);
  });
});
