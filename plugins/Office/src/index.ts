import type { LunaUnload } from "@luna/core";

import { setupQueue } from "./queue";

export { errSignal, trace } from "./log";
export { Settings } from "./Settings";
export const unloads = new Set<LunaUnload>();

setupQueue(unloads);
