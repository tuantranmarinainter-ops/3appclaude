// In-memory counterpart of agent/shot_package.py. No DOM or third-party dependencies.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = value => typeof value === 'number' && Number.isFinite(value);
export const safePackagePath = value => typeof value === 'string' && !!value.trim() &&
 !/^[\/]|^[A-Za-z]:|\\|\0/.test(value) && !value.split('/').includes('..');
export async function sha256(bytes) {
 return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
  .map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function inspectShot(files) {
 const issues = [], manifests = new Map();
 const issue = (code, path, message) => issues.push({code, path, message});
 const field = (obj, key, kind, path) => {
  const location = `${path}.${key}`;
  if (!Object.hasOwn(obj, key)) { issue('MISSING_FIELD', location, 'Required field is missing.'); return; }
  const value = obj[key], valid = kind === 'object' ? object(value) : kind === 'array' ? Array.isArray(value) :
   kind === 'number' ? number(value) : kind === 'integer' ? Number.isInteger(value) : typeof value === kind;
  if (!valid) { issue('INVALID_TYPE', location, `Expected ${kind}.`); return; }
  if (kind === 'string' && !value.trim()) { issue('INVALID_VALUE', location, 'Expected a non-empty string.'); return; }
  return value;
 };
 const version = (obj, path) => { const value = field(obj, 'version', 'string', path);
  if (value !== undefined && !/^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value)) issue('UNSUPPORTED_VERSION', `${path}.version`, 'Expected version 1.x.y.'); };
 const uuid = (obj, key, path) => { const value = field(obj, key, 'string', path);
  if (value !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
   issue('INVALID_UUID', `${path}.${key}`, 'Expected a lowercase hyphenated UUID.'); return; } return value; };
 const digest = (obj, key, path) => { const value = field(obj, key, 'string', path);
  if (value !== undefined && !/^[0-9a-fA-F]{64}$/.test(value)) { issue('INVALID_SHA256', `${path}.${key}`, 'Expected 64 hexadecimal characters.'); return; } return value?.toLowerCase(); };
 const file = (obj, key, path) => { const value = field(obj, key, 'string', path); if (value === undefined) return;
  if (!safePackagePath(value)) { issue('UNSAFE_PATH', `${path}.${key}`, 'Use a relative POSIX package path without .. .'); return; }
  // Match POSIX path normalization while never accepting traversal.
  const name = value.split('/').filter(part => part && part !== '.').join('/');
  if (!Object.hasOwn(files, name) || !(files[name] instanceof Uint8Array)) { issue('FILE_NOT_FOUND', `${path}.${key}`, `Package file does not exist: ${value}`); return; }
  return files[name];
 };
 const json = (bytes, path) => { if (!bytes) return; try {
  const value = JSON.parse(new TextDecoder('utf-8', {fatal:true,ignoreBOM:true}).decode(bytes));
  if (!object(value)) { issue('INVALID_TYPE', path, 'Expected a JSON object.'); return; } return value;
 } catch (error) { issue('INVALID_JSON', path, error.message); } };
 const hash = async (bytes, expected, path) => { if (!bytes || expected === undefined) return;
  try { if (await sha256(bytes) !== expected) issue('SHA256_MISMATCH', path, 'SHA-256 does not match the referenced file bytes.'); }
  catch (error) { issue('IO_ERROR', path, error.message); } };
 const vector = (obj, key, path) => { const value = field(obj, key, 'array', path);
  if (value && (value.length !== 3 || !value.every(number))) issue('INVALID_VALUE', `${path}.${key}`, 'Expected 3 finite numbers.'); };
 const objects = (obj, key, path, nonempty = false) => { const values = field(obj, key, 'array', path); if (!values) return [];
  if (nonempty && !values.length) issue('INVALID_VALUE', `${path}.${key}`, 'Expected at least one entry.');
  return values.flatMap((value, index) => { const location = `${path}.${key}[${index}]`;
   if (!object(value)) { issue('INVALID_TYPE', location, 'Expected an object.'); return []; } return [[value, location]]; }); };
 // Reject unsafe unused ZIP entries too: unzip never writes anything to disk.
 for (const name of Object.keys(files)) if (!safePackagePath(name)) issue('UNSAFE_PATH', name || 'zip', 'Unsafe ZIP entry.');
 const shot = json(file({file:'shot.json'}, 'file', 'shot.json'), 'shot.json');
 if (!shot) return {issues, shot:null, manifests};
 const path = 'shot.json'; version(shot, path); field(shot, 'shotId', 'string', path); field(shot, 'sceneId', 'string', path);
 const fps = field(shot, 'fps', 'integer', path); if (fps !== undefined && fps !== 30) issue('INVALID_FPS', `${path}.fps`, 'Shot FPS must be 30.');
 let frames = field(shot, 'frameRange', 'array', path);
 if (frames && (frames.length !== 2 || !frames.every(Number.isInteger) || frames[0] < 0 || frames[1] < frames[0])) {
  issue('INVALID_FRAME_RANGE', `${path}.frameRange`, 'Expected integer 0 <= start <= end.'); frames = undefined;
 }
 const camera = field(shot, 'camera', 'object', path);
 if (camera) { let previous; for (const [key, location] of objects(camera, 'keys', `${path}.camera`, true)) {
  const frame = field(key, 'frame', 'integer', location);
  if (frame !== undefined) {
   if (frame < 0 || frames && (frame < frames[0] || frame > frames[1])) issue('FRAME_OUT_OF_RANGE', `${location}.frame`, 'Frame is outside the shot range.');
   if (previous !== undefined && frame <= previous) issue('KEYS_NOT_INCREASING', `${location}.frame`, 'Frames must strictly increase.'); previous = frame;
  }
  vector(key, 'position', location); vector(key, 'lookAt', location);
  const fov = field(key, 'fovYDegrees', 'number', location); if (fov !== undefined && !(fov > 0 && fov < 180)) issue('INVALID_VALUE', `${location}.fovYDegrees`, 'Vertical FOV must be between 0 and 180 degrees.');
 } }
 const ids = new Set(); let editable = false;
 for (const [character, location] of objects(shot, 'characters', path)) {
  const id = field(character, 'characterId', 'string', location);
  if (id !== undefined) { if (ids.has(id)) issue('DUPLICATE_CHARACTER_ID', `${location}.characterId`, 'Character ID is duplicated.'); ids.add(id); }
  editable = field(character, 'editable', 'boolean', location) === true || editable;
  const glb = file(character, 'glb', location), expected = digest(character, 'glbSha256', location);
  await hash(glb, expected, `${location}.glbSha256`);
  const action = uuid(character, 'actionUuid', location), manifest = json(file(character, 'manifest', location), `${location}.manifest`);
  if (manifest) {
   const mp = `${location}.manifest`; version(manifest, mp); await hash(glb, digest(manifest, 'glbSha256', mp), `${mp}.glbSha256`);
   const uuids = new Set(); for (const [entry, ep] of objects(manifest, 'actions', mp, true)) {
    const value = uuid(entry, 'uuid', ep); if (value !== undefined) {
     if (uuids.has(value)) issue('DUPLICATE_ACTION_UUID', `${ep}.uuid`, 'Action UUID is duplicated.'); uuids.add(value);
    }
   }
   if (action !== undefined && !uuids.has(action)) issue('ACTION_NOT_IN_MANIFEST', `${location}.actionUuid`, 'Action UUID is absent from the manifest.');
   manifests.set(id, manifest);
  }
  const clip = field(character, 'clip', 'object', location);
  if (clip) { const cp = `${location}.clip`, start = field(clip, 'sourceStartSeconds', 'number', cp), end = field(clip, 'sourceEndSeconds', 'number', cp), speed = field(clip, 'speed', 'number', cp);
   field(clip, 'loop', 'boolean', cp); field(clip, 'reverse', 'boolean', cp);
   if (start < 0 || end < 0 || end < start || speed <= 0) issue('INVALID_CLIP', cp, 'Clip requires 0 <= start <= end and speed > 0.');
  }
  const placement = field(character, 'placement', 'object', location);
  if (placement) { vector(placement, 'position', `${location}.placement`); field(placement, 'yawDegrees', 'number', `${location}.placement`); }
  const root = field(character, 'rootPolicy', 'string', location);
  if (root !== undefined && !['skeletal', 'in-place'].includes(root)) issue('INVALID_ROOT_POLICY', `${location}.rootPolicy`, 'Expected skeletal or in-place.');
 }
 if (!editable) issue('NO_EDITABLE_CHARACTER', `${path}.characters`, 'At least one character must be editable.');
 for (const [reference, location] of objects(shot, 'references', path)) {
  await hash(file(reference, 'file', location), digest(reference, 'sha256', location), `${location}.sha256`);
  const transform = field(reference, 'transform', 'object', location);
  if (transform) for (const key of ['position', 'rotationDegrees', 'scale']) vector(transform, key, `${location}.transform`);
 }
 return {issues, shot, manifests};
}
export async function validateShot(files) { return (await inspectShot(files)).issues; }

// Resolve a shot-local time to the original Action, retaining trim, speed, reverse and loop.
export function shotSourceTime(clip, seconds) {
 const span = clip.sourceEndSeconds - clip.sourceStartSeconds;
 let offset = Math.max(0, seconds) * clip.speed;
 offset = clip.loop && span > 0 ? offset % span : Math.min(offset, span);
 return clip.reverse ? clip.sourceEndSeconds - offset : clip.sourceStartSeconds + offset;
}
