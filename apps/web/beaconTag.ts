import { loadEnv, type Plugin } from "vite";

/**
 * Slice 15a: adds the loader tag for the Cloudflare Web Analytics beacon, only in production builds that have
 * VITE_CF_BEACON_TOKEN set (a public value). Dev, tests and token-less builds get no tag.
 */
export function beaconTag(): Plugin {
  let token = "";
  let build = false;
  return {
    name: "atlas-beacon-tag",
    configResolved(config) {
      build = config.command === "build" && config.mode === "production";
      token = (loadEnv(config.mode, config.envDir || config.root, "VITE_").VITE_CF_BEACON_TOKEN ?? "").trim();
      if (build && token && !/^[A-Za-z0-9]{16,64}$/.test(token)) {
        throw new Error("VITE_CF_BEACON_TOKEN must be alphanumeric (the Cloudflare Web Analytics site token)");
      }
    },
    transformIndexHtml: {
      order: "post",
      handler() {
        if (!build || !token) return [];
        return [{ tag: "script", attrs: { defer: true, src: "/beacon-loader.js", "data-atlas-beacon": token }, injectTo: "head" }];
      },
    },
  };
}
