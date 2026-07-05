/// <reference types="vite/client" />

import type { NxgsApi } from '../main/preload';

declare global {
  interface Window {
    nxgs: NxgsApi;
  }
}
