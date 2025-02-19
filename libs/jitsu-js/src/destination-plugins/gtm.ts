import { loadScript } from "../script-loader";
import { AnalyticsClientEvent } from "@jitsu/protocols/analytics";
import { applyFilters, CommonDestinationCredentials, InternalPlugin } from "./index";

const defaultScriptSrc = "https://www.googletagmanager.com/gtag/js";

export type GtmDestinationCredentials = {
  debug?: boolean;
  containerId?: string;
  dataLayerName?: string;
  preview?: string;
  auth?: string;
  customScriptSrc?: string;
} & CommonDestinationCredentials;

export const gtmPlugin: InternalPlugin<GtmDestinationCredentials> = {
  id: "gtm",
  async handle(config, payload: AnalyticsClientEvent) {
    if (!applyFilters(payload, config)) {
      return;
    }
    await initGtmIfNeeded(config, payload);

    const dataLayer = window[config.dataLayerName || "dataLayer"];
    const ids = {
      ...(payload.userId ? { user_id: payload.userId, userId: payload.userId } : {}),
      ...(payload.anonymousId ? { anonymousId: payload.anonymousId } : {}),
    };
    switch (payload.type) {
      case "page":
        const { properties: pageProperties, context } = payload;
        const pageEvent = {
          event: "page_view",
          page_location: pageProperties.url,
          page_title: pageProperties.title,
          page_path: pageProperties.path,
          page_hash: pageProperties.hash,
          page_search: pageProperties.search,
          page_referrer: context?.page?.referrer ?? "",
          ...ids,
        };
        dataLayer.push(pageEvent);
        break;
      case "track":
        const { properties: trackProperties } = payload;
        const trackEvent: any = {
          event: payload.event,
          ...trackProperties,
          ...ids,
        };
        dataLayer.push(trackEvent);
        break;
      case "identify":
        const { traits } = payload;
        const identifyEvent: any = {
          event: "identify",
          ...traits,
          ...ids,
        };
        dataLayer.push(identifyEvent);
        break;
    }
    dataLayer.push(function () {
      this.reset();
    });
  },
};

type GtmState = "fresh" | "loading" | "loaded" | "failed";

function getGtmState(): GtmState {
  return window["__jitsuGtmState"] || "fresh";
}

function setGtmState(s: GtmState) {
  window["__jitsuGtmState"] = s;
}

async function initGtmIfNeeded(config: GtmDestinationCredentials, payload: AnalyticsClientEvent) {
  if (getGtmState() !== "fresh") {
    return;
  }
  setGtmState("loading");

  const dlName = config.dataLayerName || "dataLayer";
  const dlParam = dlName !== "dataLayer" ? "&l=" + dlName : "";
  const previewParams = config.preview
    ? `&gtm_preview=${config.preview}&gtm_auth=${config.auth}&gtm_cookies_win=x`
    : "";
  const tagId = config.containerId;
  const scriptSrc = `${config.customScriptSrc || defaultScriptSrc}?id=${tagId}${dlParam}${previewParams}`;

  window[dlName] = window[dlName] || [];
  const gtag = function () {
    window[dlName].push(arguments);
  };
  window[dlName].push({
    user_id: payload.userId,
  });
  // @ts-ignore
  gtag("js", new Date());
  // @ts-ignore
  gtag("config", tagId);

  loadScript(scriptSrc)
    .then(() => {
      setGtmState("loaded");
    })
    .catch(e => {
      console.warn(`GTM (containerId=${tagId}) init failed: ${e.message}`, e);
      setGtmState("failed");
    });
}
