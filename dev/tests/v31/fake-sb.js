// v31 시험용 가짜 supabase (실제 서버 없이 화면만) — window.FIX에 표 · rpc를 넣어요. 부른 기록은 window.CALLS
(function () {
  window.CALLS = [];
  const FIX = (window.FIX = window.FIX || { tables: {}, rpc: {}, user: { id: "u-lead", email: "lead@x.com" } });
  function q(table) {
    const st = { table, filters: [], single: false, maybe: false, op: "select", payload: null, head: false };
    const api = {
      select(_c, o) { if (o?.head) st.head = true; return api; },
      eq(k, v) { st.filters.push((r) => r[k] === v); return api; },
      neq(k, v) { st.filters.push((r) => r[k] !== v); return api; },
      in(k, vs) { st.filters.push((r) => vs.includes(r[k])); return api; },
      gte() { return api; }, lte() { return api; }, lt() { return api; }, gt() { return api; }, like() { return api; }, ilike() { return api; }, is() { return api; }, not() { return api; }, or() { return api; }, contains() { return api; },
      order() { return api; }, limit() { return api; }, range() { return api; },
      maybeSingle() { st.maybe = true; return api; }, single() { st.single = true; return api; },
      insert(p) { st.op = "insert"; st.payload = p; return api; }, update(p) { st.op = "update"; st.payload = p; return api; },
      upsert(p) { st.op = "upsert"; st.payload = p; return api; }, delete() { st.op = "delete"; return api; },
      then(res, rej) {
        CALLS.push({ kind: "table", table, op: st.op, payload: st.payload });
        let rows = (FIX.tables[table] || []).filter((r) => st.filters.every((f) => f(r)));
        if (st.op === "insert") rows = [].concat(st.payload).map((x, i) => ({ id: (FIX.nextId = (FIX.nextId || 1000) + 1), ...x }));
        const data = st.single || st.maybe ? rows[0] || null : rows;
        return Promise.resolve({ data, error: null, count: rows.length }).then(res, rej);
      },
    };
    return api;
  }
  const client = {
    from: q,
    rpc(name, args) {
      CALLS.push({ kind: "rpc", name, args });
      const f = FIX.rpc[name];
      const v = typeof f === "function" ? f(args) : f;
      return Promise.resolve(v && v.error ? v : { data: v === undefined ? null : v, error: null });
    },
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t", user: FIX.user } } }),
      getUser: async () => ({ data: { user: FIX.user } }),
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => ({}),
    },
    storage: { from: () => ({
      upload: async (path) => { CALLS.push({ kind: "upload", path }); return { data: { path }, error: null }; },
      remove: async (paths) => { CALLS.push({ kind: "remove", paths }); return { data: null, error: null }; },
      createSignedUrl: async (p) => ({ data: { signedUrl: "/dev/tests/v31/blank.pdf" }, error: null }),
      createSignedUrls: async (ps) => ({ data: ps.map((p) => ({ path: p, signedUrl: "/dev/tests/v31/blank.pdf" })), error: null }),
      download: async () => ({ data: await (await fetch("/dev/tests/v31/blank.pdf")).blob(), error: null }),
    }) },
    channel() { const c = { on() { return c; }, subscribe() { return c; }, unsubscribe() {} }; return c; },
    removeChannel() {},
  };
  window.supabase = { createClient: () => client };
})();
