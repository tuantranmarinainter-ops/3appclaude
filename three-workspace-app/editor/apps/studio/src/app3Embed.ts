/**
 * Single source for the App 3 (Animation Studio) copy that App 2 embeds from
 * `public/animation-studio/v<version>/`. Roll back by changing APP3_EMBED_VERSION
 * to an older folder that is still present (e.g. '1.33.0').
 *
 * App 3 is GPL-3.0 and runs only inside the iframe; App 2 talks to it through
 * postMessage and the injected host-bridge.js — never import App 3 code here.
 */
export const APP3_EMBED_VERSION = '1.34.0'
export const APP3_FRAME_URL = `/animation-studio/v${APP3_EMBED_VERSION}/index.html`
export const APP3_BRIDGE_URL = `/animation-studio/v${APP3_EMBED_VERSION}/host-bridge.js`
export const APP3_TITLE = `Animation Studio ${APP3_EMBED_VERSION}`

/**
 * Bridge protocol id, not the build version: App 3's `src/host_bridge.js` uses the
 * same string. Change it only when the message protocol changes, and on both sides.
 */
export const APP3_BRIDGE_CHANNEL = 'bbs-animation-studio-v1.33.0'
