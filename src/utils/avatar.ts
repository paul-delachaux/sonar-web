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

function fileExtension(file: File): string {
  const fromName = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (fromName) return fromName;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
  const ext = fileExtension(file);
  const path = `${userId}/avatar.${ext}`;
  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, {
    upsert: true,
    contentType: file.type || 'image/jpeg',
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
