let state = JSON.parse(localStorage.getItem('3PattiProState')) || {
    totalPlayers: [],
    activePlayers: [], // Stores IDs of active players
    history: []
};

// ====== DATE FILTER STATE ======
let activeFilter = 'all'; // 'all' | 'today' | 'yesterday' | 'custom' | 'month' | 'year'
let activeCustomDate = null; // For dashboard date picker
let leaderboardFilter = 'all'; // 'all' | 'today' | 'yesterday' | 'custom' | 'month' | 'year'
let leaderboardCustomDate = null; // Date string for custom date filter
let leaderboardSelectedMonth = null; // { month: 0-11, year: number } for monthly filter
let leaderboardSelectedYear = null; // number for yearly filter

// Migrate old saved data from previous version
function migrateOldState() {
    // 1. First time init from local storage format 1
    const old = localStorage.getItem('teenPattiPlayers');
    if (old && (!state.totalPlayers || state.totalPlayers.length === 0)) {
        try {
            const oldPlayers = JSON.parse(old);
            state.totalPlayers = [];
            state.activePlayers = [];
            oldPlayers.forEach(p => {
                const id = Date.now() + Math.random();
                state.totalPlayers.push({ id, name: p.name });
                if (p.isActive !== false) state.activePlayers.push(String(id));
                // Migrate history
                if (p.history && p.history.length > 0) {
                    p.history.forEach(entry => {
                        let round = state.history.find(r => Math.abs(r.ts - entry.ts) < 5000);
                        if (!round) {
                            round = { id: 'rnd-' + entry.ts, ts: entry.ts, deltas: {} };
                            state.history.push(round);
                        }
                        round.deltas[id] = (round.deltas[id] || 0) + entry.amount;
                    });
                }
            });
            saveState();
        } catch(e) { console.log("Migration failed silently"); }
    }

    // 2. Migrate from previous current format to split format
    if (state.players) {
        state.totalPlayers = state.players.map(p => ({ id: p.id, name: p.name }));
        state.activePlayers = state.players.filter(p => p.active !== false).map(p => String(p.id));
        delete state.players;
        saveState();
    }
}

// Migrate rounds: ensure every round has an ISO date string and string result
function migrateRoundData() {
    let changed = false;
    if (!state.history) state.history = [];
    
    state.history.forEach(round => {
        // Ensure date field exists as ISO string
        if (!round.date) {
            round.date = round.ts ? new Date(round.ts).toISOString() : new Date().toISOString();
            changed = true;
        }
        // Normalize result: boolean → string "win" | "lose"
        if (round.result === true) {
            round.result = 'win';
            changed = true;
        } else if (round.result === false) {
            round.result = 'lose';
            changed = true;
        }
        
        // --- NEW: Fix corrupted Round 1001 / Missing Deltas ---
        if (!round.deltas && round.players && round.bid && round.hukum !== undefined) {
            console.log(`Migrating round ${round.id} - computing missing deltas`);
            round.deltas = calculateGameScores(round.players, round.bid, round.hukum, round.partners || [], round.result);
            changed = true;
        }
    });
    if (changed) saveState();
}

function saveState() {
    try {
        const stateStr = JSON.stringify(state);
        localStorage.setItem('3PattiProState', stateStr);
        
        // Cloud Sync: Only if authenticated as admin
        if (window.db && window.currentUser) {
            window.db.collection('teen-patti-scores').doc('state').set(state)
                .catch(err => {
                    console.error("Cloud Error: ", err);
                    showToast('Cloud Sync Failed ⚠️');
                });
        }
    } catch (e) {
        console.error("Critical Save Error:", e);
        showToast('Storage Error: Data might not be saved! ⚠️');
    }
}

// ====== NAVIGATION ======
let expectingPlayerChange = false;
let tempActiveSelection = [];

function navTo(targetId) {
    if (targetId === 'view-round') {
        if (typeof window.isViewerMode === 'function' && window.isViewerMode()) {
            showToast('Viewers cannot add rounds 🚫');
            return;
        }
        if (currentPlayers.length > 0) {
            if (confirm("Do you want to change players?")) {
                expectingPlayerChange = true;
            } else {
                expectingPlayerChange = false;
            }
        } else {
            expectingPlayerChange = true;
        }
    }

    const currentView = document.querySelector('.view.active');
    const targetView = document.getElementById(targetId);
    
    if (currentView && currentView.id !== targetId) {
        currentView.classList.add('leaving');
        setTimeout(() => {
            currentView.classList.remove('active', 'leaving');
            targetView.classList.add('entering');
            targetView.classList.add('active');
            requestAnimationFrame(() => {
                targetView.classList.remove('entering');
            });
        }, 150); // Match CSS transition timing half-way for overlap
    } else if (targetView) {
        targetView.classList.add('active');
    }

    document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.target === targetId);
    });
    
    if (targetId === 'view-round') renderRoundCalculator();
    if (targetId === 'view-leaderboard') renderLeaderboard();
    if (targetId === 'view-settle') renderSettleUp();
    if (targetId === 'view-home') renderDashboard();
    if (targetId === 'view-players') renderPlayers();
}
window.navTo = navTo;

// ====== ACTIVE PLAYER STATE LOGIC ======
let currentPlayers = [];

function validateActivePlayers(selectedPlayerIds, allPlayersList) {
    if (!Array.isArray(selectedPlayerIds) || selectedPlayerIds.length < 4) {
        return { isValid: false, error: 'Minimum active players = 4' };
    }
    const unique = new Set(selectedPlayerIds);
    if (unique.size !== selectedPlayerIds.length) {
        return { isValid: false, error: 'No duplicates in currentPlayers' };
    }
    const allIds = allPlayersList.map(p => String(p.id));
    for (let pid of selectedPlayerIds) {
        if (!allIds.includes(String(pid))) {
            return { isValid: false, error: 'Selected players must exist in total player list' };
        }
    }
    return { isValid: true, error: null };
}

function handlePlayerSelection(wantsToChange, newSelectedIds, allPlayersList) {
    // 3. INITIAL PLAYER SELECTION / 5. CHANGE PLAYERS OPTION
    if (currentPlayers.length === 0 || wantsToChange) {
        const validation = validateActivePlayers(newSelectedIds, allPlayersList);
        if (!validation.isValid) throw new Error(validation.error);
        currentPlayers = [...newSelectedIds].map(String);
    }
    // 4. ROUND BEHAVIOR: Reuse existing currentPlayers
    return currentPlayers;
}

// ====== HELPERS (SCORE RECOMPUTATION) ======
function getPlayerBalanceFromRounds(pid, rounds) {
    const key = String(pid);
    let score = 0;
    rounds.forEach(r => {
        // Defensive check: ensure r exists
        if (!r) return;
        
        if (r.players && r.bid && r.hukum !== undefined) {
            const deltas = calculateGameScores(r.players, r.bid, r.hukum, r.partners || [], r.result);
            score += (deltas[key] || 0);
        } else if (r.deltas) {
            score += (r.deltas[key] || 0);
        }
    });
    return score;
}

function getPlayerBalance(pid) {
    return getPlayerBalanceFromRounds(pid, state.history);
}

function getPlayerTotalRounds(pid) {
    const key = String(pid);
    if (!state.history) return 0;
    return state.history.filter(r => r && r.deltas && r.deltas[key] !== undefined).length;
}

function getInitials(name) {
    return name.trim().split(' ').map(w => w[0].toUpperCase()).slice(0, 2).join('');
}

function sanitizeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ====== GAME CONSTANTS ======
const BID_VALUES = [];
for (let v = 155; v <= 250; v += 5) BID_VALUES.push(v);

// ====== GAME VALIDATION ======
function validateGameRound(activePlayers, bidValue, hukumId, partnerIds) {
    const activeStrs = activePlayers.map(p => typeof p === 'object' ? String(p.id) : String(p));
    const hukumStr = String(hukumId);
    const partnerStrs = partnerIds.map(String);

    if (activeStrs.length < 4) {
        return { isValid: false, error: 'Minimum 4 active players required.' };
    }
    if (!BID_VALUES.includes(bidValue)) {
        return { isValid: false, error: 'Invalid bid value.' };
    }
    if (!hukumId || !activeStrs.includes(hukumStr)) {
        return { isValid: false, error: 'Hukum must be in active players.' };
    }
    for (const pid of partnerStrs) {
        if (!activeStrs.includes(pid)) {
            return { isValid: false, error: 'Partners must be from active players.' };
        }
    }
    if (partnerStrs.includes(hukumStr)) {
        return { isValid: false, error: 'Hukum cannot be a partner.' };
    }
    if (new Set(partnerStrs).size !== partnerStrs.length) {
        return { isValid: false, error: 'Duplicate partners not allowed.' };
    }
    if (partnerStrs.length < 1) {
        return { isValid: false, error: 'Select at least one partner.' };
    }
    const nonPartnerCount = activeStrs.length - 1 - partnerStrs.length;
    if (nonPartnerCount < 1) {
        return { isValid: false, error: 'At least one non-partner must exist.' };
    }
    return { isValid: true, error: null };
}

// ====== SCORING LOGIC ======
function calculateGameScores(playersList, bidValue, hukumId, partnerIds, result) {
    const deltas = {};
    const hukumStr = String(hukumId);
    const partnerStrs = partnerIds.map(String);
    const isWin = result === true || result === 'win';
    
    // Normalize playersList to strings
    const activeStrs = playersList.map(p => typeof p === 'object' ? String(p.id) : String(p));
    activeStrs.forEach(pid => { deltas[pid] = 0; });

    if (isWin) {
        // WIN: Hukum +2×B, Partners +B, Non-partners 0
        if (activeStrs.includes(hukumStr)) deltas[hukumStr] = 2 * bidValue;
        partnerStrs.forEach(pid => { if (activeStrs.includes(pid)) deltas[pid] = bidValue; });
    } else {
        // LOSE: Hukum -B, Partners -floor(B/2), Non-partners +B
        if (activeStrs.includes(hukumStr)) deltas[hukumStr] = -bidValue;
        const pLoss = Math.floor(bidValue / 2);
        partnerStrs.forEach(pid => { if (activeStrs.includes(pid)) deltas[pid] = -pLoss; });
        activeStrs.forEach(pidStr => {
            if (pidStr !== hukumStr && !partnerStrs.includes(pidStr)) {
                deltas[pidStr] = bidValue;
            }
        });
    }
    return deltas;
}


// ====== DATE FILTERING ======
function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

function filterRoundsByDate(rounds, filterType, customDate, selectedMonth, selectedYear) {
    if (filterType === 'all') return rounds;
    const now = new Date();
    return rounds.filter(r => {
        const d = new Date(r.date || r.ts);
        if (filterType === 'today') {
            return isSameDay(d, now);
        }
        if (filterType === 'yesterday') {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            return isSameDay(d, yesterday);
        }
        if (filterType === 'custom' && customDate) {
            return isSameDay(d, new Date(customDate));
        }
        if (filterType === 'month') {
            const targetMonth = selectedMonth ? selectedMonth.month : now.getMonth();
            const targetYear = selectedMonth ? selectedMonth.year : now.getFullYear();
            return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
        }
        if (filterType === 'year') {
            const targetYear = selectedYear != null ? selectedYear : now.getFullYear();
            return d.getFullYear() === targetYear;
        }
        return true;
    });
}

window.setDateFilter = function(filter) {
    activeFilter = filter;
    if (filter === 'custom') {
        const picker = document.getElementById('dashboard-date-picker');
        if (picker) picker.showPicker();
    } else {
        activeCustomDate = null;
        renderDashboard();
    }
};

window.onDashboardCustomDate = function(val) {
    if (!val) return;
    activeCustomDate = val;
    activeFilter = 'custom';
    renderDashboard();
};

window.setLeaderboardFilter = function(filter) {
    leaderboardFilter = filter;
    if (filter !== 'custom') leaderboardCustomDate = null;
    // Reset month/year selectors when switching to non-month/year filters
    if (filter !== 'month') leaderboardSelectedMonth = null;
    if (filter !== 'year') leaderboardSelectedYear = null;
    renderLeaderboard();
};

window.onLeaderboardCustomDate = function(val) {
    if (val) {
        leaderboardCustomDate = val;
        leaderboardFilter = 'custom';
        renderLeaderboard();
    }
};

window.onLeaderboardMonthChange = function(val) {
    if (val) {
        const [year, month] = val.split('-').map(Number);
        leaderboardSelectedMonth = { month: month - 1, year: year };
        leaderboardFilter = 'month';
        renderLeaderboard();
    }
};

window.onLeaderboardYearChange = function(val) {
    if (val) {
        leaderboardSelectedYear = Number(val);
        leaderboardFilter = 'year';
        renderLeaderboard();
    }
};

/**
 * Core Analytics Engine - Computes statistics and recomputes player scores dynamically.
 * @param {Array} rounds - Filtered round history
 * @param {Array} players - List of players to compute stats for
 */
function computeGameAnalytics(rounds, players) {
    const analytics = {
        totalRounds: rounds.length,
        bidFrequency: {},
        highestBid: 0,
        playerStats: {}
    };

    players.forEach(p => {
        analytics.playerStats[p.id] = {
            name: p.name,
            hukumCount: 0,
            winCount: 0,
            partnerCount: 0,
            currentScore: 0
        };
    });

    rounds.forEach(round => {
        // 1. Bid Analytics
        if (round.bid) {
            const bVal = parseInt(round.bid);
            analytics.bidFrequency[bVal] = (analytics.bidFrequency[bVal] || 0) + 1;
            if (bVal > analytics.highestBid) analytics.highestBid = bVal;
        }

        // 2. Score Recomputation & Role Analytics
        if (round.players && round.bid) {
            const deltas = calculateGameScores(round.players, round.bid, round.hukum, round.partners, round.result);
            for (const pid in deltas) {
                if (analytics.playerStats[pid]) {
                    analytics.playerStats[pid].currentScore += deltas[pid];
                    if (pid === String(round.hukum)) analytics.playerStats[pid].hukumCount++;
                    if (round.partners && round.partners.map(String).includes(pid)) analytics.playerStats[pid].partnerCount++;
                    
                    const sideWins = (round.result === 'win' || round.result === true);
                    const isHukumSide = (pid === String(round.hukum)) || (round.partners && round.partners.map(String).includes(pid));
                    if ((isHukumSide && sideWins) || (!isHukumSide && !sideWins)) {
                        analytics.playerStats[pid].winCount++;
                    }
                }
            }
        } else if (round.deltas) { 
            // Legacy rounds (pre-v1.2) - no role tracking
            for (const pid in round.deltas) {
                if (analytics.playerStats[pid]) {
                    analytics.playerStats[pid].currentScore += round.deltas[pid];
                }
            }
        }
    });

    return analytics;
}
// Expose analytics globally for console access
window.getGameAnalytics = function() { return computeGameAnalytics(state.history, state.totalPlayers); };

// ====== RENDERERS ======
function renderAll() {
    try {
        renderDashboard();
        renderPlayers();
    } catch (e) {
        console.error("Render Error:", e);
    }
}

function renderDashboard() {
    try {
        _internalRenderDashboard();
    } catch (e) {
        console.error("Dashboard Render Error:", e);
        showToast("Error updating dashboard UI ⚠️");
    }
}

function _internalRenderDashboard() {
    // 1. DOM Element Acquisition
    const card = document.getElementById('dash-analytics-card');
    const emptyBox = document.getElementById('empty-state-box');
    const feed = document.getElementById('activity-feed');
    const statsContainer = document.getElementById('dash-player-stats-container');
    const acts = document.querySelectorAll('.action-card');
    const txtBtns = document.querySelectorAll('.text-btn');
    const isViewer = typeof window.isViewerMode === 'function' && window.isViewerMode();

    if (!card || !feed || !statsContainer) return;

    // 2. Early Reset (Clean Slate)
    card.style.display = 'none';
    if (emptyBox) emptyBox.style.display = 'none';
    statsContainer.style.display = 'none';
    statsContainer.innerHTML = '';
    
    // Clear the activity feed completely
    feed.innerHTML = ''; 

    // 3. Admin/Viewer UI restrictions
    acts.forEach((b, i) => {
        if (isViewer) {
            b.style.opacity = '0.4';
            b.onclick = () => showToast('Admin feature only');
        } else {
            b.style.opacity = '1';
            if (i===0) b.onclick = () => navTo('view-round');
            if (i===1) b.onclick = () => navTo('view-players');
            if (i===2) b.onclick = () => navTo('view-settle');
            if (i===3) b.onclick = () => undoLastRound();
        }
    });
    txtBtns.forEach(b => b.style.display = isViewer ? 'none' : 'inline-block');

    // 4. Data Computation
    const filteredRounds = filterRoundsByDate(state.history, activeFilter, activeCustomDate);
    const dashAnalytics = computeGameAnalytics(filteredRounds, state.totalPlayers);
    
    // 5. Hero Stats Update
    const activePlayersCount = state.totalPlayers.filter(p => state.activePlayers.includes(String(p.id))).length;
    document.getElementById('stat-active-players').textContent = activePlayersCount;
    document.getElementById('stat-total-rounds').textContent = filteredRounds.length;



    let topName = '—';
    const sortedPerformers = Object.entries(dashAnalytics.playerStats).sort((a,b) => (b[1]?.currentScore || 0) - (a[1]?.currentScore || 0));
    if (sortedPerformers.length > 0 && filteredRounds.length > 0 && sortedPerformers[0] && sortedPerformers[0][1].currentScore > 0) {
        const pid = sortedPerformers[0][0];
        const pObj = state.totalPlayers.find(p => String(p.id) === pid);
        topName = pObj ? pObj.name : '—';
    }
    document.getElementById('stat-top-winner').textContent = topName;
    
    let totalCirculation = 0;
    Object.values(dashAnalytics.playerStats).forEach(s => {
        if (s.currentScore > 0) totalCirculation += s.currentScore;
    });
    document.getElementById('stat-total-money').textContent = `₹${totalCirculation}`;

    // Filter Buttons Visual Refresh
    document.querySelectorAll('#dash-filter-bar .filter-btn').forEach(btn => {
        const filterKey = btn.dataset.filter;
        if (filterKey) btn.classList.toggle('active', activeFilter === filterKey);
    });
    const customBtn = document.getElementById('btn-custom-date');
    if (customBtn) {
        customBtn.classList.toggle('active', activeFilter === 'custom');
        customBtn.innerHTML = `<i class="fa-solid fa-calendar-days"></i> ${activeCustomDate || ''}`;
    }

    // 6. Handle Empty State
    if (filteredRounds.length === 0) {
        if (emptyBox) emptyBox.style.display = 'block';
        return;
    }

    // 7. Analytics Highlights
    card.style.display = 'grid';
    document.getElementById('ana-rounds').textContent = filteredRounds.length;
    document.getElementById('ana-highest').textContent = dashAnalytics.highestBid || '—';
    const popularBidEntry = dashAnalytics.bidFrequency ? Object.entries(dashAnalytics.bidFrequency).sort((a,b) => b[1] - a[1])[0] : null;
    const popularEl = document.getElementById('ana-popular');
    if (popularEl) popularEl.textContent = popularBidEntry ? `${popularBidEntry[0]} ×${popularBidEntry[1]}` : '—';
    
    let tPerfName = '—', tPerfScore = 0;
    if (sortedPerformers.length > 0 && sortedPerformers[0] && sortedPerformers[0][1] && sortedPerformers[0][1].currentScore > 0) {
        const pid = sortedPerformers[0][0];
        const pObj = state.totalPlayers.find(p => String(p.id) === pid);
        tPerfName = pObj ? pObj.name : '—';
        tPerfScore = sortedPerformers[0][1].currentScore;
    }
    const tPerfEl = document.getElementById('ana-top-perf');
    if (tPerfEl) tPerfEl.innerHTML = `${tPerfName} <span style="font-size:0.9rem; opacity:0.8;">(+${tPerfScore})</span>`;

    // 8. Player Stats Table
    const playersWithStats = state.totalPlayers.filter(p => dashAnalytics.playerStats[p.id]);
    if (playersWithStats.length > 0) {
        let statsHtml = '<div style="font-weight:700; margin-bottom:0.5rem; color:var(--gold-primary); font-size:0.9rem;"><i class="fa-solid fa-chart-bar"></i> Player Stats</div>';
        statsHtml += '<div style="overflow-x:auto; background:rgba(255,255,255,0.02); border-radius:12px; padding:0.5rem; border:1px solid rgba(255,255,255,0.05);"><table style="width:100%; font-size:0.8rem; border-collapse:collapse;">';
        statsHtml += '<tr style="border-bottom:1px solid rgba(255,255,255,0.1); color:var(--text-muted);"><th style="text-align:left; padding:0.5rem 0.3rem;">Player</th><th style="padding:0.5rem 0.3rem;">👑</th><th style="padding:0.5rem 0.3rem;">🤝</th><th style="padding:0.5rem 0.3rem;">🏆</th><th style="padding:0.5rem 0.3rem;">Score</th></tr>';
        playersWithStats.forEach(p => {
            const ps = dashAnalytics.playerStats[p.id];
            const clr = ps.currentScore > 0 ? 'color:var(--success)' : (ps.currentScore < 0 ? 'color:var(--danger)' : '');
            statsHtml += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:0.5rem 0.3rem; font-weight:600;">${p.name}</td>
                <td style="text-align:center; padding:0.5rem 0.3rem;">${ps.hukumCount}</td>
                <td style="text-align:center; padding:0.5rem 0.3rem;">${ps.partnerCount}</td>
                <td style="text-align:center; padding:0.5rem 0.3rem;">${ps.winCount}</td>
                <td style="text-align:center; padding:0.5rem 0.3rem; font-weight:700; ${clr}">${ps.currentScore >= 0 ? '+' : ''}${ps.currentScore}</td>
            </tr>`;
        });
        statsHtml += '</table></div>';
        statsContainer.innerHTML = statsHtml;
        statsContainer.style.display = 'block';
    }

    // 9. Recent Activity Feed
    const title = document.createElement('h4');
    title.style = 'font-weight:700; margin-bottom:0.8rem; color:var(--gold-primary); font-size:0.9rem; margin-top:1.5rem;';
    title.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Recent Rounds';
    feed.appendChild(title);

    const recent = [...filteredRounds].reverse().slice(0, 10);
    recent.forEach((round, i) => {
        const d = new Date(round.date || round.ts);
        const timeStr = `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
        const item = document.createElement('div');
        item.className = 'activity-item';
        // Make the main area clickable to show detail
        item.style.cursor = 'pointer';

        if (round.bid) {
            const hPlayer = state.totalPlayers.find(p => String(p.id) === String(round.hukum));
            const hName = hPlayer ? hPlayer.name : '?';
            const isWinResult = round.result === true || round.result === 'win';
            const resultText = isWinResult ? '<span class="text-success">WIN</span>' : '<span class="text-danger">LOSE</span>';
            item.innerHTML = `
                <div style="flex:1" onclick="showRoundDetail('${round.id}')">
                    <div class="activity-desc">Round #${state.history.length - i} &bull; Bid ${round.bid} &bull; ${resultText}</div>
                    <div class="activity-time">Hukum: ${hName} &bull; ${d.toLocaleDateString()} ${timeStr}</div>
                </div>
                ${isViewer ? '' : `<button class="icon-btn" onclick="deleteRound('${round.id}')" title="Delete round" style="opacity:0.5; padding:0.5rem;"><i class="fa-solid fa-trash-can" style="font-size:0.8rem; color:var(--danger);"></i></button>`}
            `;
        } else if (round.deltas) {
            let maxWinner = null, maxAmt = -Infinity;
            for (let pid in round.deltas) {
                if (round.deltas[pid] > maxAmt) { maxAmt = round.deltas[pid]; maxWinner = pid; }
            }
            const wPlayer = state.totalPlayers.find(p => String(p.id) === String(maxWinner));
            item.innerHTML = `
                <div style="flex:1" onclick="showRoundDetail('${round.id}')">
                    <div class="activity-desc">Round #${state.history.length - i} ${wPlayer ? `&bull; <span class="text-success">${wPlayer.name} +${maxAmt}</span>` : ''}</div>
                    <div class="activity-time">${d.toLocaleDateString()} ${timeStr}</div>
                </div>
                ${isViewer ? '' : `<button class="icon-btn" onclick="deleteRound('${round.id}')" title="Delete round" style="opacity:0.5; padding:0.5rem;"><i class="fa-solid fa-trash-can" style="font-size:0.8rem; color:var(--danger);"></i></button>`}
            `;
        }
        feed.appendChild(item);
    });
}


function renderPlayers() {
    const pl = document.getElementById('players-list');
    const inaPl = document.getElementById('inactive-players-list');
    const inaTitle = document.getElementById('inactive-title');
    const addForm = document.getElementById('add-player-form');
    // Logic: Only restrict if explicitly in viewer-only mode (managed by Admin)
    const isLocked = typeof window.isViewerMode === 'function' && window.isViewerMode() && state.history.length === 0;

    if (isLocked) {
        if (addForm) addForm.style.display = 'none';
    } else {
        if (addForm) addForm.style.display = 'flex';
    }

    const active = state.totalPlayers.filter(p => state.activePlayers.includes(String(p.id)));
    const inactive = state.totalPlayers.filter(p => !state.activePlayers.includes(String(p.id)));

    if (active.length === 0) {
        pl.innerHTML = '<p class="empty-state"><i class="fa-solid fa-user-plus"></i><br>Add players above to start!</p>';
    } else {
        pl.innerHTML = active.map(p => {
            const bal = getPlayerBalance(p.id);
            const rds = getPlayerTotalRounds(p.id);
            const clr = bal > 0 ? 'text-success' : (bal < 0 ? 'text-danger' : '');
            return `
            <div class="player-list-item" style="animation: slideIn 0.3s ease">
                <div style="display:flex; align-items:center; gap: 1rem;">
                    <div class="player-avatar">${getInitials(p.name)}</div>
                    <div class="player-info">
                        <span class="name">${p.name}</span>
                        <span class="stats">${rds} rounds played</span>
                    </div>
                </div>
                    <div style="display:flex; align-items:center; gap: 0.5rem;">
                        <span class="player-score ${clr}">${bal >= 0 ? '+' : ''}${bal}</span>
                        <button class="icon-btn" onclick="editPlayer('${p.id}')" title="Edit player"><i class="fa-solid fa-pen" style="color:var(--gold-primary); font-size:0.85rem"></i></button>
                        <button class="icon-btn" onclick="togglePlayer('${p.id}')" title="Bench player"><i class="fa-solid fa-moon text-muted"></i></button>
                        <button class="icon-btn" onclick="removePlayer('${p.id}')" title="Remove player"><i class="fa-solid fa-trash-can" style="color:var(--danger);font-size:0.85rem"></i></button>
                    </div>
            </div>`;
        }).join('');
    }

    if (inactive.length > 0) {
        inaTitle.style.display = 'block';
        inaPl.innerHTML = inactive.map(p => {
            const bal = getPlayerBalance(p.id);
            const clr = bal > 0 ? 'text-success' : (bal < 0 ? 'text-danger' : '');
            return `
            <div class="player-list-item" style="opacity: 0.6">
                <div style="display:flex; align-items:center; gap: 1rem;">
                    <div class="player-avatar" style="opacity:0.5">${getInitials(p.name)}</div>
                    <div class="player-info"><span class="name">${p.name}</span><span class="stats text-muted">Benched</span></div>
                </div>
                <div style="display:flex; align-items:center; gap: 0.8rem;">
                    <span class="player-score ${clr}">${bal}</span>
                    <button class="icon-btn text-success" onclick="${typeof window.isViewerMode === 'function' && window.isViewerMode() ? 'showToast(&quot;Admin only&quot;)' : `togglePlayer(&quot;${p.id}&quot;)`}" title="Restore"><i class="fa-solid fa-rotate-left"></i></button>
                    <button class="icon-btn" onclick="${typeof window.isViewerMode === 'function' && window.isViewerMode() ? 'showToast(&quot;Admin only&quot;)' : `removePlayer(&quot;${p.id}&quot;)`}" title="Remove player"><i class="fa-solid fa-trash-can" style="color:var(--danger);font-size:0.85rem"></i></button>
                </div>
            </div>`;
        }).join('');
    } else {
        inaTitle.style.display = 'none';
        inaPl.innerHTML = '';
    }
}

// ====== ROUND CALCULATOR ======
let roundState = { bid: null, hukum: null, partners: [], result: null };

window.toggleTempActivePlayer = function(pid) {
    const strId = String(pid);
    const idx = tempActiveSelection.indexOf(strId);
    if (idx >= 0) {
        tempActiveSelection.splice(idx, 1);
        document.getElementById('temp-active-check-' + strId).innerHTML = '☐';
    } else {
        tempActiveSelection.push(strId);
        document.getElementById('temp-active-check-' + strId).innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--success);"></i>';
    }
    const saveBtn = document.getElementById('save-round-btn');
    const balSum = document.getElementById('balance-sum');
    balSum.textContent = `${tempActiveSelection.length} selected`;
    saveBtn.disabled = tempActiveSelection.length < 4;
};

function renderRoundCalculator() {
    const calc = document.getElementById('round-calculator');
    const saveBtn = document.getElementById('save-round-btn');
    const balCheck = document.getElementById('balance-check');
    const balSum = document.getElementById('balance-sum');
    const subtitle = document.querySelector('#view-round .subtitle');

    // --- State 1: Explicit Active Player Selection ---
    if (expectingPlayerChange) {
        if (subtitle) subtitle.textContent = 'Select minimum 4 active players for this round';
        
        tempActiveSelection = currentPlayers.length > 0 ? [...currentPlayers] : [...state.activePlayers];
        
        let html = '<div class="round-row" style="flex-direction:column; align-items:stretch;">';
        html += '<div class="name" style="margin-bottom:0.5rem; font-weight:700;"><i class="fa-solid fa-users" style="color:var(--gold-primary);"></i> Total Players List</div>';
        
        if (state.totalPlayers.length === 0) {
            html += '<p class="empty-state">No players added yet. Go to Players tab!</p>';
        } else {
            state.totalPlayers.forEach(p => {
                const isSelected = tempActiveSelection.includes(String(p.id));
                html += `
                <div class="round-row" style="cursor:pointer; margin-bottom:0.3rem;" onclick="toggleTempActivePlayer('${p.id}')">
                    <div style="display:flex; align-items:center; gap:0.7rem;">
                        <div class="player-avatar sm">${getInitials(p.name)}</div>
                        <div class="name">${p.name}</div>
                    </div>
                    <div id="temp-active-check-${p.id}" style="font-size:1.1rem; color:var(--text-muted);">
                        ${isSelected ? '<i class="fa-solid fa-circle-check" style="color:var(--success);"></i>' : '☐'}
                    </div>
                </div>`;
            });
        }
        html += '</div>';
        
        calc.innerHTML = html;
        balSum.textContent = `${tempActiveSelection.length} selected`;
        balCheck.className = 'balance-check'; 
        saveBtn.innerHTML = '<i class="fa-solid fa-arrow-right"></i> Confirm Active Players';
        saveBtn.disabled = tempActiveSelection.length < 4;
        saveBtn.onclick = () => {
            if (tempActiveSelection.length < 4) {
                showToast("Need at least 4 players.");
                return;
            }
            try {
                handlePlayerSelection(true, tempActiveSelection, state.totalPlayers);
                expectingPlayerChange = false;
                renderRoundCalculator();
            } catch (e) {
                showToast(e.message);
            }
        };
        return;
    }

    // --- State 2: Actual Round Calculator ---
    const active = state.totalPlayers.filter(p => currentPlayers.includes(String(p.id)));
    roundState = { bid: null, hukum: null, partners: [], result: null };

    if (subtitle) subtitle.textContent = 'Select bid, hukum, partners, and round result';

    if (active.length < 4) {
        calc.innerHTML = '<p class="empty-state">Need at least 4 active players!</p>';
        saveBtn.disabled = true;
        return;
    }
    
    // Connect original save functionality natively!
    saveBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Save Round';
    saveBtn.onclick = window.saveRoundData;

    calc.innerHTML = `
        <!-- Step 1: Bid Selection -->
        <div class="round-row" style="flex-direction:column; align-items:stretch;">
            <div class="name" style="margin-bottom:0.5rem; font-weight:700;"><i class="fa-solid fa-gavel" style="color:var(--gold-primary);"></i> Select Bid</div>
            <select id="bid-select" onchange="onBidChange(this.value)" style="width:100%; padding:0.8rem; border-radius:10px; background:var(--bg-nav); color:var(--text-primary); border:1px solid rgba(255,255,255,0.1); font-size:1rem; font-family:inherit; outline:none;">
                <option value="">-- Choose Bid Value --</option>
                ${BID_VALUES.map(v => `<option value="${v}">${v}</option>`).join('')}
            </select>
        </div>

        <!-- Step 2: Hukum Selection -->
        <div class="round-row" style="flex-direction:column; align-items:stretch;">
            <div class="name" style="margin-bottom:0.5rem; font-weight:700;"><i class="fa-solid fa-crown" style="color:var(--gold-primary);"></i> Select Hukum</div>
            <div id="hukum-options">
                ${active.map(p => `
                    <div class="round-row" style="cursor:pointer; margin-bottom:0.3rem;" onclick="onHukumSelect('${p.id}')">
                        <div style="display:flex; align-items:center; gap:0.7rem;">
                            <div class="player-avatar sm">${getInitials(p.name)}</div>
                            <div class="name">${p.name}</div>
                        </div>
                        <div id="hukum-check-${p.id}" style="font-size:1.2rem; color:var(--text-muted);">○</div>
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- Step 3: Partner Selection (populated after hukum is chosen) -->
        <div class="round-row" style="flex-direction:column; align-items:stretch;">
            <div class="name" style="margin-bottom:0.5rem; font-weight:700;"><i class="fa-solid fa-handshake" style="color:var(--gold-primary);"></i> Select Partner(s)</div>
            <div id="partner-options">
                <p class="empty-state" style="font-size:0.85rem; padding:0.5rem;">Select Hukum first</p>
            </div>
        </div>

        <!-- Step 4: Round Result -->
        <div class="round-row" style="flex-direction:column; align-items:stretch;">
            <div class="name" style="margin-bottom:0.5rem; font-weight:700;"><i class="fa-solid fa-flag-checkered" style="color:var(--gold-primary);"></i> Round Result</div>
            <div style="display:flex; gap:0.7rem;">
                <button id="result-win-btn" class="btn full-width" style="background:var(--bg-card); border:1px solid rgba(255,255,255,0.1); color:var(--text-primary);" onclick="onResultSelect(true)">
                    <i class="fa-solid fa-trophy"></i> WIN
                </button>
                <button id="result-lose-btn" class="btn full-width" style="background:var(--bg-card); border:1px solid rgba(255,255,255,0.1); color:var(--text-primary);" onclick="onResultSelect(false)">
                    <i class="fa-solid fa-skull-crossbones"></i> LOSE
                </button>
            </div>
        </div>
    `;
    updateSaveRoundBtn();
}

window.onBidChange = function(val) {
    roundState.bid = val ? parseInt(val) : null;
    updateSaveRoundBtn();
};

window.onHukumSelect = function(pid) {
    roundState.hukum = pid;
    roundState.partners = []; // Reset partners when hukum changes

    const active = state.totalPlayers.filter(p => state.activePlayers.includes(String(p.id)));

    // Update hukum visual indicators
    active.forEach(p => {
        const el = document.getElementById('hukum-check-' + p.id);
        if (el) {
            if (String(p.id) === String(pid)) {
                el.innerHTML = '<i class="fa-solid fa-crown" style="color:var(--gold-primary);"></i>';
            } else {
                el.textContent = '○';
            }
        }
    });

    // Render partner options (excluding hukum)
    const partnerDiv = document.getElementById('partner-options');
    const eligible = active.filter(p => String(p.id) !== String(pid));
    partnerDiv.innerHTML = eligible.map(p => `
        <div class="round-row" style="cursor:pointer; margin-bottom:0.3rem;" onclick="onPartnerToggle('${p.id}')">
            <div style="display:flex; align-items:center; gap:0.7rem;">
                <div class="player-avatar sm">${getInitials(p.name)}</div>
                <div class="name">${p.name}</div>
            </div>
            <div id="partner-check-${p.id}" style="font-size:1.1rem; color:var(--text-muted);">☐</div>
        </div>
    `).join('');

    updateSaveRoundBtn();
};

window.onPartnerToggle = function(pid) {
    const idx = roundState.partners.findIndex(x => String(x) === String(pid));
    if (idx >= 0) {
        roundState.partners.splice(idx, 1);
    } else {
        roundState.partners.push(pid);
    }

    // Update visual
    const el = document.getElementById('partner-check-' + pid);
    if (el) {
        const isSelected = roundState.partners.some(x => String(x) === String(pid));
        if (isSelected) {
            el.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--success);"></i>';
        } else {
            el.textContent = '☐';
        }
    }

    updateSaveRoundBtn();
};

window.onResultSelect = function(isWin) {
    roundState.result = isWin;

    const winBtn = document.getElementById('result-win-btn');
    const loseBtn = document.getElementById('result-lose-btn');

    if (isWin) {
        winBtn.style.background = 'var(--success)';
        winBtn.style.color = '#000';
        winBtn.style.borderColor = 'var(--success)';
        loseBtn.style.background = 'var(--bg-card)';
        loseBtn.style.color = 'var(--text-primary)';
        loseBtn.style.borderColor = 'rgba(255,255,255,0.1)';
    } else {
        loseBtn.style.background = 'var(--danger)';
        loseBtn.style.color = '#fff';
        loseBtn.style.borderColor = 'var(--danger)';
        winBtn.style.background = 'var(--bg-card)';
        winBtn.style.color = 'var(--text-primary)';
        winBtn.style.borderColor = 'rgba(255,255,255,0.1)';
    }

    updateSaveRoundBtn();
};

function updateSaveRoundBtn() {
    const btn = document.getElementById('save-round-btn');
    const balEl = document.getElementById('balance-sum');
    const balCheck = document.getElementById('balance-check');
    const active = state.totalPlayers.filter(p => currentPlayers.includes(String(p.id)));

    const ready = roundState.bid && roundState.hukum && roundState.partners.length > 0 && roundState.result !== null;

    if (ready) {
        const validation = validateGameRound(active, roundState.bid, roundState.hukum, roundState.partners);
        if (validation.isValid) {
            btn.disabled = false;
            const hPlayer = state.totalPlayers.find(p => p.id == roundState.hukum);
            const hName = hPlayer ? hPlayer.name : '?';
            balEl.textContent = `${roundState.result ? '✅ WIN' : '❌ LOSE'} • Bid ${roundState.bid} • Hukum: ${hName}`;
            balCheck.className = 'balance-check balanced';
        } else {
            btn.disabled = true;
            balEl.textContent = validation.error;
            balCheck.className = 'balance-check';
        }
    } else {
        btn.disabled = true;
        balEl.textContent = 'Complete all selections above';
        balCheck.className = 'balance-check';
    }
}

// ====== ROUND CREATION LOGIC ======
function createRoundWithCurrentPlayers(bid, hukum, partners, result) {
    // Apply logic ONLY to active players stored in currentPlayers
    const isWin = result === true || result === 'win';
    const newRound = {
        id: 'rnd-' + Date.now(),
        ts: Date.now(),
        date: new Date().toISOString(),
        bid: bid,
        hukum: String(hukum),
        partners: partners.map(String),
        players: [...currentPlayers], // explicitly store from global state
        result: isWin ? 'win' : 'lose'
    };
    
    // Calculate scoring logic specifically against currentPlayers only
    newRound.deltas = calculateGameScores(currentPlayers, bid, hukum, partners, isWin);

    state.history.push(newRound);
    saveState();
}

function processRoundCreation(bid, hukum, partners, result, activePlayersData) {
    const activeIds = activePlayersData.map(p => String(p.id));
    const wantsToChange = currentPlayers.length > 0 && JSON.stringify(currentPlayers) !== JSON.stringify(activeIds);
    
    // Pass strictly through the abstract persistence validation handler
    handlePlayerSelection(wantsToChange, activeIds, state.totalPlayers);
    createRoundWithCurrentPlayers(bid, hukum, partners, result);
}

window.saveRoundData = function() {
    try {
        const active = state.totalPlayers.filter(p => currentPlayers.includes(String(p.id)));

        const validation = validateGameRound(active, roundState.bid, roundState.hukum, roundState.partners);
        if (!validation.isValid) {
            showToast(validation.error);
            return;
        }

        processRoundCreation(roundState.bid, roundState.hukum, roundState.partners, roundState.result, active);

        // Core UI Update
        renderAll();
        navTo('view-home');
        
        // Non-blocking Feedback
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        showToast(roundState.result ? 'Hukum team wins! 🎉' : 'Hukum team loses! 💀');
    } catch (e) {
        console.error("Critical Save Error:", e);
        showToast("Error saving round. Please try again.");
        // Fallback: try to at least go home
        navTo('view-home');
    }
};

// ====== LEADERBOARD ======
function getLeaderboardAnalytics(rounds, sortedPlayers) {
    const totalBids = rounds.length;
    let highestBid = 0;
    const bidCounts = {};
    let totalWins = 0;
    let totalLosses = 0;

    rounds.forEach(r => {
        if (r.bid) {
            if (r.bid > highestBid) highestBid = r.bid;
            bidCounts[r.bid] = (bidCounts[r.bid] || 0) + 1;
        }
        // Count wins/losses (handle both boolean and string result formats)
        if (r.result === true || r.result === 'win') totalWins++;
        else if (r.result === false || r.result === 'lose') totalLosses++;
    });

    let mostFrequentBid = null;
    let maxBidCount = 0;
    for (const [bid, count] of Object.entries(bidCounts)) {
        if (count > maxBidCount) { maxBidCount = count; mostFrequentBid = Number(bid); }
    }

    // Highest scoring player from the sorted list
    const topPerformer = sortedPlayers && sortedPlayers.length > 0 && sortedPlayers[0].bal > 0
        ? { name: sortedPlayers[0].p.name, score: sortedPlayers[0].bal }
        : null;

    return {
        totalBids,
        highestBid,
        mostFrequentBid,
        mostFrequentBidCount: maxBidCount,
        totalWins,
        totalLosses,
        topPerformer
    };
}

// Build the month picker value string from selectedMonth state
function getMonthInputValue() {
    if (leaderboardSelectedMonth) {
        const y = leaderboardSelectedMonth.year;
        const m = String(leaderboardSelectedMonth.month + 1).padStart(2, '0');
        return `${y}-${m}`;
    }
    // Default to current month
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Build the year select options from available round history
function getAvailableYears() {
    const years = new Set();
    const currentYear = new Date().getFullYear();
    years.add(currentYear);
    state.history.forEach(r => {
        const d = new Date(r.date || r.ts);
        years.add(d.getFullYear());
    });
    return Array.from(years).sort((a, b) => b - a);
}

function renderLeaderboard() {
    // Filter rounds based on leaderboard filter
    const filteredRounds = filterRoundsByDate(
        state.history, leaderboardFilter, leaderboardCustomDate,
        leaderboardSelectedMonth, leaderboardSelectedYear
    );

    // Recompute scores from filtered rounds only — NEVER use stored player scores
    const withBal = state.totalPlayers.map(p => ({
        p,
        bal: getPlayerBalanceFromRounds(p.id, filteredRounds)
    })).sort((a, b) => b.bal - a.bal);

    const pods = document.getElementById('podium-container');
    const list = document.getElementById('leaderboard-list');
    pods.innerHTML = ''; list.innerHTML = '';

    // --- Filter Buttons ---
    const filters = [
        { key: 'all', label: 'All' },
        { key: 'today', label: 'Today' },
        { key: 'yesterday', label: 'Yesterday' },
        { key: 'month', label: 'Month' },
        { key: 'year', label: 'Year' },
        { key: 'custom', label: '📅' }
    ];
    let filterHtml = '<div style="display:flex; gap:0.4rem; margin-bottom:0.5rem; flex-wrap:wrap; align-items:center;">';
    filters.forEach(f => {
        const isActive = leaderboardFilter === f.key;
        if (f.key === 'custom') {
            filterHtml += `<input type="date" onchange="onLeaderboardCustomDate(this.value)" value="${leaderboardCustomDate || ''}" style="padding:0.35rem 0.5rem; border-radius:20px; border:1px solid ${leaderboardFilter === 'custom' ? 'var(--gold-primary)' : 'rgba(255,255,255,0.1)'}; background:${leaderboardFilter === 'custom' ? 'var(--gold-primary)' : 'var(--bg-card)'}; color:${leaderboardFilter === 'custom' ? '#000' : 'var(--text-primary)'}; font-size:0.75rem; font-family:inherit; cursor:pointer; outline:none; max-width:130px;">`;
        } else {
            filterHtml += `<button onclick="setLeaderboardFilter('${f.key}')" style="padding:0.35rem 0.7rem; border-radius:20px; border:1px solid ${isActive ? 'var(--gold-primary)' : 'rgba(255,255,255,0.1)'}; background:${isActive ? 'var(--gold-primary)' : 'var(--bg-card)'}; color:${isActive ? '#000' : 'var(--text-primary)'}; font-size:0.75rem; font-weight:600; font-family:inherit; cursor:pointer; transition:all 0.2s;">${f.label}</button>`;
        }
    });
    filterHtml += '</div>';

    // --- Month/Year Selector Row (shown when Month or Year filter is active) ---
    let selectorHtml = '';
    if (leaderboardFilter === 'month') {
        selectorHtml = `<div style="margin-bottom:0.8rem;">
            <input type="month" value="${getMonthInputValue()}" onchange="onLeaderboardMonthChange(this.value)"
                style="padding:0.4rem 0.7rem; border-radius:12px; border:1px solid var(--gold-primary); background:var(--bg-card); color:var(--text-primary); font-size:0.8rem; font-family:inherit; cursor:pointer; outline:none;">
        </div>`;
    } else if (leaderboardFilter === 'year') {
        const years = getAvailableYears();
        const selectedYr = leaderboardSelectedYear || new Date().getFullYear();
        selectorHtml = `<div style="margin-bottom:0.8rem;">
            <select onchange="onLeaderboardYearChange(this.value)"
                style="padding:0.4rem 0.7rem; border-radius:12px; border:1px solid var(--gold-primary); background:var(--bg-card); color:var(--text-primary); font-size:0.8rem; font-family:inherit; cursor:pointer; outline:none;">
                ${years.map(y => `<option value="${y}" ${y === selectedYr ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
        </div>`;
    }

    // We need a wrapper — inject filter + analytics before podium
    const lbParent = pods.parentElement;
    // Remove old filter/analytics/selector if present
    lbParent.querySelectorAll('.lb-filter-bar, .lb-analytics, .lb-selector').forEach(el => el.remove());

    const filterDiv = document.createElement('div');
    filterDiv.className = 'lb-filter-bar';
    filterDiv.innerHTML = filterHtml + selectorHtml;
    lbParent.insertBefore(filterDiv, pods);

    // --- Analytics Section ---
    const lbAnalytics = getLeaderboardAnalytics(filteredRounds, withBal);

    let analyticsHtml = '<div style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem;">';
    analyticsHtml += `<span style="background:var(--bg-card); padding:0.35rem 0.7rem; border-radius:8px; font-size:0.78rem; border:1px solid rgba(255,255,255,0.06);">📊 Rounds: <b style="color:var(--gold-primary);">${lbAnalytics.totalBids}</b></span>`;
    if (lbAnalytics.highestBid > 0) {
        analyticsHtml += `<span style="background:var(--bg-card); padding:0.35rem 0.7rem; border-radius:8px; font-size:0.78rem; border:1px solid rgba(255,255,255,0.06);">⬆ Highest: <b style="color:var(--gold-primary);">${lbAnalytics.highestBid}</b></span>`;
    }
    if (lbAnalytics.mostFrequentBid) {
        analyticsHtml += `<span style="background:var(--bg-card); padding:0.35rem 0.7rem; border-radius:8px; font-size:0.78rem; border:1px solid rgba(255,255,255,0.06);">🔁 Popular: <b style="color:var(--gold-primary);">${lbAnalytics.mostFrequentBid} ×${lbAnalytics.mostFrequentBidCount}</b></span>`;
    }
    if (lbAnalytics.topPerformer) {
        analyticsHtml += `<span style="background:var(--bg-card); padding:0.35rem 0.7rem; border-radius:8px; font-size:0.78rem; border:1px solid rgba(255,255,255,0.06);">🏆 Top: <b style="color:var(--success);">${lbAnalytics.topPerformer.name} +${lbAnalytics.topPerformer.score}</b></span>`;
    }
    analyticsHtml += '</div>';

    const analyticsDiv = document.createElement('div');
    analyticsDiv.className = 'lb-analytics';
    analyticsDiv.innerHTML = analyticsHtml;
    lbParent.insertBefore(analyticsDiv, pods);

    if (withBal.length === 0) {
        pods.innerHTML = '<p class="empty-state" style="width:100%">No players added yet.</p>';
        return;
    }

    if (filteredRounds.length === 0) {
        pods.innerHTML = '<p class="empty-state" style="width:100%">No rounds in this period.</p>';
        return;
    }

    const order = [withBal[1], withBal[0], withBal[2]]; // 2nd, 1st, 3rd in podium order
    const metas = [
        { cls: 'podium-2', color: '#c0c0c0', label: '2' },
        { cls: 'podium-1', color: 'var(--gold-primary)', label: '<i class="fa-solid fa-crown"></i>' },
        { cls: 'podium-3', color: '#cd7f32', label: '3' },
    ];

    order.forEach((item, idx) => {
        if (!item) return;
        const m = metas[idx];
        const bar = document.createElement('div');
        bar.className = `podium-bar ${m.cls}`;
        bar.onclick = () => showPlayerDetail(item.p.id);
        const clr = item.bal > 0 ? 'text-success' : (item.bal < 0 ? 'text-danger' : '');
        bar.innerHTML = `
            <div class="podium-avatar" style="color:${m.color}; border-color:${m.color};">${m.label}</div>
            <div class="podium-name" style="padding: 0.5rem; font-size: 0.9rem;">${item.p.name.split(' ')[0]}</div>
            <div class="podium-score ${clr}" style="font-size: 1rem;">${item.bal >= 0 ? '+' : ''}${item.bal}</div>
        `;
        pods.appendChild(bar);
    });

    for (let i = 3; i < withBal.length; i++) {
        const { p, bal } = withBal[i];
        const clr = bal > 0 ? 'text-success' : (bal < 0 ? 'text-danger' : '');
        list.innerHTML += `
            <div class="player-list-item" onclick="showPlayerDetail('${p.id}')">
                <div style="display:flex; align-items:center; gap: 1rem;">
                    <span style="color:var(--text-muted); font-weight:bold; min-width:25px;">#${i + 1}</span>
                    <div class="player-avatar sm">${getInitials(p.name)}</div>
                    <span style="font-weight:600">${p.name}</span>
                </div>
                <span class="player-score ${clr}">${bal >= 0 ? '+' : ''}${bal}</span>
            </div>`;
    }
}

// ====== SETTLE UP ======
function renderSettleUp() {
    const list = document.getElementById('settle-up-list');
    list.innerHTML = '';
    const balances = state.totalPlayers.map(p => ({ name: p.name, amt: getPlayerBalance(p.id) }));
    let debtors = balances.filter(b => b.amt < 0).map(b => ({ ...b }));
    let creditors = balances.filter(b => b.amt > 0).map(b => ({ ...b }));

    if (debtors.length === 0 && creditors.length === 0) {
        list.innerHTML = '<p class="empty-state"><i class="fa-solid fa-check-circle text-success" style="font-size:2rem"></i><br>Everyone is settled up!</p>';
        return;
    }

    debtors.sort((a, b) => a.amt - b.amt);
    creditors.sort((a, b) => b.amt - a.amt);

    const settlements = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
        const amount = Math.min(Math.abs(debtors[i].amt), creditors[j].amt);
        settlements.push({ from: debtors[i].name, to: creditors[j].name, amt: amount });
        debtors[i].amt += amount;
        creditors[j].amt -= amount;
        if (Math.abs(debtors[i].amt) < 0.01) i++;
        if (creditors[j].amt < 0.01) j++;
    }

    settlements.forEach(s => {
        list.innerHTML += `
            <div class="settle-card">
                <div class="settle-route">
                    <div class="player-avatar sm" style="flex-shrink:0">${getInitials(s.from)}</div>
                    <span>${s.from}</span>
                    <i class="fa-solid fa-arrow-right-long settle-arrow"></i>
                    <div class="player-avatar sm" style="flex-shrink:0">${getInitials(s.to)}</div>
                    <span>${s.to}</span>
                </div>
                <div class="settle-amount">₹${s.amt}</div>
            </div>`;
    });
}

// ====== TOAST NOTIFICATIONS ======
function showToast(msg) {
    let toast = document.getElementById('global-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'global-toast';
        toast.style.cssText = 'position:fixed;top:5rem;left:50%;transform:translateX(-50%);background:var(--success);color:#000;padding:0.8rem 1.5rem;border-radius:50px;font-weight:700;z-index:9999;font-family:Poppins,sans-serif;font-size:0.95rem;box-shadow:0 5px 20px rgba(0,0,0,0.4);transition:opacity 0.3s;';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 1800);
}

// ====== CUSTOM CONFIRM MODAL ======
function showConfirm(msg, btnText, onConfirm, expectedString = null) {
    const modal = document.getElementById('confirm-modal');
    const inputWrap = document.getElementById('confirm-double-wrap');
    const inputEl = document.getElementById('confirm-modal-input');
    const expectedEl = document.getElementById('confirm-expected-text');
    
    document.getElementById('confirm-modal-msg').textContent = msg;
    document.getElementById('confirm-modal-ok').textContent = btnText || 'Delete';
    
    if (expectedString) {
        inputWrap.style.display = 'block';
        expectedEl.textContent = expectedString;
        inputEl.value = '';
    } else {
        inputWrap.style.display = 'none';
        inputEl.value = '';
    }
    
    modal.classList.add('active');

    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    const newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    const newCancel = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

    newOk.addEventListener('click', () => {
        if (expectedString && inputEl.value.trim().toUpperCase() !== expectedString.toUpperCase()) {
            showToast(`Please type ${expectedString} to confirm!`);
            navigator.vibrate?.([50, 50]);
            return;
        }
        modal.classList.remove('active');
        onConfirm();
    });
    newCancel.addEventListener('click', () => {
        modal.classList.remove('active');
    });
}

// ====== ACTIONS ======
window.togglePlayer = function(pid) {
    const strId = String(pid);
    const idx = state.activePlayers.indexOf(strId);
    if (idx >= 0) {
        state.activePlayers.splice(idx, 1);
    } else {
        state.activePlayers.push(strId);
    }
    saveState(); renderPlayers();
}

window.removePlayer = function(pid) {
    const p = state.totalPlayers.find(x => x.id == pid);
    if (!p) return;
    
    const bal = getPlayerBalance(pid);
    let msg = `Remove "${p.name}" from the game?`;
    if (bal !== 0) {
        msg = `⚠️ WARNING: "${p.name}" has a balance of ₹${bal}. Removing them will break the table's math. Continue?`;
    }

    showConfirm(msg, 'Remove', () => {
        const strId = String(pid);
        state.totalPlayers = state.totalPlayers.filter(x => x.id != pid);
        state.activePlayers = state.activePlayers.filter(id => id !== strId);
        currentPlayers = currentPlayers.filter(id => String(id) !== strId);
        
        // Also remove from round history
        state.history.forEach(r => { 
            if (r.deltas) delete r.deltas[pid]; 
        });
        saveState();
        renderAll();
        showToast(`${p.name} removed! 🗑️`);
    });
}

window.resetGamePrompt = function() {
    showConfirm('Reset all rounds? Players will be kept but all scores go to 0.', 'Reset', () => {
        state.history = [];
        saveState();
        renderAll();
        navTo('view-home');
        showToast('Game reset!');
    }, 'RESET');
}

window.deleteAllDataPrompt = function() {
    showConfirm('⚠️ DELETE EVERYTHING? This will remove ALL players and ALL rounds permanently!', 'Delete All', () => {
        state.totalPlayers = [];
        state.activePlayers = [];
        state.history = [];
        localStorage.removeItem('3PattiProState');
        localStorage.removeItem('teenPattiPlayers');
        saveState();
        renderAll();
        navTo('view-home');
        showToast('All data deleted! 🗑️');
    }, 'DELETE');
}

window.undoLastRound = function() {
    if (state.history.length === 0) {
        showToast('No rounds to undo!');
        return;
    }
    showConfirm('Undo the last round?', 'Undo', () => {
        state.history.pop();
        saveState();
        renderAll();
        showToast('Last round undone! ↩️');
    });
}

window.deleteRound = function(rid) {
    const round = state.history.find(r => r.id === rid);
    if (!round) return;
    
    showConfirm(`Delete Round #${state.history.findIndex(x=>x.id===rid)+1}? This will re-calculate balances.`, 'Delete', () => {
        state.history = state.history.filter(r => r.id !== rid);
        saveState();
        renderAll();
        showToast('Round deleted! 🗑️');
    });
}

window.editPlayer = function(pid) {
    const p = state.totalPlayers.find(x => x.id == pid);
    if (!p) return;
    
    const newName = prompt('Enter new name for ' + p.name, p.name);
    if (newName && newName.trim()) {
        const old = p.name;
        p.name = sanitizeHTML(newName.trim());
        saveState();
        renderAll();
        showToast(`Renamed ${old} to ${p.name}! ✏️`);
    }
}

// ====== SETUP ======
document.getElementById('add-player-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = document.getElementById('player-name');
    const n = inp.value.trim();
    if (n) {
        const exists = state.totalPlayers.some(p => p.name.toLowerCase() === n.toLowerCase());
        if (exists) {
            showToast(`Player "${n}" already exists! ⚠️`);
            return;
        }
        const id = Date.now() + Math.random();
        state.totalPlayers.push({ id, name: sanitizeHTML(n) });
        state.activePlayers.push(String(id));
        saveState();
        inp.value = '';
        renderPlayers();
        showToast(`${n} added! 🃏`);
    }
});

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        const t = e.currentTarget.dataset.target;
        if (t) navTo(t);
    });
});

window.db = null;
window.auth = null;
window.currentUser = null;

function renderSyncStatus() {
    const stat = document.getElementById('sync-status');
    const panel = document.getElementById('firebase-setup-panel');
    const adminPanel = document.getElementById('logged-in-admin-panel');

    if (window.db) {
        if (window.currentUser) {
            stat.innerHTML = '<i class="fa-solid fa-circle-check"></i> Online — Logged in as Admin';
            stat.style.color = 'var(--success)';
            panel.style.display = 'none';
            adminPanel.style.display = 'block';
        } else {
            stat.innerHTML = '<i class="fa-solid fa-cloud"></i> Online — Connected as Viewer';
            stat.style.color = '#3b82f6';
            panel.style.display = 'block';
            adminPanel.style.display = 'none';
        }
    } else {
        stat.innerHTML = '<i class="fa-solid fa-circle-info"></i> Offline — scores saved locally';
        stat.style.color = 'var(--text-muted)';
        panel.style.display = 'block';
        adminPanel.style.display = 'none';
    }
}

const HARDCODED_FIREBASE_CONFIG = {
  apiKey: "AIzaSyA9bcA9caD4xmbW-jo9NXC7A66MUBZQbIg",
  authDomain: "patti-pro-a61d8.firebaseapp.com",
  databaseURL: "https://patti-pro-a61d8-default-rtdb.firebaseio.com",
  projectId: "patti-pro-a61d8",
  storageBucket: "patti-pro-a61d8.firebasestorage.app",
  messagingSenderId: "570573461138",
  appId: "1:570573461138:web:4414d0ce87282b91b2f84b",
  measurementId: "G-RM47MXWMG8"
};

function initFirebase(config = HARDCODED_FIREBASE_CONFIG) {
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(config);
        }
        window.db = firebase.firestore();
        window.auth = firebase.auth();

        // Listen for admin auth state
        window.auth.onAuthStateChanged(user => {
            window.currentUser = user;
            renderSyncStatus();
            renderAll();
        });

        // Listen for live database updates
        window.db.collection('teen-patti-scores').doc('state').onSnapshot(doc => {
            if (doc.exists) {
                const cloudState = doc.data();
                // SAFETY: Only overwrite if we are not logged in as admin AND
                // either local is empty or cloud has more history/later timestamp.
                if (!window.currentUser) {
                    const localRounds = state.history ? state.history.length : 0;
                    const cloudRounds = cloudState.history ? cloudState.history.length : 0;
                    
                    if (localRounds === 0 || cloudRounds >= localRounds) {
                        state = cloudState;
                        localStorage.setItem('3PattiProState', JSON.stringify(state));
                        renderAll();
                    } else {
                        console.log("Cloud sync ignored to prevent local data loss.");
                    }
                }
            }
        });

        renderSyncStatus();
    } catch (e) {
        showToast('Firebase Connection Error ❌');
        console.error(e);
    }
}

document.getElementById('btn-save-sync').addEventListener('click', () => {
    const email = document.getElementById('admin-email').value.trim();
    const pwd = document.getElementById('admin-pwd').value.trim();

    if (!email || !pwd) {
        showToast('Please enter Admin Email and Password');
        return;
    }
    
    initFirebase(); // Ensure initialized

    if (window.auth) {
        window.auth.signInWithEmailAndPassword(email, pwd).then(() => {
            showToast('Logged in as Admin 🔐');
            saveState(); // Sync current state to cloud
        }).catch(err => {
            showToast('Login Failed: ' + err.message);
        });
    }
});

document.getElementById('btn-logout').addEventListener('click', () => {
    if (window.auth) {
        window.auth.signOut().then(() => {
            showToast('Logged out');
            localStorage.removeItem('fb-config');
            location.reload(); // Refresh to clean slate
        });
    }
});

window.isViewerMode = function() {
    return window.db !== null && window.currentUser === null;
};

// ====== DATA RECOVERY TOOL ======
window.scanCloudBackups = function() {
    const listEl = document.getElementById('backup-list');
    listEl.style.display = 'block';
    listEl.innerHTML = '<p style="font-size:0.75rem; color:var(--text-muted); text-align:center;">Scanning cloud documents...</p>';

    if (!window.db) {
        listEl.innerHTML = '<p style="color:var(--danger); font-size:0.8rem;">Firestore not initialized. Login first.</p>';
        return;
    }

    window.db.collection('teen-patti-scores').get().then(qs => {
        listEl.innerHTML = '';
        if (qs.empty) {
            listEl.innerHTML = '<p style="font-size:0.8rem; opacity:0.6; text-align:center;">No backups found in cloud.</p>';
            return;
        }

        qs.forEach(doc => {
            const d = doc.data();
            const rounds = d.history ? d.history.length : 0;
            const item = document.createElement('div');
            item.style = 'padding:0.6rem; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center;';
            item.innerHTML = `
                <div>
                    <div style="font-size:0.85rem; font-weight:700;">Folder: ${doc.id}</div>
                    <div style="font-size:0.7rem; opacity:0.6;">${rounds} Rounds Found</div>
                </div>
                <button class="btn" style="padding:0.4rem 0.6rem; font-size:0.7rem; background:var(--gold-primary); color:var(--bg-main);" onclick="restoreBackup('${doc.id}')">Restore</button>
            `;
            listEl.appendChild(item);
        });
    }).catch(err => {
        listEl.innerHTML = `<p style="color:var(--danger); font-size:0.8rem;">Error: ${err.message}</p>`;
    });
};

window.restoreBackup = function(docId) {
    if (!confirm(`Restore data from "${docId}"? Your current local rounds will be replaced.`)) return;
    
    window.db.collection('teen-patti-scores').doc(docId).get().then(doc => {
        if (doc.exists) {
            state = doc.data();
            saveState();
            renderAll();
            showToast('Data Restored Successfully! 🎉');
            document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
        }
    });
};

document.getElementById('btn-scan-backups')?.addEventListener('click', scanCloudBackups);

// Sync modal UI logic
document.getElementById('btn-sync').addEventListener('click', () => {
    document.getElementById('sync-modal').classList.add('active');
});
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    });
});

// ====== INIT ======
setTimeout(() => initFirebase(), 500);

migrateOldState();
migrateRoundData();
renderAll();
// ====== PLAYER DETAILS DRILL-DOWN ======
window.showPlayerDetail = function(pid) {
    const player = state.totalPlayers.find(p => String(p.id) === String(pid));
    if (!player) return;

    // Use current leaderboard filters for consistency
    const filteredRounds = filterRoundsByDate(
        state.history, leaderboardFilter, leaderboardCustomDate,
        leaderboardSelectedMonth, leaderboardSelectedYear
    ).filter(r => r.players && r.players.includes(String(pid)));

    const modal = document.getElementById('player-detail-modal');
    document.getElementById('pd-name').textContent = player.name;
    document.getElementById('pd-avatar').textContent = getInitials(player.name);
    document.getElementById('pd-period').textContent = `Period: ${leaderboardFilter.charAt(0).toUpperCase() + leaderboardFilter.slice(1)}`;

    // Compute Detail Analytics
    let score = 0, wins = 0, losses = 0, hukums = 0, partners = 0, opposition = 0;
    filteredRounds.forEach(r => {
        score += r.deltas[pid] || 0;
        const sideWins = r.result === 'win' || r.result === true;
        const isHukumSide = (String(pid) === String(r.hukum)) || (r.partners && r.partners.includes(String(pid)));
        const playerActuallyWon = (isHukumSide && sideWins) || (!isHukumSide && !sideWins);
        
        if (playerActuallyWon) wins++;
        else losses++;

        const isHukum = String(r.hukum) === String(pid);
        const isPartner = r.partners && r.partners.includes(String(pid));
        
        if (isHukum) hukums++;
        else if (isPartner) partners++;
        else opposition++;
    });

    document.getElementById('pd-score').textContent = (score >= 0 ? '+' : '') + score;
    document.getElementById('pd-wins').textContent = wins;
    document.getElementById('pd-losses').textContent = losses;
    document.getElementById('pd-bids').textContent = hukums;
    document.getElementById('pd-partners').textContent = partners;
    document.getElementById('pd-opposition').textContent = opposition;
    
    // Render History
    const historyList = document.getElementById('pd-round-history');
    historyList.innerHTML = '';

    if (filteredRounds.length === 0) {
        historyList.innerHTML = '<p class="empty-state">No rounds found for this player in this period.</p>';
    } else {
        [...filteredRounds].reverse().forEach(r => {
            const isHukum = String(r.hukum) === String(pid);
            const isPartner = r.partners && r.partners.includes(String(pid));
            const role = isHukum ? 'Hukum' : (isPartner ? 'Partner' : 'Opposition');
            const roleClass = isHukum ? 'role-hukum' : (isPartner ? 'role-partner' : 'role-opp');
            const icon = isHukum ? '👑' : (isPartner ? '🤝' : '⚔️');
            
            const sideWins = r.result === 'win' || r.result === true;
            const isHukumSide = (String(pid) === String(r.hukum)) || (r.partners && r.partners.includes(String(pid)));
            const playerActuallyWon = (isHukumSide && sideWins) || (!isHukumSide && !sideWins);
            const resultLabel = playerActuallyWon ? '✅ WIN' : '❌ LOSS';
            
            const partners = r.partners.map(id => state.totalPlayers.find(p => String(p.id) === String(id))?.name || '?').join(', ');
            const hukumName = state.totalPlayers.find(p => String(p.id) === String(r.hukum))?.name || '?';

            const item = document.createElement('div');
            item.className = 'pd-round-item';
            item.style.cursor = 'pointer';
            item.onclick = () => showRoundDetail(r.id);
            item.innerHTML = `
                <div class="pd-round-top">
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <span class="pd-round-role ${roleClass}">${icon} ${role}</span>
                        <span style="font-weight:700; font-size:0.9rem;">${resultLabel}</span>
                    </div>
                    <span style="font-weight:800; color:var(--gold-primary);">₹${r.bid}</span>
                </div>
                <div class="pd-round-bottom">
                    <span>Hukum: <b>${hukumName}</b></span>
                    <span>Partners: <b>${partners}</b></span>
                </div>
                <div style="margin-top:0.4rem; font-size:0.65rem; opacity:0.6;">
                    ${new Date(r.date || r.ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                </div>
            `;
            historyList.appendChild(item);
        });
    }

    modal.classList.add('active');
};

// ====== ROUND DETAILS MODAL ======
window.showRoundDetail = function(rid) {
    const round = state.history.find(r => r.id === rid);
    if (!round) return;

    const modal = document.getElementById('round-detail-modal');
    const rIdx = state.history.findIndex(r => r.id === rid) + 1;
    
    document.getElementById('rd-id').textContent = '#' + rIdx;
    document.getElementById('rd-bid').textContent = '₹' + (round.bid || '—');
    
    const isWin = round.result === 'win' || round.result === true;
    document.getElementById('rd-result').className = isWin ? 'text-success' : 'text-danger';
    document.getElementById('rd-result').textContent = isWin ? 'WIN' : 'LOSE';
    document.getElementById('rd-date').textContent = new Date(round.date || round.ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

    const innerList = document.getElementById('rd-player-list');
    innerList.innerHTML = '';

    // If it's a version 1.2+ round (with roles), calculate deltas live
    if (round.players && round.bid) {
        const deltas = calculateGameScores(round.players, round.bid, round.hukum, round.partners, round.result);
        round.players.forEach(pid => {
            const pObj = state.totalPlayers.find(x => String(x.id) === String(pid));
            const name = pObj ? pObj.name : 'Unknown';
            const isHukum = String(pid) === String(round.hukum);
            const isPartner = round.partners && round.partners.includes(String(pid));
            const role = isHukum ? 'Hukum' : (isPartner ? 'Partner' : 'Opposition');
            const roleClass = isHukum ? 'role-hukum' : (isPartner ? 'role-partner' : 'role-opp');
            const icon = isHukum ? '👑' : (isPartner ? '🤝' : '⚔️');
            
            const amt = deltas[pid] || 0;
            const clr = amt > 0 ? 'text-success' : (amt < 0 ? 'text-danger' : '');
            
            const pRow = document.createElement('div');
            pRow.style = 'background:rgba(255,255,255,0.02); padding:0.8rem; border-radius:12px; display:flex; justify-content:space-between; align-items:center; border:1px solid rgba(255,255,255,0.03);';
            pRow.innerHTML = `
                <div style="display:flex; align-items:center; gap:0.7rem;">
                    <div class="player-avatar mini" style="width:34px; height:34px; font-size:0.7rem;">${getInitials(name)}</div>
                    <div>
                        <div style="font-weight:700; font-size:0.85rem;">${name}</div>
                        <span class="pd-round-role ${roleClass}" style="padding:0.1rem 0.4rem; font-size:0.6rem;">${icon} ${role}</span>
                    </div>
                </div>
                <div class="${clr}" style="font-weight:800; font-size:1rem;">${amt >= 0 ? '+' : ''}${amt}</div>
            `;
            innerList.appendChild(pRow);
        });
    } else if (round.deltas) {
        // Legacy rounds: only show deltas
        for (const pid in round.deltas) {
            const pObj = state.totalPlayers.find(x => String(x.id) === String(pid));
            const name = pObj ? pObj.name : 'Unknown';
            const amt = round.deltas[pid];
            const clr = amt > 0 ? 'text-success' : (amt < 0 ? 'text-danger' : '');
            
            const pRow = document.createElement('div');
            pRow.style = 'background:rgba(255,255,255,0.02); padding:0.8rem; border-radius:12px; display:flex; justify-content:space-between; align-items:center; border:1px solid rgba(255,255,255,0.03);';
            pRow.innerHTML = `
                <div style="display:flex; align-items:center; gap:0.7rem;">
                    <div class="player-avatar mini" style="width:34px; height:34px; font-size:0.7rem;">${getInitials(name)}</div>
                    <div style="font-weight:700; font-size:0.85rem;">${name}</div>
                </div>
                <div class="${clr}" style="font-weight:800; font-size:1rem;">${amt >= 0 ? '+' : ''}${amt}</div>
            `;
            innerList.appendChild(pRow);
        }
    }

    modal.classList.add('active');
};
