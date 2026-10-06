import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand, type PutCommandInput, type QueryCommandOutput } from '@aws-sdk/lib-dynamodb';

export class HttpError extends Error { constructor(public status:number, message:string, public code?:string) { super(message); } }
export class ConflictError extends Error { constructor() { super('conditional write failed'); } }

export type Item = { pk:string; sk:string; [key:string]:unknown };
export type Condition = { absent:true } | { field:string; equals:number|undefined };

const table = process.env.DYNAMODB_TABLE;
const doc = table ? DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions:{ removeUndefinedValues:true } }) : null;
export const storageKind = doc ? 'dynamodb' : 'local';
export const localDir = () => process.env.LOCAL_DATA_DIR || resolve(process.cwd(), '.local');

// Local development store: one JSON file emulating the DynamoDB item model.
let local: Map<string, Item> | null = null;
let queue: Promise<unknown> = Promise.resolve();
const localKey = (pk:string, sk:string) => `${pk}\u0000${sk}`;
const dbFile = () => resolve(localDir(), 'db.json');
async function loadLocal() {
  if (local) return local;
  try { local = new Map(Object.entries((JSON.parse(await readFile(dbFile(), 'utf8')) as {items:Record<string, Item>}).items || {})); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; local = new Map(); }
  return local;
}
async function persistLocal() { await mkdir(dirname(dbFile()), { recursive:true }); await writeFile(dbFile(), JSON.stringify({ items:Object.fromEntries(local!) })); }
function exclusive<T>(task:() => Promise<T>) { const run = queue.then(task); queue = run.catch(() => undefined); return run; }
function satisfies(current:Item|undefined, condition:Condition) {
  if ('absent' in condition) return !current;
  const value = current?.[condition.field];
  return condition.equals === undefined ? value === undefined : value === condition.equals;
}
export function resetLocalStore() { local = null; }

export async function getItem<T extends Item>(pk:string, sk:string):Promise<T|null> {
  if (doc) return ((await doc.send(new GetCommand({ TableName:table, Key:{ pk, sk }, ConsistentRead:true }))).Item as T) || null;
  const item = (await loadLocal()).get(localKey(pk, sk));
  return item ? structuredClone(item) as T : null;
}

export async function putItem(item:Item, condition?:Condition) {
  if (doc) {
    const input:PutCommandInput = { TableName:table, Item:item };
    if (condition && 'absent' in condition) input.ConditionExpression = 'attribute_not_exists(pk)';
    else if (condition) {
      input.ExpressionAttributeNames = { '#field':condition.field };
      if (condition.equals === undefined) input.ConditionExpression = 'attribute_not_exists(#field)';
      else { input.ConditionExpression = '#field = :expected'; input.ExpressionAttributeValues = { ':expected':condition.equals }; }
    }
    try { await doc.send(new PutCommand(input)); }
    catch (e) { if ((e as Error).name === 'ConditionalCheckFailedException') throw new ConflictError(); throw e; }
    return;
  }
  await exclusive(async () => {
    const store = await loadLocal(); const key = localKey(item.pk, item.sk);
    if (condition && !satisfies(store.get(key), condition)) throw new ConflictError();
    store.set(key, structuredClone(item)); await persistLocal();
  });
}

export async function deleteItem(pk:string, sk:string) {
  if (doc) { await doc.send(new DeleteCommand({ TableName:table, Key:{ pk, sk } })); return; }
  await exclusive(async () => { const store = await loadLocal(); if (store.delete(localKey(pk, sk))) await persistLocal(); });
}

export async function queryItems<T extends Item>(pk:string, prefix = ''):Promise<T[]> {
  if (doc) {
    const items:T[] = []; let start:Record<string, unknown>|undefined;
    do {
      const page:QueryCommandOutput = await doc.send(new QueryCommand({ TableName:table, KeyConditionExpression:prefix ? 'pk = :pk AND begins_with(sk, :prefix)' : 'pk = :pk', ExpressionAttributeValues:prefix ? { ':pk':pk, ':prefix':prefix } : { ':pk':pk }, ConsistentRead:true, ExclusiveStartKey:start }));
      items.push(...(page.Items || []) as T[]); start = page.LastEvaluatedKey;
    } while (start);
    return items;
  }
  return [...(await loadLocal()).values()].filter(item => item.pk === pk && item.sk.startsWith(prefix)).sort((a, b) => a.sk.localeCompare(b.sk)).map(item => structuredClone(item) as T);
}

// Optimistic read-modify-write guarded by a `rev` counter. Returning null/undefined from `change` skips the write.
export async function mutateItem<T extends Item>(pk:string, sk:string, change:(current:T|null) => T|null|undefined, attempts = 5):Promise<T|null> {
  for (let attempt = 1; ; attempt++) {
    const current = await getItem<T>(pk, sk);
    const next = change(current ? structuredClone(current) : null);
    if (!next) return current;
    const rev = typeof current?.rev === 'number' ? current.rev : undefined;
    Object.assign(next, { pk, sk, rev:(rev ?? 0) + 1 });
    try { await putItem(next, current ? { field:'rev', equals:rev } : { absent:true }); return next; }
    catch (e) { if (!(e instanceof ConflictError) || attempt >= attempts) throw e; }
  }
}

const counters = new Map<string, number>();
const counterKey = (key:string, seconds:number) => { const bucket = Math.floor(Date.now() / 1000 / seconds); return { pk:`LIMIT#${key}#${bucket}`, ttl:(bucket + 2) * seconds }; };
// Adds one to a fixed-window counter and returns the new total.
export async function bump(key:string, seconds:number) {
  const { pk, ttl } = counterKey(key, seconds);
  if (doc) {
    const result = await doc.send(new UpdateCommand({ TableName:table, Key:{ pk, sk:'COUNT' }, UpdateExpression:'SET expiresAt = :ttl ADD #count :one', ExpressionAttributeNames:{ '#count':'count' }, ExpressionAttributeValues:{ ':ttl':ttl, ':one':1 }, ReturnValues:'UPDATED_NEW' }));
    return Number(result.Attributes?.count || 1);
  }
  const count = (counters.get(pk) || 0) + 1; counters.set(pk, count); if (counters.size > 5000) counters.clear();
  return count;
}
export async function peek(key:string, seconds:number) {
  const { pk } = counterKey(key, seconds);
  if (doc) return Number((await getItem<Item & { count?:number }>(pk, 'COUNT'))?.count || 0);
  return counters.get(pk) || 0;
}
export async function limit(key:string, max:number, seconds:number, message = '요청이 많아요. 잠시 후 다시 시도해 주세요.') {
  if (await bump(key, seconds) > max) throw new HttpError(429, message);
}
