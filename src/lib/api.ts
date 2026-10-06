export class ApiError extends Error { constructor(message:string, public status:number, public code?:string) { super(message); } }

export async function api<T>(path:string, body?:unknown, method?:string):Promise<T> {
  const response = await fetch(path, { method:method || (body === undefined ? 'GET' : 'POST'), credentials:'same-origin', headers:body === undefined ? undefined : { 'Content-Type':'application/json' }, body:body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || '요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.', response.status, data.code);
  return data as T;
}

export function readInviteCode() {
  const fromPath = location.pathname.match(/^\/invite\/([A-Za-z0-9_-]{10,64})/)?.[1];
  return fromPath || new URLSearchParams(location.search).get('invite') || null;
}
export function clearInviteUrl() { history.replaceState(null, '', '/'); }
