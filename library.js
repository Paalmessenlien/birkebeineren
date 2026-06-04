/*
 * library.js — a tiny localStorage "library" of saved field courses, shared by
 * the editor (writes) and the viewer (reads). Same origin → same storage, so a
 * course saved in editor.html shows up as a layer in index.html on the same
 * browser. (Cross-device sharing still needs GeoJSON export + commit.)
 */
const FELT_LIB_KEY = 'feltbane_library_v1';

function feltLibList() {
  try { return JSON.parse(localStorage.getItem(FELT_LIB_KEY)) || []; }
  catch (e) { return []; }
}
function feltLibWrite(list) {
  localStorage.setItem(FELT_LIB_KEY, JSON.stringify(list));
}
function feltSlug(name) {
  return (name || '').trim().toLowerCase()
    .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'o').replace(/[å]/g, 'a')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
// Insert or replace by slug(name). Returns the stored entry.
function feltLibSave(name, geojson) {
  const list = feltLibList();
  const id = feltSlug(name) || 'bane-' + (list.length + 1);
  const entry = { id, name: (name || '').trim() || id, geojson };
  const i = list.findIndex((e) => e.id === id);
  if (i >= 0) list[i] = entry; else list.push(entry);
  feltLibWrite(list);
  return entry;
}
function feltLibDelete(id) {
  feltLibWrite(feltLibList().filter((e) => e.id !== id));
}
function feltLibGet(id) {
  return feltLibList().find((e) => e.id === id) || null;
}
