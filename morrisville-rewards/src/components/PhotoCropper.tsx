import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { cropToJpeg, decodeImage, type Decoded } from "../lib/image";
import { Button, InlineError } from "./ui";
import LogoLoader from "./LogoLoader";

const VIEW = 280; // on-screen crop box, CSS px
const MAX_ZOOM = 4;

/**
 * Square photo crop: drag to move, pinch / slider / scroll wheel to zoom. The round frame shows
 * exactly what appears on the leaderboard. Returns a 320×320 JPEG.
 */
export default function PhotoCropper({
  file,
  busy,
  onCancel,
  onConfirm,
}: {
  file: Blob;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (photo: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [img, setImg] = useState<Decoded | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let live = true;
    decodeImage(file)
      .then((d) => {
        if (!live) return;
        setImg(d);
        setCenter({ x: d.width / 2, y: d.height / 2 });
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : "That photo couldn't be opened."));
    return () => {
      live = false;
    };
  }, [file]);

  const base = img ? VIEW / Math.min(img.width, img.height) : 1;
  const scale = base * zoom; // screen px per photo px
  const visible = VIEW / scale; // photo px across the crop box
  const clamp = (c: { x: number; y: number }) => {
    if (!img) return c;
    const half = visible / 2;
    return {
      x: Math.min(Math.max(c.x, half), img.width - half),
      y: Math.min(Math.max(c.y, half), img.height - half),
    };
  };
  const c = clamp(center);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = VIEW * dpr;
    canvas.height = VIEW * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, c.x - visible / 2, c.y - visible / 2, visible, visible, 0, 0, canvas.width, canvas.height);
  }, [img, c.x, c.y, visible]);

  const setZoomClamped = (z: number) => setZoom(Math.min(MAX_ZOOM, Math.max(1, z)));

  function down(e: ReactPointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  function move(e: ReactPointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const pts = [...pointers.current.entries()];
    if (pts.length === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      setCenter(clamp({ x: c.x - dx / scale, y: c.y - dy / scale }));
    } else if (pts.length === 2) {
      const other = pts.find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (before > 0) setZoomClamped(zoom * (after / before));
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  function up(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId);
  }

  if (error) {
    return (
      <div className="stack">
        <InlineError>{error}</InlineError>
        <Button variant="secondary" block onClick={onCancel}>
          Choose another photo
        </Button>
      </div>
    );
  }
  if (!img) return <LogoLoader label="Opening photo" />;

  return (
    <div className="cropper">
      <div
        className="cropper-frame"
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={(e) => setZoomClamped(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
        role="img"
        aria-label="Drag to move the photo, pinch to zoom"
      >
        <canvas ref={canvasRef} style={{ width: VIEW, height: VIEW }} />
        <span className="cropper-ring" aria-hidden />
      </div>
      <label className="cropper-zoom">
        <ZoomOut size={18} aria-hidden />
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoomClamped(Number(e.target.value))}
          aria-label="Zoom"
        />
        <ZoomIn size={18} aria-hidden />
      </label>
      <div className="cropper-actions">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            try {
              onConfirm(await cropToJpeg(img, c.x - visible / 2, c.y - visible / 2, visible));
            } catch (err) {
              setError(err instanceof Error ? err.message : "That photo couldn't be prepared.");
            }
          }}
        >
          Use photo
        </Button>
      </div>
    </div>
  );
}
