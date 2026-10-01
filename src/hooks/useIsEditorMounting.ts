import { useContext } from "react";

import { EditorMountingContext } from "../contexts/EditorMountingContext.js";

/** Whether the initial document is still being mounted across frames. */
export function useIsEditorMounting() {
  return useContext(EditorMountingContext);
}
