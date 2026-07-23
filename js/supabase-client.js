import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js?v=20260721-gb4";

function normalizeProjectUrl(value = "") {
  return String(value)
    .trim()
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/+$/, "");
}

const projectUrl = normalizeProjectUrl(SUPABASE_URL);
const publicKey = String(SUPABASE_ANON_KEY || "").trim();

const configured =
  projectUrl &&
  publicKey &&
  !projectUrl.includes("COLE_AQUI") &&
  !publicKey.includes("COLE_AQUI");

let client = null;
let initializationError = null;

if (configured) {
  try {
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(projectUrl)) {
      throw new Error(
        "A URL do Supabase está incorreta. Use https://SEU-PROJETO.supabase.co, sem /rest/v1/."
      );
    }

    if (!publicKey.startsWith("sb_publishable_") && !publicKey.startsWith("eyJ")) {
      throw new Error(
        "A chave pública do Supabase parece inválida. Use a Publishable key ou a chave anon."
      );
    }

    const { createClient } = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    );

    client = createClient(projectUrl, publicKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch (error) {
    initializationError = error;
    console.error("Falha ao iniciar o Supabase:", error);
  }
}

export const supabase = client;
export const supabaseInitializationError = initializationError;

export function assertSupabaseConfigured() {
  if (supabase) return;

  if (supabaseInitializationError) {
    throw supabaseInitializationError;
  }

  throw new Error(
    "Supabase não configurado. Abra js/config.js e informe a URL-base e a chave pública do projeto."
  );
}
