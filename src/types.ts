export type Collection = 'tasks' | 'budgets' | 'vendors' | 'guests' | 'timeline' | 'notes';
export type Side = 'groom' | 'bride' | 'other';
export interface Task { id:string;title:string;category:string;dueDate:string;status:'todo'|'doing'|'done';notes:string;sourceId?:string }
export interface Budget { id:string;title:string;category:string;planned:number;actual:number;paid:number;notes:string;sourceId?:string }
export interface Vendor { id:string;name:string;category:string;status:'researching'|'contacted'|'booked';price:number;contact:string;url:string;notes:string;sourceId?:string }
export interface Guest { id:string;name:string;side:'bride'|'groom'|'other';group:string;people:number;rsvp:'pending'|'yes'|'no';table:string;contact:string;notes:string }
export interface TimelineItem { id:string;time:string;title:string;owner:string;notes:string }
export interface Note { id:string;title:string;content:string;category:string }
export interface Settings { coupleNames:string;weddingDate:string;venue:string;totalBudget:number;guestTarget:number }
export interface Activity { id:string;at:string;text:string;by?:string }
export interface Proposal { id:string;type:'upsert'|'delete'|'settings';collection?:Collection;item?:Record<string,unknown>;itemId?:string;settings?:Partial<Settings>;expectedItem?:Record<string,unknown>|null;expectedSettings?:Partial<Settings>;description:string }
export interface ChatMessage { id:string;role:'user'|'assistant';content:string;at:string;by?:string;proposals?:Proposal[];applied?:boolean;sources?:{id:string;title:string;sourceUrl?:string}[] }
export interface PlanState { version:number;updatedAt:string;settings:Settings;tasks:Task[];budgets:Budget[];vendors:Vendor[];guests:Guest[];timeline:TimelineItem[];notes:Note[];activity:Activity[];conversations:ChatMessage[] }
export interface Material { id:string;title:string;kind?:string;category:string;summary?:string;content?:string;filename?:string;thumbnail?:string;originalFilename?:string;sourceUrl?:string;sourceType?:string;mimeType?:string }
export interface SessionUser { username:string;name:string;side:Side;role:'admin'|'member';workspaceId:string }
export interface Member { username:string;name:string;side:Side;owner:boolean }
export interface WorkspaceInfo { id:string;members:Member[];maxMembers:number;invite:{code:string;side:Side;expiresAt:string}|null }
export interface Bootstrap { user:SessionUser;workspace:WorkspaceInfo;state:PlanState;materials:Material[];agentReady:boolean;model:string;privateLibrary:boolean;pendingUsers?:number }
export interface AdminUser { username:string;name:string;side:Side;role:'admin'|'member';status:'pending'|'active'|'suspended';workspaceId:string;createdAt:string;approvedAt?:string;lastLoginAt?:string;invitedBy?:string;partners:string[] }
export interface InvitePreview { inviterName:string;side:Side;expiresAt:string;mine?:boolean }
