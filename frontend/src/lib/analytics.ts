/**
 * Privacy-friendly analytics. No npm deps.
 * Set VITE_PLAUSIBLE_DOMAIN and/or VITE_POSTHOG_KEY (+ optional VITE_POSTHOG_HOST).
 */

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Record<string, string | number | boolean> }) => void
    posthog?: {
      capture: (event: string, props?: Record<string, unknown>) => void
      init?: (key: string, opts?: Record<string, unknown>) => void
    }
  }
}

let booted = false

export function initAnalytics(): void {
  if (booted || typeof document === 'undefined') return
  booted = true

  const plausibleDomain = (import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined)?.trim()
  if (plausibleDomain) {
    const s = document.createElement('script')
    s.defer = true
    s.dataset.domain = plausibleDomain
    s.src = 'https://plausible.io/js/script.js'
    document.head.appendChild(s)
  }

  const posthogKey = (import.meta.env.VITE_POSTHOG_KEY as string | undefined)?.trim()
  if (posthogKey) {
    const host =
      (import.meta.env.VITE_POSTHOG_HOST as string | undefined)?.trim() ||
      'https://us.i.posthog.com'
    const boot = document.createElement('script')
    boot.innerHTML = `
      !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
      posthog.init(${JSON.stringify(posthogKey)},{api_host:${JSON.stringify(host)},person_profiles:'identified_only'});
    `
    document.head.appendChild(boot)
  }
}

export function trackEvent(name: string, props?: Record<string, string | number | boolean>): void {
  try {
    window.plausible?.(name, props ? { props } : undefined)
  } catch {
    /* ignore */
  }
  try {
    window.posthog?.capture(name, props)
  } catch {
    /* ignore */
  }
}
