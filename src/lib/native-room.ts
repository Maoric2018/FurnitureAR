import type { RoomLayout } from './workspace';
import { parseSurvey } from './room-scan';

declare global {
  interface Window {
    furnitureARNativeVersion?: number;
    webkit?: { messageHandlers?: { furnitureAR?: { postMessage: (message: unknown) => Promise<unknown> } } };
  }
}
export function hasNativeRoomAR(): boolean {
  return typeof window !== 'undefined' && window.furnitureARNativeVersion === 1 && !!window.webkit?.messageHandlers?.furnitureAR;
}
export function nativeRequest(kind: 'ready' | 'scan' | 'preview', payload?: unknown): Promise<unknown> {
  if (!hasNativeRoomAR()) return Promise.reject(new Error('Open this layout inside the Furniture AR iPhone app.'));
  return window.webkit!.messageHandlers!.furnitureAR!.postMessage({version:1,kind,payload});
}
export function nativeLayoutMetadata(layout:RoomLayout) {
  if (!layout.survey) throw new Error('Scan this room before using room-aligned AR.');
  const survey=parseSurvey(layout.survey);
  // Only send normalized geometry. The phone owns the trusted world transform.
  return {version:1,name:layout.name.slice(0,80),scanId:survey.scanId ?? null,
    walls:survey.walls.map(({start,end})=>({start,end}))};
}
export function bytesToBase64(bytes:Uint8Array):string {
  const chunks:string[]=[];
  for(let i=0;i<bytes.length;i+=16384)chunks.push(String.fromCharCode(...bytes.subarray(i,i+16384)));
  return btoa(chunks.join(''));
}
