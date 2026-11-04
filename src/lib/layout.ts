/** 版面斷點（issue #12）：≥ 960px 用平板／桌面版面；< 960px 維持手機版面。 */
const MQ = typeof matchMedia === "function" ? matchMedia("(min-width: 960px)") : null;
export const wide = () => !!MQ?.matches;
export const onWideChange = (f: () => void) => MQ?.addEventListener?.("change", f);
