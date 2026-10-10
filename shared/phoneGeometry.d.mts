export const IPHONE_17_MM: { width: number; height: number; depth: number; glassWidth: number; glassHeight: number; displayWidth: number; displayHeight: number; rearLensDiameter: number };
export const IPHONE_17_DISPLAY: { pixels: {width: number; height: number}; points: {width: number; height: number}; scale: number };
export const MODEL_HEIGHT: number;
export function millimetersToScene(value: number): number;
export const IPHONE_17_SCENE: typeof IPHONE_17_MM;
export interface PhoneProfile {
  id: string; name: string; deviceModel: string;
  bodyMm: { width: number; height: number; depth: number };
  displayMm: { width: number; height: number };
  displayPixels: { width: number; height: number }; specification: string;
}
export interface PhoneProfileSelection {
  profileId: string; name: string; deviceModel: string | null;
  status: 'recognized' | 'unrecognized' | 'legacy-default';
  cameraCalibration: 'approximate'; physicalValidation: 'pending';
}
export const PHONE_PROFILES: Readonly<Record<string, PhoneProfile>>;
export const DEFAULT_PHONE_PROFILE: PhoneProfile;
export function phoneProfile(profileId?: string): PhoneProfile;
export function selectPhoneProfile(deviceModel?: string | null): PhoneProfileSelection;
export function parsePhoneProfileSelection(value: unknown): PhoneProfileSelection | null;
export function phoneProfileNotice(selection: PhoneProfileSelection): string;
