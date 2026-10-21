/* Minimal replacement for the claude.ai runtime (db, assets, sample, downloads),
   backed by Supabase (table `docs`, storage bucket `assets`) and /api/identify. */
(function () {
  let sbPromise;
  function client() {
    return (sbPromise ||= fetch("/api/config").then(r => {
      if (!r.ok) throw new Error("config");
      return r.json();
    }).then(c => {
      if (!c.url || !c.anonKey) throw new Error("config");
      const sb = window.supabase.createClient(c.url, c.anonKey, { realtime: { params: { eventsPerSecond: 10 } } });
      sb.__base = c.url.replace(/\/$/, "") + "/storage/v1/object/public/assets/";
      return sb;
    }));
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const clean = o => JSON.parse(JSON.stringify(o ?? {}));

  // ---- per-collection live cache -------------------------------------------------
  const caches = {}; // name -> {rows: Map, subs: Set, ready: bool}
  function cache(name) {
    if (caches[name]) return caches[name];
    const c = (caches[name] = { rows: new Map(), subs: new Set(), ready: false, failed: false });
    const emit = () => c.subs.forEach(f => f());
    c.emit = emit;
    const load = async () => {
      const sb = await client();
      const { data, error } = await sb.from("docs").select("id,data").eq("collection", name);
      if (error) throw error;
      c.rows = new Map(data.map(r => [r.id, r.data]));
      c.ready = true; c.failed = false; emit();
    };
    c.load = load;
    load().catch(() => { c.failed = true; emit(); });
    client().then(sb => {
      sb.channel("docs-" + name)
        .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "collection=eq." + name }, p => {
          if (p.eventType === "DELETE") c.rows.delete(p.old.id);
          else c.rows.set(p.new.id, p.new.data);
          emit();
        }).subscribe();
    }).catch(() => {});
    setInterval(() => { load().catch(() => {}); }, 20000); // safety net if realtime is off
    return c;
  }
  const snapDocs = c => ({ docs: [...c.rows].map(([id, d]) => ({ id, data: () => d })) });

  function collection(name) {
    return {
      async add(data) {
        const id = uuid(), d = clean(data), sb = await client();
        const { error } = await sb.from("docs").insert({ collection: name, id, data: d });
        if (error) throw error;
        const c = cache(name); c.rows.set(id, d); c.emit();
        return { id };
      },
      onSnapshot(cb, err) {
        const c = cache(name);
        const f = () => { if (c.failed && err) { err(new Error("read")); return; } if (c.ready) cb(snapDocs(c)); };
        c.subs.add(f); f();
        return () => c.subs.delete(f);
      }
    };
  }
  function doc(path) {
    const [name, id] = path.split("/");
    const c = () => cache(name);
    return {
      async set(data) {
        const d = clean(data), sb = await client();
        const { error } = await sb.from("docs").upsert({ collection: name, id, data: d });
        if (error) throw error;
        c().rows.set(id, d); c().emit();
      },
      async update(patch) {
        const p = clean(patch), sb = await client();
        const { error } = await sb.rpc("merge_doc", { p_collection: name, p_id: id, p_patch: p });
        if (error) throw error;
        c().rows.set(id, { ...(c().rows.get(id) || {}), ...p }); c().emit();
      },
      async delete() {
        const sb = await client();
        const { error } = await sb.from("docs").delete().eq("collection", name).eq("id", id);
        if (error) throw error;
        c().rows.delete(id); c().emit();
      },
      onSnapshot(cb, err) {
        const cc = c();
        const f = () => {
          if (cc.failed && err) { err(new Error("read")); return; }
          if (!cc.ready) return;
          const d = cc.rows.get(id);
          cb({ exists: d !== undefined, data: () => d });
        };
        cc.subs.add(f); f();
        return () => cc.subs.delete(f);
      }
    };
  }

  // ---- photos ---------------------------------------------------------------------
  const store = {
    base: "/_blob/",
    async upload(blob, opts) {
      const sb = await client();
      const id = uuid();
      const { error } = await sb.storage.from("assets").upload(id, blob, { contentType: (opts && opts.type) || blob.type || "image/jpeg", upsert: false });
      if (error) throw error;
      return { id };
    },
    async delete(id) { const sb = await client(); await sb.storage.from("assets").remove([id]); }
  };

  // ---- Claude vision via serverless route -----------------------------------------
  const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
  const sample = {
    async limits() { return { images: { maxCount: 4 } }; },
    async json(prompt, opts) {
      const images = [];
      for (const b of (opts && opts.images) || []) images.push({ media: b.type || "image/jpeg", data: await toB64(b) });
      let r;
      try { r = await fetch("/api/identify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, images }) }); }
      catch { const e = new Error("network"); e.code = "failed"; throw e; }
      if (!r.ok) { const e = new Error("api"); e.code = r.status === 429 ? "rate_limited" : r.status === 415 ? "image_rejected" : r.status === 501 ? "not_granted" : "failed"; throw e; }
      return r.json();
    }
  };

  const downloads = {
    async save({ filename, data }) {
      const u = URL.createObjectURL(data), a = document.createElement("a");
      a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 10000);
    }
  };

  window.claude = {
    async use(name) {
      if (name === "db") {
        try { const sb = await client(); sb.__ok = true; } catch { return null; }
        return { collection, doc };
      }
      if (name === "assets") { try { const sb = await client(); store.base = sb.__base; return store; } catch { return null; } }
      if (name === "sample") return sample;
      if (name === "downloads") return downloads;
      return null;
    }
  };
})();
