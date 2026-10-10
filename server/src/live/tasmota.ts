// Tasmota's HTTP command API: "Status 0" returns name, firmware, IP and MAC in one call.

export interface TasmotaStatus {
  ip?: string;
  mac?: string;
  firmware?: string;
  name?: string;
  topic?: string;
}

export async function fetchTasmota(
  host: string,
  auth: { user?: string; password?: string },
  fetchFn: typeof fetch,
): Promise<TasmotaStatus> {
  const q = new URLSearchParams({ cmnd: "Status 0" });
  if (auth.password) {
    q.set("user", auth.user ?? "admin");
    q.set("password", auth.password);
  }
  const res = await fetchFn(`http://${host}/cm?${q}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const s = (await res.json()) as {
    Status?: { DeviceName?: string; Topic?: string };
    StatusFWR?: { Version?: string };
    StatusNET?: { IPAddress?: string; Mac?: string };
  };
  return {
    ip: s.StatusNET?.IPAddress,
    mac: s.StatusNET?.Mac?.toLowerCase(),
    firmware: s.StatusFWR?.Version ? `Tasmota ${s.StatusFWR.Version}` : undefined,
    name: s.Status?.DeviceName,
    topic: s.Status?.Topic,
  };
}
