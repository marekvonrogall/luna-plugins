import { redux } from "@luna/lib";

export const navigate = (pathname: string) => redux.actions["router/PUSH"]({ pathname, search: "", replace: false });
