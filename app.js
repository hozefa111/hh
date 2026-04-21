// =============================================
// 3 PATTI PRO — Firebase Edition (Full Feature)
// Complete app with all features
// =============================================

// === FIREBASE REFERENCES (from firebase-config.js) ===
// db = firebase.firestore()
// auth = firebase.auth()

// === APP STATE (populated by Firestore listeners) ===
let players = [];
let rounds = [];
let currentUser = null;
let isAdminUser = false;

let firestoreReady = false;

let sessions = [];
let sessionState = { isActive: false, startTime: null };

// === UI STATE ===
let activeViewId = 'view-home';
let ranksDateFilter = 'all';
let customRangeStart = null;
let customRangeEnd = null;
let profilePlayerId = null;
let roundFormState = { bid: 155, hukum: null, partners: [], result: null, playingIds: null };
let editingPlayerId = null;
let historyTab = 'rounds';

let lastSavedRound = null;

// === BID CONSTANTS ===
const BID_MIN = 155;
const BID_MAX = 250;
const BID_STEP = 5;

// =============================================
// AUTH MANAGEMENT
// =============================================

auth.onAuthStateChanged(user => {
    currentUser = user;
    isAdminUser = !!user;
    updateAuthUI();
    renderCurrentView();
    checkMigration();
});

function updateAuthUI() {
    const badge = document.getElementById('admin-badge');
    const authBtn = document.getElementById('btn-auth');

    if (isAdminUser) {
        badge.style.display = 'inline-flex';
        authBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i>';
        authBtn.title = 'Logout';
    } else {
        badge.style.display = 'none';
        authBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i>';
        authBtn.title = 'Login as Admin';
    }

    // Show/hide admin-only elements
    document.querySelectorAll('.admin-only').forEach(el => {
        el.style.display = isAdminUser ? '' : 'none';
    });
}

// Login form handler
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit-btn');

    errEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Logging in...';

    try {
        await auth.signInWithEmailAndPassword(email, password);
        document.getElementById('login-modal').classList.remove('active');
        document.getElementById('login-form').reset();
        showToast('Logged in as Admin! 🔓');
    } catch (err) {
        errEl.textContent = getAuthErrorMessage(err.code);
        errEl.style.display = 'block';
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Login';
    }
});

function getAuthErrorMessage(code) {
    const messages = {
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/invalid-email': 'Invalid email address.',
        'auth/too-many-requests': 'Too many attempts. Try again later.',
        'auth/invalid-credential': 'Invalid email or password.',
    };
    return messages[code] || 'Login failed. Please try again.';
}

// Auth button click
document.getElementById('btn-auth').addEventListener('click', () => {
    if (isAdminUser) {
        showConfirm('Logout from admin?', 'Logout', async () => {
            await auth.signOut();
            showToast('Logged out');
        });
    } else {
        document.getElementById('login-modal').classList.add('active');
    }
});

// Close modals
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    });
});

// =============================================
// FIRESTORE REAL-TIME LISTENERS
// =============================================

function initFirestoreListeners() {
    // Players collection
    db.collection('players').orderBy('createdAt').onSnapshot(snap => {
        players = snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        firestoreReady = true;
        renderCurrentView();
    }, err => {
        console.error('Players listener error:', err);
    });

    // Rounds collection
    db.collection('rounds').orderBy('timestamp', 'desc').onSnapshot(snap => {
        rounds = snap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                timestamp: data.timestamp ? data.timestamp.toDate() : new Date()
            };
        });
        renderCurrentView();
    }, err => {
        console.error('Rounds listener error:', err);
    });

    // Session state
    db.collection('meta').doc('session').onSnapshot(doc => {
        if (doc.exists) {
            const data = doc.data();
            sessionState = {
                isActive: data.isActive || false,
                startTime: data.startTime ? data.startTime.toDate() : null
            };
        } else {
            sessionState = { isActive: false, startTime: null };
        }
        renderCurrentView();
    }, err => {
        console.error('Session state listener error:', err);
    });

    // Sessions collection
    db.collection('sessions').orderBy('endTime', 'desc').onSnapshot(snap => {
        sessions = snap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                startTime: data.startTime ? data.startTime.toDate() : new Date(),
                endTime: data.endTime ? data.endTime.toDate() : new Date()
            };
        });
        if (activeViewId === 'view-history') renderCurrentView();
    }, err => {
        console.error('Sessions listener error:', err);
    });
}

// =============================================
// NAVIGATION
// =============================================

function navTo(viewId) {
    // Admin gate for round form
    if (viewId === 'view-round' && !isAdminUser) {
        showToast('Login as Admin to add rounds 🚫');
        return;
    }

    activeViewId = viewId;

    document.querySelectorAll('.view').forEach(v => {
        v.classList.toggle('active', v.id === viewId);
    });
    document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.target === viewId);
    });

    // Scroll to top
    document.getElementById('app-content').scrollTop = 0;

    renderCurrentView();
}
window.navTo = navTo;

function renderCurrentView() {
    const viewEl = document.querySelector('.view.active');
    if (!viewEl) return;

    switch (viewEl.id) {
        case 'view-home': renderDashboard(); break;
        case 'view-players': renderPlayers(); break;
        case 'view-round': renderRoundForm(); break;
        case 'view-ranks': renderRanks(); break;
        case 'view-profile': renderPlayerProfile(); break;
        case 'view-history': renderHistory(); break;

    }

    updateAuthUI();
}

// Nav item clicks
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        const t = e.currentTarget.dataset.target;
        if (t) navTo(t);
    });
});

// =============================================
// HELPERS
// =============================================

function getInitials(name) {
    if (!name) return '?';
    return name.trim().charAt(0).toUpperCase();
}

function getAvatarColor(name) {
    if (!name) return 'hsl(0, 65%, 50%)';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 60%, 45%)`;
}

function avatarHTML(name, size) {
    const cls = size === 'sm' ? 'player-avatar sm' : (size === 'lg' ? 'player-avatar lg' : 'player-avatar');
    return `<div class="${cls}" style="background:${getAvatarColor(name)}">${getInitials(name)}</div>`;
}

function sanitizeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDateTime(date) {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    const day = d.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const hours = d.getHours();
    const mins = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    return `${day} ${month} \u2022 ${h12}:${mins} ${ampm}`;
}

function formatDate(date) {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${d.getFullYear()}`;
}

function formatDuration(ms) {
    if (!ms || ms < 0) return '0m';
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    if (hrs > 0) return `${hrs}h ${remainMins}m`;
    return `${remainMins}m`;
}

function getPlayerName(playerId) {
    const p = players.find(x => x.id === playerId);
    return p ? p.name : 'Unknown';
}

function getActivePlayers() {
    return players.filter(p => p.active !== false);
}

function getGameRounds() {
    return rounds.filter(r => r.type !== 'settlement');
}

// =============================================
// SCORE CALCULATION
// =============================================

function calculateScoreChanges(playerIds, bid, hukumId, partnerIds, result) {
    const changes = {};
    const nonPartnerIds = playerIds.filter(id => id !== hukumId && !partnerIds.includes(id));

    if (result === 'win') {
        // Hukum Jita
        changes[hukumId] = bid * 2;
        partnerIds.forEach(id => { changes[id] = bid; });
        nonPartnerIds.forEach(id => { changes[id] = 0; });
    } else {
        // Hukum Hara
        changes[hukumId] = -bid;
        partnerIds.forEach(id => { changes[id] = -Math.round(bid / 2); });
        nonPartnerIds.forEach(id => { changes[id] = bid; });
    }
    return changes;
}

// =============================================
// DATE FILTERING
// =============================================

function filterByDate(roundsList, filterType, startDate, endDate) {
    if (filterType === 'all') return roundsList;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return roundsList.filter(r => {
        const d = r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp);

        switch (filterType) {
            case 'today':
                return d >= todayStart;
            case 'yesterday': {
                const yStart = new Date(todayStart);
                yStart.setDate(yStart.getDate() - 1);
                return d >= yStart && d < todayStart;
            }
            case 'week': {
                const weekStart = new Date(todayStart);
                weekStart.setDate(weekStart.getDate() - weekStart.getDay());
                return d >= weekStart;
            }
            case 'month':
                return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            case 'year':
                return d.getFullYear() === now.getFullYear();
            case 'custom': {
                if (startDate && endDate) {
                    const s = new Date(startDate);
                    const e = new Date(endDate);
                    e.setDate(e.getDate() + 1);
                    return d >= s && d < e;
                }
                if (startDate) {
                    return d >= new Date(startDate);
                }
                return true;
            }
            default:
                return true;
        }
    });
}

function getFilteredGameRounds() {
    const gameRounds = getGameRounds();
    return filterByDate(gameRounds, ranksDateFilter, customRangeStart, customRangeEnd);
}

// =============================================
// PLAYER STATS COMPUTATION
// =============================================

function computeAllPlayerStats(filteredRounds) {
    const stats = {};
    players.forEach(p => {
        stats[p.id] = {
            name: p.name,
            totalScore: 0,
            roundsPlayed: 0,
            wins: 0,
            losses: 0,
            asHukum: 0, hukumWins: 0, hukumLosses: 0,
            asPartner: 0, partnerWins: 0, partnerLosses: 0,
            asNonPartner: 0, nonPartnerWins: 0, nonPartnerLosses: 0,
        };
    });

    filteredRounds.forEach(round => {
        if (round.type === 'settlement') return;

        const hukumId = round.hukumId;
        const partnerIds = round.partnerIds || [];
        const nonPartnerIds = round.nonPartnerIds || [];
        const allIds = round.playerIds || [hukumId, ...partnerIds, ...nonPartnerIds];
        const isWin = round.result === 'win';

        allIds.forEach(pid => {
            if (!stats[pid]) return;
            stats[pid].roundsPlayed++;

            if (round.scoreChanges && round.scoreChanges[pid] !== undefined) {
                stats[pid].totalScore += round.scoreChanges[pid];
            }

            if (pid === hukumId) {
                stats[pid].asHukum++;
                if (isWin) { stats[pid].wins++; stats[pid].hukumWins++; }
                else { stats[pid].losses++; stats[pid].hukumLosses++; }
            } else if (partnerIds.includes(pid)) {
                stats[pid].asPartner++;
                if (isWin) { stats[pid].wins++; stats[pid].partnerWins++; }
                else { stats[pid].losses++; stats[pid].partnerLosses++; }
            } else if (nonPartnerIds.includes(pid)) {
                stats[pid].asNonPartner++;
                if (isWin) { stats[pid].losses++; stats[pid].nonPartnerLosses++; }
                else { stats[pid].wins++; stats[pid].nonPartnerWins++; }
            }
        });
    });

    return stats;
}

function getLifetimeBalance(playerId) {
    let balance = 0;
    rounds.forEach(r => {
        if (r.scoreChanges && r.scoreChanges[playerId] !== undefined) {
            balance += r.scoreChanges[playerId];
        }
    });
    return balance;
}

function getRankedPlayers(filteredRounds) {
    const stats = computeAllPlayerStats(filteredRounds);
    return players
        .map(p => ({ player: p, stats: stats[p.id] || {} }))
        .filter(x => x.stats.roundsPlayed > 0 || x.stats.totalScore !== 0)
        .sort((a, b) => (b.stats.totalScore || 0) - (a.stats.totalScore || 0));
}

// =============================================
// WINNING STREAK
// =============================================

function getWinningStreak(playerId, roundsList) {
    // Get this player's rounds, sorted newest first
    const playerRounds = roundsList
        .filter(r => r.type !== 'settlement' && r.playerIds && r.playerIds.includes(playerId))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    let streak = 0;
    for (const round of playerRounds) {
        const isHukum = round.hukumId === playerId;
        const isPartner = (round.partnerIds || []).includes(playerId);
        let playerWon;
        if (isHukum || isPartner) {
            playerWon = round.result === 'win';
        } else {
            playerWon = round.result === 'loss'; // non-partner wins when hukum hara
        }

        if (playerWon) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

function streakBadgeHTML(streak, lg) {
    if (streak < 2) return '';
    const cls = lg ? 'streak-badge streak-badge-lg' : 'streak-badge';
    return `<span class="${cls}">\uD83D\uDD25 ${streak}</span>`;
}

// =============================================
// HEAD-TO-HEAD
// =============================================

function computeHeadToHead(playerId, filteredRounds) {
    const results = {};

    filteredRounds.forEach(round => {
        if (round.type === 'settlement') return;
        if (!round.playerIds || !round.playerIds.includes(playerId)) return;

        const isHukumOrPartner = round.hukumId === playerId || (round.partnerIds || []).includes(playerId);

        round.playerIds.forEach(otherId => {
            if (otherId === playerId) return;

            if (!results[otherId]) {
                results[otherId] = { together: 0, against: 0, wins: 0, losses: 0, totalRounds: 0 };
            }

            results[otherId].totalRounds++;

            const otherIsHukumOrPartner = round.hukumId === otherId || (round.partnerIds || []).includes(otherId);
            const sameSide = (isHukumOrPartner && otherIsHukumOrPartner) || (!isHukumOrPartner && !otherIsHukumOrPartner);

            if (sameSide) {
                results[otherId].together++;
            } else {
                results[otherId].against++;
                let playerWon;
                if (isHukumOrPartner) {
                    playerWon = round.result === 'win';
                } else {
                    playerWon = round.result === 'loss';
                }
                if (playerWon) results[otherId].wins++;
                else results[otherId].losses++;
            }
        });
    });

    return results;
}

// =============================================
// BEST / WORST ROUND
// =============================================

function getBestWorstRound(playerId, filteredRounds) {
    let best = null, worst = null;
    let bestScore = -Infinity, worstScore = Infinity;

    filteredRounds.forEach(round => {
        if (round.type === 'settlement') return;
        if (!round.scoreChanges || round.scoreChanges[playerId] === undefined) return;
        const change = round.scoreChanges[playerId];
        if (change > bestScore) { bestScore = change; best = round; }
        if (change < worstScore) { worstScore = change; worst = round; }
    });

    return {
        best, worst,
        bestScore: bestScore === -Infinity ? 0 : bestScore,
        worstScore: worstScore === Infinity ? 0 : worstScore
    };
}

// =============================================
// TOAST NOTIFICATIONS
// =============================================

function showToast(msg) {
    let toast = document.getElementById('global-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'global-toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.classList.remove('show'); }, 2200);
}
window.showToast = showToast;

// =============================================
// CONFIRM MODAL
// =============================================

function showConfirm(msg, btnText, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-modal-msg').textContent = msg;
    document.getElementById('confirm-modal-ok').textContent = btnText || 'Delete';
    modal.classList.add('active');

    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    const newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    const newCancel = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

    newOk.addEventListener('click', () => {
        modal.classList.remove('active');
        onConfirm();
    });
    newCancel.addEventListener('click', () => {
        modal.classList.remove('active');
    });
}

// =============================================
// FILTER BAR RENDERER
// =============================================

function renderFilterBar(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const filters = [
        { key: 'all', label: 'All Time' },
        { key: 'today', label: 'Today' },
        { key: 'yesterday', label: 'Yesterday' },
        { key: 'week', label: 'This Week' },
        { key: 'month', label: 'This Month' },
        { key: 'year', label: 'This Year' },
    ];

    let html = '<div class="filter-pills">';
    filters.forEach(f => {
        const isActive = ranksDateFilter === f.key;
        html += `<button class="filter-pill ${isActive ? 'active' : ''}" onclick="setRanksFilter('${f.key}')">${f.label}</button>`;
    });

    const isCustom = ranksDateFilter === 'custom';
    html += `<button class="filter-pill ${isCustom ? 'active' : ''}" onclick="showCustomRange()">\uD83D\uDCC5 Custom</button>`;
    html += '</div>';

    if (isCustom) {
        html += `<div style="display:flex; gap:0.5rem; margin-top:0.5rem; align-items:center;">
            <input type="date" class="filter-date-input ${customRangeStart ? 'active' : ''}" value="${customRangeStart || ''}" onchange="setCustomStart(this.value)" style="flex:1">
            <span style="color:var(--text-muted); font-size:0.8rem;">to</span>
            <input type="date" class="filter-date-input ${customRangeEnd ? 'active' : ''}" value="${customRangeEnd || ''}" onchange="setCustomEnd(this.value)" style="flex:1">
        </div>`;
    }

    container.innerHTML = html;
}

window.setRanksFilter = function(filter) {
    ranksDateFilter = filter;
    if (filter !== 'custom') {
        customRangeStart = null;
        customRangeEnd = null;
    }
    renderCurrentView();
};

window.showCustomRange = function() {
    ranksDateFilter = 'custom';
    renderCurrentView();
};

window.setCustomStart = function(val) {
    customRangeStart = val;
    renderCurrentView();
};

window.setCustomEnd = function(val) {
    customRangeEnd = val;
    renderCurrentView();
};

// =============================================
// RENDER: DASHBOARD (HOME)
// =============================================

function renderDashboard() {
    const active = getActivePlayers();
    const gameRounds = getGameRounds();

    document.getElementById('stat-active-players').textContent = active.length;
    document.getElementById('stat-total-rounds').textContent = gameRounds.length;

    let totalMoney = 0;
    let topWinner = null;
    let topBal = 0;

    active.forEach(p => {
        const bal = getLifetimeBalance(p.id);
        if (bal > 0) totalMoney += bal;
        if (bal > topBal) { topBal = bal; topWinner = p; }
    });

    document.getElementById('stat-total-money').textContent = totalMoney;
    const twEl = document.getElementById('stat-top-winner');
    twEl.textContent = topWinner ? `${topWinner.name} (+${topBal})` : '\u2014';

    // Session controls (admin only)
    renderSessionControls();

    // Recent activity
    const feed = document.getElementById('activity-feed');
    if (gameRounds.length === 0) {
        feed.innerHTML = '<p class="empty-state"><i class="fa-solid fa-cards" style="font-size:2rem; display:block; margin-bottom:0.5rem;"></i>No rounds yet. Add players and start playing!</p>';
        return;
    }

    const recent = gameRounds.slice(0, 8);
    let html = '';

    recent.forEach((round, i) => {
        const hName = round.hukumName || getPlayerName(round.hukumId);
        const resultText = round.result === 'win'
            ? '<span class="text-success">Hukum Win</span>'
            : '<span class="text-danger">Hukum Lose</span>';
        html += `<div class="activity-item" style="animation: slideIn 0.3s ease ${i * 0.05}s both">
            <div>
                <div class="activity-desc">Bid ${round.bid} \u2022 ${resultText}</div>
                <div class="activity-time">Hukum: ${hName} \u2022 ${formatDateTime(round.timestamp)}</div>
            </div>
        </div>`;
    });

    feed.innerHTML = html;
}

// =============================================
// SESSION CONTROLS
// =============================================

function renderSessionControls() {
    const container = document.getElementById('session-controls');
    if (!container) return;
    if (!isAdminUser) { container.innerHTML = ''; return; }

    if (sessionState.isActive && sessionState.startTime) {
        const elapsed = Date.now() - sessionState.startTime.getTime();
        container.innerHTML = `<div class="session-controls-bar">
            <div class="session-info">
                <div class="session-status"><span class="session-active-dot"></span> Session Active</div>
                <div class="session-timer">Started ${formatDateTime(sessionState.startTime)} \u2022 ${formatDuration(elapsed)}</div>
            </div>
            <button class="btn btn-danger btn-session" onclick="endSession()">
                <i class="fa-solid fa-flag-checkered"></i> End
            </button>
        </div>`;
    } else {
        container.innerHTML = `<div style="margin-bottom:1.5rem;">
            <button class="btn btn-gold full-width btn-session" onclick="startSession()">
                <i class="fa-solid fa-play"></i> Start Session
            </button>
        </div>`;
    }
}

window.startSession = async function() {
    try {
        await db.collection('meta').doc('session').set({
            isActive: true,
            startTime: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast('Session started! \uD83C\uDFB2');
    } catch (err) {
        console.error('Start session error:', err);
        showToast('Failed to start session');
    }
};

window.endSession = async function() {
    if (!sessionState.isActive || !sessionState.startTime) {
        showToast('No active session');
        return;
    }

    const sessionStart = sessionState.startTime;
    const sessionEnd = new Date();

    // Get rounds in this session
    const sessionRounds = getGameRounds().filter(r => {
        const d = r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp);
        return d >= sessionStart && d <= sessionEnd;
    });

    if (sessionRounds.length === 0) {
        showConfirm('No rounds played this session. End anyway?', 'End Session', async () => {
            await db.collection('meta').doc('session').set({ isActive: false, startTime: null });
            showToast('Session ended');
        });
        return;
    }

    // Compute session stats
    const stats = computeAllPlayerStats(sessionRounds);
    const leaderboard = players
        .map(p => ({ id: p.id, name: p.name, score: (stats[p.id] || {}).totalScore || 0, roundsPlayed: (stats[p.id] || {}).roundsPlayed || 0 }))
        .filter(x => x.roundsPlayed > 0)
        .sort((a, b) => b.score - a.score)
        .map((item, idx) => ({ ...item, rank: idx + 1 }));

    const mvp = leaderboard.length > 0 ? leaderboard[0] : null;

    // Best Hukum
    let bestHukum = null;
    let bestHukumRate = -1;
    players.forEach(p => {
        const s = stats[p.id];
        if (s && s.asHukum > 0) {
            const rate = s.hukumWins / s.asHukum;
            if (rate > bestHukumRate || (rate === bestHukumRate && s.asHukum > (bestHukum ? bestHukum.total : 0))) {
                bestHukumRate = rate;
                bestHukum = { name: p.name, winRate: Math.round(rate * 100), wins: s.hukumWins, total: s.asHukum };
            }
        }
    });

    // Biggest win/loss
    let biggestWin = { name: '-', score: 0 };
    let biggestLoss = { name: '-', score: 0 };
    sessionRounds.forEach(round => {
        if (!round.scoreChanges) return;
        Object.entries(round.scoreChanges).forEach(([pid, change]) => {
            const name = getPlayerName(pid);
            if (change > biggestWin.score) { biggestWin = { name, score: change }; }
            if (change < biggestLoss.score) { biggestLoss = { name, score: change }; }
        });
    });

    // Streaks
    const streaks = [];
    players.forEach(p => {
        const streak = getWinningStreak(p.id, sessionRounds);
        if (streak >= 2) streaks.push({ name: p.name, streak });
    });
    streaks.sort((a, b) => b.streak - a.streak);

    const sessionData = {
        startTime: sessionStart,
        endTime: sessionEnd,
        duration: sessionEnd.getTime() - sessionStart.getTime(),
        totalRounds: sessionRounds.length,
        leaderboard,
        mvp: mvp ? { name: mvp.name, score: mvp.score } : null,
        bestHukum,
        biggestWin,
        biggestLoss,
        streaks
    };

    // Save to Firestore
    try {
        await db.collection('sessions').add({
            ...sessionData,
            startTime: firebase.firestore.Timestamp.fromDate(sessionStart),
            endTime: firebase.firestore.FieldValue.serverTimestamp()
        });
        await db.collection('meta').doc('session').set({ isActive: false, startTime: null });
        showSessionSummaryModal(sessionData);
    } catch (err) {
        console.error('End session error:', err);
        showToast('Failed to end session');
    }
};

function showSessionSummaryModal(data) {
    const body = document.getElementById('session-summary-body');
    let html = '';

    // Overview
    html += '<div class="session-summary-card">';
    html += '<div class="session-summary-title">\uD83D\uDCCA Overview</div>';
    html += `<div class="session-summary-stat"><span class="label">\uD83D\uDCC5 Date</span><span class="value">${formatDate(data.startTime)}</span></div>`;
    html += `<div class="session-summary-stat"><span class="label">\u23F1 Duration</span><span class="value">${formatDuration(data.duration)}</span></div>`;
    html += `<div class="session-summary-stat"><span class="label">\uD83C\uDCCF Rounds</span><span class="value">${data.totalRounds}</span></div>`;
    html += '</div>';

    // MVP & Awards
    html += '<div class="session-summary-card">';
    html += '<div class="session-summary-title">\uD83C\uDFC6 Awards</div>';
    if (data.mvp) {
        html += `<div class="session-summary-stat"><span class="label">\uD83C\uDFC5 MVP</span><span class="value text-success">${data.mvp.name} (+${data.mvp.score})</span></div>`;
    }
    if (data.bestHukum) {
        html += `<div class="session-summary-stat"><span class="label">\uD83D\uDC51 Best Hukum</span><span class="value">${data.bestHukum.name} (${data.bestHukum.winRate}%)</span></div>`;
    }
    html += `<div class="session-summary-stat"><span class="label">\uD83D\uDCC8 Biggest Win</span><span class="value text-success">${data.biggestWin.name} (+${data.biggestWin.score})</span></div>`;
    html += `<div class="session-summary-stat"><span class="label">\uD83D\uDCC9 Biggest Loss</span><span class="value text-danger">${data.biggestLoss.name} (${data.biggestLoss.score})</span></div>`;
    if (data.streaks.length > 0) {
        html += `<div class="session-summary-stat"><span class="label">\uD83D\uDD25 Streaks</span><span class="value">${data.streaks.map(s => `${s.name} (${s.streak})`).join(', ')}</span></div>`;
    }
    html += '</div>';

    // Leaderboard
    if (data.leaderboard.length > 0) {
        html += '<div class="session-summary-card">';
        html += '<div class="session-summary-title">\uD83C\uDFC6 Leaderboard</div>';
        html += '<div class="session-mini-leaderboard">';
        data.leaderboard.forEach(item => {
            const medal = item.rank <= 3 ? ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'][item.rank - 1] : `#${item.rank}`;
            const clr = item.score > 0 ? 'text-success' : (item.score < 0 ? 'text-danger' : '');
            html += `<div class="session-mini-row">
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <span class="session-mini-rank">${medal}</span>
                    <span>${sanitizeHTML(item.name)}</span>
                </div>
                <span class="${clr}" style="font-weight:700;">${item.score >= 0 ? '+' : ''}${item.score}</span>
            </div>`;
        });
        html += '</div></div>';
    }

    // Share button
    html += `<button class="btn btn-gold full-width" onclick="shareSessionSummary()" style="margin-top:0.5rem;">
        <i class="fa-solid fa-share-nodes"></i> Share Summary
    </button>`;

    body.innerHTML = html;
    document.getElementById('session-modal').classList.add('active');
}

// =============================================
// RENDER: PLAYERS
// =============================================

function renderPlayers() {
    const pl = document.getElementById('players-list');
    const inaPl = document.getElementById('inactive-players-list');
    const inaTitle = document.getElementById('inactive-title');

    const active = players.filter(p => p.active !== false);
    const inactive = players.filter(p => p.active === false);

    if (active.length === 0) {
        pl.innerHTML = '<p class="empty-state"><i class="fa-solid fa-user-plus" style="font-size:2rem; display:block; margin-bottom:0.5rem;"></i>Add players above to start!</p>';
    } else {
        pl.innerHTML = active.map(p => {
            const bal = getLifetimeBalance(p.id);
            const clr = bal > 0 ? 'text-success' : (bal < 0 ? 'text-danger' : '');

            // Inline edit mode
            if (editingPlayerId === p.id && isAdminUser) {
                return `<div class="player-list-item" style="animation: slideIn 0.3s ease">
                    <div style="display:flex; align-items:center; gap:0.6rem; flex:1; min-width:0;">
                        ${avatarHTML(p.name)}
                        <input type="text" id="edit-name-${p.id}" value="${sanitizeHTML(p.name)}" maxlength="20"
                            class="edit-player-input" autocomplete="off">
                    </div>
                    <div style="display:flex; align-items:center; gap:0.4rem;">
                        <button class="icon-btn" onclick="savePlayerName('${p.id}')" title="Save"><i class="fa-solid fa-check" style="color:var(--success);font-size:1rem"></i></button>
                        <button class="icon-btn" onclick="cancelEditPlayer()" title="Cancel"><i class="fa-solid fa-xmark" style="color:var(--danger);font-size:1rem"></i></button>
                    </div>
                </div>`;
            }

            return `<div class="player-list-item" style="animation: slideIn 0.3s ease">
                <div style="display:flex; align-items:center; gap:1rem;">
                    ${avatarHTML(p.name)}
                    <div class="player-info">
                        <span class="name">${sanitizeHTML(p.name)}</span>
                        <span class="stats">Active</span>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <span class="player-score ${clr}">${bal >= 0 ? '+' : ''}${bal}</span>
                    ${isAdminUser ? `
                        <button class="icon-btn" onclick="editPlayer('${p.id}')" title="Edit name"><i class="fa-solid fa-pen" style="color:var(--gold-primary);font-size:0.8rem"></i></button>
                        <button class="icon-btn" onclick="benchPlayer('${p.id}')" title="Bench"><i class="fa-solid fa-moon" style="color:var(--text-muted);font-size:0.9rem"></i></button>
                        <button class="icon-btn" onclick="removePlayer('${p.id}')" title="Remove"><i class="fa-solid fa-trash-can" style="color:var(--danger);font-size:0.85rem"></i></button>
                    ` : ''}
                </div>
            </div>`;
        }).join('');
    }

    if (inactive.length > 0) {
        inaTitle.style.display = 'block';
        inaPl.innerHTML = inactive.map(p => {
            const bal = getLifetimeBalance(p.id);
            const clr = bal > 0 ? 'text-success' : (bal < 0 ? 'text-danger' : '');
            return `<div class="player-list-item" style="opacity:0.6">
                <div style="display:flex; align-items:center; gap:1rem;">
                    ${avatarHTML(p.name)}
                    <div class="player-info">
                        <span class="name">${sanitizeHTML(p.name)}</span>
                        <span class="stats text-muted">Benched</span>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:0.5rem;">
                    <span class="player-score ${clr}">${bal >= 0 ? '+' : ''}${bal}</span>
                    ${isAdminUser ? `
                        <button class="icon-btn text-success" onclick="restorePlayer('${p.id}')" title="Restore"><i class="fa-solid fa-rotate-left"></i></button>
                        <button class="icon-btn" onclick="removePlayer('${p.id}')" title="Remove"><i class="fa-solid fa-trash-can" style="color:var(--danger);font-size:0.85rem"></i></button>
                    ` : ''}
                </div>
            </div>`;
        }).join('');
    } else {
        inaTitle.style.display = 'none';
        inaPl.innerHTML = '';
    }
}

// =============================================
// RENDER: HUKUM ROUND FORM
// =============================================

function renderRoundForm() {
    const container = document.getElementById('round-form-container');
    const saveBtn = document.getElementById('save-round-btn');
    const preview = document.getElementById('round-preview');
    const allActive = getActivePlayers();

    // Initialize playingIds if not set (all active by default)
    if (!roundFormState.playingIds) {
        roundFormState.playingIds = allActive.map(p => p.id);
    }
    // Clean up playingIds to only include players that still exist and are active
    const activeIds = allActive.map(p => p.id);
    roundFormState.playingIds = roundFormState.playingIds.filter(id => activeIds.includes(id));

    const playing = allActive.filter(p => roundFormState.playingIds.includes(p.id));

    if (allActive.length < 3) {
        container.innerHTML = '<p class="empty-state"><i class="fa-solid fa-exclamation-triangle" style="font-size:2rem; display:block; margin-bottom:0.5rem; color:var(--gold-primary);"></i>Need at least 3 active players!<br><small>Go to Players tab to add more.</small></p>';
        saveBtn.disabled = true;
        preview.style.display = 'none';
        return;
    }

    if (!roundFormState.hukum) {
        roundFormState = { bid: 155, hukum: null, partners: [], result: null, playingIds: roundFormState.playingIds };
    }

    let html = '';

    // Step 0: Who's Playing This Round?
    html += `<div class="form-section">
        <div class="form-section-title"><i class="fa-solid fa-users"></i> Who's Playing This Round?</div>
        <div class="playing-toggle-grid">`;
    allActive.forEach(p => {
        const isPlaying = roundFormState.playingIds.includes(p.id);
        html += `<button class="playing-toggle-btn ${isPlaying ? 'active' : ''}" onclick="toggleRoundPlayer('${p.id}')">
            ${avatarHTML(p.name, 'sm')}
            <span>${sanitizeHTML(p.name)}</span>
            <i class="fa-solid ${isPlaying ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
        </button>`;
    });
    html += `</div>
        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.4rem;">${playing.length} of ${allActive.length} players selected</div>
    </div>`;

    if (playing.length < 3) {
        html += '<p class="empty-state" style="font-size:0.85rem;">Select at least 3 players to continue.</p>';
        container.innerHTML = html;
        saveBtn.disabled = true;
        preview.style.display = 'none';
        return;
    }

    // Step 1: Bid Amount (Dropdown)
    let bidOptions = '';
    for (let v = BID_MIN; v <= BID_MAX; v += BID_STEP) {
        bidOptions += `<option value="${v}" ${v === roundFormState.bid ? 'selected' : ''}>${v}</option>`;
    }
    html += `<div class="form-section">
        <div class="form-section-title"><i class="fa-solid fa-gavel"></i> Bid Amount</div>
        <select class="bid-select" id="bid-input" onchange="onBidChange(this.value)">
            ${bidOptions}
        </select>
    </div>`;

    // Step 2: Select Hukum
    html += `<div class="form-section">
        <div class="form-section-title"><i class="fa-solid fa-crown"></i> Select Hukum</div>
        <div id="hukum-options">`;
    playing.forEach(p => {
        const isSelected = roundFormState.hukum === p.id;
        html += `<div class="player-select-row" onclick="onHukumSelect('${p.id}')">
            <div class="left">
                ${avatarHTML(p.name, 'sm')}
                <span style="font-weight:600">${sanitizeHTML(p.name)}</span>
            </div>
            <div class="check ${isSelected ? 'selected' : ''}" id="hukum-check-${p.id}">
                ${isSelected ? '<i class="fa-solid fa-crown" style="color:var(--gold-primary)"></i>' : '\u25CB'}
            </div>
        </div>`;
    });
    html += '</div></div>';

    // Step 3: Select Partners
    html += `<div class="form-section">
        <div class="form-section-title"><i class="fa-solid fa-handshake"></i> Select Partner(s)</div>
        <div id="partner-options">`;
    if (!roundFormState.hukum) {
        html += '<p class="empty-state" style="padding:0.5rem; font-size:0.85rem;">Select Hukum first</p>';
    } else {
        const eligible = playing.filter(p => p.id !== roundFormState.hukum);
        eligible.forEach(p => {
            const isSelected = roundFormState.partners.includes(p.id);
            html += `<div class="player-select-row" onclick="onPartnerToggle('${p.id}')">
                <div class="left">
                    ${avatarHTML(p.name, 'sm')}
                    <span style="font-weight:600">${sanitizeHTML(p.name)}</span>
                </div>
                <div class="check ${isSelected ? 'selected' : ''}" id="partner-check-${p.id}">
                    ${isSelected ? '<i class="fa-solid fa-circle-check" style="color:var(--success)"></i>' : '\u2610'}
                </div>
            </div>`;
        });
        const nonPartners = eligible.filter(p => !roundFormState.partners.includes(p.id));
        if (nonPartners.length > 0 && roundFormState.partners.length > 0) {
            html += `<div style="margin-top:0.5rem; padding-top:0.5rem; border-top:1px solid rgba(255,255,255,0.05);">
                <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">NON-PARTNERS:</span>
                <span style="font-size:0.8rem; color:var(--text-muted);">${nonPartners.map(p => p.name).join(', ')}</span>
            </div>`;
        }
    }
    html += '</div></div>';

    // Step 4: Result
    html += `<div class="form-section">
        <div class="form-section-title"><i class="fa-solid fa-flag-checkered"></i> Round Result</div>
        <div class="result-toggle">
            <button class="result-btn ${roundFormState.result === 'win' ? 'win-active' : ''}" onclick="onResultSelect('win')">
                <i class="fa-solid fa-trophy"></i> Hukum Win
            </button>
            <button class="result-btn ${roundFormState.result === 'loss' ? 'lose-active' : ''}" onclick="onResultSelect('loss')">
                <i class="fa-solid fa-skull-crossbones"></i> Hukum Lose
            </button>
        </div>
    </div>`;

    container.innerHTML = html;
    updateRoundPreview();
}

window.onBidChange = function(val) {
    let v = parseInt(val);
    if (isNaN(v)) v = BID_MIN;
    v = Math.max(BID_MIN, Math.min(BID_MAX, v));
    v = Math.round((v - BID_MIN) / BID_STEP) * BID_STEP + BID_MIN;
    roundFormState.bid = v;
    updateRoundPreview();
};

window.onHukumSelect = function(pid) {
    roundFormState.hukum = pid;
    roundFormState.partners = roundFormState.partners.filter(id => id !== pid);
    renderRoundForm();
};

window.toggleRoundPlayer = function(pid) {
    const idx = roundFormState.playingIds.indexOf(pid);
    if (idx >= 0) {
        roundFormState.playingIds.splice(idx, 1);
        // Remove from hukum/partners if toggled off
        if (roundFormState.hukum === pid) roundFormState.hukum = null;
        roundFormState.partners = roundFormState.partners.filter(id => id !== pid);
    } else {
        roundFormState.playingIds.push(pid);
    }
    renderRoundForm();
};

window.onPartnerToggle = function(pid) {
    const idx = roundFormState.partners.indexOf(pid);
    if (idx >= 0) {
        roundFormState.partners.splice(idx, 1);
    } else {
        roundFormState.partners.push(pid);
    }
    renderRoundForm();
};

window.onResultSelect = function(result) {
    roundFormState.result = result;
    document.querySelectorAll('.result-btn').forEach(btn => {
        btn.classList.remove('win-active', 'lose-active');
    });
    if (result === 'win') {
        document.querySelector('.result-btn:first-child').classList.add('win-active');
    } else {
        document.querySelector('.result-btn:last-child').classList.add('lose-active');
    }
    updateRoundPreview();
};

function updateRoundPreview() {
    const preview = document.getElementById('round-preview');
    const saveBtn = document.getElementById('save-round-btn');
    const playing = getActivePlayers().filter(p => roundFormState.playingIds && roundFormState.playingIds.includes(p.id));
    const { bid, hukum, partners, result } = roundFormState;

    const isReady = bid && hukum && partners.length > 0 && result;

    if (!isReady) {
        preview.style.display = 'none';
        saveBtn.disabled = true;
        return;
    }

    const activeIds = playing.map(p => p.id);
    const nonPartners = activeIds.filter(id => id !== hukum && !partners.includes(id));
    if (nonPartners.length < 1) {
        preview.style.display = 'none';
        saveBtn.disabled = true;
        return;
    }

    const scoreChanges = calculateScoreChanges(activeIds, bid, hukum, partners, result);

    let html = `<div class="preview-title"><i class="fa-solid fa-calculator"></i> Score Preview</div>`;
    activeIds.forEach(pid => {
        const name = getPlayerName(pid);
        const change = scoreChanges[pid] || 0;
        let role = pid === hukum ? '\uD83D\uDC51 Hukum' : (partners.includes(pid) ? '\uD83E\uDD1D Partner' : '\uD83C\uDFAF Non-Partner');
        const clr = change > 0 ? 'text-success' : (change < 0 ? 'text-danger' : 'text-muted');
        html += `<div class="preview-row">
            <span>${role} \u2014 ${sanitizeHTML(name)}</span>
            <span class="score-change ${clr}">${change >= 0 ? '+' : ''}${change}</span>
        </div>`;
    });

    preview.innerHTML = html;
    preview.style.display = 'block';
    saveBtn.disabled = false;
    saveBtn.onclick = saveRoundData;
}

// =============================================
// SAVE ROUND TO FIRESTORE
// =============================================

async function saveRoundData() {
    const saveBtn = document.getElementById('save-round-btn');
    const active = getActivePlayers();
    const { bid, hukum, partners, result } = roundFormState;

    if (!bid || !hukum || partners.length === 0 || !result) {
        showToast('Complete all fields first');
        return;
    }

    const playing = getActivePlayers().filter(p => roundFormState.playingIds && roundFormState.playingIds.includes(p.id));
    const activeIds = playing.map(p => p.id);
    const nonPartnerIds = activeIds.filter(id => id !== hukum && !partners.includes(id));

    if (nonPartnerIds.length < 1) {
        showToast('Need at least one non-partner');
        return;
    }

    const scoreChanges = calculateScoreChanges(activeIds, bid, hukum, partners, result);

    const roundDoc = {
        type: 'hukum',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        bid: bid,
        hukumId: hukum,
        hukumName: getPlayerName(hukum),
        partnerIds: partners,
        partnerNames: partners.map(id => getPlayerName(id)),
        nonPartnerIds: nonPartnerIds,
        nonPartnerNames: nonPartnerIds.map(id => getPlayerName(id)),
        playerIds: activeIds,
        result: result,
        scoreChanges: scoreChanges
    };

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

    try {
        const docRef = await db.collection('rounds').add(roundDoc);

        // Store for share prompt
        lastSavedRound = { ...roundDoc, id: docRef.id, timestamp: new Date() };

        // Reset form
        roundFormState = { bid: 155, hukum: null, partners: [], result: null, playingIds: null };
        showToast(result === 'win' ? 'Hukum Win! \uD83C\uDF89 Round saved!' : 'Hukum Lose! \uD83D\uDC80 Round saved!');

        // Show share prompt
        showRoundSharePrompt(lastSavedRound);

    } catch (err) {
        console.error('Save round error:', err);
        showToast('Failed to save round. Try again.');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Save Round';
    }
}

function showRoundSharePrompt(round) {
    const body = document.getElementById('round-share-body');
    const resultText = round.result === 'win' ? '<span class="text-success">Hukum Win</span>' : '<span class="text-danger">Hukum Lose</span>';

    let html = `<div style="margin-bottom:1rem;">
        <div style="font-size:0.85rem; margin-bottom:0.5rem;">
            <strong>\uD83D\uDC51 Hukum:</strong> ${sanitizeHTML(round.hukumName)} \u2022 ${resultText}<br>
            <strong>\uD83D\uDCB0 Bid:</strong> ${round.bid} points
        </div>
        <div style="font-size:0.82rem;">`;

    Object.entries(round.scoreChanges || {}).forEach(([pid, change]) => {
        const name = getPlayerName(pid);
        const clr = change > 0 ? 'text-success' : (change < 0 ? 'text-danger' : 'text-muted');
        const display = change === 0 ? 'No change' : `${change >= 0 ? '+' : ''}${change}`;
        html += `<div style="display:flex; justify-content:space-between; padding:0.2rem 0;">
            <span>${sanitizeHTML(name)}</span>
            <span class="${clr}" style="font-weight:${change === 0 ? '400' : '700'};">${display}</span>
        </div>`;
    });

    html += `</div></div>
        <div style="display:flex; gap:0.5rem;">
            <button class="btn btn-gold full-width" onclick="shareLastRound()">
                <i class="fa-solid fa-share-nodes"></i> Share
            </button>
            <button class="btn full-width" onclick="document.getElementById('round-share-modal').classList.remove('active'); navTo('view-home');" style="background:var(--bg-nav); color:var(--text-primary); border:1px solid rgba(255,255,255,0.1);">
                Done
            </button>
        </div>`;

    body.innerHTML = html;
    document.getElementById('round-share-modal').classList.add('active');
}

// =============================================
// RENDER: RANKS
// =============================================

function renderRanks() {
    renderFilterBar('ranks-filter-bar');

    const container = document.getElementById('ranks-table-container');
    const filteredRounds = getFilteredGameRounds();
    const ranked = getRankedPlayers(filteredRounds);

    if (players.length === 0) {
        container.innerHTML = '<p class="empty-state">No players yet. Add some on the Players tab!</p>';
        return;
    }

    if (filteredRounds.length === 0) {
        container.innerHTML = '<p class="empty-state"><i class="fa-solid fa-calendar-xmark" style="font-size:2rem; display:block; margin-bottom:0.5rem;"></i>No rounds in this period.</p>';
        return;
    }

    if (ranked.length === 0) {
        container.innerHTML = '<p class="empty-state">No players with data in this period.</p>';
        return;
    }

    let html = '<div class="ranks-table">';
    ranked.forEach((item, idx) => {
        const { player, stats } = item;
        const rank = idx + 1;
        const topClass = rank === 1 ? 'top-1' : (rank === 2 ? 'top-2' : (rank === 3 ? 'top-3' : ''));
        const scoreClr = stats.totalScore > 0 ? 'text-success' : (stats.totalScore < 0 ? 'text-danger' : '');
        const streak = getWinningStreak(player.id, filteredRounds);

        html += `<div class="rank-row ${topClass}" onclick="openProfile('${player.id}')">
            <span class="rank-number">${rank <= 3 ? ['\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49'][rank-1] : '#' + rank}</span>
            ${avatarHTML(player.name, 'sm')}
            <div class="rank-details">
                <div class="rank-name">${sanitizeHTML(player.name)} ${streakBadgeHTML(streak)}</div>
                <div class="rank-meta">
                    <span>${stats.roundsPlayed}R</span>
                    <span>${stats.wins}W/${stats.losses}L</span>
                    <span>\uD83D\uDC51${stats.asHukum}</span>
                    <span>\uD83E\uDD1D${stats.asPartner}</span>
                </div>
            </div>
            <span class="rank-score ${scoreClr}">${stats.totalScore >= 0 ? '+' : ''}${stats.totalScore}</span>
        </div>`;
    });
    html += '</div>';

    container.innerHTML = html;
}

// =============================================
// RENDER: PLAYER PROFILE
// =============================================

window.openProfile = function(playerId) {
    profilePlayerId = playerId;
    navTo('view-profile');
};

function renderPlayerProfile() {
    const container = document.getElementById('profile-content');
    const player = players.find(p => p.id === profilePlayerId);

    if (!player) {
        container.innerHTML = '<p class="empty-state">Player not found</p>';
        return;
    }

    const filteredRounds = getFilteredGameRounds();
    const allStats = computeAllPlayerStats(filteredRounds);
    const stats = allStats[player.id] || {};
    const ranked = getRankedPlayers(filteredRounds);
    const rankIdx = ranked.findIndex(r => r.player.id === player.id);
    const rank = rankIdx >= 0 ? rankIdx + 1 : '-';
    const scoreClr = (stats.totalScore || 0) > 0 ? 'text-success' : ((stats.totalScore || 0) < 0 ? 'text-danger' : '');

    const streak = getWinningStreak(player.id, filteredRounds);
    const filterLabel = ranksDateFilter === 'all' ? 'All Time' : ranksDateFilter.charAt(0).toUpperCase() + ranksDateFilter.slice(1);

    let html = '';

    // Back button + header
    html += `<div class="profile-header">
        <button class="profile-back-btn" onclick="navTo('view-ranks')"><i class="fa-solid fa-arrow-left"></i></button>
        ${avatarHTML(player.name, 'lg')}
        <div class="profile-info">
            <div class="profile-name">${sanitizeHTML(player.name)} ${streakBadgeHTML(streak, true)}</div>
            <div class="profile-rank">Rank #${rank} \u2022 ${filterLabel}</div>
        </div>
    </div>`;

    // Filter bar
    html += '<div id="profile-filter-bar" class="filter-bar"></div>';

    // Stats cards
    html += `<div class="profile-stats-grid">
        <div class="profile-stat-card">
            <div class="profile-stat-value ${scoreClr}">${(stats.totalScore || 0) >= 0 ? '+' : ''}${stats.totalScore || 0}</div>
            <div class="profile-stat-label">Score</div>
        </div>
        <div class="profile-stat-card">
            <div class="profile-stat-value">${stats.roundsPlayed || 0}</div>
            <div class="profile-stat-label">Rounds</div>
        </div>
        <div class="profile-stat-card">
            <div class="profile-stat-value"><span class="text-success">${stats.wins || 0}</span>/<span class="text-danger">${stats.losses || 0}</span></div>
            <div class="profile-stat-label">W / L</div>
        </div>
    </div>`;

    // Role stats
    html += `<div class="role-stats-grid">
        <div class="role-stat-card">
            <div class="role-stat-title">\uD83D\uDC51 Hukum</div>
            <div class="role-stat-count">${stats.asHukum || 0}</div>
            <div class="role-stat-wl">${stats.hukumWins || 0}W / ${stats.hukumLosses || 0}L</div>
        </div>
        <div class="role-stat-card">
            <div class="role-stat-title">\uD83E\uDD1D Partner</div>
            <div class="role-stat-count">${stats.asPartner || 0}</div>
            <div class="role-stat-wl">${stats.partnerWins || 0}W / ${stats.partnerLosses || 0}L</div>
        </div>
        <div class="role-stat-card">
            <div class="role-stat-title">\uD83C\uDFAF Non-Partner</div>
            <div class="role-stat-count">${stats.asNonPartner || 0}</div>
            <div class="role-stat-wl">${stats.nonPartnerWins || 0}W / ${stats.nonPartnerLosses || 0}L</div>
        </div>
    </div>`;

    // Best / Worst Round
    const bw = getBestWorstRound(player.id, filteredRounds);
    html += `<div class="best-worst-grid">
        <div class="bw-card">
            <div class="bw-label">\uD83D\uDCC8 Best Round</div>
            <div class="bw-value text-success">${bw.bestScore >= 0 ? '+' : ''}${bw.bestScore}</div>
            ${bw.best ? `<div class="bw-detail">Bid ${bw.best.bid} \u2022 ${formatDateTime(bw.best.timestamp)}</div>` : ''}
        </div>
        <div class="bw-card">
            <div class="bw-label">\uD83D\uDCC9 Worst Round</div>
            <div class="bw-value text-danger">${bw.worstScore >= 0 ? '+' : ''}${bw.worstScore}</div>
            ${bw.worst ? `<div class="bw-detail">Bid ${bw.worst.bid} \u2022 ${formatDateTime(bw.worst.timestamp)}</div>` : ''}
        </div>
    </div>`;

    // Head-to-Head
    const h2h = computeHeadToHead(player.id, filteredRounds);
    const h2hEntries = Object.entries(h2h).filter(([_, v]) => v.totalRounds > 0);

    if (h2hEntries.length > 0) {
        html += '<div class="h2h-section-title"><i class="fa-solid fa-people-arrows" style="color:var(--gold-primary)"></i> Head-to-Head</div>';
        html += '<div class="h2h-grid">';
        h2hEntries.sort((a, b) => b[1].against - a[1].against);
        h2hEntries.forEach(([opponentId, record]) => {
            const opName = getPlayerName(opponentId);
            html += `<div class="h2h-card">
                <div class="h2h-left">
                    ${avatarHTML(opName, 'sm')}
                    <div>
                        <div class="h2h-name">vs ${sanitizeHTML(opName)}</div>
                        <div class="h2h-detail">${record.together} together \u2022 ${record.against} against</div>
                    </div>
                </div>
                <div class="h2h-record">
                    <div class="h2h-wl"><span class="text-success">${record.wins}W</span> / <span class="text-danger">${record.losses}L</span></div>
                    <div class="h2h-rounds">${record.totalRounds} rounds</div>
                </div>
            </div>`;
        });
        html += '</div>';
    }

    // Round history for this player
    const playerRounds = filteredRounds
        .filter(r => r.playerIds && r.playerIds.includes(player.id))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    html += '<div class="profile-rounds-title">Round History</div>';

    if (playerRounds.length === 0) {
        html += '<p class="empty-state">No rounds in this period.</p>';
    } else {
        playerRounds.forEach(round => {
            const isHukum = round.hukumId === player.id;
            const isPartner = (round.partnerIds || []).includes(player.id);
            const roleLabel = isHukum ? '\uD83D\uDC51 Hukum' : (isPartner ? '\uD83E\uDD1D Partner' : '\uD83C\uDFAF Non-Partner');

            let playerWon;
            if (isHukum || isPartner) {
                playerWon = round.result === 'win';
            } else {
                playerWon = round.result === 'loss';
            }

            const scoreChange = round.scoreChanges ? (round.scoreChanges[player.id] || 0) : 0;
            const changeClr = scoreChange > 0 ? 'text-success' : (scoreChange < 0 ? 'text-danger' : 'text-muted');
            const resultBadge = playerWon
                ? '<span class="text-success" style="font-size:0.75rem; font-weight:700;">WIN</span>'
                : '<span class="text-danger" style="font-size:0.75rem; font-weight:700;">LOSS</span>';

            const hukumInfo = !isHukum ? ` \u2022 Hukum: ${round.hukumName || getPlayerName(round.hukumId)}` : '';

            html += `<div class="profile-round-row">
                <div class="profile-round-left">
                    <div class="profile-round-role">${roleLabel} \u2022 ${resultBadge}</div>
                    <div class="profile-round-meta">Bid ${round.bid}${hukumInfo} \u2022 ${formatDateTime(round.timestamp)}</div>
                </div>
                <span class="profile-round-score ${changeClr}">${scoreChange >= 0 ? '+' : ''}${scoreChange}</span>
            </div>`;
        });
    }

    container.innerHTML = html;
    renderFilterBar('profile-filter-bar');
}

// =============================================
// RENDER: ROUND HISTORY
// =============================================

window.switchHistoryTab = function(tab) {
    historyTab = tab;
    document.querySelectorAll('#history-tab-bar .tab-pill').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.getElementById('history-rounds-content').style.display = tab === 'rounds' ? 'block' : 'none';
    document.getElementById('history-sessions-content').style.display = tab === 'sessions' ? 'block' : 'none';
    renderHistory();
};

function renderHistory() {
    if (historyTab === 'sessions') {
        renderPastSessions();
        return;
    }

    const container = document.getElementById('history-rounds-content');
    const gameRounds = getGameRounds();

    if (gameRounds.length === 0) {
        container.innerHTML = '<p class="empty-state"><i class="fa-solid fa-clock-rotate-left" style="font-size:2rem; display:block; margin-bottom:0.5rem;"></i>No rounds played yet.</p>';
        return;
    }

    let html = '';
    gameRounds.forEach(round => {
        const hName = round.hukumName || getPlayerName(round.hukumId);
        const partnerNames = (round.partnerNames || round.partnerIds.map(id => getPlayerName(id))).join(', ');
        const nonPartnerNames = (round.nonPartnerNames || round.nonPartnerIds.map(id => getPlayerName(id))).join(', ');
        const resultLabel = round.result === 'win' ? 'Hukum Win' : 'Hukum Lose';
        const resultClass = round.result === 'win' ? 'win' : 'loss';

        html += `<div class="history-card">
            <div class="history-card-header">
                <span class="history-card-time">${formatDateTime(round.timestamp)}</span>
                <span class="history-card-result ${resultClass}">${resultLabel}</span>
                <div class="history-card-actions">
                    <button class="history-share-btn" onclick="shareRoundResult('${round.id}')" title="Share"><i class="fa-solid fa-share-nodes"></i></button>
                    ${isAdminUser ? `<button class="history-delete-btn admin-only" onclick="deleteRound('${round.id}')" title="Delete round"><i class="fa-solid fa-trash-can"></i></button>` : ''}
                </div>
            </div>
            <div class="history-card-body">
                <div><span class="label">Hukum:</span> <strong>${sanitizeHTML(hName)}</strong> \u2022 <span class="label">Bid:</span> <strong>${round.bid}</strong></div>
                <div><span class="label">Partners:</span> ${sanitizeHTML(partnerNames)}</div>
                <div><span class="label">Non-Partners:</span> ${sanitizeHTML(nonPartnerNames)}</div>
            </div>
            <div class="history-card-scores">
                ${Object.entries(round.scoreChanges || {}).map(([pid, change]) => {
                    const name = getPlayerName(pid);
                    if (change === 0) {
                        return `<span class="history-score-tag zero-change"><span style="color:var(--text-muted)">${name}</span> <span style="color:var(--text-muted);font-weight:400;">—</span></span>`;
                    }
                    const clr = change > 0 ? 'text-success' : 'text-danger';
                    return `<span class="history-score-tag"><span style="color:var(--text-muted)">${name}</span> <span class="${clr}" style="font-weight:700;">${change >= 0 ? '+' : ''}${change}</span></span>`;
                }).join('')}
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

function renderPastSessions() {
    const container = document.getElementById('history-sessions-content');

    if (sessions.length === 0) {
        container.innerHTML = '<p class="empty-state"><i class="fa-solid fa-flag-checkered" style="font-size:2rem; display:block; margin-bottom:0.5rem;"></i>No past sessions.</p>';
        return;
    }

    let html = '';
    sessions.forEach(session => {
        const duration = session.duration ? formatDuration(session.duration) : formatDuration(session.endTime - session.startTime);
        const mvpText = session.mvp ? `\uD83C\uDFC5 ${session.mvp.name} (+${session.mvp.score})` : '';

        html += `<div class="session-history-card" onclick="viewSessionSummary('${session.id}')">
            <div class="session-history-header">
                <span class="session-history-date">${formatDate(session.startTime)}</span>
                <span class="session-history-duration">${duration}</span>
            </div>
            <div class="session-history-stats">
                <span>\uD83C\uDCCF ${session.totalRounds} rounds</span>
                <span>\uD83D\uDC65 ${(session.leaderboard || []).length} players</span>
            </div>
            ${mvpText ? `<div class="session-history-mvp">${mvpText}</div>` : ''}
        </div>`;
    });

    container.innerHTML = html;
}

window.viewSessionSummary = function(sessionId) {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    showSessionSummaryModal(session);
};



// =============================================
// WHATSAPP SHARE (html2canvas)
// =============================================

async function generateShareImage(populateFn) {
    if (typeof html2canvas === 'undefined') {
        showToast('Share feature unavailable');
        return null;
    }

    const card = document.getElementById('share-card');
    populateFn(card);

    // Wait for render
    await new Promise(r => setTimeout(r, 150));

    try {
        const canvas = await html2canvas(card, {
            backgroundColor: '#0a0a0c',
            scale: 2,
            useCORS: true,
            logging: false
        });

        return new Promise(resolve => {
            canvas.toBlob(blob => resolve(blob), 'image/png');
        });
    } catch (err) {
        console.error('html2canvas error:', err);
        showToast('Failed to generate image');
        return null;
    }
}

async function shareImageBlob(blob, title) {
    if (!blob) return;

    const file = new File([blob], '3patti-pro.png', { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: title || '3 Patti PRO' });
        } catch (e) {
            if (e.name !== 'AbortError') {
                downloadImageBlob(blob);
            }
        }
    } else {
        downloadImageBlob(blob);
    }
}

function downloadImageBlob(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '3patti-pro.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Image downloaded! \uD83D\uDCF8');
}

window.shareLastRound = async function() {
    if (!lastSavedRound) return;
    const round = lastSavedRound;
    await shareRoundData(round);
    document.getElementById('round-share-modal').classList.remove('active');
    navTo('view-home');
};

window.shareRoundResult = async function(roundId) {
    const round = rounds.find(r => r.id === roundId);
    if (!round) return;
    await shareRoundData(round);
};

async function shareRoundData(round) {
    showToast('Generating image...');

    const blob = await generateShareImage(card => {
        const resultText = round.result === 'win' ? 'Hukum Win \u2705' : 'Hukum Lose \u274C';
        const resultClr = round.result === 'win' ? '#2ecd71' : '#e74c3c';
        const hName = round.hukumName || getPlayerName(round.hukumId);

        let scoresHTML = '';
        Object.entries(round.scoreChanges || {}).forEach(([pid, change]) => {
            const name = getPlayerName(pid);
            const clr = change > 0 ? '#2ecd71' : (change < 0 ? '#e74c3c' : '#8a8d93');
            const display = change === 0 ? '—' : `${change >= 0 ? '+' : ''}${change}`;
            scoresHTML += `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px;">
                <span style="color:#ccc;">${name}</span>
                <span style="color:${clr};font-weight:${change === 0 ? '400' : '700'};">${display}</span>
            </div>`;
        });

        card.innerHTML = `
            <div class="share-card-header">
                <div class="share-card-brand" style="color:#f6d365;">\uD83C\uDCB4 3 Patti PRO</div>
                <div class="share-card-date">\uD83D\uDCC5 ${formatDateTime(round.timestamp)}</div>
            </div>
            <div class="share-card-divider"></div>
            <div class="share-card-section">
                <div style="font-size:16px;font-weight:700;margin-bottom:4px;">
                    \uD83D\uDC51 Hukum: ${hName} \u2014 <span style="color:${resultClr}">${resultText}</span>
                </div>
                <div style="font-size:13px;color:#8a8d93;">\uD83D\uDCB0 Bid: ${round.bid} points</div>
            </div>
            <div class="share-card-section">
                <div style="font-size:12px;color:#8a8d93;margin-bottom:6px;">\uD83D\uDCCA Score Changes</div>
                ${scoresHTML}
            </div>
            <div class="share-card-footer">3 Patti PRO \u2022 Score Tracker</div>
        `;
    });

    await shareImageBlob(blob, '3 Patti PRO - Round Result');
}

window.shareLeaderboard = async function() {
    const filteredRounds = getFilteredGameRounds();
    const ranked = getRankedPlayers(filteredRounds);

    if (ranked.length === 0) {
        showToast('No data to share');
        return;
    }

    showToast('Generating image...');

    const filterLabel = ranksDateFilter === 'all' ? 'All Time' : ranksDateFilter.charAt(0).toUpperCase() + ranksDateFilter.slice(1);

    const blob = await generateShareImage(card => {
        let rowsHTML = '';
        ranked.forEach((item, idx) => {
            const rank = idx + 1;
            const medal = rank <= 3 ? ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'][rank - 1] : `#${rank}`;
            const clr = item.stats.totalScore > 0 ? '#2ecd71' : (item.stats.totalScore < 0 ? '#e74c3c' : '#8a8d93');
            rowsHTML += `<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:14px;">
                <span style="color:#fff;">${medal} ${item.player.name}</span>
                <span style="color:${clr};font-weight:700;">${item.stats.totalScore >= 0 ? '+' : ''}${item.stats.totalScore}</span>
            </div>`;
        });

        card.innerHTML = `
            <div class="share-card-header">
                <div class="share-card-brand" style="color:#f6d365;">\uD83C\uDCB4 3 Patti PRO Leaderboard</div>
                <div class="share-card-date">\uD83D\uDCC5 ${filterLabel} \u2022 ${formatDate(new Date())}</div>
            </div>
            <div class="share-card-divider"></div>
            <div class="share-card-section">
                ${rowsHTML}
            </div>
            <div class="share-card-footer">3 Patti PRO \u2022 Score Tracker</div>
        `;
    });

    await shareImageBlob(blob, '3 Patti PRO - Leaderboard');
};

window.shareSessionSummary = async function() {
    // Get the last session or the one displayed in the modal
    const lastSession = sessions.length > 0 ? sessions[0] : null;
    if (!lastSession) return;

    showToast('Generating image...');

    const blob = await generateShareImage(card => {
        let lbHTML = '';
        (lastSession.leaderboard || []).forEach(item => {
            const medal = item.rank <= 3 ? ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'][item.rank - 1] : `#${item.rank}`;
            const clr = item.score > 0 ? '#2ecd71' : (item.score < 0 ? '#e74c3c' : '#8a8d93');
            lbHTML += `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;">
                <span style="color:#fff;">${medal} ${item.name}</span>
                <span style="color:${clr};font-weight:700;">${item.score >= 0 ? '+' : ''}${item.score}</span>
            </div>`;
        });

        const dur = lastSession.duration ? formatDuration(lastSession.duration) :
            formatDuration(lastSession.endTime - lastSession.startTime);

        card.innerHTML = `
            <div class="share-card-header">
                <div class="share-card-brand" style="color:#f6d365;">\uD83C\uDCB4 3 Patti PRO</div>
                <div style="font-size:14px;font-weight:700;margin-top:4px;">Session Summary</div>
                <div class="share-card-date">\uD83D\uDCC5 ${formatDate(lastSession.startTime)} \u2022 \u23F1 ${dur} \u2022 \uD83C\uDCCF ${lastSession.totalRounds} rounds</div>
            </div>
            <div class="share-card-divider"></div>
            ${lastSession.mvp ? `<div class="share-card-section">
                <div style="font-size:12px;color:#8a8d93;margin-bottom:4px;">\uD83C\uDFC6 Awards</div>
                <div style="font-size:13px;">\uD83C\uDFC5 MVP: <strong style="color:#2ecd71;">${lastSession.mvp.name} (+${lastSession.mvp.score})</strong></div>
                ${lastSession.bestHukum ? `<div style="font-size:13px;">\uD83D\uDC51 Best Hukum: <strong>${lastSession.bestHukum.name}</strong> (${lastSession.bestHukum.winRate}%)</div>` : ''}
                <div style="font-size:13px;">\uD83D\uDCC8 Big Win: <strong style="color:#2ecd71;">${lastSession.biggestWin.name} (+${lastSession.biggestWin.score})</strong></div>
                <div style="font-size:13px;">\uD83D\uDCC9 Big Loss: <strong style="color:#e74c3c;">${lastSession.biggestLoss.name} (${lastSession.biggestLoss.score})</strong></div>
            </div>` : ''}
            <div class="share-card-section">
                <div style="font-size:12px;color:#8a8d93;margin-bottom:6px;">\uD83C\uDFC6 Leaderboard</div>
                ${lbHTML}
            </div>
            <div class="share-card-footer">3 Patti PRO \u2022 Score Tracker</div>
        `;
    });

    await shareImageBlob(blob, '3 Patti PRO - Session Summary');
};

// =============================================
// FIRESTORE CRUD OPERATIONS
// =============================================

// Add Player
document.getElementById('add-player-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = document.getElementById('player-name');
    const name = inp.value.trim();
    if (!name) return;

    // Duplicate check (case-insensitive)
    const existing = players.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
        showToast('Player name already exists! \u26A0\uFE0F');
        return;
    }

    try {
        await db.collection('players').add({
            name: sanitizeHTML(name),
            active: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        inp.value = '';
        showToast(`${name} added! \uD83C\uDCCF`);
    } catch (err) {
        console.error('Add player error:', err);
        showToast('Failed to add player');
    }
});

// Edit Player Name
window.editPlayer = function(pid) {
    editingPlayerId = pid;
    renderPlayers();
    // Focus the input after render
    setTimeout(() => {
        const inp = document.getElementById(`edit-name-${pid}`);
        if (inp) { inp.focus(); inp.select(); }
    }, 50);
};

window.cancelEditPlayer = function() {
    editingPlayerId = null;
    renderPlayers();
};

window.savePlayerName = async function(pid) {
    const inp = document.getElementById(`edit-name-${pid}`);
    if (!inp) return;
    const newName = inp.value.trim();
    if (!newName) {
        showToast('Name cannot be empty');
        return;
    }

    const player = players.find(p => p.id === pid);
    if (!player) return;

    // Skip if name unchanged
    if (newName === player.name) {
        editingPlayerId = null;
        renderPlayers();
        return;
    }

    // Duplicate check (case-insensitive, excluding current player)
    const duplicate = players.find(p => p.id !== pid && p.name.toLowerCase() === newName.toLowerCase());
    if (duplicate) {
        showToast('Player name already exists! \u26A0\uFE0F');
        return;
    }

    try {
        // Update player document
        await db.collection('players').doc(pid).update({ name: sanitizeHTML(newName) });

        // Update name in all past rounds where this player appears
        const roundsWithPlayer = rounds.filter(r =>
            r.playerIds && r.playerIds.includes(pid)
        );

        const batch = db.batch();
        roundsWithPlayer.forEach(r => {
            const ref = db.collection('rounds').doc(r.id);
            const updates = {};
            if (r.hukumId === pid) updates.hukumName = sanitizeHTML(newName);
            if (r.partnerIds && r.partnerIds.includes(pid)) {
                updates.partnerNames = (r.partnerIds || []).map(id =>
                    id === pid ? sanitizeHTML(newName) : getPlayerName(id)
                );
            }
            if (r.nonPartnerIds && r.nonPartnerIds.includes(pid)) {
                updates.nonPartnerNames = (r.nonPartnerIds || []).map(id =>
                    id === pid ? sanitizeHTML(newName) : getPlayerName(id)
                );
            }
            if (Object.keys(updates).length > 0) {
                batch.update(ref, updates);
            }
        });
        await batch.commit();

        editingPlayerId = null;
        showToast(`Renamed to ${newName} \u2705`);
    } catch (err) {
        console.error('Edit player error:', err);
        showToast('Failed to rename player');
    }
};

// Bench Player
window.benchPlayer = async function(pid) {
    try {
        await db.collection('players').doc(pid).update({ active: false });
        showToast('Player benched \uD83C\uDF19');
    } catch (err) {
        console.error('Bench player error:', err);
        showToast('Failed to bench player');
    }
};

// Restore Player
window.restorePlayer = async function(pid) {
    try {
        await db.collection('players').doc(pid).update({ active: true });
        showToast('Player restored! \u2705');
    } catch (err) {
        console.error('Restore player error:', err);
        showToast('Failed to restore player');
    }
};

// Remove Player
window.removePlayer = function(pid) {
    const p = players.find(x => x.id === pid);
    if (!p) return;
    showConfirm(`Remove "${p.name}" from the game?`, 'Remove', async () => {
        try {
            await db.collection('players').doc(pid).delete();
            showToast(`${p.name} removed! \uD83D\uDDD1\uFE0F`);
        } catch (err) {
            console.error('Remove player error:', err);
            showToast('Failed to remove player');
        }
    });
};

// Delete Round
window.deleteRound = function(roundId) {
    showConfirm('Delete this round? Score changes will be reversed.', 'Delete', async () => {
        try {
            await db.collection('rounds').doc(roundId).delete();
            showToast('Round deleted! \u21A9\uFE0F');
        } catch (err) {
            console.error('Delete round error:', err);
            showToast('Failed to delete round');
        }
    });
};



// =============================================
// DATA MIGRATION (localStorage -> Firestore)
// =============================================

async function checkMigration() {
    if (!isAdminUser) return;

    const oldData = localStorage.getItem('3PattiProState');
    if (!oldData) return;

    try {
        const parsed = JSON.parse(oldData);
        if (!parsed.totalPlayers || parsed.totalPlayers.length === 0) return;

        const playersSnap = await db.collection('players').limit(1).get();
        if (!playersSnap.empty) return;

        showMigrationBanner(parsed);
    } catch (e) {
        console.error('Migration check failed:', e);
    }
}

function showMigrationBanner(data) {
    const feed = document.getElementById('activity-feed');
    const banner = document.createElement('div');
    banner.className = 'migration-banner';
    banner.innerHTML = `
        <p><i class="fa-solid fa-database" style="color:var(--blue-primary)"></i> Found ${data.totalPlayers.length} players and ${data.history ? data.history.length : 0} rounds in local storage.</p>
        <button class="btn btn-gold" onclick="migrateToFirestore()" style="margin:0 auto;">
            <i class="fa-solid fa-cloud-arrow-up"></i> Migrate to Firebase
        </button>
    `;
    feed.prepend(banner);
}

window.migrateToFirestore = async function() {
    const oldData = JSON.parse(localStorage.getItem('3PattiProState'));
    if (!oldData) return;

    showToast('Migrating data...');

    try {
        const batch = db.batch();
        const playerIdMap = {};

        for (const p of oldData.totalPlayers) {
            const ref = db.collection('players').doc();
            playerIdMap[String(p.id)] = ref.id;
            batch.set(ref, {
                name: p.name,
                active: oldData.activePlayers ? oldData.activePlayers.includes(String(p.id)) : true,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        await batch.commit();

        if (oldData.history && oldData.history.length > 0) {
            const roundBatches = [];
            let currentBatch = db.batch();
            let count = 0;

            for (const round of oldData.history) {
                if (count >= 490) {
                    roundBatches.push(currentBatch);
                    currentBatch = db.batch();
                    count = 0;
                }

                const ref = db.collection('rounds').doc();
                const roundDoc = {
                    type: 'hukum',
                    timestamp: round.date ? new Date(round.date) : (round.ts ? new Date(round.ts) : new Date()),
                    bid: round.bid || 0,
                    result: round.result === 'win' || round.result === true ? 'win' : 'loss',
                };

                const oldHukumId = String(round.hukum);
                roundDoc.hukumId = playerIdMap[oldHukumId] || oldHukumId;
                roundDoc.hukumName = oldData.totalPlayers.find(p => String(p.id) === oldHukumId)?.name || 'Unknown';

                if (round.partners) {
                    roundDoc.partnerIds = round.partners.map(id => playerIdMap[String(id)] || String(id));
                    roundDoc.partnerNames = round.partners.map(id => oldData.totalPlayers.find(p => String(p.id) === String(id))?.name || 'Unknown');
                } else {
                    roundDoc.partnerIds = [];
                    roundDoc.partnerNames = [];
                }

                if (round.players) {
                    roundDoc.playerIds = round.players.map(id => playerIdMap[String(id)] || String(id));
                } else {
                    roundDoc.playerIds = [];
                }

                roundDoc.nonPartnerIds = roundDoc.playerIds.filter(id => id !== roundDoc.hukumId && !roundDoc.partnerIds.includes(id));
                roundDoc.nonPartnerNames = roundDoc.nonPartnerIds.map(id => {
                    const newP = players.find(p => p.id === id);
                    if (newP) return newP.name;
                    const oldId = Object.entries(playerIdMap).find(([_, v]) => v === id)?.[0];
                    return oldData.totalPlayers.find(p => String(p.id) === oldId)?.name || 'Unknown';
                });

                if (round.deltas) {
                    roundDoc.scoreChanges = {};
                    for (const [oldId, change] of Object.entries(round.deltas)) {
                        const newId = playerIdMap[String(oldId)] || String(oldId);
                        roundDoc.scoreChanges[newId] = change;
                    }
                } else {
                    roundDoc.scoreChanges = {};
                }

                currentBatch.set(ref, roundDoc);
                count++;
            }
            roundBatches.push(currentBatch);

            for (const b of roundBatches) {
                await b.commit();
            }
        }

        localStorage.setItem('3PattiProMigrated', 'true');
        showToast(`Migration complete! ${oldData.totalPlayers.length} players, ${oldData.history ? oldData.history.length : 0} rounds migrated \uD83C\uDF89`);

    } catch (err) {
        console.error('Migration error:', err);
        showToast('Migration failed: ' + err.message);
    }
};

// =============================================
// INIT
// =============================================

initFirestoreListeners();
