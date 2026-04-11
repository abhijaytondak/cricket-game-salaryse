/**
 * Anti-bot detection for mobile cricket game.
 * Detects automation tools (Selenium, Puppeteer, headless browsers, etc.)
 */

// ── Automation Detection ─────────────────────────────────────
export function detectAutomation(): boolean {
  const nav = navigator as any;
  // WebDriver flag (Selenium, Puppeteer, Playwright)
  if (nav.webdriver) return true;
  // Headless Chrome indicators
  if (/HeadlessChrome/.test(navigator.userAgent)) return true;
  // PhantomJS
  if ((window as any).__phantom || (window as any)._phantom) return true;
  // Missing touch support on a "mobile" user agent
  if (/Mobile|Android|iPhone/i.test(navigator.userAgent) && !('ontouchstart' in window)) return true;
  // Puppeteer-specific
  if ((window as any).__puppeteer_evaluation_script__) return true;
  // Chrome DevTools protocol automation
  if (nav.plugins?.length === 0 && /Chrome/.test(navigator.userAgent)) return true;
  return false;
}

// ── Anti-Bot Guard ───────────────────────────────────────────
export class AntiBotGuard {
  private automationDetected = false;

  init(): void {
    this.automationDetected = detectAutomation();
  }

  destroy(): void {}

  reset(): void {
    this.automationDetected = detectAutomation();
  }

  /** Returns true if the player is likely a bot. */
  isBot(): boolean {
    return this.automationDetected;
  }
}
