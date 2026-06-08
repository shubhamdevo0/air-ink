import { useEffect, useRef, useState, useCallback, CSSProperties } from "react";
import { Hands, Results, NormalizedLandmarkList } from "@mediapipe/hands";
import Toolbar from "@/components/Toolbar";
import type { Stroke, Tool, Point } from "@/types/whiteboard";

const GROUP_TIMEOUT_MS = 1500;
const DRAW_GRACE_FRAMES = 12;
const MAX_SEGMENT_PX = 14;
const STABILIZER_SIZE = 6;

let groupIdCounter = 0;
let strokeIdCounter = 0;

function makeGroupId() {
  return `g${++groupIdCounter}`;
}
function makeStrokeId() {
  return `s${++strokeIdCounter}`;
}

function fingerExtensionRatio(
  lm: NormalizedLandmarkList,
  mcp: number,
  pip: number,
  tip: number
) {
  const mcpP = lm[mcp];
  const pipP = lm[pip];
  const tipP = lm[tip];
  const tipDist = Math.hypot(tipP.x - mcpP.x, tipP.y - mcpP.y);
  const pipDist = Math.hypot(pipP.x - mcpP.x, pipP.y - mcpP.y) || 1e-6;
  return tipDist / pipDist;
}

const STRICT_EXTEND = 1.6;
const LENIENT_EXTEND = 1.5;
const INDEX_WRIST_REACH_MIN = 1.45;

const INDEX_JOINTS = [5, 6, 8] as const;
const MIDDLE_JOINTS = [9, 10, 12] as const;
const RING_JOINTS = [13, 14, 16] as const;
const PINKY_JOINTS = [17, 18, 20] as const;

function isIndexReaching(lm: NormalizedLandmarkList) {
  const wrist = lm[0];
  const mcp = lm[5];
  const tip = lm[8];
  const tipReach = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
  const mcpReach = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y) || 1e-6;
  return tipReach / mcpReach > INDEX_WRIST_REACH_MIN;
}

function isIndexExtendedStrict(lm: NormalizedLandmarkList) {
  return (
    fingerExtensionRatio(lm, ...INDEX_JOINTS) > STRICT_EXTEND &&
    isIndexReaching(lm)
  );
}
function isIndexExtendedLenient(lm: NormalizedLandmarkList) {
  return (
    fingerExtensionRatio(lm, ...INDEX_JOINTS) > LENIENT_EXTEND &&
    isIndexReaching(lm)
  );
}
function isMiddleExtended(lm: NormalizedLandmarkList) {
  return fingerExtensionRatio(lm, ...MIDDLE_JOINTS) > STRICT_EXTEND;
}
function isRingExtended(lm: NormalizedLandmarkList) {
  return fingerExtensionRatio(lm, ...RING_JOINTS) > STRICT_EXTEND;
}
function isPinkyExtended(lm: NormalizedLandmarkList) {
  return fingerExtensionRatio(lm, ...PINKY_JOINTS) > STRICT_EXTEND;
}
function isThumbExtended(lm: NormalizedLandmarkList) {
  const thumbRatio = fingerExtensionRatio(lm, 2, 3, 4);
  if (thumbRatio < 1.35) return false;
  const tip = lm[4];
  const indexMcp = lm[5];
  const wrist = lm[0];
  const middleMcp = lm[9];
  const handSize = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y) || 1e-6;
  const tipFromIndexMcp = Math.hypot(tip.x - indexMcp.x, tip.y - indexMcp.y);
  return tipFromIndexMcp / handSize > 0.55;
}

function getPeaceSign(lm: NormalizedLandmarkList) {
  return (
    isIndexExtendedStrict(lm) &&
    isMiddleExtended(lm) &&
    !isRingExtended(lm) &&
    !isPinkyExtended(lm)
  );
}

function getOpenPalm(lm: NormalizedLandmarkList) {
  return (
    isIndexExtendedStrict(lm) &&
    isMiddleExtended(lm) &&
    isRingExtended(lm) &&
    isPinkyExtended(lm) &&
    isThumbExtended(lm)
  );
}

function getPinchDistance(lm: NormalizedLandmarkList) {
  const thumb = lm[4];
  const index = lm[8];
  const wrist = lm[0];
  const midMcp = lm[9];
  const handSize = Math.hypot(midMcp.x - wrist.x, midMcp.y - wrist.y) || 1;
  const tipDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
  return tipDist / handSize;
}

const PINCH_START_THRESHOLD = 0.22;
const PINCH_END_THRESHOLD = 0.35;
const PINCH_DEBOUNCE_FRAMES = 4;
const ERASE_ABORT_DRAW_FRAMES = 20;
const ERASE_DEBOUNCE_FRAMES = ERASE_ABORT_DRAW_FRAMES + 45;

function getDrawingFinger(lm: NormalizedLandmarkList) {
  return isIndexExtendedLenient(lm);
}

function toCanvas(x: number, y: number, w: number, h: number): Point {
  return { x: (1 - x) * w, y: y * h };
}

function smooth(prev: Point | null, curr: Point, alpha = 0.5): Point {
  if (!prev) return curr;
  return {
    x: prev.x + alpha * (curr.x - prev.x),
    y: prev.y + alpha * (curr.y - prev.y),
  };
}

function getGroupBounds(strokes: Stroke[], groupId: string) {
  const pts = strokes
    .filter((s) => s.groupId === groupId)
    .flatMap((s) => s.points);
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function dist(a: Point, b: Point) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export default function Whiteboard() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handsRef = useRef<Hands | null>(null);
  const animFrameRef = useRef<number>(0);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#FFFFFF");
  const [brushSize, setBrushSize] = useState(6);
  const [gestureLabel, setGestureLabel] = useState("");
  const [camError, setCamError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [flashVisible, setFlashVisible] = useState(false);
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; angle: number; color: string }[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const strokesRef = useRef<Stroke[]>([]);
  const groupOffsetsRef = useRef<Record<string, Point>>({});
  const currentStrokeRef = useRef<Stroke | null>(null);
  const currentGroupIdRef = useRef<string>(makeGroupId());
  const lastDrawTimeRef = useRef<number>(0);
  const isDrawingRef = useRef(false);
  const framesSinceDrawRef = useRef(0);
  const pinchStateRef = useRef({ active: false, sustainedFrames: 0 });
  const eraseStateRef = useRef({
    largeFrames: 0,
    smallFrames: 0,
    activeKind: null as null | "large" | "small",
  });
  const stabilizerBufRef = useRef<Point[]>([]);

  const cursorRef = useRef<{ pos: Point | null; visible: boolean; gesture: string }>({
    pos: null,
    visible: false,
    gesture: "idle",
  });
  const smoothedPosRef = useRef<Point | null>(null);

  const moveRef = useRef<{
    active: boolean;
    groupId: string | null;
    grabOffset: Point;
    lastPos: Point | null;
  }>({
    active: false,
    groupId: null,
    grabOffset: { x: 0, y: 0 },
    lastPos: null,
  });

  const toolRef = useRef<Tool>("pen");
  const colorRef = useRef("#FFFFFF");
  const brushSizeRef = useRef(6);

  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);

  const drawStroke = useCallback(
    (ctx: CanvasRenderingContext2D, stroke: Stroke, offsetX = 0, offsetY = 0) => {
      if (stroke.points.length < 2) return;

      const tracePath = () => {
        ctx.beginPath();
        const p0 = stroke.points[0];
        ctx.moveTo(p0.x + offsetX, p0.y + offsetY);
        for (let i = 1; i < stroke.points.length - 1; i++) {
          const p = stroke.points[i];
          const next = stroke.points[i + 1];
          const mx = (p.x + next.x) / 2 + offsetX;
          const my = (p.y + next.y) / 2 + offsetY;
          ctx.quadraticCurveTo(p.x + offsetX, p.y + offsetY, mx, my);
        }
        const last = stroke.points[stroke.points.length - 1];
        ctx.lineTo(last.x + offsetX, last.y + offsetY);
      };

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (stroke.tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        tracePath();
        ctx.stroke();
      } else {
        ctx.globalCompositeOperation = "lighter";

        // Outer diffuse halo — wide and soft
        ctx.shadowColor = stroke.color;
        ctx.shadowBlur = Math.max(40, stroke.size * 6);
        ctx.strokeStyle = stroke.color;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = stroke.size + 14;
        tracePath();
        ctx.stroke();

        // Mid glow — medium bloom
        ctx.shadowBlur = Math.max(22, stroke.size * 3.5);
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = stroke.size + 5;
        tracePath();
        ctx.stroke();

        // Core bright line
        ctx.shadowBlur = Math.max(10, stroke.size * 1.5);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        tracePath();
        ctx.stroke();

        // Hot white centre highlight
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = Math.max(1.5, stroke.size * 0.28);
        tracePath();
        ctx.stroke();
      }
      ctx.restore();
    },
    []
  );

  const redrawCanvas = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      ctx.clearRect(0, 0, w, h);

      for (const stroke of strokesRef.current) {
        const off = groupOffsetsRef.current[stroke.groupId] ?? { x: 0, y: 0 };
        drawStroke(ctx, stroke, off.x, off.y);
      }

      if (currentStrokeRef.current) {
        drawStroke(ctx, currentStrokeRef.current);
      }

      const { pos, visible, gesture } = cursorRef.current;
      if (visible && pos) {
        ctx.save();
        const isEraseLarge = gesture === "erase-large";
        const isEraseSmall = gesture === "erase-small";
        const isErasing = isEraseLarge || isEraseSmall;
        const isMoving = gesture === "move";
        const radius = isEraseLarge
          ? Math.max(140, Math.min(w, h) * 0.18)
          : isEraseSmall
          ? brushSizeRef.current * 4 + 20
          : isMoving
          ? 28
          : brushSizeRef.current / 2 + 6;
        const cursorColor = isErasing
          ? "rgba(255,120,120,0.85)"
          : isMoving
          ? "rgba(120,220,255,0.9)"
          : colorRef.current;

        ctx.shadowColor = cursorColor;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = cursorColor;
        ctx.lineWidth = isEraseLarge ? 2.5 : 2;
        if (isErasing) ctx.setLineDash([6, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, isMoving ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = cursorColor;
        ctx.fill();

        if (gesture !== "idle") {
          ctx.shadowBlur = 0;
          ctx.font = "11px monospace";
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fillText(
            gesture.replace("-", " ").toUpperCase(),
            pos.x + radius + 8,
            pos.y + 4
          );
        }
        ctx.restore();
      }

      if (moveRef.current.active && moveRef.current.groupId) {
        const gid = moveRef.current.groupId;
        const off = groupOffsetsRef.current[gid] ?? { x: 0, y: 0 };
        const bounds = getGroupBounds(strokesRef.current, gid);
        if (bounds) {
          ctx.save();
          ctx.strokeStyle = "rgba(100,200,255,0.5)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          const pad = 16;
          ctx.strokeRect(
            bounds.minX + off.x - pad,
            bounds.minY + off.y - pad,
            bounds.maxX - bounds.minX + pad * 2,
            bounds.maxY - bounds.minY + pad * 2
          );
          ctx.restore();
        }
      }
    },
    [drawStroke]
  );

  const onHandResults = useCallback(
    (results: Results) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const now = Date.now();

      if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        cursorRef.current.visible = false;
        if (isDrawingRef.current) {
          isDrawingRef.current = false;
          currentStrokeRef.current = null;
        }
        if (moveRef.current.active) {
          moveRef.current.active = false;
          moveRef.current.groupId = null;
        }
        smoothedPosRef.current = null;
        setGestureLabel("");
        redrawCanvas(ctx, w, h);
        return;
      }

      const lm = results.multiHandLandmarks[0];
      const indexTipRaw = toCanvas(lm[8].x, lm[8].y, w, h);
      const prev = smoothedPosRef.current;
      const speed = prev ? dist(prev, indexTipRaw) : 0;
      const alpha = Math.min(0.85, 0.45 + speed / 60);
      const smoothed = smooth(prev, indexTipRaw, alpha);
      smoothedPosRef.current = smoothed;

      const currentTool = toolRef.current;
      const currentColor = colorRef.current;
      const currentBrushSize = brushSizeRef.current;

      const pinchDist = getPinchDistance(lm);
      const openPalm = getOpenPalm(lm);
      const peace = getPeaceSign(lm);
      const drawing = getDrawingFinger(lm);

      const pinchState = pinchStateRef.current;
      const indexExt = drawing;
      const tightPinch = pinchDist < PINCH_START_THRESHOLD && !indexExt;
      const looseStillPinching = pinchDist < PINCH_END_THRESHOLD;

      let pinchActive = false;
      if (pinchState.active) {
        if (looseStillPinching) {
          pinchActive = true;
        } else {
          pinchState.active = false;
          pinchState.sustainedFrames = 0;
        }
      } else if (tightPinch && !isDrawingRef.current) {
        pinchState.sustainedFrames += 1;
        if (pinchState.sustainedFrames >= PINCH_DEBOUNCE_FRAMES) {
          pinchState.active = true;
          pinchActive = true;
        }
      } else {
        pinchState.sustainedFrames = Math.max(0, pinchState.sustainedFrames - 2);
      }

      const eraseState = eraseStateRef.current;
      if (openPalm) {
        eraseState.largeFrames = Math.min(eraseState.largeFrames + 1, ERASE_DEBOUNCE_FRAMES + 5);
        eraseState.smallFrames = Math.max(0, eraseState.smallFrames - 2);
      } else if (peace) {
        eraseState.smallFrames = Math.min(eraseState.smallFrames + 1, ERASE_DEBOUNCE_FRAMES + 5);
        eraseState.largeFrames = Math.max(0, eraseState.largeFrames - 2);
      } else {
        eraseState.largeFrames = Math.max(0, eraseState.largeFrames - 2);
        eraseState.smallFrames = Math.max(0, eraseState.smallFrames - 2);
      }
      if (eraseState.activeKind === "large" && eraseState.largeFrames === 0) {
        eraseState.activeKind = null;
      } else if (eraseState.activeKind === "small" && eraseState.smallFrames === 0) {
        eraseState.activeKind = null;
      } else if (!eraseState.activeKind) {
        if (eraseState.largeFrames >= ERASE_DEBOUNCE_FRAMES) eraseState.activeKind = "large";
        else if (eraseState.smallFrames >= ERASE_DEBOUNCE_FRAMES) eraseState.activeKind = "small";
      }

      const palmHoldFrames = Math.max(eraseState.largeFrames, eraseState.smallFrames);
      if (
        isDrawingRef.current &&
        palmHoldFrames >= ERASE_ABORT_DRAW_FRAMES
      ) {
        currentStrokeRef.current = null;
        isDrawingRef.current = false;
        framesSinceDrawRef.current = 0;
        stabilizerBufRef.current = [];
      }
      const drawSuppressedByPalm = palmHoldFrames >= ERASE_ABORT_DRAW_FRAMES;

      const eraseLargeActive = eraseState.activeKind === "large";
      const eraseSmallActive = eraseState.activeKind === "small";

      let gesture: "draw" | "erase-small" | "erase-large" | "move" | "idle" = "idle";
      if (pinchActive) gesture = "move";
      else if (eraseLargeActive) gesture = "erase-large";
      else if (eraseSmallActive && currentTool !== "pen") gesture = "erase-small";
      else if (drawing && !drawSuppressedByPalm && currentTool === "pen") gesture = "draw";
      else if (drawing && !drawSuppressedByPalm && currentTool === "eraser") gesture = "erase-small";

      cursorRef.current = { pos: smoothed, visible: true, gesture };
      setGestureLabel(gesture !== "idle" ? gesture.replace("-", " ") : "");

      if (now - lastDrawTimeRef.current > GROUP_TIMEOUT_MS) {
        if (isDrawingRef.current) {
          isDrawingRef.current = false;
          currentStrokeRef.current = null;
        }
        currentGroupIdRef.current = makeGroupId();
      }

      const stabilize = (raw: Point): Point => {
        const buf = stabilizerBufRef.current;
        buf.push(raw);
        if (buf.length > STABILIZER_SIZE) buf.shift();
        let sx = 0, sy = 0, sw = 0;
        for (let i = 0; i < buf.length; i++) {
          const w = i + 1;
          sx += buf[i].x * w;
          sy += buf[i].y * w;
          sw += w;
        }
        return { x: sx / sw, y: sy / sw };
      };

      const appendPoint = (target: Point) => {
        if (!currentStrokeRef.current) return;
        const points = currentStrokeRef.current.points;
        const lastPt = points[points.length - 1];
        const segDist = dist(lastPt, target);
        if (segDist > MAX_SEGMENT_PX) {
          const steps = Math.ceil(segDist / MAX_SEGMENT_PX);
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            points.push({
              x: lastPt.x + (target.x - lastPt.x) * t,
              y: lastPt.y + (target.y - lastPt.y) * t,
            });
          }
        } else if (segDist > 1.2) {
          points.push(target);
        }
      };

      if (gesture === "draw") {
        framesSinceDrawRef.current = 0;
        lastDrawTimeRef.current = now;
        if (!isDrawingRef.current) {
          isDrawingRef.current = true;
          stabilizerBufRef.current = [smoothed];
          currentStrokeRef.current = {
            id: makeStrokeId(),
            points: [smoothed],
            color: currentColor,
            size: currentBrushSize,
            tool: "pen",
            groupId: currentGroupIdRef.current,
            timestamp: now,
          };
        } else {
          appendPoint(stabilize(smoothed));
        }
      } else if (isDrawingRef.current) {
        framesSinceDrawRef.current += 1;
        if (
          framesSinceDrawRef.current <= DRAW_GRACE_FRAMES &&
          gesture !== "erase-small" &&
          gesture !== "erase-large" &&
          gesture !== "move"
        ) {
          appendPoint(stabilize(smoothed));
          lastDrawTimeRef.current = now;
        } else {
          if (currentStrokeRef.current) {
            const buf = stabilizerBufRef.current;
            if (buf.length) appendPoint(buf[buf.length - 1]);
            if (currentStrokeRef.current.points.length >= 2) {
              strokesRef.current = [
                ...strokesRef.current,
                currentStrokeRef.current,
              ];
            }
          }
          currentStrokeRef.current = null;
          isDrawingRef.current = false;
          framesSinceDrawRef.current = 0;
          stabilizerBufRef.current = [];
        }
      }

      if (gesture === "erase-small" || gesture === "erase-large") {
        const eraseRadius =
          gesture === "erase-large"
            ? Math.max(140, Math.min(w, h) * 0.18)
            : currentBrushSize * 4 + 20;
        strokesRef.current = strokesRef.current
          .map((stroke) => {
            const off = groupOffsetsRef.current[stroke.groupId] ?? { x: 0, y: 0 };
            const filtered = stroke.points.filter(
              (p) =>
                dist({ x: p.x + off.x, y: p.y + off.y }, smoothed) > eraseRadius
            );
            if (filtered.length === stroke.points.length) return stroke;
            if (filtered.length < 2) return null;
            return { ...stroke, points: filtered };
          })
          .filter(Boolean) as Stroke[];
      }

      if (gesture === "move") {
        if (!moveRef.current.active) {
          const groups = [...new Set(strokesRef.current.map((s) => s.groupId))];
          let closestGroup: string | null = null;
          let closestDist = Infinity;
          for (const gid of groups) {
            const bounds = getGroupBounds(strokesRef.current, gid);
            if (!bounds) continue;
            const off = groupOffsetsRef.current[gid] ?? { x: 0, y: 0 };
            const cx = (bounds.minX + bounds.maxX) / 2 + off.x;
            const cy = (bounds.minY + bounds.maxY) / 2 + off.y;
            const d = dist({ x: cx, y: cy }, smoothed);
            if (d < closestDist) {
              closestDist = d;
              closestGroup = gid;
            }
          }
          if (closestGroup && closestDist < 250) {
            moveRef.current = {
              active: true,
              groupId: closestGroup,
              grabOffset: { x: 0, y: 0 },
              lastPos: smoothed,
            };
          }
        } else if (moveRef.current.active && moveRef.current.groupId) {
          const prev = moveRef.current.lastPos;
          if (prev) {
            const dx = smoothed.x - prev.x;
            const dy = smoothed.y - prev.y;
            const gid = moveRef.current.groupId;
            const existing = groupOffsetsRef.current[gid] ?? { x: 0, y: 0 };
            groupOffsetsRef.current = {
              ...groupOffsetsRef.current,
              [gid]: { x: existing.x + dx, y: existing.y + dy },
            };
          }
          moveRef.current.lastPos = smoothed;
        }
      } else if (moveRef.current.active) {
        moveRef.current.active = false;
        moveRef.current.groupId = null;
        moveRef.current.lastPos = null;
      }

      redrawCanvas(ctx, w, h);
    },
    [redrawCanvas]
  );

  useEffect(() => {
    let stopped = false;
    let resizeHandler: (() => void) | null = null;

    async function init(): Promise<void> {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user" },
          audio: false,
        });

        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        const hands = new Hands({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`,
        });

        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.75,
          minTrackingConfidence: 0.65,
        });

        hands.onResults(onHandResults);
        handsRef.current = hands;

        const canvas = canvasRef.current!;
        const resize = () => {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
        };
        resize();
        resizeHandler = resize;
        window.addEventListener("resize", resize);

        let lastSend = 0;
        async function loop() {
          if (stopped) return;
          const now = performance.now();
          if (now - lastSend > 33 && video.readyState >= 2) {
            lastSend = now;
            try {
              await hands.send({ image: video });
            } catch {
              // Ignore per-frame errors
            }
          }
          animFrameRef.current = requestAnimationFrame(loop);
        }

        setIsReady(true);
        animFrameRef.current = requestAnimationFrame(loop);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setCamError(msg.includes("Permission denied") || msg.includes("NotAllowed")
          ? "Camera access denied. Please allow camera permissions and reload."
          : `Camera error: ${msg}`);
      }
    }

    init();

    return () => {
      stopped = true;
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      cancelAnimationFrame(animFrameRef.current);
      handsRef.current?.close();
      const video = videoRef.current;
      if (video?.srcObject) {
        (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
    };
  }, [onHandResults]);

  const handleClear = useCallback(() => {
    strokesRef.current = [];
    groupOffsetsRef.current = {};
    currentStrokeRef.current = null;
    currentGroupIdRef.current = makeGroupId();
    isDrawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const handleSave = useCallback(() => {
    if (saveState !== "idle") return;
    setSaveState("saving");

    requestAnimationFrame(() => {
      try {
        const drawingCanvas = canvasRef.current;
        const video = videoRef.current;
        if (!drawingCanvas) return;

        const w = drawingCanvas.width;
        const h = drawingCanvas.height;
        const off = document.createElement("canvas");
        off.width = w;
        off.height = h;
        const ctx = off.getContext("2d")!;

        if (video && video.readyState >= 2) {
          ctx.save();
          ctx.translate(w, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, w, h);
          ctx.restore();
        } else {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, w, h);
        }

        ctx.drawImage(drawingCanvas, 0, 0);

        const BURST_COLORS = ["#FACC15","#60A5FA","#F472B6","#4ADE80","#FB923C","#A78BFA"];
        const btnX = window.innerWidth - 80;
        const btnY = window.innerHeight - 80;
        setParticles(
          Array.from({ length: 16 }, (_, i) => ({
            id: i,
            x: btnX,
            y: btnY,
            angle: (i / 16) * 360,
            color: BURST_COLORS[i % BURST_COLORS.length],
          }))
        );

        setFlashVisible(true);
        setTimeout(() => setFlashVisible(false), 600);

        setTimeout(() => {
          const url = off.toDataURL("image/png");
          const a = document.createElement("a");
          a.href = url;
          a.download = `ar-whiteboard-${Date.now()}.png`;
          a.click();
          setSaveState("saved");

          setTimeout(() => setParticles([]), 900);

          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            setSaveState("idle");
          }, 2200);
        }, 320);
      } catch {
        setSaveState("idle");
      }
    });
  }, [saveState]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      {/* Mirrored webcam feed */}
      <video
        ref={videoRef}
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: "scaleX(-1)" }}
      />

      {/* Drawing canvas (NOT mirrored — we flip coords in JS) */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ pointerEvents: "none" }}
      />

      {/* Loading overlay */}
      {!isReady && !camError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-40">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            <p className="text-white/70 text-sm font-mono">Loading hand tracking model...</p>
          </div>
        </div>
      )}

      {/* Camera error */}
      {camError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-40">
          <div className="max-w-md text-center p-8">
            <div className="text-red-400 text-5xl mb-4">📷</div>
            <h2 className="text-white text-xl font-semibold mb-2">Camera Required</h2>
            <p className="text-white/60 text-sm">{camError}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-all"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      {isReady && (
        <Toolbar
          tool={tool}
          color={color}
          brushSize={brushSize}
          onToolChange={setTool}
          onColorChange={setColor}
          onBrushSizeChange={setBrushSize}
          onClear={handleClear}
          gestureLabel={gestureLabel}
        />
      )}

      {/* Gesture guide */}
      {isReady && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className="bg-black/60 backdrop-blur-md rounded-2xl px-4 py-3 border border-white/10 text-[11px] font-mono text-white/50 space-y-1.5">
            <div className="text-white/30 uppercase tracking-widest mb-2 text-[10px]">Gestures</div>
            <div><span className="text-white/70">☝ Index finger</span> → Draw</div>
            <div><span className="text-white/70">🤏 Pinch (thumb+index)</span> → Grab &amp; move</div>
            <div><span className="text-white/70">🖐 Open palm</span> → Erase large area</div>
            <div><span className="text-white/70">✌ Peace sign</span> → Erase nearby</div>
          </div>
        </div>
      )}

      {/* Save button */}
      {isReady && (
        <button
          onClick={handleSave}
          disabled={saveState !== "idle"}
          className="fixed bottom-6 left-1/2 z-50 select-none"
          style={{
            transform: "translateX(-50%)",
            outline: "none",
            border: "none",
            background: "none",
            padding: 0,
          }}
          aria-label="Save snapshot"
        >
          <SaveButton state={saveState} />
        </button>
      )}

      {/* Shutter flash overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-[60]"
        style={{
          background: "white",
          opacity: flashVisible ? 0.85 : 0,
          transition: flashVisible
            ? "opacity 0.05s ease-in"
            : "opacity 0.55s ease-out",
        }}
      />

      {/* Particle burst */}
      <div className="absolute inset-0 pointer-events-none z-[61]">
        {particles.map((p) => (
          <Particle key={p.id} {...p} />
        ))}
      </div>
    </div>
  );
}

function SaveButton({ state }: { state: "idle" | "saving" | "saved" }) {
  const isSaving = state === "saving";
  const isSaved = state === "saved";

  return (
    <div
      className="relative flex items-center gap-2.5 px-5 py-3 rounded-2xl overflow-hidden"
      style={{
        background: isSaved
          ? "linear-gradient(135deg, #16a34a 0%, #4ade80 100%)"
          : "rgba(0,0,0,0.65)",
        backdropFilter: "blur(16px)",
        border: isSaved
          ? "1px solid rgba(74,222,128,0.5)"
          : isSaving
          ? "1px solid rgba(250,204,21,0.5)"
          : "1px solid rgba(255,255,255,0.12)",
        boxShadow: isSaved
          ? "0 0 28px rgba(74,222,128,0.45), 0 4px 16px rgba(0,0,0,0.4)"
          : isSaving
          ? "0 0 20px rgba(250,204,21,0.3), 0 4px 16px rgba(0,0,0,0.4)"
          : "0 4px 20px rgba(0,0,0,0.5)",
        transform: isSaving ? "scale(0.96)" : isSaved ? "scale(1.04)" : "scale(1)",
        transition: "all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
    >
      {/* Shimmer scan line while saving */}
      {isSaving && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(250,204,21,0.25) 50%, transparent 100%)",
            animation: "shimmerScan 0.7s linear infinite",
          }}
        />
      )}

      {/* Icon */}
      <div
        style={{
          transform: isSaved ? "scale(1.15) rotate(-8deg)" : "scale(1) rotate(0deg)",
          transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        {isSaved ? (
          <CheckIcon />
        ) : isSaving ? (
          <ScanIcon />
        ) : (
          <CameraIcon />
        )}
      </div>

      {/* Label */}
      <span
        className="text-[13px] font-semibold font-mono tracking-wide"
        style={{
          color: isSaved ? "#fff" : isSaving ? "rgba(250,204,21,0.9)" : "rgba(255,255,255,0.8)",
          transition: "color 0.2s ease",
        }}
      >
        {isSaved ? "Saved!" : isSaving ? "Capturing…" : "Save Snapshot"}
      </span>

      <style>{`
        @keyframes shimmerScan {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes particleFly {
          0%   { transform: translate(0, 0) scale(1); opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

function ScanIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(250,204,21,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <line x1="7" y1="12" x2="17" y2="12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function Particle({
  x, y, angle, color,
}: {
  id: number; x: number; y: number; angle: number; color: string;
}) {
  const rad = (angle * Math.PI) / 180;
  const distance = 60 + Math.random() * 60;
  const dx = Math.cos(rad) * distance;
  const dy = Math.sin(rad) * distance;

  return (
    <div
      style={
        {
          position: "absolute",
          left: x,
          top: y,
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 8px ${color}`,
          "--dx": `${dx}px`,
          "--dy": `${dy}px`,
          animation: "particleFly 0.85s cubic-bezier(0.22,1,0.36,1) forwards",
          pointerEvents: "none",
        } as CSSProperties
      }
    />
  );
}
