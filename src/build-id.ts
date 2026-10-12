declare const __BUILD_ID__: string | undefined;

/** Identifies the exact build in every metric row, so a phone log can be matched to a commit. Set by vite.config.ts. */
export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
