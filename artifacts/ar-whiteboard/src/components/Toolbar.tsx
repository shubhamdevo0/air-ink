import { Tool } from "@/types/whiteboard";

const COLORS = [
  { value: "#FF0040", label: "Neon Red" },
  { value: "#FF6200", label: "Neon Orange" },
  { value: "#FFE600", label: "Neon Yellow" },
  { value: "#00FF87", label: "Neon Green" },
  { value: "#00B4FF", label: "Neon Blue" },
  { value: "#FF00FF", label: "Neon Magenta" },
  { value: "#BF00FF", label: "Neon Violet" },
  { value: "#FFFFFF", label: "White" },
];

const SIZES = [
  { value: 3, label: "XS" },
  { value: 6, label: "S" },
  { value: 12, label: "M" },
  { value: 22, label: "L" },
];

interface ToolbarProps {
  tool: Tool;
  color: string;
  brushSize: number;
  onToolChange: (tool: Tool) => void;
  onColorChange: (color: string) => void;
  onBrushSizeChange: (size: number) => void;
  onClear: () => void;
  gestureLabel: string;
}

export default function Toolbar({
  tool,
  color,
  brushSize,
  onToolChange,
  onColorChange,
  onBrushSizeChange,
  onClear,
  gestureLabel,
}: ToolbarProps) {
  return (
    <div
      className="fixed left-4 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-3 select-none"
      style={{ userSelect: "none" }}
    >
      <div className="bg-black/70 backdrop-blur-md rounded-2xl p-3 flex flex-col gap-4 border border-white/10 shadow-2xl">
        <div className="text-white/40 text-[10px] font-mono text-center uppercase tracking-widest">
          Tools
        </div>

        <div className="flex flex-col gap-1">
          <ToolButton
            active={tool === "pen"}
            onClick={() => onToolChange("pen")}
            title="Pen (index finger up)"
          >
            <PenIcon />
          </ToolButton>
          <ToolButton
            active={tool === "eraser"}
            onClick={() => onToolChange("eraser")}
            title="Eraser"
          >
            <EraserIcon />
          </ToolButton>
          <ToolButton
            active={tool === "move"}
            onClick={() => onToolChange("move")}
            title="Move strokes"
          >
            <MoveIcon />
          </ToolButton>
        </div>

        <div className="w-full h-px bg-white/10" />

        <div className="text-white/40 text-[10px] font-mono text-center uppercase tracking-widest">
          Color
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c.value}
              title={c.label}
              onClick={() => onColorChange(c.value)}
              className="w-7 h-7 rounded-full transition-all duration-150 hover:scale-110"
              style={{
                backgroundColor: c.value,
                boxShadow:
                  color === c.value
                    ? `0 0 0 2px rgba(255,255,255,0.9), 0 0 12px ${c.value}88`
                    : `0 0 0 1px rgba(255,255,255,0.15)`,
                transform: color === c.value ? "scale(1.15)" : undefined,
              }}
            />
          ))}
        </div>

        <div className="w-full h-px bg-white/10" />

        <div className="text-white/40 text-[10px] font-mono text-center uppercase tracking-widest">
          Size
        </div>

        <div className="flex flex-col gap-1">
          {SIZES.map((s) => (
            <button
              key={s.value}
              onClick={() => onBrushSizeChange(s.value)}
              className="flex items-center gap-2 px-2 py-1 rounded-lg transition-all duration-150 hover:bg-white/10"
              style={{
                background: brushSize === s.value ? "rgba(255,255,255,0.15)" : undefined,
              }}
            >
              <div
                className="rounded-full bg-white shrink-0"
                style={{
                  width: Math.min(s.value, 16),
                  height: Math.min(s.value, 16),
                }}
              />
              <span className="text-white/50 text-[10px] font-mono">{s.label}</span>
            </button>
          ))}
        </div>

        <div className="w-full h-px bg-white/10" />

        <button
          onClick={onClear}
          className="text-[10px] font-mono text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg py-1.5 px-2 transition-all duration-150 text-center"
          title="Clear all strokes"
        >
          CLEAR ALL
        </button>
      </div>

      {gestureLabel && (
        <div className="bg-black/60 backdrop-blur-md rounded-xl px-3 py-2 border border-white/10">
          <div className="text-white/70 text-[10px] font-mono text-center">{gestureLabel}</div>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 hover:bg-white/15"
      style={{
        background: active ? "rgba(255,255,255,0.2)" : undefined,
        boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,0.2)" : undefined,
      }}
    >
      {children}
    </button>
  );
}

function PenIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5 9 2 12 5 15" />
      <polyline points="9 5 12 2 15 5" />
      <polyline points="15 19 12 22 9 19" />
      <polyline points="19 9 22 12 19 15" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </svg>
  );
}
