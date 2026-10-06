import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Material, PlanState } from '../src/types';
import { ConflictError, HttpError, deleteItem, getItem, localDir, putItem, queryItems, storageKind, type Item } from './db';
import { ValidationError, validateState } from './model';
import { starterState } from './starter';

export { HttpError } from './db';
// The private Notion/Excel library may only be used by the original couple's workspace.
export const MAIN_WORKSPACE = 'main';
const dataDir = () => process.env.DATA_DIR || resolve(process.cwd(), 'data');
type StateItem = Item & { payload:string; version:number };
type MaterialItem = Item & { material:Material };

export async function readData<T>(filename:string):Promise<T> { return JSON.parse(await readFile(resolve(dataDir(), filename), 'utf8')); }
const conflict = () => new HttpError(409, '다른 화면에서 먼저 변경되었어요. 최신 내용을 불러온 뒤 다시 시도해 주세요.', 'conflict');

async function legacyState():Promise<PlanState|null> {
  if (storageKind === 'dynamodb') { const item = await getItem<StateItem>('PLAN', 'STATE'); return item ? validateState(JSON.parse(item.payload)) : null; }
  try { return validateState(JSON.parse(await readFile(resolve(localDir(), 'state.json'), 'utf8'))); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
async function initialState(workspace:string) {
  if (workspace === MAIN_WORKSPACE) { const legacy = await legacyState(); if (legacy) return legacy; }
  const state = workspace === MAIN_WORKSPACE ? validateState(await readData<PlanState>('initial-state.json')) : starterState();
  return { ...state, version:1, updatedAt:new Date().toISOString() };
}

export async function getState(workspace:string):Promise<PlanState> {
  const item = await getItem<StateItem>(`WS#${workspace}`, 'STATE');
  if (item) return validateState(JSON.parse(item.payload));
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
