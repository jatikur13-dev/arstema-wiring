import {createWiringApp} from '@arstema/wiring/browser';import '@arstema/wiring/browser.css';
const app=createWiringApp(document.getElementById('wiring'),{namespace:'arstema:javascript-example',onError:console.error});let active=true;
document.getElementById('pause').onclick=()=>app.setActive(active=!active);
// A BFCache page may return without re-running this module. Keep its instance;
// the editor pauses on visibility loss and flushes state on pagehide itself.
// In an SPA, call app.destroy() when the route is actually removed.
