import type { LunaUnload } from "@luna/core";
import { StyleTag } from "@luna/lib";

import { setupRoute } from "./route";

import styles from "file://styles.css?minify";

export { errSignal, trace } from "./trace";
export const unloads = new Set<LunaUnload>();

new StyleTag("Activity", unloads, styles);
setupRoute(unloads);
