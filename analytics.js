window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
window.gtag('js', new Date());
window.gtag('config', 'G-EWZT9328LS');

window.trackEvent = function trackEvent(name, parameters) {
  window.gtag('event', name, parameters || {});
};
