/**
 * Line drawings of dials and rockers for mini controls, after the owner's
 * manual illustrations: a command dial is a knurled drum seen edge-on in its
 * housing, a rocker is a bowed knurled band with a smooth center tab. A held
 * press adds a solid arrow pushing into the control; a held direction adds a
 * curved arrow pointing to that side.
 */
import { For, Show } from 'solid-js';
import './control-drawings.css';

export type DrawingHeld = 'press' | 'decrease' | 'increase';

const n = (value: number) => value.toFixed(2);

/** The lower edge of a drum or band seen from slightly above: deepest at the center. */
function lowerEdge(cx: number, half: number, top: number, drop: number, dip: number) {
  return (x: number) => {
    const u = (x - cx) / half;
    return top + drop + dip * Math.sqrt(Math.max(0, 1 - u * u));
  };
}

function silhouette(cx: number, half: number, top: number, edge: (x: number) => number) {
  const points: string[] = [];
  for (let i = 80; i >= 0; i--) {
    const x = cx - half + (i * 2 * half) / 80;
    points.push(`L${n(x)} ${n(edge(x))}`);
  }
  return `M${n(cx - half)} ${top} H${n(cx + half)} ${points.join(' ')} Z`;
}

/** Faces of a knurled drum, spaced by the sine of their angle around the drum. */
function drumTeeth(cx: number, half: number, top: number, edge: (x: number) => number) {
  const count = 15;
  const sweep = (80 * Math.PI) / 180;
  const step = (2 * sweep) / count;
  const teeth: string[] = [];
  for (let i = 0; i < count; i++) {
    const a0 = -sweep + i * step + step * 0.16;
    const a1 = a0 + step * 0.68;
    const x0 = cx + half * Math.sin(a0);
    const x1 = cx + half * Math.sin(a1);
    if (x1 - x0 < 0.6) continue;
    teeth.push(
      `M${n(x0)} ${n(top + 2.2)} V${n(edge(x0))} L${n(x1)} ${n(edge(x1))} V${n(top + 2.2)}`,
    );
  }
  return teeth;
}

/** Ridges of a rocker's band, spaced by perspective and interrupted by the tab. */
function rockerRidges(
  cx: number,
  half: number,
  top: number,
  tab: number,
  edge: (x: number) => number,
) {
  const ridges: string[] = [];
  for (let i = 0; i < 21; i++) {
    const a = ((-82 + (i * 164) / 20) * Math.PI) / 180;
    const x = cx + half * Math.sin(a);
    if (Math.abs(x - cx) < tab + 1) continue;
    ridges.push(`M${n(x)} ${n(top + 0.8)} V${n(edge(x) - 0.7)}`);
  }
  return ridges;
}

interface ArrowPaths {
  kind: 'push' | 'turn left' | 'turn right';
  shapes: string[];
  stripe?: string;
}

/** A block arrow pushing up into the control, with the manual's stripe near its base. */
function pushArrow(cx: number, tip: number, length: number): ArrowPaths {
  const headWidth = 17;
  const neck = tip + 15;
  const shaft = 9.5;
  const base = tip + length;
  return {
    kind: 'push',
    shapes: [
      `M${cx} ${tip} L${cx + headWidth} ${neck} H${cx + shaft} V${base} H${cx - shaft} V${neck} H${cx - headWidth} Z`,
    ],
    stripe: `M${cx - shaft} ${base - 4.5} H${cx + shaft}`,
  };
}

/** A curved band below the control, on a circle centered above it, with a head on `side`. */
function turnArrow(
  cx: number,
  low: number,
  radius: number,
  side: 'decrease' | 'increase',
): ArrowPaths {
  const spread = (44 * Math.PI) / 180;
  const thick = 8;
  const head = 8.5;
  const cy = low - radius;
  const at = (angle: number, r: number) => ({
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  });
  const left = Math.PI / 2 + spread;
  const right = Math.PI / 2 - spread;
  const outer = radius + thick / 2;
  const inner = radius - thick / 2;
  const a = at(left, outer);
  const b = at(right, outer);
  const c = at(right, inner);
  const d = at(left, inner);
  const band = `M${n(a.x)} ${n(a.y)} A${outer} ${outer} 0 0 0 ${n(b.x)} ${n(b.y)} L${n(c.x)} ${n(c.y)} A${inner} ${inner} 0 0 1 ${n(d.x)} ${n(d.y)} Z`;
  // The head continues the band past its end, along the circle's tangent.
  const end = side === 'decrease' ? left : right;
  const away = side === 'decrease' ? 1 : -1;
  const from = at(end, radius);
  const next = at(end + away * 1e-3, radius);
  const length = Math.hypot(next.x - from.x, next.y - from.y);
  const tx = (next.x - from.x) / length;
  const ty = (next.y - from.y) / length;
  const root = at(end - (away * 3 * Math.PI) / 180, radius);
  const tip = { x: root.x + tx * head * 1.7, y: root.y + ty * head * 1.7 };
  const wing1 = { x: root.x - ty * head, y: root.y + tx * head };
  const wing2 = { x: root.x + ty * head, y: root.y - tx * head };
  return {
    kind: side === 'decrease' ? 'turn left' : 'turn right',
    shapes: [
      band,
      `M${n(tip.x)} ${n(tip.y)} L${n(wing1.x)} ${n(wing1.y)} L${n(wing2.x)} ${n(wing2.y)} Z`,
    ],
  };
}

function Arrow(props: { paths?: ArrowPaths }) {
  return (
    <Show when={props.paths}>
      {(paths) => (
        <g class={`drawing-arrow ${paths().kind}`}>
          <For each={paths().shapes}>{(shape) => <path class="arrow" d={shape} />}</For>
          <Show when={paths().stripe}>{(stripe) => <path class="stripe" d={stripe()} />}</Show>
        </g>
      )}
    </Show>
  );
}

const DIAL = { cx: 60, top: 10, half: 48 };
const dialEdge = lowerEdge(DIAL.cx, DIAL.half, DIAL.top, 7, 17);
const dialBody = silhouette(DIAL.cx, DIAL.half, DIAL.top, (x) => dialEdge(x) - 3.5);
const dialTeeth = drumTeeth(DIAL.cx, DIAL.half, DIAL.top, dialEdge);

const dialArrows: Record<DrawingHeld, ArrowPaths> = {
  press: pushArrow(DIAL.cx, dialEdge(DIAL.cx) - 3, 32),
  decrease: turnArrow(DIAL.cx, 56, 46, 'decrease'),
  increase: turnArrow(DIAL.cx, 56, 46, 'increase'),
};

/** A command dial: a knurled drum seen edge-on in its housing. */
export function CommandDialDrawing(props: { held?: DrawingHeld }) {
  return (
    <span class="control-drawing dial-drawing" data-held={props.held}>
      <svg viewBox="0 0 120 64" aria-hidden="true">
        <rect class="housing" x="6" y="6" width="108" height="27" rx="10" />
        <path class="groove line" d={dialBody} />
        <For each={dialTeeth}>{(tooth) => <path class="face tooth" d={tooth} />}</For>
        <rect
          class="face rim"
          x={DIAL.cx - DIAL.half}
          y={DIAL.top - 1.5}
          width={DIAL.half * 2}
          height="4.2"
          rx="2.1"
        />
        <Arrow paths={props.held && dialArrows[props.held]} />
      </svg>
    </span>
  );
}

const ROCKER = { cx: 60, top: 13, half: 47, tab: 10 };
const rockerEdge = lowerEdge(ROCKER.cx, ROCKER.half, ROCKER.top, 2.5, 15);
const rockerBand = silhouette(ROCKER.cx, ROCKER.half, ROCKER.top, rockerEdge);
const rockerLines = rockerRidges(ROCKER.cx, ROCKER.half, ROCKER.top, ROCKER.tab, rockerEdge);
const tabBottom = rockerEdge(ROCKER.cx) + 4.5;
const rockerTab = (() => {
  const { cx, top, tab } = ROCKER;
  return `M${cx - tab} ${top} V${n(rockerEdge(cx - tab))} H${cx - tab + 2.2} V${n(tabBottom)} H${cx + tab - 2.2} V${n(rockerEdge(cx + tab))} H${cx + tab} V${top} Z`;
})();
const rockerRecess = (() => {
  const { cx, top, half } = ROCKER;
  const l = cx - half - 7;
  const r = cx + half + 7;
  return `M${l} ${top + 16} V${top + 3} Q${l} ${top - 4} ${cx - half} ${top - 4} H${cx + half} Q${r} ${top - 4} ${r} ${top + 3} V${top + 16}`;
})();

const rockerArrows: Record<DrawingHeld, ArrowPaths> = {
  press: pushArrow(ROCKER.cx, tabBottom - 1, 30),
  decrease: turnArrow(ROCKER.cx, 54, 44, 'decrease'),
  increase: turnArrow(ROCKER.cx, 54, 44, 'increase'),
};

/** A rocker: a bowed knurled band with a smooth center tab, set into the body edge. */
export function RockerDrawing(props: { held?: DrawingHeld }) {
  return (
    <span class="control-drawing rocker-drawing" data-held={props.held}>
      <svg viewBox="0 0 120 66" aria-hidden="true">
        <RockerShape />
        <Arrow paths={props.held && rockerArrows[props.held]} />
      </svg>
    </span>
  );
}

function RockerShape() {
  return (
    <>
      <path class="housing" d={rockerRecess} />
      <path class="face line" d={rockerBand} />
      <For each={rockerLines}>{(ridge) => <path class="ridge" d={ridge} />}</For>
      <path class="smooth line" d={rockerTab} />
    </>
  );
}
