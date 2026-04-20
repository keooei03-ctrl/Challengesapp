/* =============================================
   FOOTBALLPRO — Supabase SPA
   ============================================= */

// ===== SUPABASE =====
const { createClient } = window.supabase;
const db = createClient(
  'https://ulnbzhctsxzkwttwqcxx.supabase.co',
  'sb_publishable_Xq0oAjHiTwVmAcbeGBO7mA_MMOi82Ss'
);

// Exercises worden geladen vanuit Supabase — geen hardcoded lijst meer

const BADGES = [
  { id: 'eerste_stap',  icon: '👟', name: 'Eerste Stap',   desc: 'Eerste oefening voltooid' },
  { id: 'op_stoom',     icon: '🔥', name: 'Op Stoom',      desc: '5 oefeningen voltooid' },
  { id: 'doorzetter',   icon: '💪', name: 'Doorzetter',    desc: '10 oefeningen voltooid' },
  { id: 'honderd',      icon: '💯', name: '100 Punten',    desc: '100 punten bereikt' },
  { id: 'halfduizend',  icon: '⭐', name: '500 Club',      desc: '500 punten bereikt' },
  { id: 'challenger',   icon: '🏆', name: 'Challenger',    desc: 'Eerste challenge voltooid' },
];

const LEVELS = [
  { min: 0,    max: 99,       name: 'Beginner', icon: '🌱', cls: 'lvl-beginner' },
  { min: 100,  max: 299,      name: 'Amateur',  icon: '⚽', cls: 'lvl-amateur'  },
  { min: 300,  max: 599,      name: 'Semi-Pro', icon: '🔥', cls: 'lvl-semipro'  },
  { min: 600,  max: 999,      name: 'Pro',      icon: '⭐', cls: 'lvl-pro'      },
  { min: 1000, max: Infinity, name: 'Elite',    icon: '👑', cls: 'lvl-elite'    },
];

const VALID_VIEWS = ['dashboard', 'exercises', 'challenges', 'leaderboard', 'profile', 'trainer'];

// ===== STATE =====
let state = {
  currentUserId: null,
  currentView: 'dashboard',
  trainerTab: 'overzicht',
  selectedPlayerId: null,
  selectedExerciseIds: [],
  exerciseFilter: { category: 'all', level: 'all' },
  exerciseSearch: '',
  data: { users: [], exercises: [], assignments: [], challenges: [], submissions: [], points: {}, peerChallenges: [], settings: {} }
};

// ===== DB MAPPERS =====
const mapExercise     = e  => ({ id: e.id, title: e.title, desc: e.description, category: e.category, level: e.level, videoId: e.video_id, points: e.points, emoji: e.emoji || '⚽', createdBy: e.created_by });
const mapAssignment   = a  => ({ id: a.id, playerId: a.player_id, exerciseId: a.exercise_id, completed: a.completed, completedAt: a.completed_at });
const mapChallenge    = c  => ({ id: c.id, title: c.title, desc: c.description, videoId: c.video_id, points: c.points, createdBy: c.created_by, icon: c.icon, active: c.active });
const mapSubmission   = s  => ({ id: s.id, playerId: s.player_id, challengeId: s.challenge_id, status: s.status, submittedAt: s.submitted_at, videoUrl: s.video_url, videoFile: s.video_file, note: s.note });
const mapPeerChallenge= pc => ({ id: pc.id, challengerId: pc.challenger_id, challengedId: pc.challenged_id, title: pc.title, exerciseId: pc.exercise_id, points: pc.points, status: pc.status, createdAt: pc.created_at, challengerVideo: pc.challenger_video, challengedVideo: pc.challenged_video, winnerId: pc.winner_id });

// ===== DATA LADEN =====
async function loadAllData() {
  const [
    { data: profiles },
    { data: exercises },
    { data: assignments },
    { data: challenges },
    { data: submissions },
    { data: pointsArr },
    { data: peerChallenges },
    { data: settingsArr },
  ] = await Promise.all([
    db.from('profiles').select('*'),
    db.from('exercises').select('*').order('created_at', { ascending: false }),
    db.from('assignments').select('*'),
    db.from('challenges').select('*').eq('active', true).order('created_at', { ascending: false }),
    db.from('submissions').select('*'),
    db.from('points').select('*'),
    db.from('peer_challenges').select('*').order('created_at', { ascending: false }),
    db.from('settings').select('*'),
  ]);

  const pointsMap = {};
  (pointsArr || []).forEach(p => {
    pointsMap[p.player_id] = { homework: p.homework || 0, manual: p.manual || 0, challenges: p.challenges || 0 };
  });

  const settingsMap = {};
  (settingsArr || []).forEach(s => { settingsMap[s.key] = s.value; });

  state.data = {
    users:          profiles || [],
    exercises:      (exercises || []).map(mapExercise),
    assignments:    (assignments    || []).map(mapAssignment),
    challenges:     (challenges     || []).map(mapChallenge),
    submissions:    (submissions    || []).map(mapSubmission),
    points:         pointsMap,
    peerChallenges: (peerChallenges || []).map(mapPeerChallenge),
    settings:       settingsMap,
  };
}

// ===== DB SCHRIJVEN =====
async function dbCompleteAssignment(assignmentId, pts, playerId) {
  await db.from('assignments').update({ completed: true, completed_at: new Date().toISOString() }).eq('id', assignmentId);
  const p = getPoints(playerId);
  await db.from('points').upsert({ player_id: playerId, homework: (p.homework || 0) + pts, manual: p.manual || 0, challenges: p.challenges || 0 }, { onConflict: 'player_id' });
}

async function dbApproveSubmission(subId, pts, playerId) {
  await db.from('submissions').update({ status: 'approved' }).eq('id', subId);
  const p = getPoints(playerId);
  await db.from('points').upsert({ player_id: playerId, homework: p.homework || 0, manual: p.manual || 0, challenges: (p.challenges || 0) + pts }, { onConflict: 'player_id' });
}

async function dbRejectSubmission(subId) {
  await db.from('submissions').delete().eq('id', subId);
}

async function dbAddManualPoints(playerId, pts) {
  const p = getPoints(playerId);
  await db.from('points').upsert({ player_id: playerId, homework: p.homework || 0, manual: (p.manual || 0) + pts, challenges: p.challenges || 0 }, { onConflict: 'player_id' });
}

async function dbAssignExercises(playerIds, exerciseIds) {
  const rows = [];
  playerIds.forEach(playerId => {
    const already = getPlayerAssignments(playerId).map(a => a.exerciseId);
    exerciseIds.forEach(exId => {
      if (!already.includes(exId)) rows.push({ id: uniqueId('a'), player_id: playerId, exercise_id: exId });
    });
  });
  if (rows.length > 0) await db.from('assignments').insert(rows);
  return rows.length;
}

async function dbSetWeeklyGoal(pts) {
  await db.from('settings').upsert({ key: 'weekly_goal', value: String(pts), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  state.data.settings['weekly_goal'] = String(pts);
}

async function dbCreateExercise({ title, desc, category, level, videoId, points, emoji }) {
  const id = uniqueId('ex');
  await db.from('exercises').insert({ id, title, description: desc, category, level, video_id: videoId || null, points, emoji: emoji || '⚽', created_by: state.currentUserId });
  return id;
}

async function dbDeleteExercise(id) {
  await db.from('assignments').delete().eq('exercise_id', id);
  await db.from('exercises').delete().eq('id', id);
}

async function dbCreateChallenge({ title, desc, videoId, points, icon }) {
  const id = uniqueId('ch');
  await db.from('challenges').insert({ id, title, description: desc, video_id: videoId, points, created_by: state.currentUserId, icon, active: true });
  return id;
}

async function dbDeleteChallenge(id) {
  await db.from('submissions').delete().eq('challenge_id', id);
  await db.from('challenges').update({ active: false }).eq('id', id);
}

async function uploadVideo(file, path) {
  const { error } = await db.storage.from('videos').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = db.storage.from('videos').getPublicUrl(path);
  return publicUrl;
}

async function dbSubmitChallenge({ challengeId, videoUrl, videoFile, note }) {
  const id = uniqueId('s');
  await db.from('submissions').insert({
    id, player_id: state.currentUserId, challenge_id: challengeId,
    status: 'pending', submitted_at: new Date().toISOString(),
    video_url: videoUrl || null, video_file: videoFile || null, note: note || null,
  });
  return id;
}

async function dbCreatePeerChallenge({ opponentId, title, exerciseId, points }) {
  const id = uniqueId('pc');
  await db.from('peer_challenges').insert({ id, challenger_id: state.currentUserId, challenged_id: opponentId, title, exercise_id: exerciseId || null, points, status: 'pending' });
  return id;
}

async function dbAcceptPeerChallenge(id) {
  await db.from('peer_challenges').update({ status: 'accepted' }).eq('id', id);
}

async function dbDeclinePeerChallenge(id) {
  await db.from('peer_challenges').delete().eq('id', id);
}

async function dbSubmitPeerVideo(pcId, isChallenger, file) {
  const path = `peer-challenges/${pcId}/${state.currentUserId}/${Date.now()}_${file.name}`;
  const publicUrl = await uploadVideo(file, path);
  const field = isChallenger ? 'challenger_video' : 'challenged_video';
  const pc = getPeerChallenge(pcId);
  const otherVideo = isChallenger ? pc.challengedVideo : pc.challengerVideo;
  const updateData = { [field]: publicUrl };
  if (otherVideo) updateData.status = 'judging';
  await db.from('peer_challenges').update(updateData).eq('id', pcId);
  return publicUrl;
}

async function dbPickDuelWinner(pcId, winnerId) {
  const pc = getPeerChallenge(pcId);
  if (!pc) return;
  await db.from('peer_challenges').update({ status: 'completed', winner_id: winnerId }).eq('id', pcId);
  const pts = pc.points;
  const p = getPoints(winnerId);
  await db.from('points').upsert({ player_id: winnerId, homework: p.homework || 0, manual: (p.manual || 0) + pts, challenges: p.challenges || 0 }, { onConflict: 'player_id' });
}

// ===== AUTH =====
function showLoading() { document.getElementById('loading').style.display = 'flex'; }
function hideLoading() { document.getElementById('loading').style.display = 'none'; }
function showAuthScreen() { document.getElementById('auth-screen').style.display = 'flex'; }
function hideAuthScreen() { document.getElementById('auth-screen').style.display = 'none'; }
function showApp() { document.getElementById('app').style.visibility = 'visible'; }

async function handleLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) { showToast('⚠️ Vul e-mail en wachtwoord in', 0, 'error'); return; }
  setAuthLoading(true);
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) { showToast('❌ ' + error.message, 0, 'error'); setAuthLoading(false); return; }
  await bootApp();
}

async function handleRegister() {
  const name     = document.getElementById('regName').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const roleBtn  = document.querySelector('#rolePicker .role-pick-btn.active');
  const role     = roleBtn ? roleBtn.dataset.role : 'player';
  if (!name || !email || !password) { showToast('⚠️ Vul alle velden in', 0, 'error'); return; }
  if (password.length < 6) { showToast('⚠️ Wachtwoord minimaal 6 tekens', 0, 'error'); return; }
  setAuthLoading(true);
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const { data, error } = await db.auth.signUp({
    email, password,
    options: { data: { name, initials, role } }
  });
  if (error) { showToast('❌ ' + error.message, 0, 'error'); setAuthLoading(false); return; }
  if (!data.session) {
    showToast('✉️ Bevestig je e-mail en log daarna in', 0, 'info');
    setAuthLoading(false);
    return;
  }
  // Profile is created automatically by the DB trigger on_auth_user_created
  await bootApp();
}

async function handleLogout() {
  await db.auth.signOut();
  state.currentUserId = null;
  state.data = { users: [], exercises: EXERCISES, assignments: [], challenges: [], submissions: [], points: {}, peerChallenges: [] };
  document.getElementById('app').style.visibility = 'hidden';
  showAuthScreen();
}

function setAuthLoading(on) {
  const btns = document.querySelectorAll('#loginBtn, #registerBtn');
  btns.forEach(b => { b.disabled = on; b.textContent = on ? 'Even geduld...' : b.id === 'loginBtn' ? 'Inloggen →' : 'Account aanmaken →'; });
}

function attachAuthEvents() {
  document.getElementById('loginTab').addEventListener('click', () => {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginTab').classList.add('active');
    document.getElementById('registerTab').classList.remove('active');
  });
  document.getElementById('registerTab').addEventListener('click', () => {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    document.getElementById('registerTab').classList.add('active');
    document.getElementById('loginTab').classList.remove('active');
  });
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
  document.getElementById('registerBtn').addEventListener('click', handleRegister);
  document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

  document.querySelectorAll('#rolePicker .role-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#rolePicker .role-pick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

async function bootApp() {
  hideAuthScreen();
  showLoading();
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) { hideLoading(); showAuthScreen(); setAuthLoading(false); return; }
    state.currentUserId = session.user.id;
    await loadAllData();
  } catch (err) {
    console.error('bootApp error:', err);
    hideLoading();
    showAuthScreen();
    setAuthLoading(false);
    showToast('❌ Verbindingsfout: ' + err.message, 0, 'error');
    return;
  }

  if (!getMe()) {
    hideLoading();
    showAuthScreen();
    setAuthLoading(false);
    showToast('❌ Profiel niet gevonden. Voer de trigger SQL uit in Supabase.', 0, 'error');
    return;
  }

  setAuthLoading(false);
  hideLoading();
  showApp();
  const hash = window.location.hash.slice(1);
  const me = getMe();
  state.currentView = VALID_VIEWS.includes(hash) ? hash : me.role === 'trainer' ? 'trainer' : 'dashboard';
  render();
}

// ===== HELPERS =====
function getUser(id)     { return state.data.users.find(u => u.id === id); }
function getMe()         { return getUser(state.currentUserId); }
function getPlayers()    { return state.data.users.filter(u => u.role === 'player'); }
function getExercise(id) { return state.data.exercises.find(e => e.id === id); }
function getChallenge(id){ return state.data.challenges.find(c => c.id === id); }
function getPoints(playerId) {
  if (!state.data.points[playerId]) state.data.points[playerId] = { homework: 0, manual: 0, challenges: 0 };
  return state.data.points[playerId];
}
function totalPoints(playerId) {
  const p = getPoints(playerId);
  return (p.homework || 0) + (p.manual || 0) + (p.challenges || 0);
}
function getPlayerAssignments(playerId)    { return state.data.assignments.filter(a => a.playerId === playerId); }
function getPlayerSubmissions(playerId)    { return state.data.submissions.filter(s => s.playerId === playerId); }
function getSubmissionForChallenge(pid, cid) { return state.data.submissions.find(s => s.playerId === pid && s.challengeId === cid); }
function getPeerChallenges()               { return state.data.peerChallenges || []; }
function getPeerChallenge(id)              { return getPeerChallenges().find(c => c.id === id); }
function getIncomingDuels(pid)             { return getPeerChallenges().filter(c => c.challengedId === pid && c.status === 'pending'); }
function getActiveDuels(pid)               { return getPeerChallenges().filter(c => (c.challengerId === pid || c.challengedId === pid) && c.status === 'accepted'); }
function hasSubmittedDuel(pc, pid)         { return pid === pc.challengerId ? !!pc.challengerVideo : !!pc.challengedVideo; }
function uniqueId(p)     { return p + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000); }
function getWeekStart() {
  const now = new Date();
  const day = now.getDay() === 0 ? 6 : now.getDay() - 1; // maandag = 0
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - day);
  return monday;
}
function getWeeklyPoints(playerId) {
  const weekStart = getWeekStart();
  const hwPts = state.data.assignments
    .filter(a => a.playerId === playerId && a.completed && a.completedAt && new Date(a.completedAt) >= weekStart)
    .reduce((sum, a) => { const ex = getExercise(a.exerciseId); return sum + (ex ? ex.points : 0); }, 0);
  const chalPts = state.data.submissions
    .filter(s => s.playerId === playerId && s.status === 'approved' && s.submittedAt && new Date(s.submittedAt) >= weekStart)
    .reduce((sum, s) => { const c = getChallenge(s.challengeId); return sum + (c ? c.points : 0); }, 0);
  return hwPts + chalPts;
}
function getWeeklyGoal() { return parseInt(state.data.settings['weekly_goal'] || '0'); }
function extractYouTubeId(input) {
  if (!input) return null;
  // Full URL: youtube.com/watch?v=ID or youtu.be/ID or youtube.com/embed/ID
  const match = input.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  if (match) return match[1];
  // Already just an ID (11 chars)
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  return input; // fallback, laat Supabase/YouTube de fout geven
}
function levelLabel(lvl) { return { beginner: 'Beginner', gemiddeld: 'Gemiddeld', gevorderd: 'Gevorderd' }[lvl] || lvl; }
function getLevel(pts)   { return LEVELS.find(l => pts >= l.min && pts <= l.max) || LEVELS[0]; }
function getNextLevelPts(pts) { const n = LEVELS.find(l => l.min > pts); return n ? n.min : null; }
function getLevelProgress(pts) {
  const l = getLevel(pts);
  if (l.max === Infinity) return 100;
  return Math.min(100, Math.round(((pts - l.min) / (l.max - l.min + 1)) * 100));
}
function pushHash(view) { history.replaceState(null, '', '#' + view); }

window.addEventListener('hashchange', () => {
  const hash = window.location.hash.slice(1);
  if (VALID_VIEWS.includes(hash) && hash !== state.currentView) {
    state.currentView = hash;
    render();
  }
});

// ===== RENDER ENGINE =====
function render() { renderHeader(); renderNav(); renderView(); }

function renderHeader() {
  const me = getMe();
  if (!me) return;
  const pts = me.role === 'player' ? totalPoints(me.id) : null;
  const lvl = pts !== null ? getLevel(pts) : null;

  document.getElementById('appHeader').innerHTML = `
    <div class="header-logo">
      <div class="logo-icon">⚽</div>
      <span class="logo-text">FootballPro</span>
    </div>
    <div class="header-right">
      ${lvl ? `<div class="level-chip ${lvl.cls}">${lvl.icon} ${lvl.name}</div>` : ''}
      ${pts !== null ? `<div class="header-points" id="headerPts">🏆 ${pts} pts</div>` : ''}
      <span class="role-badge ${me.role}">${me.role === 'trainer' ? 'Trainer' : 'Speler'}</span>
      <button class="btn btn-secondary btn-sm" id="logoutBtn" style="padding:7px 12px;font-size:0.78rem;">Uitloggen</button>
    </div>
  `;
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
}

const PLAYER_VIEWS  = [
  { id: 'dashboard',   label: 'Home',      icon: '🏠' },
  { id: 'exercises',   label: 'Trainingen', icon: '⚔️' },
  { id: 'challenges',  label: 'Missies',   icon: '🔥' },
  { id: 'leaderboard', label: 'Ranking',   icon: '👑' },
  { id: 'profile',     label: 'Profiel',   icon: '⚡' },
];
const TRAINER_VIEWS = [
  { id: 'trainer',     label: 'Panel',      icon: '🎓' },
  { id: 'exercises',   label: 'Oefeningen', icon: '📚' },
  { id: 'challenges',  label: 'Uitdagingen',icon: '🏆' },
  { id: 'leaderboard', label: 'Ranglijst',  icon: '📊' },
];

function renderNav() {
  const me = getMe();
  if (!me) return;
  const views = me.role === 'trainer' ? TRAINER_VIEWS : PLAYER_VIEWS;
  const items = views.map(v => `
    <button class="nav-item ${state.currentView === v.id ? 'active' : ''}" data-view="${v.id}">
      <span class="nav-icon">${v.icon}</span>
      <span class="nav-label">${v.label}</span>
    </button>`).join('');
  const sideItems = views.map(v => `
    <button class="sidebar-nav-item ${state.currentView === v.id ? 'active' : ''}" data-view="${v.id}">
      <span class="s-icon">${v.icon}</span>${v.label}
    </button>`).join('');

  document.getElementById('bottomNav').innerHTML = items;
  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-section">Navigatie</div>
    ${sideItems}
    <div style="margin-top:30px;padding-top:20px;border-top:1px solid var(--border);">
      <div style="font-size:0.78rem;color:var(--text-3);padding:0 14px;">
        ${me.name}<br>
        <span style="color:var(--green)">${me.role === 'trainer' ? 'Trainer' : totalPoints(me.id) + ' punten'}</span>
      </div>
    </div>`;

  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentView = btn.dataset.view;
      pushHash(btn.dataset.view);
      render();
      window.scrollTo(0, 0);
    });
  });
}

function renderView() {
  const el = document.getElementById('mainContent');
  el.innerHTML = '';
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = '';
  switch (state.currentView) {
    case 'dashboard':   el.innerHTML = renderDashboard();    break;
    case 'exercises':   el.innerHTML = renderExercises();    break;
    case 'challenges':  el.innerHTML = renderChallenges();   break;
    case 'leaderboard': el.innerHTML = renderLeaderboard();  break;
    case 'trainer':     el.innerHTML = renderTrainerPanel(); break;
    case 'profile':     el.innerHTML = renderProfile();      break;
  }
  attachViewEvents();
}

function renderWeeklyGoalCard(playerId) {
  const goal = getWeeklyGoal();
  if (!goal) return '';
  const earned = getWeeklyPoints(playerId);
  const pct    = Math.min(100, Math.round((earned / goal) * 100));
  const done   = earned >= goal;
  const days   = ['Ma','Di','Wo','Do','Vr','Za','Zo'];
  const today  = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  return `
    <div class="weekly-goal-card ${done ? 'done' : ''}">
      <div class="wg-header">
        <div class="wg-title">🎯 Weekdoel</div>
        <div class="wg-badge ${done ? 'done' : ''}">${done ? '✓ Behaald!' : earned + ' / ' + goal + ' pts'}</div>
      </div>
      <div class="wg-bar-wrap">
        <div class="wg-bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="wg-days">
        ${days.map((d, i) => `<div class="wg-day ${i < today ? 'past' : i === today ? 'today' : ''}">${d}</div>`).join('')}
      </div>
      ${done ? `<div class="wg-congrats">🔥 Geweldig werk deze week! Zo word je beter!</div>` : `<div class="wg-sub">${goal - earned} punten te gaan deze week</div>`}
    </div>`;
}

// ===== DASHBOARD =====
function renderDashboard() {
  const me  = getMe();
  if (!me) return `<div class="empty-state"><div class="empty-icon">⚠️</div><p>Profiel niet geladen. Probeer opnieuw in te loggen.</p></div>`;
  const pts = totalPoints(me.id);
  const lvl = getLevel(pts);
  const nextPts = getNextLevelPts(pts);
  const lvlPct  = getLevelProgress(pts);
  const assignments    = getPlayerAssignments(me.id);
  const completedCount = assignments.filter(a => a.completed).length;
  const pendingCount   = assignments.filter(a => !a.completed).length;

  const homeworkHtml = assignments.length === 0
    ? `<div class="empty-state"><div class="empty-icon">⚔️</div><p>Nog geen quests toegewezen — check later terug!</p></div>`
    : assignments.map(a => {
        const ex = getExercise(a.exerciseId);
        if (!ex) return '';
        return `
          <div class="homework-card ${a.completed ? 'completed' : ''}">
            <div class="homework-icon ${ex.category}">${ex.emoji}</div>
            <div class="homework-info">
              <div class="homework-title">${ex.title}</div>
              <div class="homework-meta">
                <span class="badge ${ex.category}">${ex.category}</span>
                <span class="badge ${ex.level}">${levelLabel(ex.level)}</span>
                <span class="homework-points">+${ex.points} pts</span>
              </div>
            </div>
            ${a.completed
              ? `<div class="completed-check">✓</div>`
              : `<button class="btn btn-primary btn-sm" data-action="complete-hw" data-assignment="${a.id}" data-points="${ex.points}" data-player="${a.playerId}">✓ Afronden  +${ex.points} XP</button>`}
          </div>`;
      }).join('');

  const activeChallenges = state.data.challenges.filter(c => {
    const sub = getSubmissionForChallenge(me.id, c.id);
    return !sub || sub.status === 'pending';
  });

  return `
    <div class="dashboard-hero">
      <div class="hero-greeting">Welkom terug 👋</div>
      <div class="hero-name">Hey, <span>${me.name.split(' ')[0]}!</span></div>
      <div style="font-size:0.82rem;color:var(--text-2);letter-spacing:0.3px">Elke training brengt je dichter bij je doel. 🔥</div>
      <div class="hero-points-row">
        <div class="hero-points-badge">
          <span>🏆</span>
          <div>
            <div class="hero-points-value" id="heroPts">${pts}</div>
            <div class="hero-points-label">Totale XP</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;">
          <div style="text-align:center;">
            <div style="font-size:1.4rem;font-weight:900;color:var(--green)">${completedCount}</div>
            <div style="font-size:0.72rem;color:var(--text-3);font-weight:600;text-transform:uppercase;">Voltooid</div>
          </div>
          <div style="text-align:center;margin-left:10px;">
            <div style="font-size:1.4rem;font-weight:900;color:var(--text-2)">${pendingCount}</div>
            <div style="font-size:0.72rem;color:var(--text-3);font-weight:600;text-transform:uppercase;">Open</div>
          </div>
        </div>
      </div>
      <div class="level-progress-row">
        <span class="level-chip-inline ${lvl.cls}">${lvl.icon} ${lvl.name}</span>
        <div class="level-bar-wrap"><div class="level-bar-fill ${lvl.cls}" style="width:${lvlPct}%"></div></div>
        <span class="level-next">${nextPts ? nextPts + ' pts' : 'MAX'}</span>
      </div>
    </div>

    <div class="grid-3" style="margin-bottom:12px;">
      <div class="stat-card green"><div class="stat-icon">⚔️</div><div class="stat-value">${getPoints(me.id).homework}</div><div class="stat-label">Quest XP</div></div>
      <div class="stat-card purple"><div class="stat-icon">🏆</div><div class="stat-value">${getPoints(me.id).challenges}</div><div class="stat-label">Mission XP</div></div>
      <div class="stat-card gold"><div class="stat-icon">⭐</div><div class="stat-value">${getPoints(me.id).manual}</div><div class="stat-label">Bonus XP</div></div>
    </div>
    ${renderWeeklyGoalCard(me.id)}

    <div class="section-header">
      <div class="section-title">⚔️ Dagelijkse Quests</div>
      <button class="btn btn-secondary btn-sm" data-view-nav="exercises">Alle trainingen</button>
    </div>
    ${homeworkHtml}

    ${activeChallenges.length > 0 ? `
      <div class="section-header">
        <div class="section-title">🔥 Actieve Missies</div>
        <button class="btn btn-secondary btn-sm" data-view-nav="challenges">Alle</button>
      </div>
      ${activeChallenges.slice(0, 2).map(c => {
        const sub = getSubmissionForChallenge(me.id, c.id);
        return `
          <div class="challenge-card">
            <div class="challenge-header">
              <div class="challenge-icon">${c.icon}</div>
              <div class="challenge-info">
                <div class="challenge-title">${c.title}</div>
                <div class="challenge-desc">${c.desc}</div>
              </div>
            </div>
            <div class="challenge-footer">
              <div class="challenge-reward">🏆 ${c.points} pts</div>
              ${sub ? `<span class="status-badge pending">In afwachting...</span>` : `<button class="btn btn-purple btn-sm" data-action="open-submit" data-challenge="${c.id}">Inleveren →</button>`}
            </div>
          </div>`;
      }).join('')}
    ` : ''}
    ${renderIncomingDuels(me.id)}
    ${renderActiveDuels(me.id)}
  `;
}

function renderIncomingDuels(playerId) {
  const incoming = getIncomingDuels(playerId);
  if (!incoming.length) return '';
  return `
    <div class="section-header"><div class="section-title" style="color:var(--red)">⚔️ Jij bent uitgedaagd! (${incoming.length})</div></div>
    ${incoming.map(pc => {
      const challenger = getUser(pc.challengerId);
      if (!challenger) return '';
      return `
        <div class="duel-incoming-card">
          <div class="duel-incoming-top">
            <div class="duel-challenger-avatar">${challenger.initials}</div>
            <div style="flex:1">
              <div class="duel-incoming-name"><strong>${challenger.name.split(' ')[0]}</strong> daagt jou uit!</div>
              <div class="duel-incoming-title">${pc.title}</div>
              <div style="font-size:0.78rem;color:var(--gold);font-weight:700;margin-top:4px;">🏆 ${pc.points} pts voor de winnaar</div>
            </div>
          </div>
          <div class="duel-incoming-actions">
            <button class="btn btn-primary btn-sm flex-1" data-action="accept-duel" data-pc="${pc.id}">⚔️ Accepteren</button>
            <button class="btn btn-danger btn-sm" data-action="decline-duel" data-pc="${pc.id}">✕ Weigeren</button>
          </div>
        </div>`;
    }).join('')}`;
}

function renderActiveDuels(playerId) {
  const duels = getActiveDuels(playerId);
  if (!duels.length) return '';
  return `
    <div class="section-header"><div class="section-title">⚔️ Actieve Duels</div></div>
    ${duels.map(pc => {
      const opponentId = pc.challengerId === playerId ? pc.challengedId : pc.challengerId;
      const opponent   = getUser(opponentId);
      if (!opponent) return '';
      const iSubmitted   = hasSubmittedDuel(pc, playerId);
      const theySubmitted= hasSubmittedDuel(pc, opponentId);
      return `
        <div class="duel-active-card" data-action="open-vs" data-pc="${pc.id}" style="cursor:pointer">
          <div class="duel-vs-mini">
            <div class="duel-mini-side"><div class="duel-mini-avatar you">Jij</div><div class="duel-mini-status">${iSubmitted ? '✅' : '⏳'}</div></div>
            <div class="duel-mini-vs">VS</div>
            <div class="duel-mini-side"><div class="duel-mini-avatar opp">${opponent.initials}</div><div class="duel-mini-status">${theySubmitted ? '✅' : '⏳'}</div></div>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:0.9rem;color:var(--text-1)">${pc.title}</div>
            <div style="font-size:0.75rem;color:var(--text-3);margin-top:2px;">vs ${opponent.name.split(' ')[0]} · 🏆 ${pc.points} pts</div>
          </div>
          ${!iSubmitted ? `<button class="btn btn-purple btn-sm" data-action="open-peer-submit" data-pc="${pc.id}">📹 Lever in</button>` : `<span class="status-badge approved">Ingediend ✓</span>`}
        </div>`;
    }).join('')}`;
}

// ===== EXERCISES =====
// ===== WORLD MAP =====
const ZONE_THEMES = {
  techniek:   { color: '#3b82f6', glow: 'rgba(59,130,246,0.5)',   bg: 'rgba(59,130,246,0.12)',  icon: '⚽', name: 'TECHNIEK DISTRICT',  sub: 'Beheers de bal',   bgClass: 'zone-bg-pitch'   },
  fysiek:     { color: '#ef4444', glow: 'rgba(239,68,68,0.5)',    bg: 'rgba(239,68,68,0.12)',   icon: '💪', name: 'FYSIEK ARENA',        sub: 'Bouw je kracht',   bgClass: 'zone-bg-gym'     },
  mentaal:    { color: '#8b5cf6', glow: 'rgba(139,92,246,0.5)',   bg: 'rgba(139,92,246,0.12)',  icon: '🧠', name: 'MENTAAL ZONE',        sub: 'Train je hoofd',   bgClass: 'zone-bg-stadium' },
  inspiratie: { color: '#f59e0b', glow: 'rgba(245,158,11,0.5)',   bg: 'rgba(245,158,11,0.12)',  icon: '🌟', name: 'INSPIRATIE PEAK',     sub: 'Bereik de top',    bgClass: 'zone-bg-lights'  },
};

function renderWorldMap() {
  const me = getMe();
  const assignments = getPlayerAssignments(me.id).sort((a, b) => new Date(a.assignedAt) - new Date(b.assignedAt));

  if (assignments.length === 0) return `
    <div class="wm-empty">
      <div class="wm-empty-icon">🗺️</div>
      <div class="wm-empty-title">Je reis begint binnenkort</div>
      <div class="wm-empty-sub">Je trainer wijst je oefeningen toe</div>
    </div>`;

  const totalDone = assignments.filter(a => a.completed).length;
  const pct       = Math.round((totalDone / assignments.length) * 100);

  // Group by category, preserving order of first appearance
  const catOrder = [];
  const byCategory = {};
  assignments.forEach(a => {
    const ex = getExercise(a.exerciseId);
    if (!ex) return;
    if (!byCategory[ex.category]) {
      byCategory[ex.category] = [];
      catOrder.push(ex.category);
    }
    byCategory[ex.category].push({ a, ex });
  });

  let html = `
    <div class="world-map">
      <div class="wm-top-bar">
        <div class="wm-top-title">⚽ Voetbalreis</div>
        <div class="wm-top-right">
          <div class="wm-top-pct">${pct}%</div>
          <div class="wm-top-sub">${totalDone}/${assignments.length} voltooid</div>
        </div>
      </div>
      <div class="wm-global-bar"><div class="wm-global-fill" style="width:${pct}%"></div></div>`;

  catOrder.forEach((cat, catI) => {
    const theme = ZONE_THEMES[cat] || ZONE_THEMES.techniek;
    const items = byCategory[cat];
    // Each category is independent: first uncompleted = active
    const activeIdxInCat = items.findIndex(({ a }) => !a.completed);
    const doneCat = items.filter(({ a }) => a.completed).length;

    if (catI > 0) html += `<div class="wm-zone-gap"></div>`;

    html += `
      <div class="wm-zone-section ${theme.bgClass}" style="--zc:${theme.color};--zb:${theme.bg};--zg:${theme.glow}">
        <div class="wm-zone-overlay"></div>
        <div class="wm-zone-banner">
          <div class="wm-zone-orb">${theme.icon}</div>
          <div class="wm-zone-info">
            <div class="wm-zone-name">${theme.name}</div>
            <div class="wm-zone-sub">${theme.sub}</div>
          </div>
          <div class="wm-zone-progress">
            <div class="wm-zone-pct">${doneCat}/${items.length}</div>
            <div class="wm-zone-pct-label">voltooid</div>
          </div>
        </div>
        <div class="wm-zone-nodes">`;

    items.forEach(({ a, ex }, i) => {
      const isCompleted = a.completed;
      const isActive    = i === activeIdxInCat;
      const isLocked    = !isCompleted && !isActive;
      const status      = isCompleted ? 'completed' : isActive ? 'active' : 'locked';
      const isRight     = i % 2 === 0;
      const labelSide   = isRight ? 'label-left' : 'label-right';

      if (i > 0) {
        html += `<div class="wm-conn ${isRight ? 'conn-rl' : 'conn-lr'}"></div>`;
      }

      html += `
        <div class="wm-row ${isRight ? 'row-right' : 'row-left'}">
          ${!isRight ? `<div class="wm-label ${labelSide} ${status}">
            <div class="wm-label-name">${ex.title}</div>
            <div class="wm-label-xp">+${ex.points} XP</div>
          </div>` : ''}
          <div class="wm-node ${status}"
            ${!isLocked ? `data-action="open-exercise" data-id="${ex.id}"` : ''}>
            ${isCompleted ? `<div class="wm-node-star">⭐</div>` : ''}
            ${isActive    ? `<div class="wm-pulse-ring"></div><div class="wm-pulse-ring delay"></div>` : ''}
            <div class="wm-node-emoji">${isLocked ? '🔒' : ex.emoji}</div>
            ${isActive    ? `<div class="wm-tap">TAP</div>` : ''}
          </div>
          ${isRight ? `<div class="wm-label ${labelSide} ${status}">
            <div class="wm-label-name">${ex.title}</div>
            <div class="wm-label-xp">+${ex.points} XP</div>
          </div>` : ''}
        </div>`;
    });

    html += `</div></div>`; // close wm-zone-nodes + wm-zone-section
  });

  html += `<div style="height:80px"></div></div>`;
  return html;
}

function renderExercises() {
  const me = getMe();
  if (me.role === 'player') return renderWorldMap();
  const { category, level } = state.exerciseFilter;
  const search = state.exerciseSearch.toLowerCase().trim();
  const filtered = state.data.exercises.filter(ex =>
    (category === 'all' || ex.category === category) &&
    (level    === 'all' || ex.level    === level) &&
    (!search || ex.title.toLowerCase().includes(search) || ex.desc.toLowerCase().includes(search))
  );
  const cards = filtered.length === 0
    ? `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🔍</div><p>Geen oefeningen gevonden</p></div>`
    : filtered.map(ex => `
        <div class="exercise-card" data-action="open-exercise" data-id="${ex.id}">
          <div class="exercise-thumb ${ex.category}"><span style="font-size:3rem">${ex.emoji}</span>${ex.videoId ? '<div class="play-overlay"><span>▶</span></div>' : ''}</div>
          <div class="exercise-body">
            <div class="exercise-badges"><span class="badge ${ex.category}">${ex.category}</span><span class="badge ${ex.level}">${levelLabel(ex.level)}</span></div>
            <div class="exercise-title">${ex.title}</div>
            <div class="exercise-desc">${ex.desc}</div>
            <div class="exercise-footer"><span class="exercise-pts">🏆 ${ex.points} pts</span><span style="font-size:0.78rem;color:var(--text-3)">Klik voor video →</span></div>
          </div>
        </div>`).join('');

  return `
    <div class="page-header"><div class="page-title">Oefeningen</div><div class="page-subtitle">${state.data.exercises.length} oefeningen beschikbaar</div></div>
    <div class="search-bar"><span class="search-icon">🔍</span><input type="text" id="exerciseSearch" placeholder="Zoek oefening..." value="${state.exerciseSearch}"></div>
    <div class="filter-bar">
      <select id="filterCat">
        <option value="all" ${category==='all'?'selected':''}>Alle categorieën</option>
        <option value="techniek" ${category==='techniek'?'selected':''}>⚽ Techniek</option>
        <option value="fysiek" ${category==='fysiek'?'selected':''}>💪 Fysiek</option>
        <option value="mentaal" ${category==='mentaal'?'selected':''}>🧠 Mentaal</option>
        <option value="inspiratie" ${category==='inspiratie'?'selected':''}>🌟 Inspiratie</option>
      </select>
      <select id="filterLevel">
        <option value="all" ${level==='all'?'selected':''}>Alle niveaus</option>
        <option value="beginner" ${level==='beginner'?'selected':''}>Beginner</option>
        <option value="gemiddeld" ${level==='gemiddeld'?'selected':''}>Gemiddeld</option>
        <option value="gevorderd" ${level==='gevorderd'?'selected':''}>Gevorderd</option>
      </select>
    </div>
    <div class="exercise-grid">${cards}</div>`;
}

// ===== CHALLENGES =====
function renderChallenges() {
  const me = getMe();
  const cards = state.data.challenges.map(c => {
    const sub = getSubmissionForChallenge(me.id, c.id);
    return `
      <div class="challenge-card">
        <div class="challenge-header">
          <div class="challenge-icon">${c.icon}</div>
          <div class="challenge-info"><div class="challenge-title">${c.title}</div><div class="challenge-desc">${c.desc}</div></div>
        </div>
        <div class="challenge-footer">
          <div class="challenge-reward">🏆 ${c.points} punten te verdienen</div>
          <div class="challenge-status">
            ${sub ? `<span class="status-badge ${sub.status}">${sub.status === 'approved' ? '✓ Goedgekeurd' : '⏳ In behandeling'}</span>` : ''}
            ${!sub ? `<button class="btn btn-purple btn-sm" data-action="open-submit" data-challenge="${c.id}">Inleveren →</button>` : ''}
            <button class="btn btn-secondary btn-sm" data-action="view-challenge" data-challenge="${c.id}">Video</button>
          </div>
        </div>
      </div>`;
  }).join('');

  const approved = getPlayerSubmissions(me.id).filter(s => s.status === 'approved').length;
  return `
    <div class="page-header"><div class="page-title">Uitdagingen 🏆</div><div class="page-subtitle">Voltooi challenges, verdien grote beloningen</div></div>
    ${approved > 0 ? `<div class="stat-card green" style="margin-bottom:20px;"><div class="stat-icon">🥇</div><div class="stat-value">${approved}</div><div class="stat-label">Voltooide challenges</div></div>` : ''}
    ${cards || '<div class="empty-state"><div class="empty-icon">🏆</div><p>Nog geen challenges beschikbaar</p></div>'}`;
}

// ===== LEADERBOARD =====
function renderLeaderboard() {
  const me = getMe();
  const players = getPlayers().map(p => ({ ...p, pts: totalPoints(p.id), lvl: getLevel(totalPoints(p.id)) })).sort((a, b) => b.pts - a.pts);
  const podiumOrder  = players.length >= 3 ? [players[1], players[0], players[2]] : players;
  const podiumColors = { 0: 'rank-2', 1: 'rank-1', 2: 'rank-3' };
  const podiumHeights= { 0: '80px',   1: '110px',  2: '60px'   };

  const podiumHtml = podiumOrder.slice(0, 3).map((p, i) => `
    <div class="podium-item">
      <div class="podium-avatar ${podiumColors[i]}">${i===1?'<span class="podium-crown">👑</span>':''}${p.initials}</div>
      <div class="podium-name">${p.name.split(' ')[0]}</div>
      <div class="podium-pts">${p.pts} pts</div>
      <div class="podium-bar" style="height:${podiumHeights[i]}">${i===1?'🥇':i===0?'🥈':'🥉'}</div>
    </div>`).join('');

  const listHtml = players.map((p, i) => {
    const rank = i + 1;
    const isMe = p.id === me.id;
    const existingDuel = getPeerChallenges().find(pc =>
      ((pc.challengerId === me.id && pc.challengedId === p.id) || (pc.challengerId === p.id && pc.challengedId === me.id)) &&
      ['pending','accepted'].includes(pc.status)
    );
    return `
      <div class="leaderboard-row ${isMe ? 'is-me' : ''}">
        <div class="rank-num ${rank<=3?'top3':''}">${rank<=3?['🥇','🥈','🥉'][rank-1]:rank}</div>
        <div class="lb-avatar">${p.initials}</div>
        <div class="lb-name">
          <div style="display:flex;align-items:center;gap:6px;">${p.name}${isMe?'<span style="font-size:0.72rem;color:var(--green);font-weight:700;">(jij)</span>':''}<span class="level-chip-xs ${p.lvl.cls}">${p.lvl.icon}</span></div>
          <small>📝 ${getPoints(p.id).homework} &nbsp; 🏅 ${getPoints(p.id).challenges} &nbsp; ⭐ ${getPoints(p.id).manual}</small>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="lb-points">${p.pts}</div>
          ${!isMe && me.role === 'player' ? existingDuel
            ? `<span class="status-badge pending" style="font-size:0.68rem;">⚔️ Duel</span>`
            : `<button class="btn btn-sm" style="background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3);padding:6px 10px;font-size:0.75rem;" data-action="challenge-player" data-player="${p.id}">⚔️</button>`
          : ''}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="page-header"><div class="page-title">Ranglijst 📊</div><div class="page-subtitle">Team klassement — blijf pushen!</div></div>
    <div class="podium">${podiumHtml}</div>
    <div class="leaderboard-list">${listHtml}</div>`;
}

// ===== TRAINER PANEL =====
function renderTrainerPanel() {
  const tabs = [
    { id: 'overzicht',   label: '📋 Overzicht'    },
    { id: 'toewijzen',   label: '📌 Toewijzen'    },
    { id: 'oefeningen',  label: '📚 Oefeningen'  },
    { id: 'challenges',  label: '🔥 Challenges'   },
    { id: 'goedkeuring', label: '✅ Goedkeuring'  },
    { id: 'punten',      label: '⭐ Punten'       },
    { id: 'duels',       label: '⚔️ Duels'        },
  ];
  const tabBar = `<div class="tab-bar">${tabs.map(t => `<button class="tab-btn ${state.trainerTab===t.id?'active':''}" data-trainer-tab="${t.id}">${t.label}</button>`).join('')}</div>`;
  let content = '';
  switch (state.trainerTab) {
    case 'overzicht':   content = renderTrainerOverview();   break;
    case 'toewijzen':   content = renderTrainerAssign();     break;
    case 'oefeningen':  content = renderTrainerExercises();  break;
    case 'challenges':  content = renderTrainerChallenges(); break;
    case 'goedkeuring': content = renderTrainerApprovals();  break;
    case 'punten':      content = renderTrainerPoints();     break;
    case 'duels':       content = renderTrainerDuels();      break;
  }
  return `<div class="page-header"><div class="page-title">Trainer Panel 🎓</div><div class="page-subtitle">Beheer spelers, huiswerk en uitdagingen</div></div>${tabBar}${content}`;
}

function renderTrainerOverview() {
  const players = getPlayers().sort((a, b) => totalPoints(b.id) - totalPoints(a.id));
  const pending = state.data.submissions.filter(s => s.status === 'pending').length;
  const total   = state.data.assignments.length;
  const done    = state.data.assignments.filter(a => a.completed).length;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const cats = Object.keys(ZONE_THEMES);

  return `
    <div class="trainer-stats-row">
      <div class="trainer-stat-pill">
        <span class="tsp-icon">👥</span>
        <span class="tsp-val">${players.length}</span>
        <span class="tsp-lbl">spelers</span>
      </div>
      <div class="trainer-stat-pill">
        <span class="tsp-icon">✅</span>
        <span class="tsp-val">${done}/${total}</span>
        <span class="tsp-lbl">voltooid</span>
      </div>
      <div class="trainer-stat-pill ${pending > 0 ? 'tsp-alert' : ''}">
        <span class="tsp-icon">⏳</span>
        <span class="tsp-val">${pending}</span>
        <span class="tsp-lbl">goedkeuring</span>
      </div>
    </div>

    ${players.length === 0
      ? `<div class="empty-state"><div class="empty-icon">👥</div><p>Nog geen spelers geregistreerd</p></div>`
      : players.map(p => {
          const as      = getPlayerAssignments(p.id);
          const pts     = totalPoints(p.id);
          const lvl     = getLevel(pts);
          const weekPts = getWeeklyPoints(p.id);
          const totalA  = as.length;
          const doneA   = as.filter(a => a.completed).length;
          const pct     = totalA > 0 ? Math.round((doneA / totalA) * 100) : 0;

          // Recent activity: last completed assignment
          const lastDone = as
            .filter(a => a.completed && a.completedAt)
            .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0];
          const daysSince = lastDone
            ? Math.floor((Date.now() - new Date(lastDone.completedAt)) / 86400000)
            : null;
          const isLate = daysSince === null ? totalA > 0 : daysSince >= 7;

          // Category breakdown
          const catBars = cats.map(cat => {
            const theme  = ZONE_THEMES[cat];
            const catAs  = as.filter(a => { const ex = getExercise(a.exerciseId); return ex && ex.category === cat; });
            if (catAs.length === 0) return '';
            const catPct = Math.round((catAs.filter(a => a.completed).length / catAs.length) * 100);
            return `
              <div class="tov-cat-row">
                <span class="tov-cat-icon">${theme.icon}</span>
                <div class="tov-cat-bar-wrap">
                  <div class="tov-cat-bar-fill" style="width:${catPct}%;background:${theme.color}"></div>
                </div>
                <span class="tov-cat-pct" style="color:${theme.color}">${catPct}%</span>
              </div>`;
          }).join('');

          // Open (not completed) assignments — show up to 3
          const openAs = as.filter(a => !a.completed).slice(0, 3);
          const openList = openAs.map(a => {
            const ex = getExercise(a.exerciseId);
            if (!ex) return '';
            const theme = ZONE_THEMES[ex.category] || ZONE_THEMES.techniek;
            return `<div class="tov-open-item">
              <span>${ex.emoji}</span>
              <span class="tov-open-name">${ex.title}</span>
              <span class="tov-open-xp" style="color:${theme.color}">+${ex.points} XP</span>
            </div>`;
          }).join('');

          return `
            <div class="tov-card ${isLate ? 'tov-late' : ''}">
              <div class="tov-header">
                <div class="tov-avatar ${isLate ? 'tov-avatar-late' : ''}">${p.initials}</div>
                <div class="tov-info">
                  <div class="tov-name">${p.name}
                    ${isLate ? `<span class="tov-badge-late">⚠️ achterloopt</span>` : ''}
                  </div>
                  <div class="tov-meta">
                    <span class="level-chip-xs ${lvl.cls}">${lvl.icon} ${lvl.name}</span>
                    <span class="tov-pts">⭐ ${pts} XP</span>
                    <span class="tov-week">+${weekPts} deze week</span>
                  </div>
                </div>
                <div class="tov-pct-circle">
                  <svg viewBox="0 0 36 36" class="tov-circle-svg">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="3"/>
                    <circle cx="18" cy="18" r="15" fill="none"
                      stroke="${pct >= 80 ? '#00e87a' : pct >= 40 ? '#f59e0b' : '#ef4444'}"
                      stroke-width="3"
                      stroke-dasharray="${(pct / 100) * 94.2} 94.2"
                      stroke-linecap="round"
                      transform="rotate(-90 18 18)"/>
                  </svg>
                  <span class="tov-circle-pct">${pct}%</span>
                </div>
              </div>

              ${catBars ? `<div class="tov-cats">${catBars}</div>` : ''}

              ${openList ? `
                <div class="tov-open-section">
                  <div class="tov-open-label">📌 Open oefeningen</div>
                  ${openList}
                  ${as.filter(a => !a.completed).length > 3
                    ? `<div class="tov-open-more">+${as.filter(a=>!a.completed).length - 3} meer</div>`
                    : ''}
                </div>` : `
                <div class="tov-all-done">🎉 Alle oefeningen voltooid!</div>`}

              <div class="tov-footer">
                ${daysSince === null
                  ? `<span class="tov-activity tov-activity-none">Nog niet begonnen</span>`
                  : daysSince === 0
                  ? `<span class="tov-activity tov-activity-ok">✅ Vandaag actief</span>`
                  : daysSince === 1
                  ? `<span class="tov-activity tov-activity-ok">Gisteren actief</span>`
                  : daysSince < 7
                  ? `<span class="tov-activity tov-activity-warn">${daysSince} dagen geleden actief</span>`
                  : `<span class="tov-activity tov-activity-late">⚠️ ${daysSince} dagen inactief</span>`}
                <span class="tov-footer-count">${doneA}/${totalA} oefeningen</span>
              </div>
            </div>`;
        }).join('')}`;
}

function renderTrainerAssign() {
  const players = getPlayers();
  const sel     = state.selectedPlayerId;
  const playerGrid = `
    <div class="section-header" style="margin-top:0;"><div class="section-title">Stap 1 — Kies een speler</div></div>
    <div class="player-select-grid">
      ${players.map(p => `
        <div class="player-select-card ${sel===p.id?'selected':''}" data-select-player="${p.id}">
          <div class="psc-avatar">${p.initials}</div>
          <div class="psc-name">${p.name.split(' ')[0]}</div>
          <div class="psc-pts">${totalPoints(p.id)} pts</div>
        </div>`).join('')}
    </div>`;

  if (!sel) return `${playerGrid}<div class="empty-state"><div class="empty-icon">👆</div><p>Kies een speler</p></div>`;

  const alreadyAssigned = getPlayerAssignments(sel).map(a => a.exerciseId);
  const exerciseList = state.data.exercises.map(ex => {
    const isAssigned = alreadyAssigned.includes(ex.id);
    const isSelected = state.selectedExerciseIds.includes(ex.id);
    return `
      <div class="assign-exercise-row ${isSelected?'selected-assign':''}" data-toggle-exercise="${ex.id}" style="${isAssigned?'opacity:0.5;':'cursor:pointer'}">
        <div class="aer-check">${isSelected||isAssigned ? '✓' : ''}</div>
        <div class="aer-info">
          <div class="aer-title">${ex.emoji} ${ex.title}</div>
          <div class="aer-meta">
            <span class="badge ${ex.category}">${ex.category}</span>
            <span class="badge ${ex.level}">${levelLabel(ex.level)}</span>
            <span style="color:var(--gold);font-weight:700;font-size:0.75rem">+${ex.points} pts</span>
            ${isAssigned ? '<span style="color:var(--green);font-size:0.72rem">Al toegewezen</span>' : ''}
          </div>
        </div>
      </div>`;
  }).join('');

  const has = state.selectedExerciseIds.length > 0;
  return `
    ${playerGrid}
    <div class="section-header">
      <div class="section-title">Stap 2 — Kies oefeningen</div>
      ${has ? `<div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" data-action="assign-exercises">Toewijzen (${state.selectedExerciseIds.length})</button>
        <button class="btn btn-secondary btn-sm" data-action="assign-all-players">Heel team</button>
      </div>` : ''}
    </div>
    ${exerciseList}`;
}

function renderTrainerExercises() {
  const exList = state.data.exercises.map(ex => `
    <div class="card" style="margin-bottom:10px;display:flex;align-items:center;gap:14px;">
      <div style="font-size:2rem;flex-shrink:0">${ex.emoji}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;margin-bottom:4px;">${ex.title}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <span class="badge ${ex.category}">${ex.category}</span>
          <span class="badge ${ex.level}">${levelLabel(ex.level)}</span>
          <span style="color:var(--gold);font-size:0.75rem;font-weight:700">+${ex.points} pts</span>
        </div>
      </div>
      <button class="btn btn-danger btn-xs" data-action="delete-exercise" data-exercise="${ex.id}" style="flex-shrink:0">Verwijder</button>
    </div>`).join('');

  return `
    <div class="section-header" style="margin-top:0;">
      <div class="section-title">Oefeningen (${state.data.exercises.length})</div>
      <button class="btn btn-primary btn-sm" data-action="open-create-exercise">+ Nieuwe Oefening</button>
    </div>
    ${exList || '<div class="empty-state"><div class="empty-icon">📚</div><p>Nog geen oefeningen aangemaakt</p></div>'}`;
}

function openCreateExerciseModal() {
  const EMOJIS = ['⚽','🔷','🦶','🏃','✨','💨','⚡','🔥','🏅','🧠','🎯','💪','🌟','👑','🎬','🏋️','🎽','🥅'];
  openModal(`
    <div class="modal-title">📚 Nieuwe Oefening</div>
    <div class="form-group">
      <label class="form-label">Titel *</label>
      <input type="text" id="exTitle" placeholder="bijv. Bal controle 1000 aanrakingen">
    </div>
    <div class="form-group">
      <label class="form-label">Beschrijving</label>
      <textarea id="exDesc" placeholder="Uitleg van de oefening..."></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Categorie</label>
      <select id="exCat">
        <option value="techniek">⚽ Techniek</option>
        <option value="fysiek">💪 Fysiek</option>
        <option value="mentaal">🧠 Mentaal</option>
        <option value="inspiratie">🌟 Inspiratie</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Niveau</label>
      <select id="exLevel">
        <option value="beginner">Beginner</option>
        <option value="gemiddeld">Gemiddeld</option>
        <option value="gevorderd">Gevorderd</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">YouTube Video ID <span style="color:var(--text-3);font-size:0.8rem">(optioneel)</span></label>
      <input type="text" id="exVideo" placeholder="YouTube link of video ID">
    </div>
    <div class="form-group">
      <label class="form-label">Punten</label>
      <input type="number" id="exPoints" value="50" min="5" max="500">
    </div>
    <div class="form-group">
      <label class="form-label">Emoji</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;" id="emojiPicker">
        ${EMOJIS.map(e => `<button class="emoji-pick-btn" data-emoji="${e}" style="font-size:1.4rem;padding:4px 8px;border-radius:8px;background:var(--bg-3);border:2px solid transparent;">${e}</button>`).join('')}
      </div>
      <input type="hidden" id="exEmoji" value="⚽">
    </div>
    <button class="btn btn-primary btn-full" id="saveExerciseBtn" style="margin-top:8px;">Oefening Opslaan →</button>
  `);

  document.querySelectorAll('.emoji-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.emoji-pick-btn').forEach(b => b.style.borderColor = 'transparent');
      btn.style.borderColor = 'var(--green)';
      document.getElementById('exEmoji').value = btn.dataset.emoji;
    });
  });

  document.getElementById('saveExerciseBtn').addEventListener('click', async () => {
    const title = document.getElementById('exTitle').value.trim();
    if (!title) { showToast('⚠️ Vul een titel in', 0, 'error'); return; }
    const saveBtn = document.getElementById('saveExerciseBtn');
    saveBtn.disabled = true; saveBtn.textContent = 'Opslaan...';
    const id = await dbCreateExercise({
      title,
      desc:     document.getElementById('exDesc').value.trim(),
      category: document.getElementById('exCat').value,
      level:    document.getElementById('exLevel').value,
      videoId:  extractYouTubeId(document.getElementById('exVideo').value.trim()) || null,
      points:   parseInt(document.getElementById('exPoints').value) || 50,
      emoji:    document.getElementById('exEmoji').value,
    });
    await loadAllData();
    closeModal();
    showToast('📚 Oefening aangemaakt!', 0, 'success');
    renderView();
  });
}

function renderTrainerChallenges() {
  return `
    <div class="section-header" style="margin-top:0;">
      <div class="section-title">Actieve Challenges (${state.data.challenges.length})</div>
      <button class="btn btn-primary btn-sm" data-action="open-create-challenge">+ Nieuwe Challenge</button>
    </div>
    ${state.data.challenges.map(c => `
      <div class="challenge-card">
        <div class="challenge-header"><div class="challenge-icon">${c.icon}</div><div class="challenge-info"><div class="challenge-title">${c.title}</div><div class="challenge-desc">${c.desc}</div></div></div>
        <div class="challenge-footer">
          <div class="challenge-reward">🏆 ${c.points} pts</div>
          <button class="btn btn-danger btn-xs" data-action="delete-challenge" data-challenge="${c.id}">Verwijder</button>
        </div>
      </div>`).join('') || '<div class="empty-state"><div class="empty-icon">🏆</div><p>Nog geen challenges aangemaakt</p></div>'}`;
}

function renderSubmissionVideo(sub) {
  if (sub.videoUrl) {
    const isYT = sub.videoUrl.includes('youtube') || sub.videoUrl.includes('youtu.be');
    if (isYT) return `<a href="${sub.videoUrl}" target="_blank" rel="noopener" style="font-size:0.78rem;color:var(--green);margin-top:4px;display:block;">🎬 YouTube bekijken</a>`;
    return `<video src="${sub.videoUrl}" controls playsinline style="width:100%;border-radius:8px;max-height:180px;background:#000;margin-top:6px;"></video>`;
  }
  if (sub.videoFile) return `<div style="font-size:0.78rem;color:var(--text-2);margin-top:4px;">📹 ${sub.videoFile}</div>`;
  return '';
}

function renderTrainerApprovals() {
  const pending = state.data.submissions.filter(s => s.status === 'pending');
  if (!pending.length) return `<div class="empty-state" style="padding:60px 20px;"><div class="empty-icon">✅</div><p>Geen inzendingen wachten op goedkeuring</p></div>`;
  return `
    <div class="section-title" style="margin-bottom:16px;">Wacht op Goedkeuring (${pending.length})</div>
    ${pending.map(sub => {
      const player    = getUser(sub.playerId);
      const challenge = getChallenge(sub.challengeId);
      if (!player || !challenge) return '';
      return `
        <div class="approval-card">
          <div class="approval-header">
            <div class="approval-avatar">${player.initials}</div>
            <div class="approval-info">
              <div class="approval-name">${player.name}</div>
              <div class="approval-challenge">${challenge.title}</div>
              ${sub.note ? `<div style="font-size:0.78rem;color:var(--text-2);margin-top:4px;">"${sub.note}"</div>` : ''}
              ${renderSubmissionVideo(sub)}
            </div>
            <div style="text-align:right;"><div style="font-size:0.9rem;font-weight:800;color:var(--gold)">+${challenge.points} pts</div></div>
          </div>
          <div class="approval-actions">
            <button class="btn btn-primary btn-sm flex-1" data-action="approve-submission" data-sub="${sub.id}" data-points="${challenge.points}" data-player="${sub.playerId}">✓ Goedkeuren (+${challenge.points} pts)</button>
            <button class="btn btn-danger btn-sm" data-action="reject-submission" data-sub="${sub.id}">✕ Afwijzen</button>
          </div>
        </div>`;
    }).join('')}`;
}

function renderTrainerPoints() {
  const players = getPlayers();
  return `
    <div class="section-title" style="margin-bottom:20px;">Handmatig Punten Toekennen ⭐</div>
    <div class="card" style="margin-bottom:16px;">
      <div class="form-group">
        <label class="form-label">Speler</label>
        <select id="manualPlayer">
          <option value="">-- Kies speler --</option>
          ${players.map(p => `<option value="${p.id}">${p.name} (${totalPoints(p.id)} pts)</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group" style="margin-bottom:0;"><label class="form-label">Punten</label><input type="number" id="manualPts" placeholder="bijv. 25" min="1" max="500"></div>
        <div class="form-group" style="margin-bottom:0;"><label class="form-label">Reden</label><input type="text" id="manualReason" placeholder="bijv. Goede prestatie"></div>
      </div>
      <button class="btn btn-primary btn-full" style="margin-top:16px;" data-action="add-manual-points">⭐ Punten Toekennen</button>
    </div>
    <div class="section-title" style="margin-bottom:16px;margin-top:28px;">🎯 Weekdoel Instellen</div>
    <div class="card" style="margin-bottom:24px;">
      <div class="form-row">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Punten per week</label>
          <input type="number" id="weeklyGoalInput" placeholder="bijv. 100" min="10" max="1000" value="${getWeeklyGoal() || ''}">
        </div>
        <div style="display:flex;align-items:flex-end;">
          <button class="btn btn-primary btn-sm" data-action="set-weekly-goal">Opslaan</button>
        </div>
      </div>
      ${getWeeklyGoal() ? `<div style="margin-top:10px;font-size:0.82rem;color:var(--text-2)">Huidig doel: <strong style="color:var(--green)">${getWeeklyGoal()} pts/week</strong></div>` : ''}
    </div>
    <div class="section-title" style="margin-bottom:16px;">Huidige Standen</div>
    ${players.sort((a,b)=>totalPoints(b.id)-totalPoints(a.id)).map(p => `
      <div class="leaderboard-row" style="margin-bottom:8px;">
        <div class="lb-avatar">${p.initials}</div>
        <div class="lb-name">${p.name}<small>📝 ${getPoints(p.id).homework} &nbsp; 🏅 ${getPoints(p.id).challenges} &nbsp; ⭐ ${getPoints(p.id).manual}</small></div>
        <div class="lb-points">${totalPoints(p.id)}</div>
      </div>`).join('')}`;
}

function renderTrainerDuels() {
  const judging = getPeerChallenges().filter(pc => pc.status === 'judging');
  const active  = getPeerChallenges().filter(pc => pc.status === 'accepted');
  if (!judging.length && !active.length) return `<div class="empty-state"><div class="empty-icon">⚔️</div><p>Geen actieve duels</p></div>`;
  const renderDuelCard = (pc, showWinner) => {
    const c1 = getUser(pc.challengerId), c2 = getUser(pc.challengedId);
    if (!c1 || !c2) return '';
    return `
      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          <div class="lb-avatar">${c1.initials}</div>
          <div class="vs-badge" style="width:30px;height:30px;font-size:0.6rem;">VS</div>
          <div class="lb-avatar">${c2.initials}</div>
          <div style="flex:1"><div style="font-weight:700">${pc.title}</div><div style="font-size:0.78rem;color:var(--gold)">🏆 ${pc.points} pts</div></div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <div style="flex:1;text-align:center;background:var(--bg-3);border-radius:8px;padding:8px;">
            <div style="font-size:0.75rem;color:var(--text-3)">${c1.name.split(' ')[0]}</div>
            ${pc.challengerVideo ? `<video src="${pc.challengerVideo}" controls playsinline style="width:100%;border-radius:6px;max-height:120px;background:#000;margin-top:6px;"></video>` : '<div style="font-size:0.75rem;color:var(--text-3);margin-top:4px;">⏳ Nog niet ingediend</div>'}
          </div>
          <div style="flex:1;text-align:center;background:var(--bg-3);border-radius:8px;padding:8px;">
            <div style="font-size:0.75rem;color:var(--text-3)">${c2.name.split(' ')[0]}</div>
            ${pc.challengedVideo ? `<video src="${pc.challengedVideo}" controls playsinline style="width:100%;border-radius:6px;max-height:120px;background:#000;margin-top:6px;"></video>` : '<div style="font-size:0.75rem;color:var(--text-3);margin-top:4px;">⏳ Nog niet ingediend</div>'}
          </div>
        </div>
        ${showWinner ? `
          <div style="display:flex;gap:8px;">
            <button class="btn btn-primary btn-sm flex-1" data-action="pick-winner" data-pc="${pc.id}" data-winner="${c1.id}">🥇 ${c1.name.split(' ')[0]} wint</button>
            <button class="btn btn-secondary btn-sm flex-1" data-action="pick-winner" data-pc="${pc.id}" data-winner="${c2.id}">🥇 ${c2.name.split(' ')[0]} wint</button>
          </div>` : `<div style="text-align:center;font-size:0.78rem;color:var(--text-3);">Wacht op beide videos...</div>`}
      </div>`;
  };
  return `
    ${judging.length ? `<div class="section-header" style="margin-top:0;"><div class="section-title" style="color:var(--gold)">⚔️ Klaar voor beoordeling (${judging.length})</div></div>${judging.map(pc=>renderDuelCard(pc,true)).join('')}` : ''}
    ${active.length  ? `<div class="section-header"><div class="section-title">⏳ Bezig (${active.length})</div></div>${active.map(pc=>renderDuelCard(pc,false)).join('')}` : ''}`;
}

// ===== PROFILE =====
function renderProfile() {
  const me  = getMe();
  if (!me) return `<div class="empty-state"><div class="empty-icon">⚠️</div><p>Profiel niet geladen.</p></div>`;
  const pts = getPoints(me.id);
  const total   = totalPoints(me.id);
  const lvl     = getLevel(total);
  const nextPts = getNextLevelPts(total);
  const lvlPct  = getLevelProgress(total);
  const assignments  = getPlayerAssignments(me.id);
  const completed    = assignments.filter(a => a.completed);
  const approvedSubs = getPlayerSubmissions(me.id).filter(s => s.status === 'approved');
  const players = getPlayers().sort((a,b) => totalPoints(b.id)-totalPoints(a.id));
  const rank    = players.findIndex(p => p.id === me.id) + 1;
  const maxPts  = Math.max(...players.map(p => totalPoints(p.id)), 1);
  const vsTopPct= Math.min(100, Math.round((total / maxPts) * 100));

  return `
    <div class="profile-hero">
      <div class="profile-avatar">${me.initials}</div>
      <div style="flex:1">
        <div class="profile-name">${me.name}</div>
        <div class="profile-role">⚽ Voetballer</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
          <div class="profile-pts">${total}</div>
          <div>
            <div style="font-size:0.72rem;color:var(--text-3);font-weight:500;">totale punten</div>
            <div style="font-size:0.78rem;color:var(--gold);font-weight:700;">#${rank || '—'} in team</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="font-weight:700;">Level Voortgang</div>
        <span class="level-chip ${lvl.cls}">${lvl.icon} ${lvl.name}</span>
      </div>
      <div class="progress-bar" style="margin-bottom:8px;"><div class="level-bar-fill ${lvl.cls}" style="width:${lvlPct}%"></div></div>
      <div style="font-size:0.78rem;color:var(--text-3);">${total} pts ${nextPts ? `— nog ${nextPts-total} pts tot <strong style="color:var(--text-1)">${LEVELS[LEVELS.indexOf(lvl)+1]?.name}</strong>` : '— maximum bereikt!'}</div>
    </div>

    <div class="grid-2" style="margin-bottom:16px;">
      <div class="stat-card green"><div class="stat-icon">✅</div><div class="stat-value">${completed.length}</div><div class="stat-label">Oefeningen voltooid</div></div>
      <div class="stat-card purple"><div class="stat-icon">🏆</div><div class="stat-value">${approvedSubs.length}</div><div class="stat-label">Challenges voltooid</div></div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div style="font-weight:700;margin-bottom:16px;">Punten Verdeling</div>
      <div class="points-breakdown">
        <div class="pts-chip"><div class="pts-chip-value" style="color:var(--green)">${pts.homework}</div><div class="pts-chip-label">📝 Huiswerk</div></div>
        <div class="pts-chip"><div class="pts-chip-value" style="color:var(--purple-light)">${pts.challenges}</div><div class="pts-chip-label">🏅 Challenges</div></div>
        <div class="pts-chip"><div class="pts-chip-value" style="color:var(--gold)">${pts.manual}</div><div class="pts-chip-label">⭐ Trainer</div></div>
      </div>
    </div>

    <div class="card">
      <div style="font-weight:700;margin-bottom:16px;">Team Voortgang</div>
      <div class="progress-item">
        <div class="progress-header"><span class="progress-label">Score vs. top speler</span><span class="progress-value">${vsTopPct}%</span></div>
        <div class="progress-bar"><div class="progress-fill green" style="width:${vsTopPct}%"></div></div>
      </div>
      <div class="progress-item">
        <div class="progress-header"><span class="progress-label">Huiswerk voltooid</span><span class="progress-value">${assignments.length > 0 ? Math.round((completed.length/assignments.length)*100) : 0}%</span></div>
        <div class="progress-bar"><div class="progress-fill purple" style="width:${assignments.length > 0 ? Math.round((completed.length/assignments.length)*100) : 0}%"></div></div>
      </div>
    </div>`;
}

// ===== EVENT HANDLERS =====
function attachViewEvents() {
  const main = document.getElementById('mainContent');

  main.querySelectorAll('[data-action="complete-hw"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const aId      = btn.dataset.assignment;
      const pts      = parseInt(btn.dataset.points) || 0;
      const playerId = btn.dataset.player;
      const assignment = state.data.assignments.find(a => a.id === aId);
      if (!assignment || assignment.completed) return;
      btn.disabled = true; btn.textContent = '...';
      assignment.completed = true;
      assignment.completedAt = new Date().toISOString();
      const p = getPoints(playerId);
      p.homework = (p.homework || 0) + pts;
      await dbCompleteAssignment(aId, pts, playerId);
      showToast('✅ Oefening voltooid!', pts, 'success');
      render();
    });
  });

  main.querySelectorAll('[data-action="open-exercise"]').forEach(el => el.addEventListener('click', () => openExerciseModal(el.dataset.id)));
  main.querySelectorAll('[data-action="open-submit"]').forEach(btn => btn.addEventListener('click', () => openSubmitModal(btn.dataset.challenge)));
  main.querySelectorAll('[data-action="view-challenge"]').forEach(btn => btn.addEventListener('click', () => { const c = getChallenge(btn.dataset.challenge); if (c) openChallengeVideoModal(c); }));

  main.querySelectorAll('[data-trainer-tab]').forEach(btn => btn.addEventListener('click', () => {
    state.trainerTab = btn.dataset.trainerTab;
    state.selectedExerciseIds = [];
    renderView();
  }));

  main.querySelectorAll('[data-select-player]').forEach(el => el.addEventListener('click', () => {
    state.selectedPlayerId = el.dataset.selectPlayer;
    state.selectedExerciseIds = [];
    renderView();
  }));

  main.querySelectorAll('[data-toggle-exercise]').forEach(row => row.addEventListener('click', () => {
    if (row.style.opacity === '0.5') return;
    const id  = row.dataset.toggleExercise;
    const idx = state.selectedExerciseIds.indexOf(id);
    idx === -1 ? state.selectedExerciseIds.push(id) : state.selectedExerciseIds.splice(idx, 1);
    renderView();
  }));

  main.querySelectorAll('[data-action="assign-exercises"]').forEach(btn => btn.addEventListener('click', async () => {
    if (!state.selectedPlayerId || !state.selectedExerciseIds.length) return;
    btn.disabled = true;
    const count = await dbAssignExercises([state.selectedPlayerId], state.selectedExerciseIds);
    state.selectedExerciseIds = [];
    await loadAllData();
    showToast(`📌 ${count} oefening(en) toegewezen!`, 0, 'success');
    renderView();
  }));

  main.querySelectorAll('[data-action="assign-all-players"]').forEach(btn => btn.addEventListener('click', async () => {
    if (!state.selectedExerciseIds.length) return;
    btn.disabled = true;
    const count = await dbAssignExercises(getPlayers().map(p => p.id), state.selectedExerciseIds);
    state.selectedExerciseIds = [];
    await loadAllData();
    showToast(`📌 Toegewezen aan heel team (${count} nieuwe taken)!`, 0, 'success');
    renderView();
  }));

  main.querySelectorAll('[data-action="approve-submission"]').forEach(btn => btn.addEventListener('click', async () => {
    const subId = btn.dataset.sub, pts = parseInt(btn.dataset.points) || 0, playerId = btn.dataset.player;
    btn.disabled = true;
    await dbApproveSubmission(subId, pts, playerId);
    const sub = state.data.submissions.find(s => s.id === subId);
    if (sub) sub.status = 'approved';
    const p = getPoints(playerId);
    p.challenges = (p.challenges || 0) + pts;
    showToast(`✅ Goedgekeurd! +${pts} pts`, pts, 'success');
    renderView();
  }));

  main.querySelectorAll('[data-action="reject-submission"]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    await dbRejectSubmission(btn.dataset.sub);
    state.data.submissions = state.data.submissions.filter(s => s.id !== btn.dataset.sub);
    showToast('❌ Inzending afgewezen', 0, 'error');
    renderView();
  }));

  const weeklyGoalBtn = main.querySelector('[data-action="set-weekly-goal"]');
  if (weeklyGoalBtn) weeklyGoalBtn.addEventListener('click', async () => {
    const pts = parseInt(document.getElementById('weeklyGoalInput')?.value) || 0;
    if (pts < 10) { showToast('⚠️ Minimaal 10 punten als weekdoel', 0, 'error'); return; }
    weeklyGoalBtn.disabled = true;
    await dbSetWeeklyGoal(pts);
    showToast(`🎯 Weekdoel ingesteld op ${pts} punten!`, 0, 'success');
    renderView();
  });

  const manualBtn = main.querySelector('[data-action="add-manual-points"]');
  if (manualBtn) manualBtn.addEventListener('click', async () => {
    const playerId = document.getElementById('manualPlayer')?.value;
    const pts = parseInt(document.getElementById('manualPts')?.value) || 0;
    if (!playerId || pts <= 0) { showToast('⚠️ Kies een speler en vul een puntenaantal in', 0, 'error'); return; }
    manualBtn.disabled = true;
    await dbAddManualPoints(playerId, pts);
    const p = getPoints(playerId);
    p.manual = (p.manual || 0) + pts;
    showToast(`⭐ ${pts} punten toegekend aan ${getUser(playerId).name.split(' ')[0]}!`, pts, 'success');
    renderView();
  });

  main.querySelectorAll('[data-action="open-create-exercise"]').forEach(btn => btn.addEventListener('click', openCreateExerciseModal));

  main.querySelectorAll('[data-action="delete-exercise"]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm(`Oefening verwijderen? Alle toewijzingen worden ook verwijderd.`)) return;
    btn.disabled = true;
    await dbDeleteExercise(btn.dataset.exercise);
    state.data.exercises = state.data.exercises.filter(e => e.id !== btn.dataset.exercise);
    state.data.assignments = state.data.assignments.filter(a => a.exerciseId !== btn.dataset.exercise);
    showToast('🗑️ Oefening verwijderd', 0, 'info');
    renderView();
  }));

  main.querySelectorAll('[data-action="open-create-challenge"]').forEach(btn => btn.addEventListener('click', openCreateChallengeModal));

  main.querySelectorAll('[data-action="delete-challenge"]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    await dbDeleteChallenge(btn.dataset.challenge);
    state.data.challenges = state.data.challenges.filter(c => c.id !== btn.dataset.challenge);
    state.data.submissions = state.data.submissions.filter(s => s.challengeId !== btn.dataset.challenge);
    showToast('🗑️ Challenge verwijderd', 0, 'info');
    renderView();
  }));

  main.querySelectorAll('[data-action="challenge-player"]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openChallengePlayerModal(btn.dataset.player); }));

  main.querySelectorAll('[data-action="accept-duel"]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    await dbAcceptPeerChallenge(btn.dataset.pc);
    const pc = getPeerChallenge(btn.dataset.pc);
    if (pc) pc.status = 'accepted';
    showToast('⚔️ Duel geaccepteerd! Lever je video in.', 0, 'success');
    renderView();
  }));

  main.querySelectorAll('[data-action="decline-duel"]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    await dbDeclinePeerChallenge(btn.dataset.pc);
    state.data.peerChallenges = state.data.peerChallenges.filter(c => c.id !== btn.dataset.pc);
    showToast('Uitdaging geweigerd', 0, 'info');
    renderView();
  }));

  main.querySelectorAll('[data-action="open-vs"]').forEach(el => el.addEventListener('click', e => {
    if (e.target.closest('[data-action="open-peer-submit"]')) return;
    openVsModal(el.dataset.pc);
  }));

  main.querySelectorAll('[data-action="open-peer-submit"]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openPeerSubmitModal(btn.dataset.pc); }));

  main.querySelectorAll('[data-action="pick-winner"]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    const pcId = btn.dataset.pc, winnerId = btn.dataset.winner;
    await dbPickDuelWinner(pcId, winnerId);
    const pc = getPeerChallenge(pcId);
    if (pc) { pc.status = 'completed'; pc.winnerId = winnerId; }
    const p = getPoints(winnerId);
    p.manual = (p.manual || 0) + (getPeerChallenge(pcId)?.points || 0);
    showToast(`🥇 ${getUser(winnerId)?.name.split(' ')[0]} wint het duel!`, 0, 'success');
    renderView();
  }));

  main.querySelectorAll('[data-view-nav]').forEach(btn => btn.addEventListener('click', () => {
    state.currentView = btn.dataset.viewNav;
    pushHash(btn.dataset.viewNav);
    render();
    window.scrollTo(0, 0);
  }));

  const searchInput = document.getElementById('exerciseSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => { state.exerciseSearch = searchInput.value; renderView(); });
  }
  const filterCat   = document.getElementById('filterCat');
  const filterLevel = document.getElementById('filterLevel');
  if (filterCat)   filterCat.addEventListener('change',   () => { state.exerciseFilter.category = filterCat.value;   renderView(); });
  if (filterLevel) filterLevel.addEventListener('change', () => { state.exerciseFilter.level    = filterLevel.value; renderView(); });
}

// ===== MODALS =====
function openModal(html)  { document.getElementById('modalContent').innerHTML = html; document.getElementById('modalOverlay').classList.add('open'); }
function closeModal()     { document.getElementById('modalOverlay').classList.remove('open'); }

function openExerciseModal(exId) {
  const ex = getExercise(exId);
  if (!ex) return;
  const videoHtml = ex.videoId
    ? `<div class="video-container"><iframe src="https://www.youtube.com/embed/${ex.videoId}?rel=0&modestbranding=1" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>`
    : '';
  openModal(`
    <div class="modal-title">${ex.emoji} ${ex.title}</div>
    <div class="modal-subtitle"><span class="badge ${ex.category}">${ex.category}</span><span class="badge ${ex.level}" style="margin-left:6px">${levelLabel(ex.level)}</span><span style="margin-left:8px;color:var(--gold);font-weight:700;">+${ex.points} pts</span></div>
    ${videoHtml}
    <div style="font-size:0.92rem;color:var(--text-2);line-height:1.7;${!videoHtml?'margin-top:12px':''}">${ex.desc || ''}</div>`);
}

function openChallengeVideoModal(c) {
  openModal(`
    <div class="modal-title">${c.icon} ${c.title}</div>
    <div class="modal-subtitle" style="color:var(--gold)">🏆 ${c.points} punten te verdienen</div>
    ${c.videoId ? `<div class="video-container"><iframe src="https://www.youtube.com/embed/${c.videoId}?rel=0&modestbranding=1" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>` : ''}
    <div style="font-size:0.92rem;color:var(--text-2);line-height:1.7;">${c.desc || ''}</div>`);
}

function openSubmitModal(challengeId) {
  const c = getChallenge(challengeId);
  if (!c) return;
  let selectedFile = null;
  openModal(`
    <div class="modal-title">📤 Challenge Inleveren</div>
    <div class="modal-subtitle">${c.title} — 🏆 ${c.points} pts</div>
    <div class="form-group">
      <label class="form-label">📹 Video bewijs</label>
      <input type="file" id="videoFileInput" accept="video/*" capture="environment" style="display:none">
      <button class="btn btn-secondary btn-full upload-btn" id="cameraBtn"><span id="camIcon">📷</span> <span id="camLabel">Film of kies video van apparaat</span></button>
      <video id="videoPreview" style="display:none;width:100%;border-radius:12px;margin-top:12px;max-height:220px;background:#000;" controls playsinline></video>
    </div>
    <div class="upload-divider"><span>of plak een link</span></div>
    <div class="form-group"><label class="form-label">Video URL (YouTube, Instagram…)</label><input type="url" id="submitVideoUrl" placeholder="https://youtube.com/watch?v=..."></div>
    <div class="form-group"><label class="form-label">Bericht aan trainer</label><textarea id="submitNote" placeholder="Beschrijf kort wat je hebt gedaan..."></textarea></div>
    <button class="btn btn-primary btn-full" id="submitChallengeBtn">🚀 Inleveren voor goedkeuring</button>`);

  document.getElementById('cameraBtn').addEventListener('click', () => document.getElementById('videoFileInput').click());
  document.getElementById('videoFileInput').addEventListener('change', e => {
    selectedFile = e.target.files[0];
    if (!selectedFile) return;
    const preview = document.getElementById('videoPreview');
    preview.src = URL.createObjectURL(selectedFile);
    preview.style.display = 'block';
    document.getElementById('camIcon').textContent  = '✅';
    document.getElementById('camLabel').textContent = selectedFile.name.length > 30 ? selectedFile.name.slice(0,30)+'…' : selectedFile.name;
    document.getElementById('cameraBtn').style.borderColor = 'var(--green)';
  });

  document.getElementById('submitChallengeBtn').addEventListener('click', async () => {
    const videoUrl = document.getElementById('submitVideoUrl').value.trim();
    const note     = document.getElementById('submitNote').value.trim();
    if (!selectedFile && !videoUrl) { showToast('⚠️ Voeg een video toe als bewijs', 0, 'error'); return; }
    if (getSubmissionForChallenge(state.currentUserId, challengeId)) { showToast('⚠️ Al ingeleverd', 0, 'error'); closeModal(); return; }

    const btn = document.getElementById('submitChallengeBtn');
    btn.disabled = true; btn.textContent = selectedFile ? 'Uploaden...' : 'Opslaan...';
    try {
      let finalUrl = videoUrl;
      if (selectedFile) {
        finalUrl = await uploadVideo(selectedFile, `challenges/${challengeId}/${state.currentUserId}/${Date.now()}_${selectedFile.name}`);
      }
      const subId = await dbSubmitChallenge({ challengeId, videoUrl: finalUrl, videoFile: selectedFile?.name, note });
      state.data.submissions.push({ id: subId, playerId: state.currentUserId, challengeId, status: 'pending', submittedAt: new Date().toISOString(), videoUrl: finalUrl, videoFile: selectedFile?.name || null, note: note || null });
      closeModal();
      showToast('✅ Video ingediend! Wacht op goedkeuring.', 0, 'success');
      renderView();
    } catch (err) {
      showToast('❌ Upload mislukt: ' + err.message, 0, 'error');
      btn.disabled = false; btn.textContent = '🚀 Inleveren voor goedkeuring';
    }
  });
}

function openChallengePlayerModal(opponentId) {
  const me = getMe(), opponent = getUser(opponentId);
  if (!opponent) return;
  openModal(`
    <div class="modal-title">⚔️ Daag ${opponent.name.split(' ')[0]} uit!</div>
    <div style="display:flex;align-items:center;gap:12px;background:var(--bg-3);border-radius:12px;padding:14px;margin-bottom:20px;">
      <div class="duel-modal-avatar you">${me.initials}</div>
      <div class="vs-badge-sm">VS</div>
      <div class="duel-modal-avatar opp">${opponent.initials}</div>
      <div style="flex:1;margin-left:4px;"><div style="font-weight:700">${me.name.split(' ')[0]} vs ${opponent.name.split(' ')[0]}</div><div style="font-size:0.78rem;color:var(--text-3)">Wie is de beste?</div></div>
    </div>
    <div class="form-group"><label class="form-label">Jouw uitdaging</label><input type="text" id="duelTitle" placeholder="bijv. Wie heeft de meeste touches in 2 min?"></div>
    <div class="form-group"><label class="form-label">Gerelateerde oefening</label>
      <select id="duelExercise"><option value="">— Optioneel —</option>${EXERCISES.map(ex => `<option value="${ex.id}">${ex.emoji} ${ex.title}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Punten inzet</label><input type="number" id="duelPoints" value="100" min="25" max="500"></div>
    <button class="btn btn-primary btn-full" id="sendDuelBtn">⚔️ Uitdaging Versturen</button>`);

  document.getElementById('sendDuelBtn').addEventListener('click', async () => {
    const title = document.getElementById('duelTitle').value.trim();
    const exerciseId = document.getElementById('duelExercise').value || null;
    const points = parseInt(document.getElementById('duelPoints').value) || 100;
    if (!title) { showToast('⚠️ Geef je uitdaging een beschrijving', 0, 'error'); return; }
    const btn = document.getElementById('sendDuelBtn');
    btn.disabled = true; btn.textContent = 'Versturen...';
    const id = await dbCreatePeerChallenge({ opponentId, title, exerciseId, points });
    state.data.peerChallenges.unshift({ id, challengerId: state.currentUserId, challengedId: opponentId, title, exerciseId, points, status: 'pending', createdAt: new Date().toISOString(), challengerVideo: null, challengedVideo: null, winnerId: null });
    closeModal();
    showToast(`⚔️ Uitdaging verstuurd naar ${opponent.name.split(' ')[0]}!`, 0, 'success');
    renderView();
  });
}

function openVsModal(pcId) {
  const pc = getPeerChallenge(pcId);
  if (!pc) return;
  const me = getMe();
  const c1 = getUser(pc.challengerId), c2 = getUser(pc.challengedId);
  if (!c1 || !c2) return;
  const iCanSubmit = pc.status === 'accepted' && !hasSubmittedDuel(pc, me.id) && (me.id === pc.challengerId || me.id === pc.challengedId);

  const playerCol = (user, isChallenger) => {
    const submitted = isChallenger ? !!pc.challengerVideo : !!pc.challengedVideo;
    const video     = isChallenger ? pc.challengerVideo   : pc.challengedVideo;
    const isMe      = user.id === me.id;
    return `
      <div class="vs-player-col ${isMe?'vs-you':''}">
        <div class="vs-big-avatar ${isMe?'vs-avatar-you':'vs-avatar-opp'}">${user.initials}</div>
        <div class="vs-player-name">${user.name.split(' ')[0]}${isMe?' <span style="font-size:0.7rem;color:var(--green)">(jij)</span>':''}</div>
        <div class="vs-player-pts">${totalPoints(user.id)} pts</div>
        <div class="vs-submission-status ${submitted?'submitted':'waiting'}">${submitted?'✅ Video in':'⏳ Bezig...'}</div>
        ${video ? `<video src="${video}" controls playsinline style="width:100%;border-radius:8px;margin-top:8px;max-height:140px;background:#000;"></video>` : ''}
      </div>`;
  };

  openModal(`
    <div class="vs-modal-header">⚔️ DUEL</div>
    <div class="vs-arena">${playerCol(c1,true)}<div class="vs-center"><div class="vs-badge">VS</div><div class="vs-prize">🏆 ${pc.points} pts</div></div>${playerCol(c2,false)}</div>
    <div class="vs-challenge-info">
      <div class="vs-challenge-title">${pc.title}</div>
      ${pc.exerciseId ? `<div style="font-size:0.8rem;color:var(--text-3);margin-top:4px;">📚 ${getExercise(pc.exerciseId)?.title||''}</div>` : ''}
    </div>
    ${pc.status==='completed' ? `<div class="vs-winner-banner">🥇 Winnaar: <strong>${getUser(pc.winnerId)?.name.split(' ')[0]||'—'}</strong></div>`
      : iCanSubmit ? `<button class="btn btn-primary btn-full" style="margin-top:16px;" id="vsSubmitBtn">📹 Lever jouw video in</button>`
      : `<div style="text-align:center;padding:12px;color:var(--text-2);font-size:0.85rem;">Wacht tot beide spelers hun video hebben ingeleverd</div>`}`);

  document.getElementById('vsSubmitBtn')?.addEventListener('click', () => { closeModal(); openPeerSubmitModal(pcId); });
}

function openPeerSubmitModal(pcId) {
  const pc = getPeerChallenge(pcId);
  if (!pc) return;
  const isChallenger = state.currentUserId === pc.challengerId;
  let selectedFile = null;

  openModal(`
    <div class="modal-title">📹 Duel video inleveren</div>
    <div class="modal-subtitle">${pc.title}</div>
    <div class="form-group">
      <label class="form-label">📷 Jouw bewijs</label>
      <input type="file" id="peerVideoInput" accept="video/*" capture="environment" style="display:none">
      <button class="btn btn-secondary btn-full upload-btn" id="peerCamBtn"><span id="peerCamIcon">📷</span> <span id="peerCamLabel">Film of kies video</span></button>
      <video id="peerPreview" style="display:none;width:100%;border-radius:12px;margin-top:12px;max-height:200px;background:#000;" controls playsinline></video>
    </div>
    <button class="btn btn-primary btn-full" id="peerSubmitBtn">🚀 Inleveren</button>`);

  document.getElementById('peerCamBtn').addEventListener('click', () => document.getElementById('peerVideoInput').click());
  document.getElementById('peerVideoInput').addEventListener('change', e => {
    selectedFile = e.target.files[0];
    if (!selectedFile) return;
    const preview = document.getElementById('peerPreview');
    preview.src = URL.createObjectURL(selectedFile);
    preview.style.display = 'block';
    document.getElementById('peerCamIcon').textContent = '✅';
    document.getElementById('peerCamLabel').textContent = selectedFile.name.length > 30 ? selectedFile.name.slice(0,30)+'…' : selectedFile.name;
    document.getElementById('peerCamBtn').style.borderColor = 'var(--green)';
  });

  document.getElementById('peerSubmitBtn').addEventListener('click', async () => {
    if (!selectedFile) { showToast('⚠️ Voeg eerst een video toe', 0, 'error'); return; }
    const btn = document.getElementById('peerSubmitBtn');
    btn.disabled = true; btn.textContent = 'Uploaden...';
    try {
      const publicUrl = await dbSubmitPeerVideo(pcId, isChallenger, selectedFile);
      if (isChallenger) { pc.challengerVideo = publicUrl; }
      else              { pc.challengedVideo = publicUrl; }
      if (pc.challengerVideo && pc.challengedVideo) pc.status = 'judging';
      closeModal();
      showToast(pc.status === 'judging' ? '🔥 Beide videos in! Trainer beslist de winnaar.' : '✅ Video ingediend!', 0, 'success');
      renderView();
    } catch (err) {
      showToast('❌ Upload mislukt: ' + err.message, 0, 'error');
      btn.disabled = false; btn.textContent = '🚀 Inleveren';
    }
  });
}

function openCreateChallengeModal() {
  const icons = ['🔥','⚽','🦶','💨','💪','🧠','🌟','🏅','⚡','🎯'];
  let selectedIcon = '🔥';
  openModal(`
    <div class="modal-title">🔥 Nieuwe Challenge Aanmaken</div>
    <div class="form-group"><label class="form-label">Titel</label><input type="text" id="newChalTitle" placeholder="bijv. 30-Daagse Dribbelchallenge"></div>
    <div class="form-group"><label class="form-label">Beschrijving</label><textarea id="newChalDesc" placeholder="Wat moeten spelers doen? Hoe bewijs je het?"></textarea></div>
    <div class="form-row">
      <div class="form-group" style="margin-bottom:0"><label class="form-label">YouTube link of video ID</label><input type="text" id="newChalVideo" placeholder="YouTube link of video ID"></div>
      <div class="form-group" style="margin-bottom:0"><label class="form-label">Punten Beloning</label><input type="number" id="newChalPoints" placeholder="bijv. 300" min="10" max="1000"></div>
    </div>
    <div class="form-group" style="margin-top:16px;"><label class="form-label">Icoon</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;" id="iconPicker">
        ${icons.map(ic => `<button class="icon-pick-btn" data-icon="${ic}" style="font-size:1.5rem;width:40px;height:40px;border-radius:8px;border:2px solid var(--border);background:var(--bg-3);cursor:pointer;transition:all 0.2s;">${ic}</button>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-full" id="createChalBtn" style="margin-top:16px;">✓ Challenge Aanmaken</button>`);

  document.querySelectorAll('.icon-pick-btn').forEach(btn => {
    if (btn.dataset.icon === selectedIcon) btn.style.borderColor = 'var(--green)';
    btn.addEventListener('click', () => {
      document.querySelectorAll('.icon-pick-btn').forEach(b => b.style.borderColor = 'var(--border)');
      btn.style.borderColor = 'var(--green)';
      selectedIcon = btn.dataset.icon;
    });
  });

  document.getElementById('createChalBtn').addEventListener('click', async () => {
    const title   = document.getElementById('newChalTitle').value.trim();
    const desc    = document.getElementById('newChalDesc').value.trim();
    const videoId = extractYouTubeId(document.getElementById('newChalVideo').value.trim()) || null;
    const pts     = parseInt(document.getElementById('newChalPoints').value) || 0;
    if (!title || pts <= 0) { showToast('⚠️ Vul een titel en puntenaantal in', 0, 'error'); return; }
    const btn = document.getElementById('createChalBtn');
    btn.disabled = true; btn.textContent = 'Aanmaken...';
    const id = await dbCreateChallenge({ title, desc, videoId, points: pts, icon: selectedIcon });
    state.data.challenges.unshift({ id, title, desc, videoId, points: pts, createdBy: state.currentUserId, icon: selectedIcon, active: true });
    closeModal();
    showToast(`🔥 Challenge "${title}" aangemaakt!`, 0, 'success');
    renderView();
  });
}

// ===== TOAST =====
function showToast(msg, pts = 0, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = `<span class="toast-icon">${icons[type]||'📢'}</span><span class="toast-msg">${msg}</span>${pts>0?`<span class="toast-pts">+${pts} pts</span>`:''}`;
  container.appendChild(toast);
  setTimeout(() => {
    const hp = document.getElementById('headerPts');
    if (hp && getMe()?.role === 'player') { hp.innerHTML = `🏆 ${totalPoints(state.currentUserId)} pts`; hp.classList.add('pts-animate'); setTimeout(() => hp.classList.remove('pts-animate'), 400); }
  }, 100);
  setTimeout(() => { toast.style.opacity='0'; toast.style.transform='translateX(100%)'; toast.style.transition='all 0.3s ease'; setTimeout(() => toast.remove(), 300); }, 3000);
}

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', e => { if (e.target === document.getElementById('modalOverlay')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ===== INIT =====
async function init() {
  attachAuthEvents();
  const { data: { session } } = await db.auth.getSession();
  if (!session) { hideLoading(); showAuthScreen(); return; }
  state.currentUserId = session.user.id;
  await loadAllData();
  hideLoading();
  const me = getMe();
  if (!me) { await handleLogout(); return; }
  state.currentView = me.role === 'trainer' ? 'trainer' : 'dashboard';
  showApp();
  render();
}

init();
