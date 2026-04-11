let state = JSON.parse(localStorage.getItem('3PattiProState')) || {
    totalPlayers: [],
    activePlayers: [], // Stores IDs of active players
    history: []
};

// ====== DATE FILTER STATE ======
let activeFilter = 'all'; // 'all' | 'today' | 'month' | 'year'
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
    });
    if (changed) saveState();
}

function saveState() {
    localStorage.setItem('3PattiProState', JSON.stringify(state));
}

// ====== NAVIGATION ======
let expectingPlayerChange = false;
let tempActiveSelection = [];

function navTo(targetId) {
    if (targetId === 'view-round') {
        if (currentPlayers.length > 0) {
            // Ask: Do you want to change players?
            if (confirm("Do you want to change players?")) {
                expectingPlayerChange = true;
            } else {
                expectingPlayerChange = false;
            }
        } else {
            // Initial round: force selection
            expectingPlayerChange = true;
        }
    }

    document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.target === targetId);
    });
    document.querySelectorAll('.view').forEach(v => {
        v.classList.toggle('active', v.id === targetId);
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
        if (r.players && r.bid) {
            const deltas = calculateGameScores(r.players, r.bid, r.hukum, r.partners, r.result);
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
    return state.history.filter(r => r.deltas[key] !== undefined).length;
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

// ====== SCORE RECOMPUTATION ENGINE & ANALYTICS ======
function computeGameAnalytics(rounds, players) {
    const analytics = {
        totalRounds: rounds.length,
        bidFrequency: {},
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
        // Bid Frequency
        if (round.bid) {
            analytics.bidFrequency[round.bid] = (analytics.bidFrequency[round.bid] || 0) + 1;
        }
        // Hukum Count
        if (round.hukum != null) {
            const hKey = String(round.hukum);
            if (analytics.playerStats[hKey]) analytics.playerStats[hKey].hukumCount++;
        }
        // Partner Count
        if (round.partners && Array.isArray(round.partners)) {
            round.partners.forEach(partnerId => {
                if (analytics.playerStats[partnerId]) analytics.playerStats[partnerId].partnerCount++;
            });
        }
        // Score Recomputation
        if (round.players && round.bid) {
            const deltas = calculateGameScores(round.players, round.bid, round.hukum, round.partners, round.result);
            for (const pid in deltas) {
                if (analytics.playerStats[pid]) {
                    analytics.playerStats[pid].currentScore += deltas[pid];
                }
            }
        } else if (round.deltas) { // Legacy rounds
            for (const pid in round.deltas) {
                if (analytics.playerStats[pid]) {
                    analytics.playerStats[pid].currentScore += round.deltas[pid];
                }
            }
        }
        // Win Count
        const isWin = round.result === true || round.result === 'win';
        if (isWin && round.hukum != null) {
            const hKey = String(round.hukum);
            if (analytics.playerStats[hKey]) {
                analytics.playerStats[hKey].winCount++;
            }
        }
    });

    return analytics;
}
// Expose analytics globally for console access
window.getGameAnalytics = function() { return computeGameAnalytics(state.history, state.totalPlayers); };

// ====== RENDERERS ======
function renderAll() {
    renderDashboard();
    renderPlayers();
}

function renderDashboard() {
    // Apply date filter for dashboard analytics
    const filteredRounds = filterRoundsByDate(state.history, activeFilter);

    const activePlayers = state.totalPlayers.filter(p => state.activePlayers.includes(String(p.id)));
    document.getElementById('stat-active-players').textContent = activePlayers.length;
    document.getElementById('stat-total-rounds').textContent = filteredRounds.length;
    let totalMoney = 0;
    let topWinner = null;
    let topWinnerBal = 0;
    activePlayers.forEach(p => {
        const b = getPlayerBalanceFromRounds(p.id, filteredRounds);
        if (b > 0) totalMoney += b;
        if (b > topWinnerBal) { topWinnerBal = b; topWinner = p; }
    });
    document.getElementById('stat-total-money').textContent = `₹${totalMoney}`;
    const twEl = document.getElementById('stat-top-winner');
    if (topWinner) {
        twEl.textContent = `${topWinner.name} (+${topWinnerBal})`;
    } else {
        twEl.textContent = '—';
    }

    // Activity feed with analytics
    const feed = document.getElementById('activity-feed');
    feed.innerHTML = '';

    // --- Date Filter Buttons ---
    const filters = [
        { key: 'all', label: 'All' },
        { key: 'today', label: 'Today' },
        { key: 'month', label: 'Month' },
        { key: 'year', label: 'Year' }
    ];
    let filterHtml = '<div style="display:flex; gap:0.4rem; margin-bottom:1rem; flex-wrap:wrap;">';
    filters.forEach(f => {
        const isActive = activeFilter === f.key;
        filterHtml += `<button onclick="setDateFilter('${f.key}')" style="padding:0.4rem 0.9rem; border-radius:20px; border:1px solid ${isActive ? 'var(--gold-primary)' : 'rgba(255,255,255,0.1)'}; background:${isActive ? 'var(--gold-primary)' : 'var(--bg-card)'}; color:${isActive ? '#000' : 'var(--text-primary)'}; font-size:0.8rem; font-weight:600; font-family:inherit; cursor:pointer; transition:all 0.2s;">${f.label}</button>`;
    });
    filterHtml += '</div>';
    feed.innerHTML += filterHtml;

    if (filteredRounds.length === 0) {
        feed.innerHTML += '<p class="empty-state"><i class="fa-solid fa-play-circle"></i><br>No rounds in this period. Try a different filter!</p>';
        return;
    }

    // Compute analytics from filtered rounds only
    const analytics = computeGameAnalytics(filteredRounds, state.totalPlayers);

    // --- Bid Frequency ---
    const sortedBids = Object.entries(analytics.bidFrequency).sort((a, b) => b[1] - a[1]);
    if (sortedBids.length > 0) {
        let bidHtml = '<div style="margin-bottom:1.2rem;">';
        bidHtml += '<div style="font-weight:700; margin-bottom:0.5rem; color:var(--gold-primary); font-size:0.9rem;"><i class="fa-solid fa-gavel"></i> Bid Frequency</div>';
        bidHtml += '<div style="display:flex; flex-wrap:wrap; gap:0.4rem;">';
        sortedBids.forEach(([bid, count]) => {
            bidHtml += `<span style="background:var(--bg-card); padding:0.3rem 0.7rem; border-radius:8px; font-size:0.8rem; border:1px solid rgba(255,255,255,0.08);">${bid} <b style="color:var(--gold-primary);">×${count}</b></span>`;
        });
        bidHtml += '</div></div>';
        feed.innerHTML += bidHtml;
    }

    // --- Player Stats Table ---
    const playersWithStats = state.totalPlayers.filter(p => analytics.playerStats[p.id]);
    if (playersWithStats.length > 0) {
        let statsHtml = '<div style="margin-bottom:1.2rem;">';
        statsHtml += '<div style="font-weight:700; margin-bottom:0.5rem; color:var(--gold-primary); font-size:0.9rem;"><i class="fa-solid fa-chart-bar"></i> Player Stats</div>';
        statsHtml += '<div style="overflow-x:auto;"><table style="width:100%; font-size:0.8rem; border-collapse:collapse;">';
        statsHtml += '<tr style="border-bottom:1px solid rgba(255,255,255,0.1); color:var(--text-muted);"><th style="text-align:left; padding:0.5rem 0.3rem;">Player</th><th style="padding:0.5rem 0.3rem;">👑</th><th style="padding:0.5rem 0.3rem;">🤝</th><th style="padding:0.5rem 0.3rem;">🏆</th><th style="padding:0.5rem 0.3rem;">Score</th></tr>';
        playersWithStats.forEach(p => {
            const ps = analytics.playerStats[p.id];
            const clr = ps.currentScore > 0 ? 'color:var(--success)' : (ps.currentScore < 0 ? 'color:var(--danger)' : '');
            statsHtml += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:0.5rem 0.3rem; font-weight:600;">${p.name}</td>
                <td style="text-align:center; padding:0.5rem 0.3rem;">${ps.hukumCount}</td>
                <td style="text-align:center; padding:0.5rem 0.3rem;">${ps.partnerCount}</td>
                <td style="text-align:center; padding:0.5rem 0.3rem;">${ps.winCount}</td>
                <td style="text-align:center; padding:0.5rem 0.3rem; font-weight:700; ${clr}">${ps.currentScore >= 0 ? '+' : ''}${ps.currentScore}</td>
            </tr>`;
        });
        statsHtml += '</table></div></div>';
        feed.innerHTML += statsHtml;
    }

    // --- Recent Rounds ---
    feed.innerHTML += '<div style="font-weight:700; margin-bottom:0.5rem; color:var(--gold-primary); font-size:0.9rem;"><i class="fa-solid fa-clock-rotate-left"></i> Recent Rounds</div>';
    const recent = [...filteredRounds].reverse().slice(0, 6);
    recent.forEach((round, i) => {
        const d = new Date(round.date || round.ts);
        const timeStr = `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
        const item = document.createElement('div');
        item.className = 'activity-item';

        if (round.bid) {
            // New format round with bid/hukum/result
            const hPlayer = state.totalPlayers.find(p => p.id == round.hukum);
            const hName = hPlayer ? hPlayer.name : '?';
            const isWinResult = round.result === true || round.result === 'win';
            const resultText = isWinResult
                ? '<span class="text-success">WIN</span>'
                : '<span class="text-danger">LOSE</span>';
            item.innerHTML = `
                <div>
                    <div class="activity-desc">Round #${state.history.length - i} &bull; Bid ${round.bid} &bull; ${resultText}</div>
                    <div class="activity-time">Hukum: ${hName} &bull; ${d.toLocaleDateString()} ${timeStr}</div>
                </div>
            `;
        } else {
            // Legacy format round
            let maxWinner = null, maxAmt = -Infinity;
            for (let pid in round.deltas) {
                if (round.deltas[pid] > maxAmt) { maxAmt = round.deltas[pid]; maxWinner = pid; }
            }
            const wPlayer = state.totalPlayers.find(p => p.id == maxWinner);
            item.innerHTML = `
                <div>
                    <div class="activity-desc">Round #${state.history.length - i} ${wPlayer ? `&bull; <span class="text-success">${wPlayer.name} +${maxAmt}</span>` : ''}</div>
                    <div class="activity-time">${d.toLocaleDateString()} ${timeStr}</div>
                </div>
            `;
        }
        feed.appendChild(item);
    });
}

function renderPlayers() {
    const pl = document.getElementById('players-list');
    const inaPl = document.getElementById('inactive-players-list');
    const inaTitle = document.getElementById('inactive-title');

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
                <div style="display:flex; align-items:center; gap: 0.8rem;">
                    <span class="player-score ${clr}">${bal >= 0 ? '+' : ''}${bal}</span>
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
                    <button class="icon-btn text-success" onclick="togglePlayer('${p.id}')" title="Restore"><i class="fa-solid fa-rotate-left"></i></button>
                    <button class="icon-btn" onclick="removePlayer('${p.id}')" title="Remove player"><i class="fa-solid fa-trash-can" style="color:var(--danger);font-size:0.85rem"></i></button>
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
    const active = state.totalPlayers.filter(p => currentPlayers.includes(String(p.id)));

    const validation = validateGameRound(active, roundState.bid, roundState.hukum, roundState.partners);
    if (!validation.isValid) {
        showToast(validation.error);
        return;
    }

    processRoundCreation(roundState.bid, roundState.hukum, roundState.partners, roundState.result, active);

    renderAll();
    navTo('view-home');
    showToast(roundState.result ? 'Hukum team wins! 🎉' : 'Hukum team loses! 💀');
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
            <div class="player-list-item">
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
function showConfirm(msg, btnText, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-modal-msg').textContent = msg;
    document.getElementById('confirm-modal-ok').textContent = btnText || 'Delete';
    modal.classList.add('active');

    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    // Remove old listeners by cloning
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
    showConfirm(`Remove "${p.name}" from the game?`, 'Remove', () => {
        const strId = String(pid);
        state.totalPlayers = state.totalPlayers.filter(x => x.id != pid);
        state.activePlayers = state.activePlayers.filter(id => id !== strId);
        // Edge Case Handling: safely purge manually deleted players from current active players mid-round
        currentPlayers = currentPlayers.filter(id => String(id) !== strId);
        
        // Also remove from round history
        state.history.forEach(r => { delete r.deltas[pid]; });
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
    });
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
    });
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

// ====== SETUP ======
document.getElementById('add-player-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = document.getElementById('player-name');
    const n = inp.value.trim();
    if (n) {
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

// Sync modal
document.getElementById('btn-sync').addEventListener('click', () => {
    document.getElementById('sync-modal').classList.add('active');
});
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    });
});
document.getElementById('btn-save-sync').addEventListener('click', () => {
    showToast('Firebase support coming soon! 🔥');
});

// ====== INIT ======
migrateOldState();
migrateRoundData();
renderAll();
