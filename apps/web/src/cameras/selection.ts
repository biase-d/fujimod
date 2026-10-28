import type { CameraRecord } from './store';

export function latestCamera(cameras: readonly CameraRecord[], hash: string, modEnabled: boolean) {
  return cameras
    .filter((camera) => camera.firmwareHash === hash && camera.modEnabled === modEnabled)
    .sort((a, b) => (b.savedAt ?? b.createdAt) - (a.savedAt ?? a.createdAt))[0];
}
