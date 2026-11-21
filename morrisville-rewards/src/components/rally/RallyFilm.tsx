import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";

type Point = [number, number, number];
type Projected = { x: number; y: number; scale: number };
export type BallHandoff = {
  x: number;
  y: number;
  diameter: number;
  // Screen velocity in CSS pixels per millisecond.
  vx: number;
  vy: number;
};

const durationMs = 1650;
const bounceTime = .58;
const ballRadius = .02;
const surface = 0.76;
const halfWidth = 0.7625;
const halfLength = 1.37;

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (p: Point): Point => {
  const length = Math.hypot(...p);
  return [p[0] / length, p[1] / length, p[2] / length];
};
const mix = (from: number, to: number, t: number) => from + (to - from) * t;

function ballPosition(t: number): Point {
  if (t <= bounceTime) {
    const descent = t / bounceTime;
    return [mix(-.54, .005, descent), surface + ballRadius + .64 * (1 - descent * descent), mix(.22, .49, descent)];
  }

  const rebound = (t - bounceTime) / (1 - bounceTime);
  const lift = .275 * rebound * (1.65 - .65 * rebound);
  return [mix(.005, .57, rebound), surface + ballRadius + lift, mix(.49, .65, rebound)];
}

function cameraProjection(width: number, height: number, t: number) {
  // Push toward the center of the net, keeping its midpoint near the next shot's focal point.
  const push = t * (2 - t);
  const camera: Point = [mix(2.55, .88, push), mix(1.62, 1.56, push), mix(3.45, 2.75, push)];
  const forward = unit(sub([0, .84, 0], camera));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const focal = Math.min(width * .82, height * 1.37);
  return (point: Point): Projected => {
    const relative = sub(point, camera);
    const scale = focal / dot(relative, forward);
    return { x: width / 2 + dot(relative, right) * scale, y: height * .48 - dot(relative, up) * scale, scale };
  };
}

function draw(ctx: CanvasRenderingContext2D, width: number, height: number, t: number): BallHandoff | undefined {
  const project = cameraProjection(width, height, t);

  function path(points: Point[]) {
    ctx.beginPath();
    points.forEach((point, i) => {
      const p = project(point);
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    });
  }
  function face(points: Point[], paint: string | CanvasGradient) {
    path(points);
    ctx.closePath();
    ctx.fillStyle = paint;
    ctx.fill();
  }
  function line(a: Point, b: Point, color: string, thickness = 1) {
    path([a, b]);
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.stroke();
  }
  function ellipse(point: Point, rx: number, rz: number, fill: string) {
    const ring: Point[] = Array.from({ length: 28 }, (_, i) => {
      const angle = i / 28 * Math.PI * 2;
      return [point[0] + rx * Math.cos(angle), point[1], point[2] + rz * Math.sin(angle)];
    });
    path(ring);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  ctx.clearRect(0, 0, width, height);
  const light = ctx.createRadialGradient(width * .50, height * .46, 6, width * .50, height * .47, Math.max(width * .56, height * .36));
  light.addColorStop(0, "#321022");
  light.addColorStop(0.64, "#100a12");
  light.addColorStop(1, "#080809");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, width, height);

  // Soft floor contact and legs give the tabletop depth as the camera moves.
  for (let i = 0; i < 7; i++) ellipse([0, 0.007, 0], 1.13 - i * .055, 1.63 - i * .05, "rgba(0,0,0,.15)");
  for (const z of [-1.06, 1.06]) {
    for (const x of [-0.60, 0.60]) {
      line([x, .72, z], [x * 1.06, .04, z * 1.06], "#201622", Math.max(3, width * .015));
      line([x, .72, z], [x * 1.06, .04, z * 1.06], "#51334a", Math.max(1, width * .003));
    }
    line([-.62,.36,z],[.62,.36,z],"#261b29", Math.max(2, width * .009));
  }
  const a: Point = [-halfWidth, surface, -halfLength];
  const b: Point = [halfWidth, surface, -halfLength];
  const c: Point = [halfWidth, surface, halfLength];
  const d: Point = [-halfWidth, surface, halfLength];
  const underside = (p: Point): Point => [p[0], p[1] - .07, p[2]];
  face([b,c,underside(c),underside(b)], "#482040");
  face([d,c,underside(c),underside(d)], "#4f2948");
  line(underside(d), underside(c), "#130b13", 2);

  const top = ctx.createLinearGradient(0, height * .18, width, height * .76);
  top.addColorStop(0, "#261323");
  top.addColorStop(.5, "#532447");
  top.addColorStop(1, "#281427");
  face([a,b,c,d], top);
  for (const [from,to] of [[a,b],[b,c],[c,d],[d,a]] as [Point,Point][]) line(from,to,"#f9a7ce",1.35);
  line([0,surface,-halfLength],[0,surface,halfLength],"#b6779c",.75);
  line(d,c,"#ffd2e5",1.65);

  const topY = surface + .153;
  const post = halfWidth + .029;
  face([[-post,surface,0],[post,surface,0],[post,topY,0],[-post,topY,0]],"rgba(23,13,24,.62)");
  for (let i = 0; i <= 30; i++) {
    const x = mix(-post, post, i / 30);
    line([x,surface,0],[x,topY,0],"rgba(226,158,197,.42)",.43);
  }
  for (let i = 1; i <= 4; i++) {
    const y = mix(surface, topY, i / 5);
    line([-post,y,0],[post,y,0],"rgba(226,158,197,.4)",.45);
  }
  for (const x of [-post, post]) line([x,surface-.025,0],[x,topY+.014,0],"#dea3c5",1.6);

  const rim = Math.pow(t, 3);
  ctx.save();
  ctx.shadowColor = "#ff0078";
  ctx.shadowBlur = rim * 16;
  line([-post,topY,0],[post,topY,0],`rgba(255,${Math.round(mix(222, 125, rim))},${Math.round(mix(235, 190, rim))},1)`, mix(1.65, 2.45, rim));
  ctx.restore();

  const ball = ballPosition(t);
  const position = project(ball);
  const radius = Math.max(mix(5, 9, t), Math.min(12, position.scale * ballRadius));
  if (t >= 1) {
    const sampleMs = 1;
    const previousTime = 1 - sampleMs / durationMs;
    const previous = cameraProjection(width, height, previousTime)(ballPosition(previousTime));
    return {
      x: position.x / width,
      y: position.y / height,
      diameter: radius * 2,
      vx: (position.x - previous.x) / sampleMs,
      vy: (position.y - previous.y) / sampleMs,
    };
  }

  const lift = ball[1] - surface - ballRadius;
  const contactPoint: Point = [ball[0], surface + .001, ball[2]];
  const groundY = project(contactPoint).y;
  const contactOffset = Math.max(0, position.y + radius - groundY) * Math.max(0, 1 - lift / .10);
  const centerY = position.y - contactOffset;
  const shadowRadius = .047 + lift * .064;
  ellipse(contactPoint, shadowRadius, shadowRadius * .84, `rgba(12,4,12,${.66 - Math.min(.52, lift)})`);

  const contact = 1 - Math.abs(t - bounceTime) / .027;
  const highlight = ctx.createRadialGradient(
    position.x - radius * .31, centerY - radius * .38, radius * .06,
    position.x, centerY, radius,
  );
  highlight.addColorStop(0, "#fff");
  highlight.addColorStop(.66, "#f7eff5");
  highlight.addColorStop(1, "#bd96ac");
  ctx.save();
  if (contact > 0) {
    ctx.shadowColor = "#ff9cc8";
    ctx.shadowBlur = contact * 12;
  }
  ctx.beginPath();
  ctx.arc(position.x, centerY, radius, 0, Math.PI * 2);
  ctx.fillStyle = highlight;
  ctx.fill();
  ctx.restore();
}

export function RallyFilm({ onFinish }: { onFinish: (handoff?: BallHandoff) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onFinish();
      return;
    }
    let frame = 0;
    const start = performance.now();
    function tick(now: number) {
      if (!element || !ctx) return;
      const { width, height } = element.getBoundingClientRect();
      const progress = Math.min(1, (now - start) / durationMs);
      let handoff: BallHandoff | undefined;
      if (width && height) {
        const density = Math.min(window.devicePixelRatio || 1, 2);
        const pixelWidth = Math.round(width * density);
        const pixelHeight = Math.round(height * density);
        if (element.width !== pixelWidth || element.height !== pixelHeight) {
          element.width = pixelWidth;
          element.height = pixelHeight;
        }
        ctx.setTransform(density, 0, 0, density, 0, 0);
        handoff = draw(ctx, width, height, progress);
      }
      if (progress < 1) frame = requestAnimationFrame(tick);
      else {
        // Swap to the close-up before paint so the ball has no empty or doubled frame.
        flushSync(() => onFinish(handoff));
      }
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [onFinish]);

  return <canvas className="rally-film" ref={canvas} aria-hidden="true" />;
}
