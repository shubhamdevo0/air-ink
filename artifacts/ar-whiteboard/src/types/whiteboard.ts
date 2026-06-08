export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  points: Point[];
  color: string;
  size: number;
  tool: "pen" | "eraser";
  groupId: string;
  timestamp: number;
}

export interface StrokeGroup {
  id: string;
  offset: Point;
}

export type Tool = "pen" | "eraser" | "move";

export type GestureState =
  | "drawing"
  | "erasing"
  | "moving"
  | "idle";

export interface HandState {
  indexTip: Point | null;
  gesture: GestureState;
  confidence: number;
}
