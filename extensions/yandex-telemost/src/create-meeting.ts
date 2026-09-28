import { Clipboard, getPreferenceValues, open, showHUD, showToast, Toast } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";

const TELEMOST_URL = "https://telemost.yandex.ru";
const MEETING_PATH_PREFIX = "/j/";
const MEETING_RESULT_PREFIX = "meeting:";
const CLICKED_RESULT_PREFIX = "clicked:";
const WAITING_RESULT_PREFIX = "waiting:";

// Single JS payload: detects success URL or clicks the best "create meeting" control.
// Returns "meeting:<url>", "clicked:<label>", "pending:<label>" (recently clicked, give the page time)
// or "waiting:<visible button labels>".
// NOTE: newlines are collapsed to spaces before sending, so no `//` comments inside the payload.
const CHECK_AND_CLICK_JS = `
(function() {
  if (location.pathname.indexOf('${MEETING_PATH_PREFIX}') === 0) {
    return '${MEETING_RESULT_PREFIX}' + location.href;
  }
  var EXCLUDE = /трансляц|эфир|стрим|запланир|календар|расписан|подключ|присоедин|войти|вход|скачать|приложени/;
  var norm = function(s) { return (s || '').replace(/\\s+/g, ' ').trim().toLowerCase(); };
  var usable = function(el) {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.pointerEvents !== 'none';
  };
  var score = function(el, label) {
    if (EXCLUDE.test(label)) return 0;
    var role = el.getAttribute('role') || '';
    var inPopup = role.indexOf('menuitem') === 0 || role === 'option' ||
      !!el.closest('[role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"]');
    if (inPopup && /встреч/.test(label)) return 100;
    if (/^(создать|начать|новая|новую) (видео)?встреч/.test(label)) return 90;
    if (label === 'создать') return 80;
    if (label.indexOf('создать') === 0) return 50;
    return 0;
  };
  var fire = function(el, full) {
    el.scrollIntoView({ block: 'center' });
    if (!full) { el.click(); return; }
    var r = el.getBoundingClientRect();
    var o = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      pointerId: 1, pointerType: 'mouse', isPrimary: true };
    try { el.dispatchEvent(new PointerEvent('pointerdown', o)); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mousedown', o));
    try { el.dispatchEvent(new PointerEvent('pointerup', o)); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
  };
  var nodes = Array.from(document.querySelectorAll(
    'button, a, [role="button"], [role="link"], [role^="menuitem"], [role="option"]'));
  var best = null, bestScore = 0, bestLabel = '', seen = [];
  nodes.forEach(function(el) {
    if (!usable(el)) return;
    var label = norm(el.innerText) || norm(el.getAttribute('aria-label')) || norm(el.getAttribute('title'));
    if (!label) return;
    if (seen.length < 12 && seen.indexOf(label) === -1) seen.push(label.slice(0, 40));
    var s = score(el, label);
    if (s > bestScore) { best = el; bestScore = s; bestLabel = label; }
  });
  if (!best) return '${WAITING_RESULT_PREFIX}' + seen.join(' | ');
  var st = window.__raycastTelemost || (window.__raycastTelemost = {});
  var key = bestScore + '|' + bestLabel;
  var rec = st[key] || (st[key] = { at: 0, n: 0 });
  if (Date.now() - rec.at < 2500) return 'pending:' + bestLabel;
  rec.at = Date.now();
  rec.n += 1;
  fire(best, rec.n % 2 === 0);
  return '${CLICKED_RESULT_PREFIX}' + bestLabel;
})()
`.trim();

type BrowserFamily = "chromium" | "safari";

// Known Safari-family apps; everything else defaults to Chromium syntax (covers 95%+ of browsers)
const SAFARI_FAMILY = new Set(["Safari", "Safari Technology Preview"]);

function detectBrowserFamily(browser: string): BrowserFamily {
  return SAFARI_FAMILY.has(browser) ? "safari" : "chromium";
}

function escapeForAppleScript(js: string): string {
  return js.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

function getRunJsScript(browser: string, family: BrowserFamily, js: string): string {
  const escaped = escapeForAppleScript(js);
  if (family === "safari") {
    return `tell application "${browser}" to return (do JavaScript "${escaped}" in current tab of front window) as string`;
  }
  return `tell application "${browser}" to return (execute active tab of front window javascript "${escaped}") as string`;
}

async function getFrontmostApp(): Promise<string> {
  return (
    await runAppleScript(`
    tell application "System Events"
      return name of first application process whose frontmost is true
    end tell
  `)
  ).trim();
}

async function refocusApp(appName: string): Promise<void> {
  await runAppleScript(`
    tell application "System Events"
      set frontmost of first application process whose name is "${appName}" to true
    end tell
  `);
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export async function createMeeting(refocus: boolean): Promise<void> {
  const { browser: preferredBrowserApp } = getPreferenceValues<Preferences>();

  // Save the app to return to before opening the browser.
  // Skip if Raycast itself is frontmost — refocusing Raycast (which is already closed) is a no-op
  // and would not restore the user's actual previous context.
  let previousApp: string | null = null;
  if (refocus) {
    const frontmost = await getFrontmostApp();
    if (frontmost && frontmost !== "Raycast") {
      previousApp = frontmost;
    }
  }

  const toast = await showToast({ style: Toast.Style.Animated, title: "Opening Telemost…" });

  // Pass the Application object directly so Raycast uses the correct app
  await open(TELEMOST_URL, preferredBrowserApp ?? undefined);

  // For AppleScript we need the app name — use the configured browser when available,
  // otherwise detect from frontmost after a short wait for the browser to come to front
  let browser: string;
  if (preferredBrowserApp?.name) {
    browser = preferredBrowserApp.name;
  } else {
    await sleep(500);
    browser = await getFrontmostApp();
  }
  const family = detectBrowserFamily(browser);

  toast.message = "Creating meeting…";

  // Unified polling loop: each iteration either detects the meeting URL or
  // clicks the create button. Handles every state in one AppleScript call.
  const deadline = Date.now() + 30_000;
  let clicked = false;
  let lastClickedLabel = "";
  let lastSeenButtons = "";

  // Track the initial /j/ URL (if any) so we can ignore it — it represents a meeting
  // the user already had open, not the one we're creating now.
  let staleUrl: string | null = null;

  while (Date.now() < deadline) {
    try {
      const result = (await runAppleScript(getRunJsScript(browser, family, CHECK_AND_CLICK_JS))).trim();

      if (result.startsWith(MEETING_RESULT_PREFIX)) {
        const url = result.slice(MEETING_RESULT_PREFIX.length);
        // Accept only if we either clicked the button or the URL changed from the stale one.
        // Otherwise this is just a pre-existing meeting tab we shouldn't claim as ours.
        if (clicked || (staleUrl !== null && url !== staleUrl)) {
          await Promise.all([
            Clipboard.copy(url),
            previousApp ? refocusApp(previousApp).catch(() => undefined) : Promise.resolve(),
          ]);
          await showHUD("✓ Meeting created — URL copied to clipboard");
          return;
        }
        if (staleUrl === null) {
          staleUrl = url;
        }
      } else if (result.startsWith(CLICKED_RESULT_PREFIX)) {
        clicked = true;
        lastClickedLabel = result.slice(CLICKED_RESULT_PREFIX.length);
        toast.title = "Waiting for meeting…";
        toast.message = `Clicked “${lastClickedLabel}”`;
      } else if (result.startsWith(WAITING_RESULT_PREFIX)) {
        lastSeenButtons = result.slice(WAITING_RESULT_PREFIX.length);
      }
    } catch (e) {
      const msg = String(e);
      if (
        msg.includes("AppleScript is turned off") ||
        msg.includes("JavaScript from Apple Events") ||
        msg.includes("must enable")
      ) {
        const instruction =
          family === "safari"
            ? `Safari Settings → Advanced → enable "Show features for web developers", then Develop → Allow JavaScript from Apple Events`
            : `${browser}: View → Developer → Allow JavaScript from Apple Events, then restart ${browser}`;
        toast.style = Toast.Style.Failure;
        toast.title = "Enable JavaScript from Apple Events";
        toast.message = instruction;
        toast.primaryAction = { title: "Got it", onAction: () => toast.hide() };
        return;
      }
      if (msg.includes("isn't going to do it") || msg.includes("doesn't understand") || msg.includes("Expected end")) {
        toast.style = Toast.Style.Failure;
        toast.title = "Browser not supported";
        toast.message = `"${browser}" doesn't support the required AppleScript commands.`;
        return;
      }
      // Other errors (page not ready, etc.) — keep polling
    }
    await sleep(300);
  }

  toast.style = Toast.Style.Failure;
  toast.title = "Timeout";
  toast.message = clicked
    ? `Clicked “${lastClickedLabel}” but no meeting link appeared — finish manually`
    : `Couldn't find the create-meeting button${lastSeenButtons ? ` (seen: ${lastSeenButtons})` : ""}`;
}
