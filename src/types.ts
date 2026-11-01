import { appUrl } from './urls';
export type MissionType = 'orbit' | 'lunar' | 'docking' | 'launch';
export interface Config { mission_type: MissionType; start_altitude_km: number; target_altitude_km: number; dry_mass_kg: number; payload_kg: number; fuel_kg: number; isp_s: number; station_rpm: number; }
export interface Sample { t: number; x: number; y: number; altitude_km: number; speed_m_s: number; fuel_kg: number; phase: string; distance_m?: number; station_angle?: number; }
export interface Burn { name: string; at_s: number; delta_v_m_s: number; description: string; }
export interface Plan { id: string; config: Config; status: string; feasible: boolean; success: boolean; delta_v_m_s: number; available_delta_v_m_s: number; fuel_required_kg: number; fuel_remaining_kg: number; duration_s: number; burns: Burn[]; assumptions: string[]; knowledge_ids: string[]; summary: string; samples?: Sample[]; final: Sample; }
export interface Trace { tier: number; name: string; duration_ms: number; output: unknown; }
export interface Message { role: 'user' | 'assistant'; content: string; trace?: Trace[]; }
export interface Mission { id: MissionType; name: string; subtitle: string; objective: string; model: string; defaults: Config; }
export interface Topic {
  id: string; title: string; category: string; equation: string; summary: string; details: string;
  related: string[]; sources: { title: string; url: string }[];
  regime?: string; assumptions?: string[]; limitations?: string[]; keywords?: string[];
  simulation_status?: 'implemented' | 'simplified' | 'reference_only'; simulation_notes?: string;
}
export interface Health { provider: string; key_configured: boolean; reasoning_model: string; decisions_model: string; }
export const DEFAULT_CONFIG: Config = { mission_type: 'orbit', start_altitude_km: 300, target_altitude_km: 800, dry_mass_kg: 500, payload_kg: 100, fuel_kg: 120, isp_s: 320, station_rpm: 0.2 };
export function duration(seconds: number) { if (seconds >= 86400) return `${(seconds / 86400).toFixed(1)} d`; if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} h`; return `${Math.round(seconds / 60)} min`; }
export function clock(seconds: number) { const h = Math.floor(seconds / 3600); const m = Math.floor(seconds % 3600 / 60); const s = Math.floor(seconds % 60); return [h, m, s].map(n => String(n).padStart(2, '0')).join(':'); }
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(appUrl(`/api/${path}`), { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(typeof result.detail === 'string' ? result.detail : `Request failed (${response.status}). Check the mission parameters.`); }
  return response.json();
}
