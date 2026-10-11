import { Tracer, type LunaUnload } from "@luna/core";

export const { trace, errSignal } = Tracer("[Comité]");
export const unloads = new Set<LunaUnload>();
