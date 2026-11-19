// Asks the Focus desktop app whether a focus session is running and, if so,
// replaces tabs with blocked sites by the "back to work" page.
const STATE = 'http://127.0.0.1:47600/state';
const PAGE = chrome.runtime.getURL('blocked.html');

async function getState() {
  try { return await (await fetch(STATE, { cache: 'no-store' })).json(); }
  catch (e) { return { active: false, sites: [] }; } // desktop app is not running — block nothing
}
function isBlocked(url, sites) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.replace(/^www\./, '');
    return sites.some(s => host === s || host.endsWith('.' + s));
  } catch (e) { return false; }
}
function check(tab, st) {
  if (st.active && tab.url && isBlocked(tab.url, st.sites || []))
    chrome.tabs.update(tab.id, { url: PAGE + '?u=' + encodeURIComponent(tab.url) });
}
async function sweep() {
  const st = await getState();
  if (st.active) for (const tab of await chrome.tabs.query({})) check(tab, st);
}
const arm = () => { chrome.alarms.create('sweep', { periodInMinutes: 0.5 }); sweep(); };

chrome.runtime.onInstalled.addListener(arm);
chrome.runtime.onStartup.addListener(arm);
chrome.alarms.onAlarm.addListener(sweep);
chrome.tabs.onUpdated.addListener(async (id, info, tab) => { if (info.url) check(tab, await getState()); });
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try { check(await chrome.tabs.get(tabId), await getState()); } catch (e) {}
});
