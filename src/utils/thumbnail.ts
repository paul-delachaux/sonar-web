export const THUMB_PRESETS = {
  // Case gauche de .main-grid (2fr sur 1200px, min-height 700px).
  hero: { w: 787, h: 700 },
  // Cartes paysage de la colonne gauche (rangée asymétrique) : ~443×170.
  strip: { w: 443, h: 170 },
  // Carte sidebar longue (1fr de la colonne droite) : ~393×321.
  brief: { w: 393, h: 321 },
  // Petites cartes du sub-grid sidebar : (colonne 393 − gap 15) / 2, hauteur de la rangée.
  tile: { w: 189, h: 323 },
} as const;

export type ThumbFormat = 'hero' | 'strip' | 'brief' | 'tile' | 'custom';

function asNum(v: unknown, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveFormat(raw: unknown): ThumbFormat {
  if (raw === 'custom') return 'custom';
  if (raw === 'brief') return 'brief';
  if (raw === 'tile') return 'tile';
  if (raw === 'strip' || raw === 'sidebar' || raw === 'landscape') return 'strip';
  return 'hero';
}

export function presetFor(format: ThumbFormat) {
  if (format === 'brief') return THUMB_PRESETS.brief;
  if (format === 'tile') return THUMB_PRESETS.tile;
  if (format === 'strip') return THUMB_PRESETS.strip;
  return THUMB_PRESETS.hero;
}

/** Recadre la composition pour remplir un nouveau cadre (cover + centrage). */
export function remapLayoutToFrame<T extends {
  frame: { w: number; h: number };
  images: Array<{ x: number; y: number; w: number; h: number; [k: string]: any }>;
  blocks: Array<{ x: number; y: number; size: number; w?: number; h?: number; [k: string]: any }>;
}>(layout: T, newW: number, newH: number): T {
  const oldW = Math.max(1, layout.frame.w);
  const oldH = Math.max(1, layout.frame.h);
  if (oldW === newW && oldH === newH) return layout;
  const scale = Math.max(newW / oldW, newH / oldH);
  const ox = (newW - oldW * scale) / 2;
  const oy = (newH - oldH * scale) / 2;
  return {
    ...layout,
    frame: { w: newW, h: newH },
    images: layout.images.map((img) => ({
      ...img,
      x: img.x * scale + ox,
      y: img.y * scale + oy,
      w: img.w * scale,
      h: img.h * scale,
    })),
    blocks: layout.blocks.map((b) => ({
      ...b,
      x: b.x * scale + ox,
      y: b.y * scale + oy,
      size: Math.max(8, b.size * scale),
      w: Math.max(24, (b.w ?? oldW * 0.55) * scale),
      h: Math.max(20, (b.h ?? b.size * 1.8) * scale),
    })),
  };
}

/** Normalise thumbnail_layout (ancien fond x/y/zoom → calques image). */
export function normalizeThumbLayout(raw: any, thumbnailBg?: string | null) {
  const plain = raw && typeof raw === 'object' ? raw : {};
  const format = resolveFormat(plain.format);
  const preset = presetFor(format);
  const frame = {
    w: Math.max(40, asNum(plain.frame?.w, preset.w)),
    h: Math.max(40, asNum(plain.frame?.h, preset.h)),
  };

  const rawBlocks = Array.isArray(plain.blocks)
    ? plain.blocks
    : Array.isArray(plain.descs)
      ? (plain.title && plain.title.x != null ? [plain.title].concat(plain.descs) : plain.descs)
      : [];

  let blocks = rawBlocks.map((b: any) => {
    const size = asNum(b.size, 20);
    return {
      line: b.line || '',
      x: asNum(b.x, 20),
      y: asNum(b.y, 20),
      size,
      w: Math.max(24, asNum(b.w, Math.round(frame.w * 0.55))),
      h: Math.max(20, asNum(b.h, Math.round(size * 1.8))),
      weight: b.weight || '700',
      font: b.font || 'sans-serif',
      color: b.color || '#ffffff',
      z: b.z == null ? undefined : asNum(b.z, 0),
    };
  });

  const hasImages = Array.isArray(plain.images);
  let images = hasImages
    ? plain.images.map((img: any, i: number) => ({
        src: String(img.src || ''),
        x: asNum(img.x, 0),
        y: asNum(img.y, 0),
        w: Math.max(20, asNum(img.w, frame.w)),
        h: Math.max(20, asNum(img.h, frame.h)),
        z: img.z == null ? i : asNum(img.z, i),
      })).filter((img: any) => img.src)
    : [];

  if (!hasImages && thumbnailBg) {
    const bg = plain.bg || {};
    const zoom = asNum(bg.zoom, 100);
    const w = Math.max(20, frame.w * zoom / 100);
    const h = Math.max(20, frame.h * zoom / 100);
    const xPct = asNum(bg.x, 50) / 100;
    const yPct = asNum(bg.y, 50) / 100;
    images = [{
      src: String(thumbnailBg),
      x: (frame.w - w) * xPct,
      y: (frame.h - h) * yPct,
      w,
      h,
      z: 0,
    }];
  }

  images = images.map((img, i) => ({
    ...img,
    z: img.z == null ? i : asNum(img.z, i),
  }));
  blocks = blocks.map((b, i) => ({
    ...b,
    z: b.z == null ? images.length + i : asNum(b.z, images.length + i),
  }));

  let layout = { format, frame, images, blocks };
  if (format !== 'custom') {
    const target = presetFor(format);
    if (frame.w !== target.w || frame.h !== target.h) {
      layout = remapLayoutToFrame(layout, target.w, target.h);
    }
  }
  return layout;
}
