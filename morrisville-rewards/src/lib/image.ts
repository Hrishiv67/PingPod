// Profile photos are resized on the phone before upload: a centered square, 320×320 JPEG
// (usually 20–40 KB), so boards load fast and nobody uploads a 12 MB camera original.

const SIZE = 320;

async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall back to an <img> below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function squareJpeg(file: Blob): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo (JPEG, PNG or HEIC).");
  let img: CanvasImageSource & { width: number; height: number };
  try {
    img = await decode(file);
  } catch {
    throw new Error("That photo couldn't be opened. Try another one.");
  }
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("That photo couldn't be prepared. Try another one.");
  return blob;
}

/** Data URL version, used by demo mode (photos stay in this browser). */
export async function squareJpegDataUrl(file: Blob): Promise<string> {
  const blob = await squareJpeg(file);
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("That photo couldn't be read."));
    r.readAsDataURL(blob);
  });
}
