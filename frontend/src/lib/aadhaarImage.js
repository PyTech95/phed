// Aadhaar PVC-card proportions; identical output dimensions for both sides.
export const AADHAAR_WIDTH = 1600;
export const AADHAAR_HEIGHT = 1009;
export const AADHAAR_ASPECT = AADHAAR_WIDTH / AADHAAR_HEIGHT;
export const AADHAAR_ACCEPT = 'image/jpeg,image/png,image/webp';

export function validateAadhaarPhoto(file) {
  if (!AADHAAR_ACCEPT.split(',').includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.');
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('Choose a photo smaller than 20 MB.');
}

function toJpeg(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob?.type === 'image/jpeg') resolve(blob);
    else reject(new Error('Photo could not be prepared. Please try again.'));
  }, 'image/jpeg', 0.94));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This photo cannot be opened. Choose another photo.'));
    image.src = url;
  });
}

export async function normalizeAadhaarPhoto(file) {
  validateAadhaarPhoto(file);
  let bitmap, url;
  try {
    // Decode EXIF once, then remove it by drawing onto a canvas.
    bitmap = typeof createImageBitmap === 'function'
      ? await createImageBitmap(file, { imageOrientation: 'from-image' })
      : await loadImage(url = URL.createObjectURL(file));
    if (bitmap.width * bitmap.height > 64000000) throw new Error('Photo resolution is too large. Choose a smaller photo.');
    const scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await toJpeg(canvas);
  } catch (error) {
    throw new Error(error.message?.includes('resolution') ? error.message : 'This photo cannot be opened. Choose another JPEG, PNG or WebP photo.');
  } finally {
    bitmap?.close?.();
    if (url) URL.revokeObjectURL(url);
  }
}

export async function cropAadhaarPhoto(url, area, rotation, side) {
  if (!area || area.width <= 0 || area.height <= 0) throw new Error('Select the card area first.');
  const image = await loadImage(url);
  const radians = rotation * Math.PI / 180;
  const rotatedWidth = Math.abs(Math.cos(radians)) * image.width + Math.abs(Math.sin(radians)) * image.height;
  const rotatedHeight = Math.abs(Math.sin(radians)) * image.width + Math.abs(Math.cos(radians)) * image.height;
  const canvas = document.createElement('canvas');
  canvas.width = AADHAAR_WIDTH; canvas.height = AADHAAR_HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Draw directly into the output crop, avoiding a second full-resolution canvas.
  ctx.scale(canvas.width / area.width, canvas.height / area.height);
  ctx.translate(rotatedWidth / 2 - area.x, rotatedHeight / 2 - area.y);
  ctx.rotate(radians);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  return new File([await toJpeg(canvas)], `aadhaar-${side}.jpg`, { type: 'image/jpeg' });
}