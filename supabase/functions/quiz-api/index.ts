const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-teacher-token, x-site-token",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
};
const enc = new TextEncoder();
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sessionMs = 8 * 60 * 60 * 1000;
const siteSessionMs = 7 * 24 * 60 * 60 * 1000;
const attempts = new Map<string, { count: number; since: number }>();
const siteAttempts = new Map<string, { count: number; since: number }>();

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
}
function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function adminKey() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const keys = JSON.parse(raw); if (keys.default) return keys.default as string; } catch {} }
  return env("SUPABASE_SERVICE_ROLE_KEY");
}
function validClientKey(key: string | null) {
  if (!key) return false;
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) { try { if (Object.values(JSON.parse(raw)).includes(key)) return true; } catch {} }
  return key === Deno.env.get("SUPABASE_ANON_KEY");
}
async function db(path: string, init: RequestInit = {}) {
  const key = adminKey();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", key);
  headers.set("Content-Type", "application/json");
  if (key.startsWith("eyJ")) headers.set("Authorization", `Bearer ${key}`);
  const res = await fetch(`${env("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) { console.error("REST", res.status, text.slice(0, 500)); throw new Error("Database unavailable"); }
  return text ? JSON.parse(text) : null;
}
async function body(req: Request) {
  const raw = await req.text();
  if (raw.length > 1_000_000) throw Object.assign(new Error("Dữ liệu quá lớn."), { status: 413 });
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error("Dữ liệu không hợp lệ."), { status: 400 }); }
}
async function config() {
  const rows = await db("app_config?select=teacher_salt,teacher_hash,site_passcode_salt,site_passcode_hash,session_secret&id=eq.1&limit=1");
  if (!rows?.length) throw new Error("Missing teacher config");
  return rows[0] as { teacher_salt: string; teacher_hash: string; site_passcode_salt: string; site_passcode_hash: string; session_secret: string };
}
function decode64(value: string) {
  const b = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
function encode64(value: Uint8Array) {
  let b = ""; for (const x of value) b += String.fromCharCode(x);
  return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function passwordMatches(value: string, salt: string, expectedHash: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(value), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: decode64(salt), iterations: 310000, hash: "SHA-256" }, key, 256));
  return equal(bits, decode64(expectedHash));
}
async function passwordOK(value: string, cfg: Awaited<ReturnType<typeof config>>) {
  return passwordMatches(value, cfg.teacher_salt, cfg.teacher_hash);
}
async function token(exp: number, secret: string, purpose: "teacher" | "site" = "teacher") {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  // Keep teacher-token signing compatible with existing live teacher sessions.
  const payload = purpose === "teacher" ? String(exp) : purpose + ":" + String(exp);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return String(exp) + "." + encode64(new Uint8Array(sig));
}
async function teacher(req: Request, cfg: Awaited<ReturnType<typeof config>>) {
  const t = req.headers.get("x-teacher-token") || "";
  const [raw] = t.split(".");
  if (!raw || !/^\d+$/.test(raw)) return false;
  const exp = Number(raw);
  if (!Number.isSafeInteger(exp) || exp < Date.now() || exp > Date.now() + sessionMs + 60_000) return false;
  return equal(enc.encode(t), enc.encode(await token(exp, cfg.session_secret, "teacher")));
}
async function siteAccess(req: Request, cfg: Awaited<ReturnType<typeof config>>) {
  const t = req.headers.get("x-site-token") || "";
  const [raw] = t.split(".");
  if (!raw || !/^\d+$/.test(raw)) return false;
  const exp = Number(raw);
  if (!Number.isSafeInteger(exp) || exp < Date.now() || exp > Date.now() + siteSessionMs + 60_000) return false;
  return equal(enc.encode(t), enc.encode(await token(exp, cfg.session_secret, "site")));
}
function ip(req: Request) { return (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 80); }

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!validClientKey(req.headers.get("apikey"))) return reply({ error: "API key không hợp lệ." }, 401);
  const url = new URL(req.url);
  const route = url.pathname.slice(url.pathname.indexOf("/quiz-api") + 9) || "/";
  const id = url.searchParams.get("id");

  if (route === "/api/site/access" && req.method === "POST") {
    const address = ip(req), now = Date.now(), previous = siteAttempts.get(address);
    if (previous && now - previous.since < 900_000 && previous.count >= 10) return reply({ error: "Quá nhiều lần nhập mã sai. Thử lại sau 15 phút." }, 429);
    if (!previous || now - previous.since >= 900_000) siteAttempts.set(address, { count: 0, since: now });
    const input = await body(req), cfg = await config(), passcode = String(input.passcode || "");
    if (passcode.length > 128 || !await passwordMatches(passcode, cfg.site_passcode_salt, cfg.site_passcode_hash)) {
      const item = siteAttempts.get(address)!; item.count++; siteAttempts.set(address, item);
      return reply({ error: "Mã truy cập không đúng." }, 401);
    }
    siteAttempts.delete(address);
    const expiresAt = Date.now() + siteSessionMs;
    return reply({ success: true, token: await token(expiresAt, cfg.session_secret, "site"), expiresAt });
  }

  const cfg = await config();
  if (route === "/api/site/session" && req.method === "GET") return reply({ isUnlocked: await siteAccess(req, cfg) });
  if (!await siteAccess(req, cfg)) return reply({ error: "Cần nhập mã truy cập website.", code: "SITE_ACCESS_REQUIRED" }, 401);

  if (route === "/api/teacher/login" && req.method === "POST") {
    const address = ip(req), now = Date.now(), previous = attempts.get(address);
    if (previous && now - previous.since < 900_000 && previous.count >= 8) return reply({ error: "Quá nhiều lần đăng nhập sai. Thử lại sau 15 phút." }, 429);
    if (!previous || now - previous.since >= 900_000) attempts.set(address, { count: 0, since: now });
    const input = await body(req), pw = String(input.password || "");
    if (pw.length > 256 || !await passwordOK(pw, cfg)) {
      const item = attempts.get(address)!; item.count++; attempts.set(address, item);
      return reply({ error: "Mật khẩu giáo viên không đúng." }, 401);
    }
    attempts.delete(address);
    const expiresAt = Date.now() + sessionMs;
    return reply({ success: true, token: await token(expiresAt, cfg.session_secret), expiresAt });
  }
  if (route === "/api/teacher/session" && req.method === "GET") {
    return reply({ isTeacher: await teacher(req, cfg) });
  }
  if (route === "/api/teacher/logout" && req.method === "POST") return reply({ success: true });

  if (route === "/api/tests" && req.method === "GET") {
    const isTeacher = await teacher(req, cfg);
    if (id) {
      if (!uuidRe.test(id)) return reply({ error: "Mã đề không hợp lệ." }, 400);
      const rows = await db(`tests?select=id,name,questions,is_public&id=eq.${id}&limit=1`);
      if (!rows?.length || (!rows[0].is_public && !isTeacher)) return reply({ error: "Không tìm thấy đề thi." }, 404);
      const safe: Record<string, unknown> = {};
      for (const [qid, q] of Object.entries(rows[0].questions || {}) as [string, any][]) safe[qid] = { text: q.text, options: q.options };
      return reply({ test: { id: rows[0].id, name: rows[0].name, isPublic: !!rows[0].is_public, questions: safe } });
    }
    const visibilityFilter = isTeacher ? "" : "&is_public=eq.true";
    const rows = await db(`test_stats?select=id,name,questions,is_public,results_count,created_at&order=created_at.desc${visibilityFilter}`);
    return reply({ tests: (rows || []).map((r: any) => ({ id: r.id, name: r.name, isPublic: !!r.is_public, questionCount: Object.keys(r.questions || {}).length, resultsCount: Number(r.results_count) || 0 })) });
  }
  if (route === "/api/tests" && req.method === "POST") {
    if (!await teacher(req, cfg)) return reply({ error: "Phiên giáo viên đã hết hạn hoặc chưa đăng nhập." }, 401);
    const input = await body(req), name = String(input.name || "Đề trắc nghiệm mới").trim().slice(0, 180) || "Đề trắc nghiệm mới", qs = input.questions;
    if (input.isPublic !== undefined && typeof input.isPublic !== "boolean") return reply({ error: "Lựa chọn công khai/riêng tư không hợp lệ." }, 400);
    const isPublic = input.isPublic !== false;
    if (!qs || typeof qs !== "object" || Array.isArray(qs) || !Object.keys(qs).length) return reply({ error: "Đề thi chưa có câu hỏi hợp lệ." }, 400);
    const entries = Object.entries(qs) as [string, any][];
    if (entries.length > 500) return reply({ error: "Mỗi đề không được vượt quá 500 câu." }, 400);
    for (const [qid, q] of entries) {
      const opts = q?.options && typeof q.options === "object" && !Array.isArray(q.options) ? Object.keys(q.options) : [];
      if (!/^\d{1,4}$/.test(qid) || !q || typeof q.text !== "string" || q.text.length > 20000 || !q.options || Array.isArray(q.options) ||
        !["A", "B", "C", "D"].includes(q.answer) || !q.options[q.answer] || opts.length < 2 || opts.some(k => !["A", "B", "C", "D"].includes(k) || typeof q.options[k] !== "string" || q.options[k].length > 10000))
        return reply({ error: `Dữ liệu câu ${qid} chưa hợp lệ.` }, 400);
    }
    const inserted = await db("tests?select=id", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([{ name, questions: qs, is_public: isPublic }]) });
    return reply({ id: inserted[0].id }, 201);
  }
  if (route === "/api/tests" && req.method === "PATCH") {
    if (!await teacher(req, cfg)) return reply({ error: "Phiên giáo viên đã hết hạn hoặc chưa đăng nhập." }, 401);
    if (!id || !uuidRe.test(id)) return reply({ error: "Mã đề không hợp lệ." }, 400);
    const input = await body(req);
    if (typeof input.isPublic !== "boolean") return reply({ error: "Lựa chọn công khai/riêng tư không hợp lệ." }, 400);
    await db(`tests?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ is_public: input.isPublic }) });
    return reply({ success: true, isPublic: input.isPublic });
  }
  if (route === "/api/tests" && req.method === "DELETE") {
    if (!await teacher(req, cfg)) return reply({ error: "Phiên giáo viên đã hết hạn hoặc chưa đăng nhập." }, 401);
    if (!id || !uuidRe.test(id)) return reply({ error: "Mã đề không hợp lệ." }, 400);
    await db(`tests?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return reply({ success: true });
  }
  if (route === "/api/submit" && req.method === "POST") {
    const input = await body(req), testId = String(input.testId || ""), studentName = String(input.studentName || "").trim().replace(/\s+/g, " ").slice(0, 100), answers = input.answers;
    if (!uuidRe.test(testId)) return reply({ error: "Mã đề không hợp lệ." }, 400);
    if (!studentName) return reply({ error: "Vui lòng nhập họ và tên." }, 400);
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) return reply({ error: "Câu trả lời không hợp lệ." }, 400);
    const rows = await db(`tests?select=id,questions,is_public&id=eq.${testId}&limit=1`);
    if (!rows?.length || (!rows[0].is_public && !await teacher(req, cfg))) return reply({ error: "Không tìm thấy đề thi." }, 404);
    const qs = rows[0].questions || {}, ids = Object.keys(qs); let score = 0;
    for (const qid of ids) if (answers[qid] && answers[qid] === qs[qid].answer) score++;
    const total = ids.length;
    const saved = await db("results?select=score,total,submitted_at", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([{ test_id: testId, student_name: studentName, score, total }]) });
    return reply({ score: saved[0].score, total: saved[0].total, percent: total ? Math.round(score / total * 100) : 0 }, 201);
  }
  if (route === "/api/leaderboard" && req.method === "GET") {
    if (!id || !uuidRe.test(id)) return reply({ error: "Mã đề không hợp lệ." }, 400);
    const tests = await db(`tests?select=name,is_public&id=eq.${id}&limit=1`);
    if (!tests?.length || (!tests[0].is_public && !await teacher(req, cfg))) return reply({ error: "Không tìm thấy đề thi." }, 404);
    const results = await db(`results?select=student_name,score,total,submitted_at&test_id=eq.${id}&order=score.desc,submitted_at.asc&limit=1000`);
    return reply({ testName: tests[0].name, results: (results || []).map((r: any) => ({ studentName: r.student_name, score: r.score, total: r.total, submittedAt: r.submitted_at })) });
  }
  return reply({ error: "Không tìm thấy API." }, 404);
}

Deno.serve(async (req: Request) => {
  try { return await handle(req); }
  catch (error) {
    const status = Number((error as any)?.status) || 500;
    if (status >= 500 ) console.error(error);
    return reply({ error: status >= 500 ? "Có lỗi xảy ra ῃ mạy chủ. Vui lòng thử lại." : (error as Error).message }, status);
  }
});
