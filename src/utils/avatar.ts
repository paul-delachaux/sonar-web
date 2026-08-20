export const AVATAR_COLORS = [
  '#ea580c',
  '#dc2626',
  '#d97706',
  '#16a34a',
  '#0891b2',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#0f766e',
  '#4f46e5',
  '#b45309',
  '#be123c',
];

export function pickAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

export function avatarInitial(username: string): string {
  const trimmed = (username || '?').trim();
  return (trimmed.charAt(0) || '?').toUpperCase();
}

export const PENDING_AVATAR_KEY = 'sonar_pending_avatar';
const AVATAR_EXPORT_SIZE = 512;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function loadImage(file: File): Promise<HTMLImageElement | ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fallback ci-dessous */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Impossible de lire l’image.'));
      img.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function normalizeAvatarPng(file: File): Promise<File> {
  const source = await loadImage(file);
  const srcW = 'naturalWidth' in source ? source.naturalWidth || source.width : source.width;
  const srcH = 'naturalHeight' in source ? source.naturalHeight || source.height : source.height;
  if (!srcW || !srcH) throw new Error('Image invalide.');

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_EXPORT_SIZE;
  canvas.height = AVATAR_EXPORT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const scale = Math.max(AVATAR_EXPORT_SIZE / srcW, AVATAR_EXPORT_SIZE / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  ctx.drawImage(source, (AVATAR_EXPORT_SIZE - dw) / 2, (AVATAR_EXPORT_SIZE - dh) / 2, dw, dh);

  if ('close' in source && typeof source.close === 'function') {
    source.close();
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((next) => {
      if (next) resolve(next);
      else reject(new Error('Impossible de générer le PNG.'));
    }, 'image/png');
  });

  return new File([blob], 'avatar.png', { type: 'image/png' });
}

export async function stashPendingAvatar(email: string, file: File): Promise<void> {
  const dataUrl = await fileToDataUrl(file);
  localStorage.setItem(
    PENDING_AVATAR_KEY,
    JSON.stringify({
      email: email.trim().toLowerCase(),
      dataUrl,
      type: file.type || 'image/jpeg',
      name: file.name || 'avatar.jpg',
    })
  );
}

export function clearPendingAvatar() {
  localStorage.removeItem(PENDING_AVATAR_KEY);
}

export async function uploadAccountAvatar(
  supabase: { storage: any; from: any },
  userId: string,
  file: File
): Promise<string> {
  let prepared = file;
  try {
    prepared = await normalizeAvatarPng(file);
  } catch {
    prepared = file;
  }

  const isPng = prepared.type === 'image/png';
  const path = `${userId}/avatar.${isPng ? 'png' : 'jpg'}`;
  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, prepared, {
    upsert: true,
    contentType: prepared.type || (isPng ? 'image/png' : 'image/jpeg'),
    cacheControl: '3600',
  });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data: publicData } = supabase.storage.from('avatars').getPublicUrl(path);
  const publicUrl = `${publicData.publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await supabase
    .from('accounts')
    .update({ avatar_url: publicUrl })
    .eq('id', userId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return publicUrl;
}

export async function flushPendingAvatar(supabase: { auth: any; storage: any; from: any }): Promise<string | null> {
  const raw = localStorage.getItem(PENDING_AVATAR_KEY);
  if (!raw) return null;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.email) return null;

  let pending: { email?: string; dataUrl?: string; type?: string; name?: string };
  try {
    pending = JSON.parse(raw);
  } catch {
    clearPendingAvatar();
    return null;
  }

  if (!pending.dataUrl || pending.email !== session.user.email.toLowerCase()) {
    return null;
  }

  const blob = await (await fetch(pending.dataUrl)).blob();
  const file = new File([blob], pending.name || 'avatar.jpg', {
    type: pending.type || blob.type || 'image/jpeg',
  });

  const url = await uploadAccountAvatar(supabase, session.user.id, file);
  clearPendingAvatar();
  return url;
}
