// api/_lib/admin.ts
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
function app() {
  const existing = getApps()[0];
  if (existing) return existing;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!projectId || !databaseURL) throw new Error("Firebase Admin settings are missing");
  const credential = clientEmail && privateKey ? cert({ projectId, clientEmail, privateKey }) : process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : null;
  if (!credential) throw new Error("Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS");
  return initializeApp({ credential, projectId, databaseURL });
}
async function verifyToken(token) {
  return (await getAuth(app()).verifyIdToken(token)).uid;
}
function getAdmin(uid) {
  if (!uid) throw new Error("Firebase user ID required");
  const database = getDatabase(app());
  const table = (name) => database.ref(`apps/paintos/users/${uid}/${name}`);
  const textRef = (name, path) => database.ref(`apps/paintos/users/${uid}/artifact_text/${name}/${encodeURIComponent(path).replaceAll(".", "%2E")}`);
  const isText = (path) => path.endsWith(".json");
  const cloud = process.env.VITE_CLOUDINARY_CLOUD_NAME;
  const preset = process.env.VITE_CLOUDINARY_UPLOAD_PRESET;
  const asError = (error) => ({ message: error instanceof Error ? error.message : String(error) });
  class Query {
    constructor(name, action = "read") {
      this.name = name;
      this.action = action;
    }
    filters = [];
    ordering = [];
    max = null;
    one = false;
    optional = false;
    records = [];
    changes = {};
    select(_fields = "*") {
      return this;
    }
    eq(key, value) {
      this.filters.push({ key, value });
      return this;
    }
    order(key, options) {
      this.ordering.push({ key, ascending: options?.ascending !== false });
      return this;
    }
    limit(max) {
      this.max = max;
      return this;
    }
    maybeSingle() {
      this.one = true;
      this.optional = true;
      return this;
    }
    single() {
      this.one = true;
      return this;
    }
    insert(records) {
      this.action = "insert";
      this.records = Array.isArray(records) ? records : [records];
      return this;
    }
    update(changes) {
      this.action = "update";
      this.changes = changes;
      return this;
    }
    delete() {
      this.action = "delete";
      return this;
    }
    async run() {
      try {
        const value = (await table(this.name).get()).val();
        let rows = Object.entries(value ?? {}).map(([id, row]) => ({ ...row, id }));
        rows = rows.filter((row) => this.filters.every((f) => row[f.key] === f.value));
        if (this.action === "read") {
          for (const order of [...this.ordering].reverse()) rows.sort((a, b) => String(a[order.key] ?? "").localeCompare(String(b[order.key] ?? "")) * (order.ascending ? 1 : -1));
          if (this.max !== null) rows = rows.slice(0, this.max);
        } else if (this.action === "insert") {
          rows = await Promise.all(this.records.map(async (record) => {
            const row = { ...record, id: String(record.id || crypto.randomUUID()) };
            await table(this.name).child(row.id).set(row);
            return row;
          }));
        } else if (this.action === "update") {
          rows = await Promise.all(rows.map(async (row) => {
            const updated = { ...row, ...this.changes };
            await table(this.name).child(String(row.id)).update(this.changes);
            return updated;
          }));
        } else {
          await Promise.all(rows.map((row) => table(this.name).child(String(row.id)).remove()));
        }
        if (this.one) return rows.length ? { data: rows[0], error: null } : this.optional ? { data: null, error: null } : { data: null, error: { message: "Row not found" } };
        return { data: rows, error: null };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    }
    then(onfulfilled, onrejected) {
      return this.run().then(onfulfilled, onrejected);
    }
  }
  return {
    from: (name) => new Query(name),
    storage: { from: (name) => ({
      async download(path) {
        try {
          if (isText(path)) {
            const value = (await textRef(name, path).get()).val();
            if (typeof value !== "string") throw new Error("Stored text not found");
            return { data: new Blob([value], { type: "application/json" }), error: null };
          }
          const url = new URL(path);
          if (!cloud || url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || !url.pathname.startsWith(`/${cloud}/image/upload/`)) throw new Error("Untrusted media URL");
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Media download HTTP ${response.status}`);
          return { data: new Blob([await response.arrayBuffer()]), error: null };
        } catch (error) {
          return { data: null, error: asError(error) };
        }
      },
      async upload(path, value, options) {
        try {
          if (isText(path)) {
            await textRef(name, path).set(typeof value === "string" ? value : value.toString("utf8"));
            return { data: { path }, error: null };
          }
          if (!cloud || !preset) throw new Error("Cloudinary settings are missing");
          const folder = name === "source-images" ? "paintos/sources" : "paintos/generated";
          const filename = path.startsWith("https://") ? `${crypto.randomUUID()}.svg` : path.split("/").pop() || "image.svg";
          const file = new Blob([typeof value === "string" ? value : Uint8Array.from(value)], { type: options?.contentType || "image/svg+xml" });
          const body = new FormData();
          body.set("file", file, filename);
          body.set("upload_preset", preset);
          body.set("folder", folder);
          body.set("asset_folder", folder);
          body.set("public_id_prefix", folder);
          const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`, { method: "POST", body });
          const json = await response.json();
          if (!response.ok || !json.secure_url) throw new Error(json.error?.message || "Cloudinary upload failed");
          return { data: { path: json.secure_url }, error: null };
        } catch (error) {
          return { data: null, error: asError(error) };
        }
      }
    }) }
  };
}

// server/routes/decide-complexity.ts
var config = {
  // Vision round-trip can be slow on the free model; the algorithmic fallback
  // covers any timeout regardless.
  maxDuration: 25
};
var DEFAULT_MODEL = "nvidia/nemotron-nano-12b-v2-vl:free";
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) ?? {};
  const sourceImageId = String(body.sourceImageId ?? "").trim();
  if (!sourceImageId) return res.status(400).json({ error: "sourceImageId required" });
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Missing bearer token" });
  let admin;
  try {
    admin = getAdmin(await verifyToken(token));
  } catch (err) {
    return res.status(401).json({ error: err instanceof Error ? err.message : "Invalid session" });
  }
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    return res.status(503).json({ error: "OPENROUTER_API_KEY not configured \u2014 use algorithmic fallback" });
  }
  try {
    const { data: source, error: srcErr } = await admin.from("source_images").select("*").eq("id", sourceImageId).maybeSingle();
    if (srcErr || !source) {
      return res.status(404).json({ error: srcErr?.message ?? "source image not found" });
    }
    const dl = await admin.storage.from("source-images").download(source.storage_path);
    if (dl.error || !dl.data) {
      return res.status(500).json({ error: `download: ${dl.error?.message ?? "no data"}` });
    }
    const buf = Buffer.from(await dl.data.arrayBuffer());
    const mime = guessMime(source.original_filename);
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    const model = process.env.OPENROUTER_VISION_MODEL ?? DEFAULT_MODEL;
    const decision = await askOpenRouter(openrouterKey, model, dataUrl);
    return res.status(200).json({ ok: true, model, ...decision });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[decide-complexity] failed:", err);
    return res.status(200).json({ ok: false, error: msg });
  }
}
async function askOpenRouter(apiKey, model, dataUrl) {
  const prompt = 'You are advising on a paint-by-numbers conversion of this image. Rate its complexity for that purpose and suggest a target color count.\n\nTiers: "simple" (~8 colors, flat illustrations, low edge density), "normal" (~16 colors, balanced photos/paintings), "complex" (~32 colors, busy photographs, lots of fine detail).\n\nRespond with a single JSON object \u2014 no prose, no markdown fences \u2014 with exactly:\n{ "tier": "simple"|"normal"|"complex", "suggestedCount": integer between 6 and 48, "reason": short one-sentence explanation }\n\nRound up when in doubt: an over-colored kit is better than a sparse one.';
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://paintos.lab",
      "X-Title": "Painto's Lab"
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ]
    })
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "<no body>");
    throw new Error(`OpenRouter ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = extractJson(content);
  if (!parsed) throw new Error(`Could not parse model response: ${content.slice(0, 200)}`);
  const tier = normaliseTier(parsed.tier);
  const suggestedCount = Math.max(2, Math.min(64, Number(parsed.suggestedCount) || 16));
  const reason = String(parsed.reason ?? "").slice(0, 280);
  return { tier, suggestedCount, reason };
}
function normaliseTier(value) {
  const s = String(value ?? "").toLowerCase().trim();
  if (s === "simple" || s === "normal" || s === "complex") return s;
  if (s.includes("simple") || s.includes("low") || s.includes("flat")) return "simple";
  if (s.includes("complex") || s.includes("high") || s.includes("busy")) return "complex";
  return "normal";
}
function extractJson(text) {
  const candidates = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fence) candidates.push(fence[1]);
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) candidates.push(brace[0]);
  candidates.push(text);
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object") return v;
    } catch {
    }
  }
  return null;
}
function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
function guessMime(name) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}
export {
  config,
  handler as default
};
