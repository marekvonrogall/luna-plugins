import type { LunaUnload } from "@luna/core";

import { setupPlayer } from "./player";
import { setupQueue } from "./queue";
import { setupSidebar } from "./sidebar";

export { errSignal, trace } from "./log";
export { Settings } from "./Settings";
export const unloads = new Set<LunaUnload>();

setupQueue(unloads);
setupPlayer(unloads);
setupSidebar(unloads);
