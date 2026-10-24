const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const idPattern = /^[\w-]{1,100}$/;
const mimeExtensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const reviewImageFilePattern = /^[\w-]{1,100}-(?:[01]\.(?:png|jpg|webp)|preview-(?:desktop|mobile|asset|viewport-[1-4])-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg)$/i;
const reviewImageIdPattern = /^([\w-]{1,100})\/([\w-]{1,100}-(?:[01]\.(?:png|jpg|webp)|preview-(?:desktop|mobile|asset|viewport-[1-4])-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg))$/i;

function createImageStore(app) {
  const root = path.join(app.getPath('userData'), 'agent-images');
  fs.mkdirSync(root, { recursive: true });
  const issuedPreviews = new Map();
  const issuedReviewImages = new Set();
  function save(taskId, requestId, images) {
    if (![taskId, requestId].every(id => typeof id === 'string' && idPattern.test(id))) throw new Error('Invalid image task ID.');
    if (!Array.isArray(images) || images.length > 2) throw new Error('Attach at most two reference images per turn.');
    const directory = path.join(root, taskId);
    fs.mkdirSync(directory, { recursive: true });
    return images.map((image, index) => {
      const extension = mimeExtensions[image?.mime];
      if (!extension || typeof image.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) throw new Error('Unsupported reference image.');
      const data = Buffer.from(image.data, 'base64');
      if (!data.length || data.length > 800_000) throw new Error('Reference image exceeds the 800 KB processed-image limit.');
      const valid = image.mime === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : image.mime === 'image/jpeg' ? data[0] === 0xff && data[1] === 0xd8
          : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
      if (!valid) throw new Error('Reference image data does not match its format.');
      const file = path.join(directory, `${requestId}-${index}${extension}`);
      fs.writeFileSync(file, data, { mode: 0o600 });
      return { type: 'orvix_image_ref', file, mime: image.mime, name: String(image.name ?? 'Reference image').slice(0, 120) };
    });
  }
  function read(ref) {
    const file = path.resolve(String(ref?.file ?? ''));
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !Object.hasOwn(mimeExtensions, ref?.mime)) throw new Error('Invalid image reference.');
    const data = fs.readFileSync(file);
    if (!data.length || data.length > 1_000_000) throw new Error('Saved reference image is unavailable or too large.');
    return data.toString('base64');
  }
  function reviewImageMeta(taskId, requestId, ref) {
    if (![taskId, requestId].every(id => typeof id === 'string' && idPattern.test(id))) return null;
    const file = path.resolve(String(ref?.file ?? ''));
    const relative = path.relative(root, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    const parts = relative.split(path.sep);
    if (parts.length !== 2 || !idPattern.test(parts[0]) || !reviewImageFilePattern.test(parts[1])) return null;
    const extension = path.extname(parts[1]).toLowerCase();
    const mime = Object.keys(mimeExtensions).find(type => mimeExtensions[type] === extension);
    if (!mime || ref?.mime !== mime) return null;
    try {
      const imageRoot = fs.realpathSync(root);
      const directory = fs.realpathSync(path.join(root, parts[0]));
      const realFile = fs.realpathSync(file);
      if (path.dirname(directory) !== imageRoot || path.dirname(realFile) !== directory) return null;
      const stat = fs.statSync(realFile);
      if (!stat.isFile() || stat.size < 1 || stat.size > 1_000_000) return null;
    } catch { return null; }
    const id = `${parts[0]}/${parts[1]}`;
    const accessKey = `${taskId}\0${requestId}\0${id}`;
    issuedReviewImages.add(accessKey);
    if (issuedReviewImages.size > 4096) issuedReviewImages.delete(issuedReviewImages.values().next().value);
    const suppliedName = String(ref?.name ?? '').replace(/\\/g, '/').split('/').pop().slice(0, 120);
    return { id, name: suppliedName || 'Review image', mime };
  }
  function readReviewImage(taskId, requestId, imageId, allowSavedActivity = false) {
    if (![taskId, requestId].every(id => typeof id === 'string' && idPattern.test(id)) || typeof imageId !== 'string') throw new Error('Invalid review image request.');
    const match = reviewImageIdPattern.exec(imageId);
    const accessKey = `${taskId}\0${requestId}\0${imageId}`;
    if (!match || (!issuedReviewImages.has(accessKey) && !allowSavedActivity)) throw new Error('This image is not attached to the requested visual review.');
    const [, imageTaskId, filename] = match;
    const directory = path.resolve(root, imageTaskId);
    const file = path.resolve(directory, filename);
    if (path.dirname(directory) !== path.resolve(root) || path.dirname(file) !== directory) throw new Error('Invalid review image path.');
    const realRoot = fs.realpathSync(root);
    const realDirectory = fs.realpathSync(directory);
    const realFile = fs.realpathSync(file);
    if (path.dirname(realDirectory) !== realRoot || path.dirname(realFile) !== realDirectory) throw new Error('Review image path is outside its task folder.');
    const stat = fs.statSync(realFile);
    if (!stat.isFile() || stat.size < 1 || stat.size > 1_000_000) throw new Error('Review image is unavailable or too large.');
    const data = fs.readFileSync(realFile);
    const extension = path.extname(filename).toLowerCase();
    const mime = Object.keys(mimeExtensions).find(type => mimeExtensions[type] === extension);
    if (!mime) throw new Error('Unsupported review image format.');
    return { mime, data: data.toString('base64') };
  }
  function savePreview(taskId, requestId, label, data) {
    if (![taskId, requestId].every(id => typeof id === 'string' && idPattern.test(id)) || !/^(desktop|mobile|asset|viewport-[1-4])$/.test(label)) throw new Error('Invalid preview image ID.');
    const directory = path.join(root, taskId);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${requestId}-preview-${label}-${crypto.randomUUID()}.jpg`);
    if (!Buffer.isBuffer(data) || !data.length || data.length > 1_000_000) throw new Error('Preview screenshot is too large.');
    fs.writeFileSync(file, data, { mode: 0o600 });
    const ref = { type: 'orvix_image_ref', file, mime: 'image/jpeg', name: `${label} preview` };
    issuedPreviews.set(path.resolve(file), { taskId, ref });
    return ref;
  }
  function forget(taskId) {
    if (typeof taskId !== 'string' || !idPattern.test(taskId)) throw new Error('Invalid image task ID.');
    const directory = path.resolve(root, taskId);
    if (path.dirname(directory) !== path.resolve(root)) throw new Error('Invalid image directory.');
    fs.rmSync(directory, { recursive: true, force: true });
    for (const [file, saved] of issuedPreviews) if (saved.taskId === taskId) issuedPreviews.delete(file);
    for (const key of issuedReviewImages) if (key.startsWith(`${taskId}\0`)) issuedReviewImages.delete(key);
  }
  function previewFor(taskId, file) {
    const saved = issuedPreviews.get(path.resolve(String(file ?? '')));
    return saved?.taskId === taskId ? saved.ref : null;
  }
  return { save, read, savePreview, previewFor, reviewImageMeta, readReviewImage, forget };
}

module.exports = { createImageStore };
