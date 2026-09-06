import type { VercelRequest, VercelResponse } from "@vercel/node";

export function json(res: VercelResponse, status: number, body: unknown): void {
  res.status(status).setHeader("Content-Type", "application/json").json(body);
}

export function apiError(
  res: VercelResponse,
  status: number,
  error: string,
  message: string,
): void {
  json(res, status, { error, message });
}

/** CORS abierto solo para endpoints de lectura (la API de consulta es pública con key) */
export function corsRead(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

export function handleOptions(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.status(204).end();
    return true;
  }
  return false;
}
