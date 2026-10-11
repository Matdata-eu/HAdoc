// openHAB REST API: items, their channel links, and the rules that use each item.

export interface OhItem {
  name: string;
  label?: string;
  type: string;
  state?: string;
  groupNames: string[];
  /** Channels the item is linked to; empty for virtual items. */
  channels: string[];
}

export interface OhRule {
  uid: string;
  name: string;
  /** Script source for rules that have one (DSL, JS, Blockly's generated code). */
  script?: string;
}

export interface RuleUse {
  uid: string;
  name: string;
  /** Why the rule counts: it triggers on the item, on a group it is in, or names it in its script. */
  how: "trigger" | "group trigger" | "script";
}

export interface OpenhabData {
  items: Map<string, OhItem>;
  rules: Map<string, OhRule>;
  uses: Map<string, RuleUse[]>;
}

interface RestRule {
  uid: string;
  name?: string;
  triggers?: { configuration?: { itemName?: string; groupName?: string } }[];
  actions?: { configuration?: { script?: string } }[];
}

export async function fetchOpenhab(url: string, token: string | undefined, fetchFn: typeof fetch): Promise<OpenhabData> {
  const base = url.replace(/\/$/, "");
  const get = async <T>(p: string): Promise<T> => {
    const res = await fetchFn(`${base}${p}`, {
      headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`${p}: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  };

  const [rawItems, links, rawRules] = await Promise.all([
    get<{ name: string; label?: string; type: string; state?: string; groupNames?: string[] }[]>(
      "/rest/items?recursive=false&fields=name,label,type,state,groupNames",
    ),
    get<{ itemName: string; channelUID: string }[]>("/rest/links"),
    get<RestRule[]>("/rest/rules"),
  ]);

  const items = new Map<string, OhItem>();
  for (const i of rawItems) {
    items.set(i.name, { name: i.name, label: i.label, type: i.type, state: i.state, groupNames: i.groupNames ?? [], channels: [] });
  }
  for (const l of links) items.get(l.itemName)?.channels.push(l.channelUID);

  const rules = new Map<string, OhRule>();
  const uses = new Map<string, RuleUse[]>();
  const use = (item: string, u: RuleUse) => {
    const list = uses.get(item) ?? [];
    if (!list.some((x) => x.uid === u.uid)) list.push(u);
    uses.set(item, list);
  };

  for (const r of rawRules) {
    const name = r.name ?? r.uid;
    const script = (r.actions ?? []).map((a) => a.configuration?.script).filter(Boolean).join("\n\n") || undefined;
    rules.set(r.uid, { uid: r.uid, name, script });

    for (const t of r.triggers ?? []) {
      const { itemName, groupName } = t.configuration ?? {};
      if (itemName) use(itemName, { uid: r.uid, name, how: "trigger" });
      if (groupName) {
        for (const i of items.values()) if (i.groupNames.includes(groupName)) use(i.name, { uid: r.uid, name, how: "group trigger" });
      }
    }
    if (script) {
      // Item names are identifiers, so a whole-word match is a good enough "this rule uses it".
      for (const word of new Set(script.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])) {
        if (items.has(word)) use(word, { uid: r.uid, name, how: "script" });
      }
    }
  }

  return { items, rules, uses };
}
