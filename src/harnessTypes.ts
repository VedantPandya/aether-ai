import { appUrl } from './urls';
export interface RunEvent { id:number; type:string; at:string; data:Record<string,any>; }
export interface WorkspaceFile { path:string; bytes:number; sha256:string; }
export interface AgentRun { id:string; task:string; provider:string; status:string; created_at:string; updated_at:string; summary:string; plan:{title:string;status:string}[]; steps:number; tokens:number; max_steps:number; token_budget:number; files:WorkspaceFile[]; has_simulation:boolean; events:RunEvent[]; }
export interface ToolDefinition { name:string; description:string; parameters:{properties:Record<string,unknown>}; }
export async function harnessApi<T>(path:string,body?:unknown,method?:string):Promise<T> {
 const r=await fetch(appUrl('/api/harness/')+path,{method:method??(body===undefined?'GET':'POST'),headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok){const data=await r.json().catch(()=>({}));throw new Error(typeof data.detail==='string'?data.detail:`Harness request failed (${r.status})`);}return r.json();
}
