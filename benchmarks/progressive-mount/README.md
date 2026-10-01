# Progressive mounting experiment

For a manual playground, run `node scripts/serve-progressive-demo.mjs` and open
`http://127.0.0.1:4180/demo/progressive-mount.html`. It serves a production
build with document-size, batch-size, mount-cost, shape and read-only controls.
The JavaScript pulse, input and click counter remain outside the editor so you
can test app responsiveness during loading. You can also run
`corepack yarn demo` and open `/demo/progressive-mount.html` on the development
server.

The goal is to reduce the longest main-thread pause while mounting a document.
It does not reduce the amount of React component work or virtualize the editor.
The implementation keeps the original EditorState and mounts its DOM in batches
of top-level children. An incremental cache reuses the existing prefix instead
of describing and creating React elements for it again. A separate mounting
context prevents the readiness change from re-rendering every node-view consumer
of the EditorContext.

ProseMirror requires a complete document DOM for selection and coordinate
operations. During loading, input and selection observers are blocked, and view
effects (including plugin views) are deferred. At the final commit, the editor
resumes the normal lifecycle against its original state. This avoids feeding
truncated documents through schema validation or plugins, which could affect
history, collaboration, and position mappings.

## Reproduce

```sh
corepack yarn install --immutable
node scripts/benchmark-progressive-mount.mjs
```

The script builds a **production** fixture and runs it in headless Chromium. Set
`CHROME_PATH` if the browser is not in a standard location. It needs no browser
download. `BENCHMARK_COUNT` defaults to 1000 and `BENCHMARK_WORK_MS` defaults to
0.15. The latter adds synthetic synchronous work in each paragraph's layout
effect; set it to zero to measure just the library. Input-state creation is
excluded from timing. The same fixture runs once synchronously and once with a
batch size of 25. The script asserts that all components mount exactly once, the
selection and tail DOM mapping survive, and an edit after loading appears in
both state and DOM. It fails on browser exceptions.

Measurements are local observations, not performance guarantees. The frame-gap
metric includes rendering and painting opportunities; it is not a React render
duration. Headless Chrome's frame rate differs from a user's display. Small
batches incur at least one animation-frame scheduling interval each.

Two production runs on Windows with headless Chrome 154 produced the following
observations (batch size 25):

| Workload                                           | Synchronous total | Progressive total | Synchronous longest frame gap | Progressive longest frame gap |
| -------------------------------------------------- | ----------------: | ----------------: | ----------------------------: | ----------------------------: |
| 1,000 paragraphs, 0.15 ms synthetic work per mount |            301 ms |            300 ms |                        313 ms |                         13 ms |
| 5,000 paragraphs, no synthetic work                |            814 ms |          2,625 ms |                        854 ms |                         46 ms |

The larger workload waited across 200 batches. An earlier run of the same
5,000-paragraph case measured 861 ms / 2,469 ms total and 900 ms / 29 ms maximum
frame gaps. This variability reinforces that batching improves responsiveness
without promising a particular frame-time ceiling or faster overall loading.

## Alternatives and limits

- `startTransition` yields render work but leaves DOM commits and layout effects
  synchronous. It cannot solve an expensive mount commit by itself.
- Moving React DOM mounting to a worker is not available: the browser DOM is on
  the main thread. Independent data preparation can use workers separately.
- Permanent virtualization needs a larger editor architecture change to preserve
  DOM positions, selection, composition, native find, and off-screen geometry.
- Static placeholders followed by one full React mount move the original freeze
  to the end. Truncating EditorState also changes the document seen by plugins.
- This experiment bounds top-level children per commit, not time or total nested
  work. A single huge table/list, expensive plugin initialization, or many
  deferred editor effects can still cause a long task. For those cases, optimize
  the component work or investigate recursive batching as a separate extension.
- Sibling description registration still sorts arrays repeatedly. This can add
  substantial cost to flat documents and deserves a separate optimization with
  node-view reordering coverage.

Use `node scripts/test-chrome.mjs` for the desktop Chrome regression suite, or
pass a spec path to run one browser test. The normal `yarn test` command still
includes the upstream Firefox and mobile Chrome coverage.
