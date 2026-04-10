/**
 * Anti-bot detection for mobile cricket game.
 * Tracks touch fingerprints, timing entropy, device motion, and automation signals.
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

// ── Touch Fingerprint Analysis ───────────────────────────────
interface TouchSample {
  timestamp: number;
  radiusX: number;
  radiusY: number;
  force: number;
  x: number;
  y: number;
  pointerType: string;
}

const MAX_SAMPLES = 30;

export class TouchAnalyzer {
  private samples: TouchSample[] = [];
  private tapTimestamps: number[] = [];

  /** Record a pointer event. Call on every pointerDown and pointerUp. */
  recordTouch(e: PointerEvent | React.PointerEvent): void {
    this.samples.push({
      timestamp: performance.now(),
      radiusX: (e as any).radiusX ?? (e as any).width ?? 0,
      radiusY: (e as any).radiusY ?? (e as any).height ?? 0,
      force: (e as any).pressure ?? (e as any).force ?? 0,
      x: e.clientX,
      y: e.clientY,
      pointerType: e.pointerType,
    });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  /** Record a tap (swing) timestamp for timing entropy analysis. */
  recordTap(): void {
    this.tapTimestamps.push(performance.now());
    if (this.tapTimestamps.length > MAX_SAMPLES) this.tapTimestamps.shift();
  }

  /** Returns a bot confidence score from 0 (human) to 1 (definitely bot). */
  getBotScore(): number {
    if (this.samples.length < 4) return 0; // not enough data yet

    let flags = 0;
    let totalChecks = 0;

    // ── Check 1: Touch radius variety ────────────────────────
    // Real fingers produce varying radiusX/radiusY values.
    // Synthetic events produce 0 or identical values.
    totalChecks++;
    const radii = this.samples.map(s => s.radiusX + s.radiusY);
    const uniqueRadii = new Set(radii.map(r => r.toFixed(1)));
    if (uniqueRadii.size <= 1) flags++; // all identical = suspicious

    // ── Check 2: All zero radius/force ───────────────────────
    // Programmatic PointerEvents have 0 radius and 0 pressure.
    totalChecks++;
    const allZeroRadius = this.samples.every(s => s.radiusX === 0 && s.radiusY === 0);
    if (allZeroRadius) flags++;

    totalChecks++;
    const allZeroForce = this.samples.every(s => s.force === 0);
    // On some devices force is always 0 for touch, so weight this less
    if (allZeroForce && allZeroRadius) flags++;

    // ── Check 3: Coordinate variance ─────────────────────────
    // Real taps land at slightly different spots. Bot taps can be pixel-perfect.
    totalChecks++;
    const xs = this.samples.map(s => s.x);
    const ys = this.samples.map(s => s.y);
    const xVariance = variance(xs);
    const yVariance = variance(ys);
    // If all taps land within ~2px of each other across 4+ samples
    if (xVariance < 2 && yVariance < 2 && this.samples.length >= 6) flags++;

    // ── Check 4: Pointer type consistency ────────────────────
    // Mobile should be "touch". Bots often use "mouse" on mobile user agents.
    totalChecks++;
    const mouseOnly = this.samples.every(s => s.pointerType === 'mouse');
    const isMobileUA = /Mobile|Android|iPhone/i.test(navigator.userAgent);
    if (mouseOnly && isMobileUA && this.samples.length >= 4) flags++;

    // ── Check 5: Timing entropy ──────────────────────────────
    // Measure intervals between taps. Humans have high variance, bots are robotic.
    if (this.tapTimestamps.length >= 4) {
      totalChecks++;
      const intervals: number[] = [];
      for (let i = 1; i < this.tapTimestamps.length; i++) {
        intervals.push(this.tapTimestamps[i] - this.tapTimestamps[i - 1]);
      }
      const iv = variance(intervals);
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      // Coefficient of variation — humans typically > 0.15, bots < 0.05
      const cv = mean > 0 ? Math.sqrt(iv) / mean : 0;
      if (cv < 0.03 && intervals.length >= 3) flags++;

      // Also flag superhuman reaction times (< 80ms between actions consistently)
      totalChecks++;
      const superFast = intervals.filter(i => i < 80).length;
      if (superFast > intervals.length * 0.5) flags++;
    }

    return Math.min(1, flags / Math.max(1, totalChecks * 0.5));
  }

  reset(): void {
    this.samples = [];
    this.tapTimestamps = [];
  }
}

// ── Device Motion Check ──────────────────────────────────────
export class DeviceMotionChecker {
  private hasMotion = false;
  private listener: ((e: DeviceMotionEvent) => void) | null = null;

  start(): void {
    if (this.listener) return;
    this.listener = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (a && (a.x !== null || a.y !== null || a.z !== null)) {
        this.hasMotion = true;
      }
    };
    window.addEventListener('devicemotion', this.listener);
  }

  stop(): void {
    if (this.listener) {
      window.removeEventListener('devicemotion', this.listener);
      this.listener = null;
    }
  }

  /** Returns true if real device motion was detected. */
  hasRealMotion(): boolean {
    return this.hasMotion;
  }

  reset(): void {
    this.hasMotion = false;
  }
}

// ── Helpers ──────────────────────────────────────────────────
function variance(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return nums.reduce((sum, n) => sum + (n - mean) ** 2, 0) / nums.length;
}

// ── Combined Anti-Bot Guard ──────────────────────────────────
// Bot score threshold — above this, the game considers the player a bot.
const BOT_THRESHOLD = 0.5;

export class AntiBotGuard {
  touchAnalyzer = new TouchAnalyzer();
  motionChecker = new DeviceMotionChecker();
  private automationDetected = false;

  init(): void {
    this.automationDetected = detectAutomation();
    this.motionChecker.start();
  }

  destroy(): void {
    this.motionChecker.stop();
  }

  reset(): void {
    this.touchAnalyzer.reset();
    this.motionChecker.reset();
    // Re-check automation on reset since page state might change
    this.automationDetected = detectAutomation();
  }

  /** Returns true if the player is likely a bot. */
  isBot(): boolean {
    if (this.automationDetected) return true;
    return this.touchAnalyzer.getBotScore() >= BOT_THRESHOLD;
  }

  /** Returns a detailed breakdown for debugging. */
  getDebugInfo(): { automationDetected: boolean; touchBotScore: number; hasDeviceMotion: boolean } {
    return {
      automationDetected: this.automationDetected,
      touchBotScore: this.touchAnalyzer.getBotScore(),
      hasDeviceMotion: this.motionChecker.hasRealMotion(),
    };
  }
}
