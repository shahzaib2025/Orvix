// Keep browser evidence in the same labelled order on direct and native routes.
function visualImages(value) {
  const images = [], seen = new Set();
  const add = (ref, name) => {
    if (!ref?.file || seen.has(ref.file)) return;
    seen.add(ref.file); images.push({ ...ref, name: name || ref.name });
  };
  for (const view of value?.views ?? []) {
    add(view.image, `${view.label} page`);
    for (const frame of view.motion?.frames ?? []) add(frame.image, `${view.label} motion: ${frame.label}`);
  }
  for (const ref of value?.images ?? []) add(ref);
  return images;
}
module.exports = { visualImages };
