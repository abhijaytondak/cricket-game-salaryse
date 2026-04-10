/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react';
import { Trophy, RotateCcw, Play, Home, Volume2, VolumeX, MoveHorizontal, MousePointerClick } from 'lucide-react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'motion/react';
import { AntiBotGuard } from './antiBot';

const GameScene = lazy(() => import('./Scene3D').then(m => ({ default: m.GameScene })));

// ── Constants ──────────────────────────────────────────────
const HIT_ZONE_START = 430;
const HIT_ZONE_END = 570;
const HIT_ZONE_CENTER = 500;
const CANVAS_WIDTH = 400;
const MAX_BALLS = 6;
const BALL_NEXT_DELAY = 1500;
const WICKET_END_DELAY = 1000;
const SWING_DURATION = 200;
const BAT_MIN_X = 140;
const BAT_MAX_X = 260;
const BAT_HIT_RANGE = 15;
const STUMP_HIT_RANGE = 15;
const BALL_MIN_X = 165;
const BALL_MAX_X = 235;
const TARGET_FRAME_MS = 1000 / 60;

// Ball delivery types
type DeliveryType = 'pace' | 'yorker' | 'bouncer' | 'offbreak' | 'legbreak' | 'slower' | 'inswingh' | 'outswingh';

interface DeliveryConfig {
  speed: number; curve: number; startX: number; label: string;
}

function pickDelivery(ballNumber: number): DeliveryConfig {
  // 3 balls are easy sixer deliveries (balls 0, 2, 4 — 1st, 3rd, 5th)
  const isSixerBall = (ballNumber === 0 || ballNumber === 2 || ballNumber === 4);
  // Last ball targets stumps
  const onStumps = (ballNumber === 5);

  const pool: { type: DeliveryType; weight: number }[] = [
    { type: 'pace', weight: 20 },
    { type: 'yorker', weight: 12 + ballNumber * 3 },
    { type: 'bouncer', weight: 8 + ballNumber * 2 },
    { type: 'offbreak', weight: 10 },
    { type: 'legbreak', weight: 10 },
    { type: 'slower', weight: 8 },
    { type: 'inswingh', weight: 10 },
    { type: 'outswingh', weight: 10 },
  ];
  const totalWeight = pool.reduce((s, p) => s + p.weight, 0);
  let rand = Math.random() * totalWeight;
  let chosen: DeliveryType = 'pace';
  for (const p of pool) { rand -= p.weight; if (rand <= 0) { chosen = p.type; break; } }

  let d: DeliveryConfig;
  switch (chosen) {
    case 'pace': d = { speed: 4.5 + Math.random() * 1.5, curve: (Math.random() - 0.5) * 0.4, startX: 190 + Math.random() * 20, label: 'Pace' }; break;
    case 'yorker': d = { speed: 5.0 + Math.random() * 1.5, curve: (Math.random() - 0.5) * 0.15, startX: 193 + Math.random() * 14, label: 'Yorker' }; break;
    case 'bouncer': d = { speed: 4.8 + Math.random() * 1.5, curve: (Math.random() > 0.5 ? 1 : -1) * (0.2 + Math.random() * 0.2), startX: 190 + Math.random() * 20, label: 'Bouncer' }; break;
    case 'offbreak': d = { speed: 3.5 + Math.random() * 1.0, curve: 0.35 + Math.random() * 0.25, startX: 185 + Math.random() * 15, label: 'Off Break' }; break;
    case 'legbreak': d = { speed: 3.5 + Math.random() * 1.0, curve: -(0.35 + Math.random() * 0.25), startX: 200 + Math.random() * 15, label: 'Leg Break' }; break;
    case 'slower': d = { speed: 3.0 + Math.random() * 1.0, curve: (Math.random() - 0.5) * 0.3, startX: 190 + Math.random() * 20, label: 'Slower Ball' }; break;
    case 'inswingh': d = { speed: 4.2 + Math.random() * 1.2, curve: 0.25 + Math.random() * 0.2, startX: 185 + Math.random() * 12, label: 'Inswinger' }; break;
    case 'outswingh': d = { speed: 4.2 + Math.random() * 1.2, curve: -(0.25 + Math.random() * 0.2), startX: 200 + Math.random() * 12, label: 'Outswinger' }; break;
    default: d = { speed: 6.0 + Math.random() * 1.5, curve: (Math.random() - 0.5) * 0.35, startX: 190 + Math.random() * 20, label: 'Pace' }; break;
  }

  if (isSixerBall) {
    // Easy sixer: slow, straight, right in the sweet spot
    d.startX = 198 + Math.random() * 4; // dead center
    d.curve = (Math.random() - 0.5) * 0.04; // barely moves
    d.speed = 3.0 + Math.random() * 0.8; // slow but not too slow
  }

  if (onStumps) {
    d.startX = 197 + Math.random() * 6; // dead on stumps
    d.curve = (Math.random() - 0.5) * 0.08; // stays straight
  }

  return d;
}

const POPUP_DURATIONS: Record<string, number> = {
  'SIX!': 1100, 'FOUR!': 800, '+3': 650, '+2': 600, '+1': 500, 'MISS': 500, 'BOWLED!': 1200,
};

// ── Types ──────────────────────────────────────────────────
interface Ball {
  x: number; y: number; radius: number;
  speed: number; active: boolean; curve: number; hasSwung: boolean;
  processed: boolean; // #3.2: guard against double-fire
  bounceX: number; // x position where ball will bounce on the pitch
}

// Cricket shot types for realistic bat swing animations
type ShotType = 'straight' | 'cover' | 'pull' | 'sweep' | 'uppercut' | 'flick' | 'defend';

const SHOT_TYPES: ShotType[] = ['straight', 'cover', 'pull', 'sweep', 'uppercut', 'flick', 'defend'];

function pickShot(points: number): ShotType {
  if (points === 6) {
    // Big shots for sixes
    const pool: ShotType[] = ['uppercut', 'pull', 'straight', 'flick'];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  if (points === 4) {
    // Drives and pulls for fours
    const pool: ShotType[] = ['cover', 'straight', 'pull', 'flick'];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  if (points >= 1) {
    // Controlled shots for singles/doubles/triples
    const pool: ShotType[] = ['defend', 'flick', 'cover', 'straight'];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  // Miss / 0 — defensive poke
  return 'defend';
}

interface GameState {
  score: number; ballsPlayed: number;
  isGameOver: boolean; gameStarted: boolean;
  batX: number; targetBatX: number;
  isSwinging: boolean; isMuted: boolean;
  activePointerId: number | null;
  shotType: ShotType; // which swing animation to play
}

type BallResult = { runs: number; isWicket: boolean };

// ── Helpers ────────────────────────────────────────────────
function safeGetItem(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSetItem(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

// ── Ball Tracker ───────────────────────────────────────────
function BallTracker({ results, total }: { results: BallResult[]; total: number }) {
  const balls = [];
  for (let i = 0; i < total; i++) {
    const r = results[i];
    let bg = 'transparent', text = '', textColor = '#374151', border = '1px dashed #374151', extra = '';
    if (r) {
      if (r.isWicket) { bg = '#7F1D1D'; textColor = '#EF4444'; text = 'W'; border = 'none'; }
      else if (r.runs === 6) { bg = '#713F12'; textColor = '#FFD700'; text = '6'; border = '1px solid #F5A623'; extra = 'tracker-six-glow'; }
      else if (r.runs === 4) { bg = '#064E3B'; textColor = '#4ADE80'; text = '4'; border = 'none'; }
      else if (r.runs === 0) { bg = '#1a1a2e'; textColor = '#9CA3AF'; text = '0'; border = '1px solid #4B5563'; }
      else { bg = '#1E3A5F'; textColor = '#38BDF8'; text = String(r.runs); border = 'none'; }
    }
    balls.push(
      <motion.div key={i}
        initial={r ? { scale: 0, opacity: 0 } : false}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 20 }}
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold select-none ${extra}`}
        style={{ background: bg, color: textColor, border, lineHeight: 1 }}
      >{text}</motion.div>
    );
  }
  return <div className="flex gap-1.5 items-center">{balls}</div>;
}

// ── Animated Score ─────────────────────────────────────────
function AnimatedScore({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v));
  const [display, setDisplay] = useState(0);
  useEffect(() => { const c = animate(mv, value, { duration: 0.4, ease: 'easeOut' }); return c.stop; }, [value, mv]);
  useEffect(() => { const u = rounded.on('change', (v) => setDisplay(v)); return u; }, [rounded]);
  return (
    <AnimatePresence mode="popLayout">
      <motion.span key={display}
        initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}
        className="inline-block tabular-nums">{display}</motion.span>
    </AnimatePresence>
  );
}

// ── Count-Up Score (Game Over) ─────────────────────────────
function CountUpScore({ target }: { target: number }) {
  const [display, setDisplay] = useState(0);
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v));
  useEffect(() => { const c = animate(mv, target, { duration: 0.8, ease: 'easeOut', delay: 0.2 }); return c.stop; }, [target, mv]);
  useEffect(() => { const u = rounded.on('change', (v) => setDisplay(v)); return u; }, [rounded]);
  return <div className="text-[72px] font-black leading-none tabular-nums tracking-tight">{display}</div>;
}

// ── Main App ───────────────────────────────────────────────
export default function App() {
  const [score, setScore] = useState(0);
  const [ballsPlayed, setBallsPlayed] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    const s = safeGetItem('cricketHighScore'); return s ? parseInt(s, 10) : 0;
  });
  const [isGameOver, setIsGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [message, setMessage] = useState({ text: '', color: '', id: 0 });
  const [isSwinging, setIsSwinging] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [ballResults, setBallResults] = useState<BallResult[]>([]);

  const sounds = useRef<{ [key: string]: HTMLAudioElement }>({});
  const messageIdRef = useRef(0);
  const pendingTimeouts = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const highScoreRef = useRef(highScore); // #3.5: ref for highScore

  // Refs shared with 3D scene
  const ballRef = useRef<Ball>({ x: 200, y: 50, radius: 6, speed: 0, active: false, curve: 0, hasSwung: false, processed: false, bounceX: 200 });
  const gameStateRef = useRef<GameState>({
    score: 0, ballsPlayed: 0, isGameOver: false, gameStarted: false,
    batX: 200, targetBatX: 200, isSwinging: false, isMuted: false, activePointerId: null, shotType: 'straight' as ShotType,
  });
  const crowdEnergyRef = useRef(0);
  const celebrationTypeRef = useRef<'six' | 'four' | 'wicket' | null>(null);
  const shakeActiveRef = useRef(false);
  // #1.2: Shared keyboard state read by main loop (no separate rAF)
  const keysDownRef = useRef(new Set<string>());

  // ── Anti-bot guard ────────────────────────────────────────
  const antiBotRef = useRef(new AntiBotGuard());
  useEffect(() => {
    antiBotRef.current.init();
    return () => antiBotRef.current.destroy();
  }, []);

  // #3.5: Keep highScoreRef in sync
  useEffect(() => { highScoreRef.current = highScore; }, [highScore]);

  // ── Timeout management ─────────────────────────────────
  const managedTimeout = useCallback((fn: () => void, delay: number) => {
    const id = setTimeout(() => { pendingTimeouts.current.delete(id); fn(); }, delay);
    pendingTimeouts.current.add(id);
    return id;
  }, []);
  const clearAllTimeouts = useCallback(() => {
    pendingTimeouts.current.forEach(id => clearTimeout(id));
    pendingTimeouts.current.clear();
  }, []);

  // ── Sound ──────────────────────────────────────────────
  const bgCrowdRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    sounds.current = {
      batHit: new Audio('/sounds/bat-hit.mp3'),
      cheer: new Audio('/sounds/crowd-cheer.mp3'),
      bigCheer: new Audio('/sounds/crowd-cheer.mp3'),
      wicket: new Audio('/sounds/out.mp3'),
      miss: new Audio('/sounds/bat-hit.mp3'),
    };
    Object.values(sounds.current).forEach(a => { (a as HTMLAudioElement).load(); });

    // Background crowd ambient — loops continuously
    const bgCrowd = new Audio('/sounds/bg-crowd.mp3');
    bgCrowd.loop = true;
    bgCrowd.volume = 0.06;
    bgCrowd.load();
    bgCrowdRef.current = bgCrowd;

    // Stop ALL audio on unmount / page close
    const stopAll = () => {
      bgCrowd.pause(); bgCrowd.src = '';
      Object.values(sounds.current).forEach(s => { s.pause(); s.src = ''; });
    };

    // Also stop when tab is hidden or page is unloading
    const handleVisibility = () => { if (document.hidden) { bgCrowd.pause(); Object.values(sounds.current).forEach(s => s.pause()); } };
    const handleUnload = () => stopAll();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);

    return () => {
      stopAll();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, []);

  // #3.1: REMOVED the async state→ref sync effect. All ref mutations are done inline.

  const playSound = useCallback((name: string, volume: number = 1.0) => {
    if (gameStateRef.current.isMuted) return;
    const s = sounds.current[name];
    if (s) { s.currentTime = 0; s.volume = volume; s.play().catch(() => {}); }
  }, []);

  const showMessage = useCallback((txt: string, color: string) => {
    messageIdRef.current += 1;
    const cid = messageIdRef.current;
    setMessage({ text: txt, color, id: cid });
    const dur = POPUP_DURATIONS[txt] || 600;
    managedTimeout(() => { setMessage(prev => prev.id === cid ? { text: '', color: '', id: cid } : prev); }, dur);
  }, [managedTimeout]);

  // ── Celebrations ───────────────────────────────────────
  const triggerCelebration = useCallback((type: 'six' | 'four' | 'wicket') => {
    celebrationTypeRef.current = type;
    // #4.3: Increased trigger window to 250ms so slow devices don't miss it
    managedTimeout(() => { celebrationTypeRef.current = null; }, 250);
    if (type === 'six' || type === 'wicket') {
      shakeActiveRef.current = true;
      managedTimeout(() => { shakeActiveRef.current = false; }, type === 'wicket' ? 500 : 400);
    }
    crowdEnergyRef.current = type === 'wicket' ? 0.3 : 1;
  }, [managedTimeout]);

  // ── Game Logic (all ref mutations inline, no async sync) ──
  const [botDetected, setBotDetected] = useState(false);

  const endGame = useCallback(() => {
    setIsGameOver(true);
    gameStateRef.current.isGameOver = true; // #3.1: sync inline

    // ── Anti-bot check at game end ──────────────────────────
    const isBot = antiBotRef.current.isBot();
    if (isBot) {
      setBotDetected(true);
      // Don't save score or report to Flutter — invalidated
      return;
    }

    const fs = gameStateRef.current.score;
    const hs = highScoreRef.current; // #3.5: read from ref
    if (fs >= hs && fs > 0) { setHighScore(fs); safeSetItem('cricketHighScore', fs.toString()); }
    if ((window as any).CricketGameChannel) {
      (window as any).CricketGameChannel.postMessage(JSON.stringify({ type: 'GAME_OVER', score: fs, ballsPlayed: gameStateRef.current.ballsPlayed }));
    }
  }, []);

  const initBallInternal = useCallback(() => {
    if (gameStateRef.current.ballsPlayed === 0 && (window as any).CricketGameChannel) {
      (window as any).CricketGameChannel.postMessage(JSON.stringify({ type: 'GAME_START' }));
    }
    const delivery = pickDelivery(gameStateRef.current.ballsPlayed);
    // Estimate bounce X: bounce happens around ballY ~340 (55% progress)
    // frames to bounce ≈ (340 - 50) / speed, lateral drift = frames * curve
    const framesToBounce = (340 - 50) / delivery.speed;
    const bounceX = Math.max(BALL_MIN_X, Math.min(BALL_MAX_X, delivery.startX + delivery.curve * framesToBounce));
    ballRef.current = {
      active: true, y: 50, x: delivery.startX,
      speed: delivery.speed, curve: delivery.curve,
      radius: 6, hasSwung: false, processed: false, bounceX,
    };
    // Don't clear message here — let the popup timer handle it naturally
  }, []);

  const nextBall = useCallback(() => {
    const ball = ballRef.current;
    if (ball.processed) return; // #3.2: prevent double-fire
    ball.processed = true;
    ball.active = false;
    setBallsPlayed(b => b + 1);
    gameStateRef.current.ballsPlayed += 1; // #3.1: sync inline
    managedTimeout(() => {
      if (gameStateRef.current.isGameOver) return;
      if (gameStateRef.current.ballsPlayed >= MAX_BALLS) { endGame(); return; }
      initBallInternal();
    }, BALL_NEXT_DELAY);
  }, [endGame, managedTimeout, initBallInternal]);

  const initBall = useCallback(() => {
    if (gameStateRef.current.ballsPlayed >= MAX_BALLS) { endGame(); return; }
    initBallInternal();
  }, [endGame, initBallInternal]);

  const handleInput = useCallback(() => {
    const ball = ballRef.current;
    const gs = gameStateRef.current;
    if (gs.isGameOver || !gs.gameStarted) return;

    // Always play visual swing animation on tap (responsive feedback)
    // But do NOT clear the score message — let it expire on its own timer
    if (!gs.isSwinging) {
      setIsSwinging(true); gs.isSwinging = true;
      gs.shotType = ball.active && !ball.hasSwung ? pickShot(0) : 'defend';
      managedTimeout(() => { setIsSwinging(false); gs.isSwinging = false; }, SWING_DURATION);
    }

    // Only process the hit once per ball
    if (!ball.active || ball.hasSwung || ball.processed) return;
    ball.hasSwung = true;

    const inHitZone = ball.y >= HIT_ZONE_START && ball.y <= HIT_ZONE_END;
    const horizontalDist = Math.abs(ball.x - gs.batX);

    if (inHitZone && horizontalDist < BAT_HIT_RANGE) {
      // 70% chance of six, 30% chance of four — every hit is a boundary
      const roll = Math.random();
      let points: number, msg: string, color: string;
      if (roll < 0.7) {
        points = 6; msg = 'SIX!'; color = '#FFD700';
        triggerCelebration('six');
        setTimeout(() => { playSound('batHit', 1.0); playSound('bigCheer', 1.0); try { navigator.vibrate?.([100, 50, 200, 50, 150]); } catch {} }, 0);
      } else {
        points = 4; msg = 'FOUR!'; color = '#4ADE80';
        triggerCelebration('four');
        setTimeout(() => { playSound('batHit', 1.0); playSound('cheer', 1.0); try { navigator.vibrate?.([80, 40, 120]); } catch {} }, 0);
      }

      gs.shotType = pickShot(points);

      setScore(s => s + points); gs.score += points;
      if (msg) showMessage(msg, color);
      setBallResults(prev => [...prev, { runs: points, isWicket: false }]);
      nextBall();
    } else if (inHitZone) {
      gs.shotType = pickShot(0);
      setTimeout(() => playSound('batHit', 0.4), 0);
      showMessage('MISS', '#EF4444');
      setBallResults(prev => [...prev, { runs: 0, isWicket: false }]);
      nextBall();
    } else {
      // Swing outside the zone — record dot and advance immediately
      gs.shotType = 'defend';
      setTimeout(() => playSound('batHit', 0.3), 0);
      showMessage('MISS', '#F59E0B');
      setBallResults(prev => [...prev, { runs: 0, isWicket: false }]);
      nextBall();
    }
  }, [playSound, showMessage, nextBall, managedTimeout, triggerCelebration]);

  const restartGame = useCallback(() => {
    clearAllTimeouts();
    setBotDetected(false);
    antiBotRef.current.reset();
    setScore(0); setBallsPlayed(0); setIsGameOver(false); setGameStarted(true);
    setMessage({ text: '', color: '', id: 0 }); setBallResults([]);
    celebrationTypeRef.current = null; shakeActiveRef.current = false; crowdEnergyRef.current = 0;
    const gs = gameStateRef.current;
    // #3.1: All ref syncs inline
    gs.score = 0; gs.ballsPlayed = 0; gs.isGameOver = false; gs.gameStarted = true;
    gs.batX = 200; gs.targetBatX = 200; gs.activePointerId = null;
    gs.isMuted = gameStateRef.current.isMuted; // preserve mute
    ballRef.current.active = false; ballRef.current.processed = true;
    initBallInternal();
    // Resume bg crowd on restart
    if (bgCrowdRef.current && !gs.isMuted) bgCrowdRef.current.play().catch(() => {});
  }, [clearAllTimeouts, initBallInternal]);

  // Flutter bridge
  const restartGameRef = useRef(restartGame);
  restartGameRef.current = restartGame;
  useEffect(() => { (window as any).restartCricketGame = () => restartGameRef.current(); }, []);

  // Stable refs for callbacks used in the tick loop
  const showMessageRef = useRef(showMessage); showMessageRef.current = showMessage;
  const endGameRef = useRef(endGame); endGameRef.current = endGame;
  const nextBallRef = useRef(nextBall); nextBallRef.current = nextBall;
  const triggerCelebrationRef = useRef(triggerCelebration); triggerCelebrationRef.current = triggerCelebration;
  const playSoundRef = useRef(playSound); playSoundRef.current = playSound;

  // ── Single game loop (physics + keyboard polling merged) ──
  useEffect(() => {
    let lastTime = 0;
    let animId: number;

    const tick = (time: number) => {
      const delta = lastTime === 0 ? TARGET_FRAME_MS : Math.min(time - lastTime, 50);
      lastTime = time;
      const dtFactor = delta / TARGET_FRAME_MS;
      const ball = ballRef.current;
      const gs = gameStateRef.current;

      // #1.2: Keyboard bat movement (merged into main loop, no extra rAF)
      const keys = keysDownRef.current;
      if (gs.gameStarted && !gs.isGameOver) {
        if (keys.has('ArrowLeft')) gs.targetBatX = Math.max(BAT_MIN_X, gs.targetBatX - 3 * dtFactor);
        if (keys.has('ArrowRight')) gs.targetBatX = Math.min(BAT_MAX_X, gs.targetBatX + 3 * dtFactor);
      }

      if (ball.active && !ball.processed && !gs.isGameOver) {
        ball.y += ball.speed * dtFactor;
        ball.x = Math.max(BALL_MIN_X, Math.min(BALL_MAX_X, ball.x + ball.curve * dtFactor));

        // Bat smoothing
        const smoothFactor = 1 - Math.pow(0.65, dtFactor);
        gs.batX += (gs.targetBatX - gs.batX) * smoothFactor;

        // Wicket check — ball on stumps
        if (ball.y > 540 && !ball.hasSwung) {
          const onStumps = Math.abs(ball.x - 200) < STUMP_HIT_RANGE;
          // If bat hasn't moved from default position (200) and ball is on stumps = auto out
          const batNotMoved = Math.abs(gs.batX - 200) < 5;
          if (onStumps && (batNotMoved || Math.random() < 0.05)) {
            // Auto-out if bat not moved, or 5% chance even if moved
            showMessageRef.current('BOWLED!', '#EF4444');
            playSoundRef.current('wicket', 0.9);
            ball.active = false; ball.processed = true;
            triggerCelebrationRef.current('wicket');
            setBallResults(prev => [...prev, { runs: 0, isWicket: true }]);
            managedTimeout(() => { if (!gameStateRef.current.isGameOver) endGameRef.current(); }, WICKET_END_DELAY);
          } else if (ball.y > 580) {
            setBallResults(prev => [...prev, { runs: 0, isWicket: false }]);
            nextBallRef.current();
          }
        } else if (ball.y > 580) {
          // Ball passed everything — always record as dot ball
          setBallResults(prev => [...prev, { runs: 0, isWicket: false }]);
          nextBallRef.current();
        }
      } else {
        // Still smooth bat when idle
        const smoothFactor = 1 - Math.pow(0.65, dtFactor);
        gs.batX += (gs.targetBatX - gs.batX) * smoothFactor;
      }

      crowdEnergyRef.current *= 0.995;
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [managedTimeout]); // managedTimeout is stable

  // ── Pointer Handling ────────────────────────────────────
  const pointerStartPos = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const gs = gameStateRef.current;
    if (!gs.gameStarted || gs.isGameOver) return;
    if (gs.activePointerId !== null && gs.activePointerId !== e.pointerId) return;

    // Check if this is a drag (moved more than 8px from start)
    if (pointerStartPos.current) {
      const dx = Math.abs(e.clientX - pointerStartPos.current.x);
      if (dx > 8) isDragging.current = true;
    }

    // Only move bat if dragging
    if (isDragging.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
      const logicalX = BAT_MIN_X + (x / CANVAS_WIDTH) * (BAT_MAX_X - BAT_MIN_X);
      gs.targetBatX = Math.max(BAT_MIN_X, Math.min(BAT_MAX_X, logicalX));
    }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const gs = gameStateRef.current;
    if (!gs.gameStarted || gs.isGameOver) return;
    if (gs.activePointerId !== null && gs.activePointerId !== e.pointerId) return;
    gs.activePointerId = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerStartPos.current = { x: e.clientX, y: e.clientY };
    isDragging.current = false;
    antiBotRef.current.touchAnalyzer.recordTouch(e);
    // Don't swing on pointerDown — wait for pointerUp to distinguish tap from drag
  }, [handleInput]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (gameStateRef.current.activePointerId === e.pointerId) {
      antiBotRef.current.touchAnalyzer.recordTouch(e);
      // Only swing if this was a tap (not a drag)
      if (!isDragging.current) {
        antiBotRef.current.touchAnalyzer.recordTap();
        handleInput();
      }
      gameStateRef.current.activePointerId = null;
      pointerStartPos.current = null;
      isDragging.current = false;
    }
  }, [handleInput]);

  // ── Keyboard (just listeners, polling merged into main loop) ──
  const handleInputRef = useRef(handleInput);
  handleInputRef.current = handleInput;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); handleInputRef.current(); }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); keysDownRef.current.add(e.code); }
    };
    const handleKeyUp = (e: KeyboardEvent) => keysDownRef.current.delete(e.code);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, []);

  // ── Mute sync to ref (inline, not effect) ───────────────
  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      gameStateRef.current.isMuted = next;
      // Pause/resume background crowd
      if (bgCrowdRef.current) {
        if (next) bgCrowdRef.current.pause();
        else if (gameStateRef.current.gameStarted) bgCrowdRef.current.play().catch(() => {});
      }
      return next;
    });
  }, []);

  // ── Derived Stats ───────────────────────────────────────
  // Stats removed from game over screen

  const getResultBanner = () => {
    if (score >= 30) return { text: 'INCREDIBLE INNINGS!', color: '#FFD700' };
    if (score >= 18) return { text: 'SOLID BATTING!', color: '#38BDF8' };
    if (score >= 6) return { text: 'DECENT EFFORT', color: '#F9FAFB' };
    return { text: 'BETTER LUCK NEXT TIME', color: '#c0c8d8' };
  };

  const getPopupStyle = (text: string) => {
    if (text === 'SIX!') return { fontSize: '72px', fontWeight: 900, textShadow: '0 0 40px rgba(255,215,0,0.6), 0 0 80px rgba(255,215,0,0.25)' };
    if (text === 'FOUR!') return { fontSize: '52px', fontWeight: 800, textShadow: '0 0 25px rgba(74,222,128,0.5)' };
    if (text === '+3') return { fontSize: '36px', fontWeight: 700, textShadow: '0 0 12px rgba(56,189,248,0.3)' };
    if (text === '+2') return { fontSize: '32px', fontWeight: 600, textShadow: 'none' };
    if (text === '+1') return { fontSize: '28px', fontWeight: 600, textShadow: 'none' };
    if (text === 'BOWLED!') return { fontSize: '56px', fontWeight: 900, textShadow: '0 0 40px rgba(239,68,68,0.6)' };
    if (text === 'MISS') return { fontSize: '28px', fontWeight: 600, textShadow: 'none' };
    return { fontSize: '32px', fontWeight: 700, textShadow: 'none' };
  };

  const getPopupAnimation = (text: string) => {
    if (text === 'SIX!') return { initial: { opacity: 0, scale: 3, rotate: -5 }, animate: { opacity: 1, scale: 1, rotate: 0 }, exit: { opacity: 0, scale: 0.8, y: -40 }, transition: { type: 'spring' as const, stiffness: 400, damping: 15 } };
    if (text === 'FOUR!') return { initial: { opacity: 0, scale: 1.5, y: 0 }, animate: { opacity: 1, scale: 1, y: -10 }, exit: { opacity: 0, scale: 0.9, y: -30 }, transition: { type: 'spring' as const, stiffness: 300, damping: 15 } };
    if (text === 'BOWLED!') return { initial: { opacity: 0, scale: 0.5 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.8 }, transition: { type: 'spring' as const, stiffness: 500, damping: 12 } };
    return { initial: { opacity: 0, y: 0, scale: 0.8 }, animate: { opacity: 1, y: -20, scale: 1 }, exit: { opacity: 0, y: -40 }, transition: { duration: 0.3, ease: 'easeOut' as const } };
  };

  const banner = getResultBanner();

  return (
    // #5.2: min-h-dvh for mobile viewport, #5.4: safe-area padding
    <div className="min-h-dvh bg-[#060c1a] text-white flex flex-col items-center justify-center font-sans p-2 sm:p-4 touch-none overflow-hidden"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))', paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
      <div className="relative w-full max-w-[420px]">

        {/* ── Scoreboard ─────────────────────────────────── */}
        {gameStarted && (
          <div className="rounded-t-2xl p-3 pb-2.5 mb-0 shadow-xl border border-white/[0.06]"
            style={{ background: 'linear-gradient(180deg, rgba(10,14,26,0.97) 0%, rgba(10,14,26,0.88) 100%)', backdropFilter: 'blur(12px)' }}
            role="status" aria-live="polite">
            <div className="flex justify-between items-center mb-2.5">
              <div className="flex flex-col">
                <span className="text-[9px] uppercase font-bold tracking-[0.15em]" style={{ color: '#3D45C3' }}>Total Runs</span>
                <span className="text-3xl font-black font-mono leading-none tabular-nums"><AnimatedScore value={score} /></span>
              </div>
              <div className="h-8 w-px bg-white/[0.06]" />
              <div className="flex flex-col items-center">
                <span className="text-[9px] uppercase font-bold text-gray-500 tracking-[0.15em]">Over</span>
                <span className="text-2xl font-bold font-mono leading-none tabular-nums text-gray-300">{Math.floor(ballsPlayed / 6)}.{ballsPlayed % 6}</span>
              </div>
              <div className="h-8 w-px bg-white/[0.06]" />
              <div className="flex flex-col items-end">
                <span className="text-[9px] uppercase font-bold tracking-[0.15em] flex items-center gap-1" style={{ color: '#FFD700' }}><Trophy size={9} /> Best</span>
                <span className="text-2xl font-bold font-mono leading-none tabular-nums" style={{ color: '#FFD700' }}>{highScore}</span>
              </div>
            </div>
            <div className="flex justify-center">
              <div className="px-3 py-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <BallTracker results={ballResults} total={MAX_BALLS} />
              </div>
            </div>
          </div>
        )}

        {/* ── Game Container ──────────────────────────────── */}
        {/* #6.1: role, tabIndex, aria-label for accessibility */}
        <div
          className={`relative ${!gameStarted ? 'rounded-2xl' : 'rounded-b-2xl'} overflow-hidden shadow-2xl touch-none aspect-[2/3] select-none`}
          style={{ border: '1px solid rgba(255,255,255,0.05)', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', userSelect: 'none' }}
          role="application" tabIndex={0}
          aria-label="Cricket batting area. Tap to swing the bat."
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
          onTouchStart={(e) => { if (gameStarted && !isGameOver) e.preventDefault(); }}
        >
          <img src="/stadium-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover select-none" fetchPriority="high" loading="eager" decoding="async" style={{ zIndex: 0, pointerEvents: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }} draggable={false} />

          <Suspense fallback={null}>
            <GameScene
              ballRef={ballRef}
              gameStateRef={gameStateRef}
              crowdEnergyRef={crowdEnergyRef}
              celebrationTypeRef={celebrationTypeRef}
              shakeActiveRef={shakeActiveRef}
            />
          </Suspense>

          {/* ── Score Popup ───────────────────────────────── */}
          <AnimatePresence mode="wait">
            {message.text && (() => {
              const style = getPopupStyle(message.text);
              const anim = getPopupAnimation(message.text);
              // Map message text to shot image
              const shotImageMap: Record<string, { src: string; width: string; alt: string }> = {
                'SIX!':   { src: '/shots/six.png',   width: 'w-60', alt: "It's a Six!" },
                'FOUR!':  { src: '/shots/four.png',  width: 'w-60', alt: "It's a Four!" },
                '+3':     { src: '/shots/three.png', width: 'w-36', alt: '3 runs' },
                '+2':     { src: '/shots/two.png',   width: 'w-36', alt: '2 runs' },
                '+1':     { src: '/shots/one.png',   width: 'w-32', alt: '1 run' },
                'BOWLED!':{ src: '/shots/bowled.png', width: 'w-64', alt: 'Clean Bowled!' },
                'MISS':   { src: '/shots/dot.png',   width: 'w-24', alt: 'Dot ball' },
              };
              const imgInfo = shotImageMap[message.text];
              return (
                <motion.div key={message.id}
                  initial={anim.initial} animate={anim.animate} exit={anim.exit} transition={anim.transition}
                  className="absolute top-[38%] left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none"
                  style={{ color: message.color, zIndex: 20 }} role="alert" aria-live="assertive">
                  {imgInfo ? (
                    <img src={imgInfo.src} alt={imgInfo.alt} className={`${imgInfo.width} h-auto drop-shadow-[0_4px_20px_rgba(0,0,0,0.6)]`} draggable={false} />
                  ) : (
                    <span className="block font-black italic tracking-tighter font-display"
                      style={{ fontSize: style.fontSize, fontWeight: style.fontWeight, textShadow: style.textShadow }}>
                      {message.text}
                    </span>
                  )}
                  <span className="sr-only">
                    {message.text === 'BOWLED!' ? 'Wicket! You are bowled out.' :
                     message.text === 'MISS' ? 'Missed the ball.' :
                     message.text === 'SIX!' ? 'Maximum! Six runs scored!' :
                     message.text === 'FOUR!' ? 'Boundary! Four runs scored!' :
                     `${message.text.replace('+', '')} runs scored.`}
                  </span>
                </motion.div>
              );
            })()}
          </AnimatePresence>

          {/* ── Start Screen ──────────────────────────────── */}
          {!gameStarted && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-20"
              style={{ background: 'rgba(5,8,25,0.98)' }}>
              <motion.div initial="hidden" animate="show"
                variants={{ show: { transition: { staggerChildren: 0.12 } } }}
                className="w-[88%] max-w-[340px]">
                <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } }}
                  className="text-[12px] font-bold tracking-[0.14em] uppercase mb-3" style={{ color: '#7B82E0' }}>
                  6-Ball Challenge
                </motion.div>
                <motion.h1 variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } }}
                  className="text-[32px] font-black tracking-tight leading-tight mb-0 text-white">
                  STEP UP TO <span style={{ color: '#7B82E0' }}>BAT</span>
                </motion.h1>
                <motion.div variants={{ hidden: { opacity: 0, scaleX: 0 }, show: { opacity: 1, scaleX: 1, transition: { duration: 0.5 } } }}
                  className="w-12 h-px mx-auto my-5" style={{ background: '#7B82E0' }} />
                <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } }}
                  className="space-y-4 mb-6">
                  <div className="flex items-center justify-center gap-6 py-5 rounded-2xl px-6"
                    style={{ background: 'rgba(61,69,195,0.15)', border: '1px solid rgba(123,130,224,0.3)' }}>
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'rgba(61,69,195,0.3)', color: '#A5AAEE' }}><MoveHorizontal size={22} /></div>
                      <span className="text-[10px] uppercase font-bold tracking-[0.1em] text-white">Slide</span>
                    </div>
                    <div className="h-12 w-px" style={{ background: 'rgba(123,130,224,0.3)' }} />
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'rgba(61,69,195,0.3)', color: '#A5AAEE' }}><MousePointerClick size={22} /></div>
                      <span className="text-[10px] uppercase font-bold tracking-[0.1em] text-white">Hit</span>
                    </div>
                  </div>
                  <p className="text-[14px] leading-relaxed text-white/80">
                    Time it right in the <span className="font-bold text-white" style={{ color: '#A5AAEE' }}>sweet spot</span> for maximum runs. 6 balls. Make them count.
                  </p>
                </motion.div>
                <motion.div variants={{ hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } }}>
                  <button onClick={(e) => {
                    e.stopPropagation();
                    // Block automation tools immediately
                    if (antiBotRef.current.isBot()) {
                      setBotDetected(true);
                      setGameStarted(true);
                      setIsGameOver(true);
                      gameStateRef.current.gameStarted = true;
                      gameStateRef.current.isGameOver = true;
                      return;
                    }
                    setGameStarted(true);
                    gameStateRef.current.gameStarted = true;
                    initBall();
                    // Start background crowd sound
                    if (bgCrowdRef.current && !gameStateRef.current.isMuted) {
                      bgCrowdRef.current.play().catch(() => {});
                    }
                  }}
                    className="w-full h-[52px] rounded-xl font-bold text-base tracking-[0.04em] flex items-center justify-center gap-2.5 transition-transform active:scale-[0.97] btn-glow"
                    style={{ background: 'linear-gradient(135deg, #3D45C3 0%, #2A30A0 100%)', color: '#ffffff' }}
                    aria-label="Start innings">
                    <Play fill="currentColor" size={18} /> START INNINGS
                  </button>
                </motion.div>
              </motion.div>
            </div>
          )}

          {/* ── Game Over Screen ──────────────────────────── */}
          {isGameOver && (
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 25 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center z-30"
              style={{ background: 'rgba(2,4,15,0.96)', backdropFilter: 'blur(16px)' }}>
              <div className="w-full max-w-[340px]">
                {botDetected ? (
                <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 20 }} className="mb-6">
                  <div className="text-[40px] mb-2">🚫</div>
                  <div className="text-[18px] font-bold text-red-400 mb-2">Bot Detected</div>
                  <p className="text-[13px] text-white/60 leading-relaxed">
                    Unusual activity was detected. Your score was not recorded. Play on a real device to submit scores.
                  </p>
                </motion.div>
              ) : (<>
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                  className="text-[12px] font-bold tracking-[0.1em] uppercase mb-2" style={{ color: banner.color }}>
                  {banner.text}
                </motion.div>
                <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1, type: 'spring', stiffness: 200, damping: 20 }} className="mb-1">
                  <CountUpScore target={score} />
                  <div className="text-[13px] font-medium tracking-[0.08em] uppercase" style={{ color: '#c0c8d8' }}>Runs</div>
                </motion.div>
              </>)}
                {!botDetected && score >= highScore && score > 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, scale: [1, 1.1, 1] }}
                    transition={{ delay: 0.8, duration: 1.5, repeat: Infinity }}
                    className="text-[12px] font-bold flex items-center justify-center gap-1.5 uppercase tracking-[0.08em] mb-4"
                    style={{ color: '#FFD700' }}>
                    <Trophy size={14} /> New Personal Best!
                  </motion.div>
                )}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                  className="flex justify-center mb-4">
                  <div className="px-3 py-2 rounded-full" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <BallTracker results={ballResults} total={MAX_BALLS} />
                  </div>
                </motion.div>
                {/* Stats grid removed */}
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}
                  className="flex flex-col gap-2.5">
                  {/* #6.4: autoFocus on primary action */}
                  <button autoFocus onClick={(e) => { e.stopPropagation(); restartGame(); }}
                    className="w-full h-[50px] rounded-xl font-bold text-[15px] tracking-[0.04em] flex items-center justify-center gap-2.5 transition-transform active:scale-[0.97]"
                    style={{ background: 'linear-gradient(135deg, #3D45C3 0%, #2A30A0 100%)', color: '#ffffff' }}>
                    <RotateCcw size={18} /> BAT AGAIN
                  </button>
                  {!(window as any).CricketGameChannel && (
                    <button onClick={(e) => {
                      e.stopPropagation(); clearAllTimeouts();
                      setBotDetected(false); antiBotRef.current.reset();
                      // Full reset — same as restartGame but go to start screen
                      setScore(0); setBallsPlayed(0); setIsGameOver(false); setGameStarted(false);
                      setMessage({ text: '', color: '', id: 0 }); setBallResults([]);
                      const gs = gameStateRef.current;
                      gs.score = 0; gs.ballsPlayed = 0; gs.isGameOver = false; gs.gameStarted = false;
                      gs.batX = 200; gs.targetBatX = 200; gs.activePointerId = null;
                      ballRef.current.active = false; ballRef.current.processed = true;
                      celebrationTypeRef.current = null; shakeActiveRef.current = false; crowdEnergyRef.current = 0;
                      if (bgCrowdRef.current) bgCrowdRef.current.pause();
                    }}
                      className="w-full h-[46px] rounded-xl font-bold text-[14px] flex items-center justify-center gap-2 transition-transform active:scale-[0.97]"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#c0c8d8' }}>
                      <Home size={16} /> QUIT
                    </button>
                  )}
                </motion.div>
              </div>
            </motion.div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────── */}
        <div className="mt-3 flex justify-between items-center px-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#3D45C3' }} />
              <span className="text-[9px] uppercase font-bold tracking-[0.12em]" style={{ color: '#6B7280' }}>Live</span>
            </div>
            <button onClick={toggleMute}
              className="transition-colors p-1 rounded"
              style={{ color: isMuted ? '#374151' : '#9CA3AF' }}
              aria-label={isMuted ? 'Unmute' : 'Mute'}>
              {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
          </div>
          <span className="text-[9px] uppercase tracking-[0.1em] hidden sm:block" style={{ color: '#374151' }}>
            Arrows to move · Space to hit
          </span>
        </div>
      </div>
    </div>
  );
}
