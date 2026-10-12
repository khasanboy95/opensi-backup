export type Page = 'personal' | 'home' | 'tasks' | 'workspace' | 'agents' | 'connections' | 'admin' | 'settings' | 'library' | 'flows' | 'media' | 'montage' | 'projects' | 'computer' | 'dashboard' | 'creative' | 'documents' | 'skills';
export interface User { id: string; name: string; email: string | null; role: string; local: boolean; token_limit: number }
export interface AuthConfig { configured: boolean; localMode: boolean; redirectUri: string }
export interface Provider { id: string; label: string; base_url: string; protocol: string; node_id?: string; hosted?: boolean; models: string[]; model_labels?: Record<string, string>; shared?: boolean; can_manage?: boolean; can_share?: boolean; has_key: boolean; enabled: boolean; verified_at: string | null; tested_at: string | null }
export interface Agent { id: string; name: string; description: string; prompt: string; tools: string[]; user_id?: string; provider_id?: string; model?: string }
export interface Project { id: string; title: string; environment: 'cloud' | 'local'; node_id: string | null; updated_at: string }
export interface Node { id: string; name: string; platform: string; workspace: string; online: boolean; hosted?: boolean; revoked: number; last_seen: string }
export interface Usage { input: number; output: number; unknown: number }
export interface Run { id: string; project_id: string; project_title?: string; prompt: string; status: string; model: string; provider_id: string; agent_id: string; environment: string; node_id: string | null; error?: string | null; created_at: string; updated_at: string; usage?: Usage }
export interface Message { role: string; content: string | null | { type: string; text?: string; image_url?: { url: string } }[]; tool_calls?: { function: { name: string; arguments: string } }[] }
export interface SavedMessage { id: string | number; role: string; message: Message; created_at: string; run_id: string }
export interface RunEvent { id: number; type: string; data: Record<string, any>; created_at: string }
export interface Approval { id: string; tool: string; args: Record<string, any>; status: string }
export interface LiveDraft { key: string; callId: string; path: string; content: string; state: string; bytes: number; lines: number; step: number; agent: string; depth: number; operation?: string; recoveredPath?: string }
export interface LiveTerminal { callId: string; command: string; output: string; state: string; exitCode?: number }
export interface LiveState { plan?: { title: string; status: "pending" | "in_progress" | "completed" }[]; phase: string; agent: string; model?: string; step: number; depth: number; receivedBytes: number; text: string; drafts: LiveDraft[]; terminals: LiveTerminal[]; updatedAt: string; startedAt?: string; tool?: string; path?: string; command?: string }
export interface ParallelTask { id:string;prompt:string;status:string;providerId?:string;model?:string;step:number;summary:string;error?:string|null;files:{path:string;state:string}[];createdAt:string;updatedAt:string }
export interface RunDetail { run: Run; project: Project; messages: SavedMessage[]; events: RunEvent[]; approvals: Approval[]; usage: Usage; cursor: number; live: LiveState | null; parallel?:ParallelTask[];recovery?: {state:string;attempts:number;resumes:number}|null;capabilities?: { cloudShell: boolean; browser?: boolean } }
export interface Attachment { id: string; name: string; mime: string; storage?: string; nodeId?: string; size?: number }
export interface FileInfo { path: string; size: number; updated_at: string }
export interface McpConnection { id: string; label: string; url: string; has_key: boolean; enabled: boolean; tools: { name: string; description: string }[] }
export interface Selection { model: string; agent: string; environment: 'cloud' | 'local'; node: string; autonomy?: 'guided'|'automatic'; destination?: 'cloud'|'folder'|'download'; folderName?:string; userId?:string }
export interface Overview { usersCount: number; runsCount: number; providersCount: number; usage: Usage; daily: { date: string; input: number; output: number }[]; byModel: { model: string; provider_id: string; input: number; output: number; unknown: number; requests: number }[]; loginEvents: { id: string; name: string | null; email: string | null; method: string; status: string; created_at: string }[]; users: AdminUser[]; google: AuthConfig }
export interface AdminUser { id: string; name: string; email: string; role: string; disabled: number; token_limit: number; tokens: number; last_login_at: string }
export const isActive = (status: string) => ['queued', 'running', 'waiting_approval', 'waiting_input'].includes(status);
export const statusLabels: Record<string, string> = { queued: 'Navbatda', running: 'Bajarilmoqda', waiting_approval: 'Tasdiqlash kutilmoqda', waiting_input: 'Javobingiz kutilmoqda', completed: 'Tayyor', failed: 'Xatolik', cancelled: 'To‘xtatilgan', interrupted: 'Uzilgan' };
