import type { LunaUnload } from "@luna/core";

import { watchCompact } from "./compact";
import { setupHeader } from "./header";
import { setupPlayer } from "./player";
import { setupBar } from "./player/bar";
import { setupPinnedCover } from "./player/cover";
import { setupQueue } from "./queue";
import { setupSidebar } from "./sidebar";
import { setupPinnedSidebar } from "./sidebar/pin";

export { errSignal, trace } from "./log";
export { Settings } from "./Settings";
export const unloads = new Set<LunaUnload>();

watchCompact(unloads);
setupQueue(unloads);
setupPlayer(unloads);
setupBar(unloads);
setupPinnedCover(unloads);
setupSidebar(unloads);
setupHeader(unloads);
setupPinnedSidebar(unloads);
