import { baseKeymap, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import "prosemirror-view/style/prosemirror.css";
import React, {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import {
  NodeViewComponentProps,
  ProseMirror,
  ProseMirrorDoc,
  reactKeys,
  useEditorEffect,
  useEditorEventCallback,
  useIsEditorMounting,
  useMergedDOMRefs,
} from "../src/index.js";

import "./progressive-mount.css";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "text*",
      attrs: { index: { default: 0 } },
      toDOM: () => ["p", 0],
    },
    list: { group: "block", content: "list_item+", toDOM: () => ["ul", 0] },
    list_item: { content: "paragraph+", toDOM: () => ["li", 0] },
    text: {},
  },
  marks: {
    strong: { toDOM: () => ["strong", 0], parseDOM: [{ tag: "strong" }] },
    em: { toDOM: () => ["em", 0], parseDOM: [{ tag: "em" }] },
  },
});

interface Settings {
  mode: "progressive" | "synchronous";
  count: number;
  batchSize: number;
  workMs: number;
  layout: "paragraphs" | "list";
  readonly: boolean;
  endSelection: boolean;
}

interface Session {
  id: number;
  settings: Settings;
  state: EditorState;
  preparationMs: number;
  started: number;
  readyAt: number;
  mounted: number;
  maxGap: number;
  frames: number;
  cancelled: boolean;
}

function prepare(settings: Settings, id: number): Session {
  const start = performance.now();
  const paragraphs = Array.from({ length: settings.count }, (_, index) =>
    schema.node(
      "paragraph",
      { index: index + 1 },
      schema.text(
        `Paragraph ${
          index + 1
        }. This is editable text. Try selecting a phrase, changing its formatting, or typing while the document loads.`
      )
    )
  );
  const children =
    settings.layout === "list"
      ? [
          schema.node(
            "list",
            null,
            paragraphs.map((paragraph) =>
              schema.node("list_item", null, paragraph)
            )
          ),
        ]
      : paragraphs;
  const doc = schema.node("doc", null, children);
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(
      doc,
      settings.endSelection
        ? doc.content.size - (settings.layout === "list" ? 3 : 1)
        : settings.layout === "list"
        ? 3
        : 1
    ),
    plugins: [
      history(),
      reactKeys(),
      keymap({
        ...baseKeymap,
        "Mod-b": toggleMark(schema.marks.strong),
        "Mod-i": toggleMark(schema.marks.em),
        "Mod-z": undo,
        "Mod-Shift-z": redo,
        "Mod-y": redo,
      }),
    ],
  });
  return {
    id,
    settings,
    state,
    preparationMs: performance.now() - start,
    started: 0,
    readyAt: 0,
    mounted: 0,
    maxGap: 0,
    frames: 0,
    cancelled: false,
  };
}

function Controls({ session }: { session: Session }) {
  const mounting = useIsEditorMounting();
  const bold = useEditorEventCallback((view) => {
    toggleMark(schema.marks.strong)(view.state, view.dispatch, view);
    view.focus();
  });
  const italic = useEditorEventCallback((view) => {
    toggleMark(schema.marks.em)(view.state, view.dispatch, view);
    view.focus();
  });
  const jump = useEditorEventCallback((view) => {
    const pos =
      view.state.doc.content.size -
      (session.settings.layout === "list" ? 3 : 1);
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, pos))
        .scrollIntoView()
    );
    view.focus();
  });
  useEditorEffect(() => {
    session.readyAt = performance.now();
  }, [session]);
  return (
    <div className="editor-toolbar">
      <div className="toolbar-actions">
        <button
          disabled={mounting || session.settings.readonly}
          onClick={bold}
          title="Bold (Ctrl/Cmd+B)"
        >
          <strong>B</strong>
        </button>
        <button
          disabled={mounting || session.settings.readonly}
          onClick={italic}
          title="Italic (Ctrl/Cmd+I)"
        >
          <em>I</em>
        </button>
        <button disabled={mounting} onClick={jump}>
          Jump to end ↗
        </button>
      </div>
      <span
        className={`editor-state ${mounting ? "loading" : ""}`}
        data-testid="editor-status"
      >
        <span className="status-dot" />
        {mounting
          ? "Mounting · read-only"
          : session.settings.readonly
          ? "Ready · read-only"
          : "Ready · editable"}
      </span>
    </div>
  );
}

function Editor({ session }: { session: Session }) {
  const [components] = useState(() => ({
    paragraph: forwardRef<HTMLParagraphElement, NodeViewComponentProps>(
      function Paragraph({ children, nodeProps, ...props }, ref) {
        const mergedRef = useMergedDOMRefs(ref, nodeProps.contentDOMRef);
        useLayoutEffect(() => {
          const until = performance.now() + session.settings.workMs;
          while (performance.now() < until) {
            /* optional synthetic mount work */
          }
          if (!session.readyAt) session.mounted++;
        }, []);
        return (
          <p
            {...props}
            ref={mergedRef}
            data-paragraph={nodeProps.node.attrs.index}
          >
            {children}
          </p>
        );
      }
    ),
  }));
  return (
    <ProseMirror
      defaultState={session.state}
      progressiveMount={
        session.settings.mode === "progressive"
          ? { batchSize: session.settings.batchSize }
          : undefined
      }
      editable={() => !session.settings.readonly}
      nodeViewComponents={components}
    >
      <Controls session={session} />
      <div className="document-scroll">
        <ProseMirrorDoc spellCheck={false} aria-label="Test document" />
      </div>
    </ProseMirror>
  );
}

function LiveStatus({ session }: { session: Session | null }) {
  const [, refresh] = useState(0);
  const [clicks, setClicks] = useState(0);
  const lastSession = useRef<Session | null>(null);
  useEffect(() => {
    let frame: number;
    let last = performance.now();
    let capturedReady = false;
    function tick() {
      const now = performance.now();
      if (lastSession.current !== session) {
        lastSession.current = session;
        last = session?.started || now;
        capturedReady = false;
      }
      if (session && !session.cancelled && !capturedReady) {
        session.maxGap = Math.max(session.maxGap, now - last);
        session.frames++;
        capturedReady = session.readyAt > 0;
      }
      last = now;
      refresh((value) => value + 1);
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [session]);
  const done = session?.readyAt || session?.cancelled;
  const elapsed = session?.started
    ? (session.readyAt || performance.now()) - session.started
    : 0;
  const percentage = session
    ? Math.min(100, (100 * session.mounted) / session.settings.count)
    : 0;
  return (
    <div className="live-grid">
      <section className="status-card">
        <div className="section-label">Current run</div>
        <div className="progress-heading">
          <strong>
            {session
              ? session.cancelled
                ? "Run cancelled"
                : session.readyAt
                ? "Document ready"
                : "Mounting document…"
              : "Ready when you are"}
          </strong>
          <span>
            {session
              ? `${session.mounted.toLocaleString()} / ${session.settings.count.toLocaleString()}`
              : "No document loaded"}
          </span>
        </div>
        <progress
          value={percentage}
          max={100}
          aria-label="Paragraphs mounted"
        />
        <div className="metrics">
          <div>
            <span>Mount to ready</span>
            <strong data-testid="mount-time">
              {session ? `${Math.round(elapsed)} ms` : "—"}
            </strong>
          </div>
          <div>
            <span>Longest UI frame gap</span>
            <strong data-testid="frame-gap">
              {session ? `${Math.round(session.maxGap)} ms` : "—"}
            </strong>
          </div>
          <div>
            <span>Frames observed</span>
            <strong>{session ? session.frames : "—"}</strong>
          </div>
        </div>
        <p className="metric-note">
          Mount timing starts after document preparation
          {session ? ` (${Math.round(session.preparationMs)} ms)` : ""}. Frame
          gaps run through the next frame after readiness and include browser
          rendering and scheduling. They can exceed the mount timer.
        </p>
        {session && !done && (
          <p className="loading-note">
            The document is temporarily read-only. Try the responsiveness
            controls while it mounts.
          </p>
        )}
      </section>
      <section className="response-card">
        <div className="section-label">
          Can the rest of the app keep moving?
        </div>
        <div className="pulse-row">
          <span className="pulse">
            <span
              style={{
                opacity: 0.55 + 0.45 * Math.sin(performance.now() / 200),
                transform: `scale(${
                  1 + 0.35 * Math.sin(performance.now() / 200)
                })`,
              }}
            />
          </span>
          <span>The animation runs on JavaScript frames.</span>
        </div>
        <div className="response-actions">
          <button onClick={() => setClicks((value) => value + 1)}>
            Click me <span>{clicks}</span>
          </button>
          <input
            aria-label="Responsiveness test"
            placeholder="Type here while loading…"
          />
        </div>
      </section>
    </div>
  );
}

function App() {
  const [settings, setSettings] = useState<Settings>({
    mode: "progressive",
    count: 2000,
    batchSize: 25,
    workMs: 0.25,
    layout: "paragraphs",
    readonly: false,
    endSelection: false,
  });
  const [session, setSession] = useState<Session | null>(null);
  const nextId = useRef(0);
  const [error, setError] = useState("");
  function load() {
    if (
      !Number.isSafeInteger(settings.count) ||
      settings.count < 1 ||
      settings.count > 20000 ||
      !Number.isSafeInteger(settings.batchSize) ||
      settings.batchSize < 1 ||
      settings.batchSize > 20000 ||
      !Number.isFinite(settings.workMs) ||
      settings.workMs < 0 ||
      settings.workMs > 5
    ) {
      setError(
        "Use 1–20,000 paragraphs, a batch size of 1–20,000, and a mount cost of 0–5 ms."
      );
      return;
    }
    setError("");
    const next = prepare({ ...settings }, ++nextId.current);
    if (session && !session.readyAt) session.cancelled = true;
    next.started = performance.now();
    flushSync(() => setSession(next));
  }
  function clear() {
    if (session) session.cancelled = true;
    setSession(null);
  }
  return (
    <main className="demo-shell">
      <header className="page-header">
        <div>
          <div className="eyebrow">
            <span className="brand-mark">↗</span> React ProseMirror /
            Performance lab
          </div>
          <h1>
            A big document.
            <br />
            <span>A responsive app.</span>
          </h1>
          <p>
            Mount an editor all at once, or spread the work across frames. Watch
            the difference, then edit the result.
          </p>
        </div>
        <a
          className="source-link"
          href="https://github.com/AndrewKaninchen/react-prosemirror/pull/1"
          target="_blank"
          rel="noreferrer"
        >
          View implementation ↗
        </a>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <section className="settings-card">
            <div className="section-label">01 / Configure your run</div>
            <div className="mode-picker" aria-label="Mounting mode">
              {(["progressive", "synchronous"] as const).map((mode) => (
                <button
                  key={mode}
                  aria-pressed={settings.mode === mode}
                  onClick={() => setSettings({ ...settings, mode })}
                >
                  {mode === "progressive" ? "Across frames" : "All at once"}
                </button>
              ))}
            </div>
            <label>
              Paragraphs
              <input
                type="number"
                min="1"
                max="20000"
                value={settings.count}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    count: Number(event.target.value),
                  })
                }
              />
            </label>
            <div className="presets">
              {[500, 2000, 5000, 10000].map((count) => (
                <button
                  key={count}
                  onClick={() => setSettings({ ...settings, count })}
                >
                  {count.toLocaleString()}
                </button>
              ))}
            </div>
            <div className="settings-pair">
              <label>
                Blocks per frame
                <input
                  type="number"
                  min="1"
                  max="20000"
                  disabled={settings.mode === "synchronous"}
                  value={settings.batchSize}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      batchSize: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Extra mount work
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.05"
                  value={settings.workMs}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      workMs: Number(event.target.value),
                    })
                  }
                />
                <small>ms per paragraph</small>
              </label>
            </div>
            <p className="field-note">
              Extra work simulates an expensive component. Set it to 0 to test
              only the library.
            </p>
            <label>
              Document shape
              <select
                value={settings.layout}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    layout: event.target.value as Settings["layout"],
                  })
                }
              >
                <option value="paragraphs">Separate paragraphs</option>
                <option value="list">One large nested list</option>
              </select>
            </label>
            {settings.layout === "list" && (
              <p className="limitation-note">
                One list is one top-level block. Its paragraphs mount together,
                even in progressive mode.
              </p>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.readonly}
                onChange={(event) =>
                  setSettings({ ...settings, readonly: event.target.checked })
                }
              />
              Keep editor read-only after loading
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.endSelection}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    endSelection: event.target.checked,
                  })
                }
              />
              Start selection at the document end
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="load-button" onClick={load}>
              Load document <span>↗</span>
            </button>
            <button
              className="clear-button"
              disabled={!session}
              onClick={clear}
            >
              Clear / cancel loading
            </button>
            <p className="field-note">
              Settings apply on the next load. Loading another document replaces
              the current run.
            </p>
          </section>
        </aside>
        <section className="editor-card">
          <div className="document-header">
            <div>
              <div className="section-label">02 / Try the editor</div>
              <h2>
                {session
                  ? `${session.settings.count.toLocaleString()} paragraphs`
                  : "Your test document"}
              </h2>
            </div>
            <span className="document-badge">
              {session
                ? session.settings.mode === "progressive"
                  ? "PROGRESSIVE"
                  : "SYNCHRONOUS"
                : "EMPTY"}
            </span>
          </div>
          <LiveStatus session={session} />
          {session ? (
            <Editor key={session.id} session={session} />
          ) : (
            <div className="empty-state">
              <span className="paper-icon">≡</span>
              <h3>Give it something big.</h3>
              <p>
                Choose a size and load a document.
                <br />
                Compare both modes with the same settings.
              </p>
            </div>
          )}
          <footer className="document-footer">
            Select text to format it. Undo with Ctrl/Cmd+Z. Each load starts a
            fresh editor.
          </footer>
        </section>
      </div>
    </main>
  );
}

const mount = document.getElementById("root");
if (!mount) throw new Error("Missing demo root");
createRoot(mount).render(<App />);
