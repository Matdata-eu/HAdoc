// UniFi Network Integration API (Network application 9.x and later).

export interface NetClient {
  mac: string;
  ip?: string;
  name?: string;
  /** "WIRED", "WIRELESS", or "DEVICE" for UniFi's own gear. */
  type?: string;
  connectedAt?: string;
}

interface Page<T> {
  offset: number;
  count: number;
  totalCount: number;
  data: T[];
}

export async function fetchUnifi(
  cfg: { url: string; api_path?: string; site?: string },
  key: string,
  fetchFn: typeof fetch,
): Promise<NetClient[]> {
  const base = `${cfg.url.replace(/\/$/, "")}${cfg.api_path ?? "/integration/v1"}`;
  const get = async <T>(p: string): Promise<T> => {
    const res = await fetchFn(`${base}${p}`, {
      headers: { accept: "application/json", "x-api-key": key },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`${p}: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  };
  const all = async <T>(p: string): Promise<T[]> => {
    const out: T[] = [];
    for (let offset = 0; ; ) {
      const page = await get<Page<T>>(`${p}?offset=${offset}&limit=200`);
      out.push(...page.data);
      offset += page.count;
      if (page.count === 0 || offset >= page.totalCount) return out;
    }
  };

  const wanted = cfg.site ?? "default";
  const sites = await all<{ id: string; internalReference?: string; name?: string }>("/sites");
  const site = sites.find((s) => s.id === wanted || s.internalReference === wanted || s.name === wanted);
  if (!site) throw new Error(`Site "${wanted}" not found; there are ${sites.map((s) => s.internalReference ?? s.name).join(", ")}`);

  const [clients, devices] = await Promise.all([
    all<{ type?: string; name?: string; ipAddress?: string; macAddress?: string; connectedAt?: string }>(`/sites/${site.id}/clients`),
    all<{ name?: string; ipAddress?: string; macAddress?: string; state?: string }>(`/sites/${site.id}/devices`),
  ]);

  return [
    ...clients
      .filter((c) => c.macAddress)
      .map((c) => ({ mac: c.macAddress!.toLowerCase(), ip: c.ipAddress, name: c.name, type: c.type, connectedAt: c.connectedAt })),
    ...devices
      .filter((d) => d.macAddress && d.state === "ONLINE")
      .map((d) => ({ mac: d.macAddress!.toLowerCase(), ip: d.ipAddress, name: d.name, type: "DEVICE" })),
  ];
}

/** True when an IPv4 address is inside a CIDR subnet like "192.168.20.0/24". */
export function inSubnet(ip: string, cidr: string): boolean {
  const [net, bits] = cidr.split("/");
  const toInt = (a: string) => a.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (toInt(ip) & mask) === (toInt(net!) & mask);
}
