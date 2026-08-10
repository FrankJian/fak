/** Tier C 跟随模式（SPEC F16）。 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from './invoke';

export const TAIL_APPENDED_EVENT = 'app://document-tail-appended';

export interface TailAppended {
  documentId: string;
  lineCount: number;
  truncated: boolean;
}

export function startFollow(documentId: string): Promise<void> {
  return invoke<void>('start_follow', { args: { documentId } });
}

export function stopFollow(documentId: string): Promise<void> {
  return invoke<void>('stop_follow', { args: { documentId } });
}

export function listenTailAppended(callback: (event: TailAppended) => void): Promise<UnlistenFn> {
  return listen<TailAppended>(TAIL_APPENDED_EVENT, (event) => callback(event.payload));
}
