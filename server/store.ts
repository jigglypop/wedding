import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Material, PlanState, Venue, VenueChecklist } from '../src/types';
import { ConflictError, HttpError, deleteItem, getItem, localDir, putItem, queryItems, storageKind, type Item } from './db';
import { ValidationError, validateState, venueChecklistSchema } from './model';
import { genericVenueChecklist, starterState } from './starter';
import { normalizeVenue, scopeVenueChecklist } from '../src/lib/venue-checklist';

export { HttpError } from './db';
// The private Notion/Excel library may only be used by the original couple's workspace.
export const MAIN_WORKSPACE = 'main';
const dataDir = () => process.env.DATA_DIR || resolve(process.cwd(), 'data');
type StateItem = Item & { payload:string; version:number };
type MaterialItem = Item & { material:Material };

export async function readData<T>(filename:string):Promise<T> { return JSON.parse(await readFile(resolve(dataDir(), filename), 'utf8')); }
const conflict = () => new HttpError(409, '다른 화면에서 먼저 변경되었어요. 최신 내용을 불러온 뒤 다시 시도해 주세요.', 'conflict');

type PrivateVenueChecklist = VenueChecklist & { venues:string[] };
const privateChecklistSchema = venueChecklistSchema.and(z.object({ venues:z.array(z.string().min(1).max(300)).max(100) }));
// Kept outside browser assets and returned only to the original workspace after authentication.
export async function getVenueChecklist(workspace:string):Promise<VenueChecklist> {
  if (workspace !== MAIN_WORKSPACE) return structuredClone(genericVenueChecklist);
  const { venues:_venues, ...template } = privateChecklistSchema.parse(await readData<PrivateVenueChecklist>('venue-checklist.json'));
  return scopeVenueChecklist(template);
}
async function seededVenues(workspace:string):Promise<Venue[]> {
  if (workspace !== MAIN_WORKSPACE) return [];
  const template = privateChecklistSchema.parse(await readData<PrivateVenueChecklist>('venue-checklist.json'));
  return template.venues.map((name, index) => normalizeVenue({ id:`excel-venue-${index + 1}`, name, status:'researching', visitDate:'', contact:'', url:'', notes:'', answers:{} }));
}
const hasVenues = (input:unknown) => !!input && typeof input === 'object' && Object.hasOwn(input, 'venues');
const needsVenueMigration = (input:unknown) => !hasVenues(input) || !!input && typeof input === 'object' && 'venues' in input && Array.isArray(input.venues) && input.venues.some(venue => venue && typeof venue === 'object' && !Object.hasOwn(venue, 'halls'));
async function initializeVenues(input:unknown, workspace:string):Promise<PlanState> {
  return validateState(hasVenues(input) ? input : { ...input as object, venues:await seededVenues(workspace) }, (await getVenueChecklist(workspace)).fields);
}
async function legacyState():Promise<unknown|null> {
  if (storageKind === 'dynamodb') { const item = await getItem<StateItem>('PLAN', 'STATE'); return item ? JSON.parse(item.payload) : null; }
  try { return JSON.parse(await readFile(resolve(localDir(), 'state.json'), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
async function initialState(workspace:string) {
  if (workspace === MAIN_WORKSPACE) { const legacy = await legacyState(); if (legacy) return initializeVenues(legacy, workspace); }
  const state = workspace === MAIN_WORKSPACE ? await initializeVenues(await readData<PlanState>('initial-state.json'), workspace) : starterState();
  return { ...state, version:1, updatedAt:new Date().toISOString() };
}

export async function getState(workspace:string):Promise<PlanState> {
  const item = await getItem<StateItem>(`WS#${workspace}`, 'STATE');
  if (item) {
    const raw:unknown = JSON.parse(item.payload);
    if (!needsVenueMigration(raw)) return validateState(raw);
    // An old payload is migrated exactly once. A concurrent edit wins the condition and is re-read.
    const migrated = validateState({ ...await initializeVenues(raw, workspace), version:item.version + 1, updatedAt:new Date().toISOString() });
    try { await putItem({ ...item, payload:JSON.stringify(migrated), version:migrated.version }, { field:'version', equals:item.version }); }
    catch (e) { if (e instanceof ConflictError) return getState(workspace); throw e; }
    return migrated;
  }
  const initial = await initialState(workspace);
  try { await putItem({ pk:`WS#${workspace}`, sk:'STATE', payload:JSON.stringify(initial), version:initial.version }, { absent:true }); }
  catch (e) { if (e instanceof ConflictError) return getState(workspace); throw e; }
  return initial;
}

export async function saveState(workspace:string, input:PlanState, expectedVersion:number):Promise<PlanState> {
  let state:PlanState;
  try { state = validateState({ ...input, version:expectedVersion + 1, updatedAt:new Date().toISOString() }); }
  catch (e) { if (e instanceof ValidationError) throw new HttpError(400, e.message); throw e; }
  try { await putItem({ pk:`WS#${workspace}`, sk:'STATE', payload:JSON.stringify(state), version:state.version }, { field:'version', equals:expectedVersion }); }
  catch (e) { if (e instanceof ConflictError) throw conflict(); throw e; }
  return state;
}

// Applies a change to the newest state, retrying when another member saved first.
// The callback edits the draft in place (or returns a replacement); returning null keeps the state unchanged.
export async function mutateState(workspace:string, change:(state:PlanState) => PlanState|null|void, attempts = 4):Promise<PlanState> {
  for (let attempt = 1; ; attempt++) {
    const current = await getState(workspace);
    const draft = structuredClone(current);
    let next:PlanState|null|void;
    try { next = change(draft); }
    catch (e) { if (e instanceof ValidationError) throw new HttpError(409, e.message); throw e; }
    if (next === null) return current;
    try { return await saveState(workspace, next || draft, current.version); }
    catch (e) { if (!(e instanceof HttpError && e.code === 'conflict') || attempt >= attempts) throw e; }
  }
}

export async function deleteState(workspace:string) { await deleteItem(`WS#${workspace}`, 'STATE'); }

let bundled:Material[]|null = null;
export async function bundledMaterials() {
  if (!bundled) { const raw = await readData<Material[]|{ materials:Material[] }>('materials.json'); bundled = Array.isArray(raw) ? raw : raw.materials; }
  return bundled;
}
export async function uploadedMaterials(workspace:string) { return (await queryItems<MaterialItem>(`WS#${workspace}`, 'MAT#')).map(item => item.material); }
export async function getMaterials(workspace:string):Promise<Material[]> {
  const uploads = await uploadedMaterials(workspace);
  return workspace === MAIN_WORKSPACE ? [...await bundledMaterials(), ...uploads] : uploads;
}
export async function addMaterial(workspace:string, material:Material) { await putItem({ pk:`WS#${workspace}`, sk:`MAT#${material.id}`, material, createdAt:new Date().toISOString() }, { absent:true }); }
export async function removeMaterial(workspace:string, id:string) { await deleteItem(`WS#${workspace}`, `MAT#${id}`); }
