import { ORIGINAL_VERSION_ID, normalizeVersionState } from './model.js';

function cleanName(value, fallback) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, 120) || fallback;
}

function versionById(state, id) {
  return state.versions.find((version) => version.id === id) || null;
}

export function renameVersionState(input, id, name) {
  const state = normalizeVersionState(input);
  const target = versionById(state, id);
  if (!target) return { ok: false, reason: 'Version was not found.', state };
  const nextName = cleanName(name, target.name);
  return {
    ok: true,
    state: {
      ...state,
      versions: state.versions.map((version) => version.id === id ? { ...version, name: nextName } : version)
    }
  };
}

export function setActiveVersionState(input, id) {
  const state = normalizeVersionState(input);
  if (id === ORIGINAL_VERSION_ID || id === null) {
    return { ok: true, state: { ...state, activeVersionId: null } };
  }
  const target = versionById(state, id);
  if (!target) return { ok: false, reason: 'Version was not found.', state };
  if (target.status !== 'ready') return { ok: false, reason: 'Only a Ready Version can be set active.', state };
  return { ok: true, state: { ...state, activeVersionId: target.id } };
}

export function setBranchBaseState(input, id) {
  const state = normalizeVersionState(input);
  if (id === ORIGINAL_VERSION_ID) {
    return {
      ok: true,
      state: { ...state, baseVersionId: ORIGINAL_VERSION_ID, activeVersionId: null }
    };
  }
  const target = versionById(state, id);
  if (!target) return { ok: false, reason: 'Version was not found.', state };
  if (target.status !== 'ready') return { ok: false, reason: 'Only a Ready Version can be used as a branch base.', state };
  return {
    ok: true,
    state: { ...state, baseVersionId: target.id, activeVersionId: target.id }
  };
}

export function duplicateVersionState(input, id, {
  newId,
  createdAt,
  blobRef,
  sessionAvailable
} = {}) {
  const state = normalizeVersionState(input);
  const target = versionById(state, id);
  if (!target) return { ok: false, reason: 'Version was not found.', state };
  if (target.status !== 'ready') return { ok: false, reason: 'Only a Ready Version can be duplicated.', state };
  const duplicateId = cleanName(newId, '');
  if (!duplicateId || state.versions.some((version) => version.id === duplicateId)) {
    return { ok: false, reason: 'Duplicate Version needs a new stable ID.', state };
  }

  const copy = {
    ...target,
    id: duplicateId,
    createdAt: String(createdAt || '').slice(0, 64),
    name: cleanName(`${target.name} Copy`, 'Version Copy'),
    blobRef: blobRef || null,
    sessionAvailable: Boolean(sessionAvailable)
  };
  return {
    ok: true,
    version: copy,
    state: { ...state, versions: [...state.versions, copy] }
  };
}

export function deleteVersionState(input, id) {
  const state = normalizeVersionState(input);
  if (!id || id === ORIGINAL_VERSION_ID) {
    return { ok: false, reason: 'Original is immutable and cannot be deleted.', state };
  }
  const target = versionById(state, id);
  if (!target) return { ok: false, reason: 'Version was not found.', state };
  if (state.baseVersionId === id) {
    return { ok: false, reason: 'Branch from Original or another Version before deleting the current editing base.', state };
  }
  if (state.versions.some((version) => version.parentVersionId === id)) {
    return { ok: false, reason: 'Delete child Versions first so branch lineage is not broken.', state };
  }

  return {
    ok: true,
    state: {
      ...state,
      versions: state.versions.filter((version) => version.id !== id),
      activeVersionId: state.activeVersionId === id ? null : state.activeVersionId
    }
  };
}
