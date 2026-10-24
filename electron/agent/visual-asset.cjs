const fs = require('node:fs');
const path = require('node:path');
const { isHiddenPath } = require('./file-policy.cjs');
const { canonicalTarget } = require('./workspace-manager.cjs');

async function readVisualAsset({ file, taskId, requestId, workspaces, imageStore, signal }) {
  if (signal.aborted) throw new Error('Task cancelled.');
  const issuedPreview = imageStore.previewFor?.(taskId, file);
  if (issuedPreview) {
    // Only images issued by this store for this task bypass workspace lookup.
    imageStore.read(issuedPreview);
    return { file: issuedPreview.file, images: [issuedPreview], note: 'Previously captured image from this task; reused without a new browser capture.' };
  }
  workspaces.assert(taskId, file);
  const target = canonicalTarget(file);
  workspaces.assert(taskId, target);
  if (isHiddenPath(file) || isHiddenPath(target) || !/\.(png|jpe?g|webp)$/i.test(target)) throw new Error('Choose a non-sensitive PNG, JPEG or WebP inside the approved workspace.');
  const stat = fs.statSync(target);
  if (!stat.isFile() || !stat.size || stat.size > 10_000_000) throw new Error('Visual assets must be files up to 10 MB.');
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  const source = await loadImage(fs.readFileSync(target));
  if (source.width * source.height > 40_000_000) throw new Error('Image exceeds the 40 megapixel limit.');
  const scale = Math.min(1, 1600 / Math.max(source.width, source.height));
  const canvas = createCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  let data;
  for (const quality of [75, 55, 35]) { data = canvas.toBuffer('image/jpeg', quality); if (data.length <= 1_000_000) break; }
  if (signal.aborted) throw new Error('Task cancelled.');
  return { file: target, name: path.basename(target), originalWidth: source.width, originalHeight: source.height,
    width: canvas.width, height: canvas.height, images: [imageStore.savePreview(taskId, requestId, 'asset', data)],
    note: 'Inspection copy is resized and transparent areas are shown on white. Original asset is unchanged.' };
}
module.exports = { readVisualAsset };
