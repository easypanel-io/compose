import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function renderPage(dept: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Queue Admin${dept ? ' - ' + dept.toUpperCase() : ''}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;background:#f1f5f9;min-height:100vh;color:#334155}

/* Header */
.header{background:linear-gradient(135deg,#1e293b 0%,#334155 100%);color:#fff;padding:20px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.header-left h1{font-size:22px;font-weight:800;letter-spacing:0.5px}
.header-left .dept-label{font-size:13px;opacity:0.7;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:2px}
.header-right{display:flex;gap:12px}
.stat-pill{background:rgba(255,255,255,0.12);border-radius:10px;padding:8px 16px;text-align:center;min-width:70px}
.stat-pill .num{font-size:22px;font-weight:700}
.stat-pill .label{font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:0.7}
.conn-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}
.conn-ok{background:#22c55e}
.conn-off{background:#ef4444}

/* Main */
.main{max-width:700px;margin:0 auto;padding:24px 16px 140px}

/* Serving Card */
.serving-card{background:linear-gradient(135deg,#2563eb 0%,#1d4ed8 100%);border-radius:24px;padding:44px 32px;text-align:center;color:#fff;margin-bottom:28px;box-shadow:0 12px 40px rgba(37,99,235,0.30);position:relative;overflow:hidden}
.serving-card::before{content:'';position:absolute;top:-40%;right:-20%;width:200px;height:200px;background:rgba(255,255,255,0.06);border-radius:50%}
.serving-label{font-size:12px;text-transform:uppercase;letter-spacing:3px;opacity:0.75;margin-bottom:8px;font-weight:600}
.serving-number{font-size:100px;font-weight:900;line-height:1}
.serving-name{font-size:22px;opacity:0.95;margin-top:8px;font-weight:500}
.serving-badge{display:inline-block;margin-top:12px;background:rgba(255,255,255,0.2);border-radius:20px;padding:4px 16px;font-size:12px;font-weight:600}
.serving-phone{font-size:14px;opacity:0.7;margin-top:6px}

/* Empty */
.empty-card{background:#fff;border:2px dashed #cbd5e1;border-radius:24px;padding:48px 32px;text-align:center;color:#94a3b8;margin-bottom:28px}
.empty-icon{font-size:56px;margin-bottom:12px}
.empty-text{font-size:16px;font-weight:500}

/* Waiting Section */
.section-title{font-size:16px;font-weight:700;color:#475569;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.section-count{background:#e0e7ff;color:#3b82f6;border-radius:12px;padding:2px 10px;font-size:13px;font-weight:700}
.waiting-list{display:flex;flex-direction:column;gap:8px}
.waiting-item{background:#fff;border-radius:14px;padding:16px 20px;display:flex;align-items:center;gap:16px;box-shadow:0 1px 4px rgba(0,0,0,0.04);border:1px solid #e2e8f0;transition:all 0.2s}
.waiting-item:first-child{border-left:4px solid #f59e0b}
.waiting-num{font-size:28px;font-weight:800;color:#2563eb;min-width:56px;text-align:center}
.waiting-info{flex:1}
.waiting-name{font-size:15px;font-weight:600;color:#334155}
.waiting-meta{font-size:12px;color:#94a3b8;margin-top:2px}
.waiting-badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:6px;font-weight:600}
.badge-registered{background:#dcfce7;color:#16a34a}
.badge-anonymous{background:#f1f5f9;color:#94a3b8}
.next-indicator{font-size:11px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:1px}

/* Completed message */
.completed-msg{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:20px;text-align:center;color:#16a34a;margin-bottom:20px;font-weight:600}

/* FAB */
.fab{position:fixed;bottom:28px;right:28px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:18px;padding:20px 36px;font-size:18px;font-weight:800;cursor:pointer;box-shadow:0 8px 32px rgba(34,197,94,0.45);transition:all 0.15s;z-index:100;display:flex;align-items:center;gap:10px;letter-spacing:0.5px}
.fab:hover{transform:translateY(-3px);box-shadow:0 14px 44px rgba(34,197,94,0.55)}
.fab:active{transform:translateY(0)}
.fab:disabled{opacity:0.4;cursor:not-allowed;transform:none;box-shadow:none}
.fab-icon{font-size:22px}

/* Department Selector */
.selector{max-width:600px;margin:60px auto;padding:0 16px}
.selector h1{text-align:center;font-size:28px;font-weight:800;color:#1e293b;margin-bottom:8px}
.selector p{text-align:center;color:#64748b;margin-bottom:32px;font-size:15px}
.dept-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:16px}
.dept-card{background:#fff;border-radius:16px;padding:28px 20px;text-align:center;border:2px solid #e2e8f0;cursor:pointer;transition:all 0.15s}
.dept-card:hover{border-color:#3b82f6;box-shadow:0 4px 20px rgba(59,130,246,0.15);transform:translateY(-2px)}
.dept-card .dept-icon{font-size:36px;margin-bottom:10px}
.dept-card .dept-name{font-size:16px;font-weight:700;color:#1e293b}
.dept-card .dept-count{font-size:12px;color:#94a3b8;margin-top:4px}

/* Animations */
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
.pulse{animation:pulse 2s infinite}
@keyframes slideIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.slide-in{animation:slideIn 0.3s ease}

/* Responsive */
@media(max-width:500px){
  .header{padding:16px}
  .header-left h1{font-size:18px}
  .serving-card{padding:32px 20px}
  .serving-number{font-size:72px}
  .fab{bottom:20px;right:20px;padding:16px 28px;font-size:16px}
}
</style>
</head>
<body>

<div id="app"></div>

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
(function() {
  var SB_URL = '${SUPABASE_URL}';
  var SB_KEY = '${SUPABASE_ANON_KEY}';
  var DEPT = '${dept}';
  var sb = window.supabase.createClient(SB_URL, SB_KEY);
  var session = null;
  var turns = [];
  var channel = null;
  var connected = false;
  var advancing = false;

  var app = document.getElementById('app');

  // ── Department Selector (no dept in URL) ──
  if (!DEPT) {
    loadDepartments();
    return;
  }

  async function loadDepartments() {
    var res = await sb.from('queue_sessions').select('*').eq('is_active', true).order('title');
    var sessions = res.data || [];
    var icons = { deli: '🥩', bakery: '🍞', butcher: '🔪', seafood: '🐟', pharmacy: '💊', produce: '🥬', floral: '💐' };
    var html = '<div class="selector">';
    html += '<h1>Queue Admin</h1>';
    html += '<p>Selecciona un departamento para administrar su cola</p>';
    html += '<div class="dept-grid">';
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      var code = s.department_code || '';
      var icon = icons[code] || '🏪';
      html += '<div class="dept-card" onclick="location.href=location.pathname+\'?dept=' + code + '\'">';
      html += '<div class="dept-icon">' + icon + '</div>';
      html += '<div class="dept-name">' + (s.title || code) + '</div>';
      html += '<div class="dept-count">Turnos: ' + s.current_turn + '</div>';
      html += '</div>';
    }
    html += '</div></div>';
    app.innerHTML = html;
  }

  // ── Main Queue Admin ──
  init();

  async function init() {
    // Find active session
    var res = await sb.from('queue_sessions').select('*').eq('department_code', DEPT).eq('is_active', true).limit(1);
    var sessions = res.data || [];
    if (sessions.length === 0) {
      app.innerHTML = '<div class="empty-card" style="margin:60px auto;max-width:500px"><div class="empty-icon">🚫</div><div class="empty-text">No hay sesión activa para "' + DEPT + '"</div><p style="margin-top:12px;color:#94a3b8"><a href="' + location.pathname + '" style="color:#3b82f6">← Volver a departamentos</a></p></div>';
      return;
    }
    session = sessions[0];

    // Fetch turns
    var tRes = await sb.from('queue_turns').select('*').eq('session_id', session.id).order('turn_number', { ascending: true });
    turns = tRes.data || [];

    render();
    subscribe();
  }

  function subscribe() {
    channel = sb.channel('admin_queue_' + session.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_turns', filter: 'session_id=eq.' + session.id }, function(payload) {
        if (payload.eventType === 'INSERT') {
          var exists = turns.some(function(t) { return t.id === payload.new.id; });
          if (!exists) turns.push(payload.new);
          turns.sort(function(a, b) { return a.turn_number - b.turn_number; });
        } else if (payload.eventType === 'UPDATE') {
          turns = turns.map(function(t) { return t.id === payload.new.id ? payload.new : t; });
        } else if (payload.eventType === 'DELETE') {
          turns = turns.filter(function(t) { return t.id !== payload.old.id; });
        }
        render();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'queue_sessions', filter: 'id=eq.' + session.id }, function(payload) {
        session = payload.new;
        render();
      })
      .subscribe(function(status) {
        connected = (status === 'SUBSCRIBED');
        updateConnDot();
      });
  }

  function updateConnDot() {
    var dot = document.getElementById('conn-dot');
    if (dot) {
      dot.className = 'conn-dot ' + (connected ? 'conn-ok' : 'conn-off');
    }
  }

  function render() {
    var serving = null;
    var waiting = [];
    for (var i = 0; i < turns.length; i++) {
      if (turns[i].status === 'serving') serving = turns[i];
      else if (turns[i].status === 'waiting') waiting.push(turns[i]);
    }

    var icons = { deli: '🥩', bakery: '🍞', butcher: '🔪', seafood: '🐟', pharmacy: '💊', produce: '🥬', floral: '💐' };
    var deptIcon = icons[DEPT] || '🏪';
    var deptTitle = session.title || DEPT;

    var html = '';

    // Header
    html += '<div class="header">';
    html += '<div class="header-left">';
    html += '<div class="dept-label"><span id="conn-dot" class="conn-dot ' + (connected ? 'conn-ok' : 'conn-off') + '"></span> Queue Admin</div>';
    html += '<h1>' + deptIcon + ' ' + deptTitle + '</h1>';
    html += '</div>';
    html += '<div class="header-right">';
    html += '<div class="stat-pill"><div class="num">' + session.current_turn + '</div><div class="label">Total</div></div>';
    html += '<div class="stat-pill"><div class="num">' + waiting.length + '</div><div class="label">Esperando</div></div>';
    html += '</div>';
    html += '</div>';

    // Main
    html += '<div class="main">';

    // Serving Card
    if (serving) {
      var isRegistered = !!serving.user_id;
      var name = serving.user_name || 'Anonymous';
      html += '<div class="serving-card slide-in">';
      html += '<div class="serving-label">Atendiendo Ahora</div>';
      html += '<div class="serving-number pulse">#' + serving.turn_number + '</div>';
      html += '<div class="serving-name">' + escHtml(name) + '</div>';
      html += '<div class="serving-badge">' + (isRegistered ? '✓ Cliente Registrado' : 'Anónimo') + '</div>';
      if (serving.user_phone) html += '<div class="serving-phone">📞 ' + escHtml(serving.user_phone) + '</div>';
      html += '</div>';
    } else {
      html += '<div class="empty-card">';
      html += '<div class="empty-icon">⏳</div>';
      html += '<div class="empty-text">' + (waiting.length > 0 ? 'Presiona "Siguiente" para atender' : 'No hay nadie en la cola') + '</div>';
      html += '</div>';
    }

    // Waiting Section
    html += '<div class="section-title">En Espera <span class="section-count">' + waiting.length + '</span></div>';
    if (waiting.length === 0) {
      html += '<div style="text-align:center;color:#94a3b8;padding:24px 0;font-size:14px">No hay personas esperando</div>';
    } else {
      html += '<div class="waiting-list">';
      for (var w = 0; w < waiting.length; w++) {
        var t = waiting[w];
        var reg = !!t.user_id;
        html += '<div class="waiting-item slide-in">';
        html += '<div class="waiting-num">#' + t.turn_number + '</div>';
        html += '<div class="waiting-info">';
        html += '<div class="waiting-name">' + escHtml(t.user_name || 'Anonymous') + '</div>';
        html += '<div class="waiting-meta">';
        if (w === 0) html += '<span class="next-indicator">→ Siguiente </span>';
        html += '<span class="waiting-badge ' + (reg ? 'badge-registered' : 'badge-anonymous') + '">' + (reg ? 'Registrado' : 'Anónimo') + '</span>';
        if (t.user_phone) html += ' · 📞 ' + escHtml(t.user_phone);
        html += '</div>';
        html += '</div>';
        html += '</div>';
      }
      html += '</div>';
    }

    html += '</div>'; // .main

    // FAB
    var hasAnyone = serving || waiting.length > 0;
    var btnLabel = serving ? 'Siguiente' : (waiting.length > 0 ? 'Comenzar' : 'Siguiente');
    if (hasAnyone) {
      html += '<button class="fab" id="next-btn" onclick="window._nextTurn()">';
      html += '<span class="fab-icon">⏭</span> ' + btnLabel + ' →';
      html += '</button>';
    }

    app.innerHTML = html;
  }

  window._nextTurn = async function() {
    if (advancing) return;
    advancing = true;
    var btn = document.getElementById('next-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="fab-icon">⏳</span> Procesando...'; }

    try {
      var res = await sb.rpc('advance_queue', { p_department_code: DEPT });
      if (res.error) console.error('Error advancing queue:', res.error);
    } catch(e) {
      console.error('Error:', e);
    }

    advancing = false;
    // UI updates via realtime, but re-enable button
    setTimeout(function() {
      var btn2 = document.getElementById('next-btn');
      if (btn2) { btn2.disabled = false; }
      render();
    }, 300);
  };

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

})();
</script>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const dept = (url.searchParams.get("dept") || "").replace(/[^a-zA-Z0-9_-]/g, "");

  return new Response(renderPage(dept), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
    },
  });
});
