import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The NXGS cloud backend from nxgs-client.ini (or environment), shared by payments and Device Management. */
export interface BackendConfig {
  supabaseUrl: string;
  functionBaseUrl: string;
  publishableKey: string;
}

export function parseIni(source: string): Map<string, string> {
  const values = new Map<string, string>();
  let section = '';
  for (const sourceLine of source.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      continue;
    }
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    values.set(`${section}/${key}`, line.slice(separator + 1).trim());
  }
  return values;
}

export async function readBackendConfig(): Promise<BackendConfig> {
  let supabaseUrl = '';
  let functionBaseUrl = '';
  let publishableKey = '';
  const candidates = [
    join(process.cwd(), 'nxgs-client.ini'),
    join(app.getAppPath(), 'nxgs-client.ini'),
    join(process.resourcesPath, 'nxgs-client.ini'),
    join(dirname(process.execPath), 'nxgs-client.ini')
  ];

  for (const path of [...new Set(candidates)]) {
    if (!existsSync(path)) continue;
    const values = parseIni(await readFile(path, 'utf8'));
    functionBaseUrl ||= values.get('backend/function_base_url') ?? '';
    publishableKey ||= values.get('backend/supabase_anon_key') ?? '';
    supabaseUrl ||= values.get('backend/supabase_url') ?? '';
    if (!functionBaseUrl && supabaseUrl) {
      functionBaseUrl = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1`;
    }
    if (supabaseUrl && functionBaseUrl && publishableKey) break;
  }

  supabaseUrl ||= process.env.NXGS_SUPABASE_URL?.trim() ?? '';
  functionBaseUrl ||= process.env.NXGS_RENTAL_FUNCTION_BASE_URL?.trim() ?? '';
  publishableKey ||= process.env.NXGS_SUPABASE_ANON_KEY?.trim() ?? '';
  if (!functionBaseUrl && supabaseUrl) {
    functionBaseUrl = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1`;
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    functionBaseUrl: functionBaseUrl.replace(/\/+$/, ''),
    publishableKey
  };
}
