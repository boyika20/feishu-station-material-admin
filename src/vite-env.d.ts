/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLUGIN_VERSION: string;
  readonly VITE_PLUGIN_BUILD_TIME: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
