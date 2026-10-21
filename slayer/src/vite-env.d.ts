/// <reference types="vite/client" />

/* The build's variables (only VITE_ names reach the browser). The account service's two live in .env.local — see
   .env.example for the names and data/supabase.ts for what they open. */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
