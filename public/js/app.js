const app = {
  escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  user: null,
  shopItems: [],
  inventory: [],
  equippedItems: [],
  layers: [],

  // ── Init ──
  async init() {
    this.setupNavigation();
    this.createToastContainer();
    await this.loadMeta();
    await this.checkAuth();
    this.checkLinkSuccess();
    this.connectWebSocket();
  },

  // ── Auth ──
  async checkAuth() {
    try {
      const res = await fetch('/auth/me');
      const data = await res.json();
      if (data.authenticated) {
        this.user = data.user;
        this.showLoggedIn();
        await this.loadUserData();
      }
    } catch (err) {
      console.error('Auth check failed:', err);
    }
  },

  showLoggedIn() {
    document.getElementById('loginBtnTwitch').style.display = 'none';
    document.getElementById('loginBtnYoutube').style.display = 'none';
    document.getElementById('userInfo').style.display = 'flex';
    document.getElementById('userName').textContent = this.user.display_name;
    document.getElementById('userName').onclick = () => this.openSettings();
    this.updatePointsDisplay();
    if (this.user.streak_days > 1) {
      document.getElementById('streakDisplay').textContent = `🔥${this.user.streak_days}`;
    }
    if (this.user.is_admin) {
      document.getElementById('adminLink').style.display = '';
    }
  },

  updatePointsDisplay() {
    document.getElementById('pointsDisplay').textContent =
      (this.user?.points_balance || 0).toLocaleString();
  },

  async logout() {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.reload();
  },

  // ── Data Loading ──
  async loadMeta() {
    try {
      const res = await fetch('/api/shop/meta/layers');
      const data = await res.json();
      this.layers = data.layers;
      this.populateLayerFilters();
    } catch (err) {
      console.error('Failed to load meta:', err);
    }
  },

  async loadUserData() {
    await Promise.all([
      this.loadAvatar(),
      this.loadInventory(),
      this.loadShop(),
    ]);
  },

  async loadAvatar() {
    if (!this.user) return;
    try {
      const res = await fetch('/api/users/me/avatar');
      this.equippedItems = await res.json();
      this.renderAvatar();
      this.renderEquippedList();
    } catch (err) {
      console.error('Failed to load avatar:', err);
    }
  },

  async loadInventory() {
    if (!this.user) return;
    try {
      const res = await fetch('/api/users/me/inventory');
      this.inventory = await res.json();
      this.renderInventory();
    } catch (err) {
      console.error('Failed to load inventory:', err);
    }
  },

  async loadShop() {
    try {
      const res = await fetch('/api/shop');
      const data = await res.json();
      this.shopItems = data.items;
      this.renderShop();
    } catch (err) {
      console.error('Failed to load shop:', err);
    }
  },

  // ── Avatar Rendering ──
  renderAvatar() {
    const canvas = document.getElementById('avatarCanvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.equippedItems.length === 0) {
      ctx.fillStyle = '#555';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No items equipped', canvas.width / 2, canvas.height / 2);
      return;
    }

    // Sort by layer order and draw each
    const sorted = [...this.equippedItems].sort((a, b) => a.layer_order - b.layer_order);
    let loaded = 0;

    sorted.forEach((item, i) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        loaded++;
        if (loaded === sorted.length) {
          // All loaded — draw in order
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          sorted.forEach(s => {
            if (s._img) ctx.drawImage(s._img, 0, 0, canvas.width, canvas.height);
          });
        }
      };
      img.onerror = () => { loaded++; };
      img.src = `/assets/cosmetics/${item.image_filename}`;
      item._img = img;
    });
  },

  renderEquippedList() {
    const container = document.getElementById('equippedList');
    if (!this.user) return;

    if (this.equippedItems.length === 0) {
      container.innerHTML = '<p class="text-muted">No items equipped. Visit the shop!</p>';
      return;
    }

    container.innerHTML = this.equippedItems
      .sort((a, b) => a.layer_order - b.layer_order)
      .map(item => `
        <div class="equipped-slot">
          <img src="/assets/cosmetics/${item.thumbnail_filename || item.image_filename}" alt="${this.escapeHtml(item.name)}">
          <div>
            <div class="slot-label">${this.escapeHtml(item.layer_type.replace('_', ' '))}</div>
            <div class="item-name">${this.escapeHtml(item.name)}</div>
          </div>
          <button class="btn btn-sm btn-secondary" onclick="app.unequip('${item.id}')">✕</button>
        </div>
      `).join('');
  },

  // ── Shop ──
  renderShop() {
    const container = document.getElementById('shopGrid');
    const layerFilter = document.getElementById('shopLayerFilter').value;
    const rarityFilter = document.getElementById('shopRarityFilter').value;

    let filtered = this.shopItems;
    if (layerFilter) filtered = filtered.filter(i => i.layer_type === layerFilter);
    if (rarityFilter) filtered = filtered.filter(i => i.rarity === rarityFilter);

    container.innerHTML = filtered.map(item => {
      const isOwned = item.owned;
      const isEquipped = this.equippedItems.some(e => e.id === item.id);
      const costLabel = this.getCostLabel(item);
      const limitedBadge = item.is_limited && item.available_until
        ? `<span class="limited-badge" data-until="${item.available_until}">⏳ ${this.getTimeRemaining(item.available_until)}</span>`
        : '';

      return `
        <div class="item-card ${isOwned ? 'owned' : ''} ${isEquipped ? 'equipped' : ''}">
          <span class="rarity-badge rarity-${this.escapeHtml(item.rarity)}">${this.escapeHtml(item.rarity)}</span>
          ${limitedBadge}
          <img src="/assets/cosmetics/${item.thumbnail_filename || item.image_filename}" alt="${this.escapeHtml(item.name)}">
          <div class="item-name">${this.escapeHtml(item.name)}</div>
          <div class="item-layer">${this.escapeHtml(item.layer_type.replace('_', ' '))}</div>
          <div class="item-cost">${costLabel}</div>
          <div class="item-actions">
            ${isOwned
              ? (isEquipped
                ? '<button class="btn btn-sm btn-secondary" onclick="app.unequip(\'' + item.id + '\')">Unequip</button>'
                : '<button class="btn btn-sm btn-primary" onclick="app.equip(\'' + item.id + '\')">Equip</button>')
              : '<button class="btn btn-sm btn-primary" onclick="app.purchase(\'' + item.id + '\')">' + (item.unlock_type === 'free' ? 'Claim Free' : 'Buy') + '</button>'
            }
          </div>
        </div>
      `;
    }).join('');

    // Start countdown timer for limited items
    this.startLimitedCountdowns();
  },

  getTimeRemaining(until) {
    const now = new Date();
    const end = new Date(until);
    const diff = end - now;
    if (diff <= 0) return 'Expired';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (days > 0) return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h ${mins}m left`;
    return `${mins}m left`;
  },

  startLimitedCountdowns() {
    if (this._countdownInterval) clearInterval(this._countdownInterval);
    this._countdownInterval = setInterval(() => {
      document.querySelectorAll('.limited-badge[data-until]').forEach(el => {
        const until = el.getAttribute('data-until');
        const text = this.getTimeRemaining(until);
        el.textContent = '⏳ ' + text;
        if (text === 'Expired') {
          el.textContent = '❌ Expired';
          el.classList.add('limited-expired');
        }
      });
    }, 60 * 1000); // update every minute
  },

  getCostLabel(item) {
    switch (item.unlock_type) {
      case 'free': return 'Free';
      case 'points': return `✦ ${item.unlock_cost.toLocaleString()}`;
      case 'watch_time': return `⏱ ${item.unlock_threshold}min`;
      case 'sub_only': return '⭐ Sub Only';
      case 'donation': return '💰 Donor Only';
      default: return `✦ ${item.unlock_cost}`;
    }
  },

  filterShop() { this.renderShop(); },

  toggleLimitedFields(checked) {
    document.getElementById('limitedFields').style.display = checked ? '' : 'none';
  },

  populateLayerFilters() {
    const shopSelect = document.getElementById('shopLayerFilter');
    const adminSelect = document.getElementById('adminLayerSelect');

    this.layers.forEach(layer => {
      shopSelect.innerHTML += `<option value="${this.escapeHtml(layer.type)}">${this.escapeHtml(layer.label)}</option>`;
      if (adminSelect) adminSelect.innerHTML += `<option value="${this.escapeHtml(layer.type)}">${this.escapeHtml(layer.label)}</option>`;
    });
  },

  // ── Inventory ──
  renderInventory() {
    const container = document.getElementById('inventoryGrid');

    if (!this.user) {
      container.innerHTML = '<p class="text-muted">Login to see your inventory.</p>';
      return;
    }

    if (this.inventory.length === 0) {
      container.innerHTML = '<p class="text-muted">Your collection is empty. Visit the shop!</p>';
      return;
    }

    container.innerHTML = this.inventory.map(item => {
      const isEquipped = item.equipped;
      return `
        <div class="item-card ${isEquipped ? 'equipped' : ''}">
          <span class="rarity-badge rarity-${this.escapeHtml(item.rarity)}">${this.escapeHtml(item.rarity)}</span>
          <img src="/assets/cosmetics/${item.thumbnail_filename || item.image_filename}" alt="${this.escapeHtml(item.name)}">
          <div class="item-name">${this.escapeHtml(item.name)}</div>
          <div class="item-layer">${this.escapeHtml(item.layer_type.replace('_', ' '))}</div>
          <div class="item-actions">
            ${isEquipped
              ? '<button class="btn btn-sm btn-secondary" onclick="app.unequip(\'' + item.id + '\')">Unequip</button>'
              : '<button class="btn btn-sm btn-primary" onclick="app.equip(\'' + item.id + '\')">Equip</button>'
            }
          </div>
        </div>
      `;
    }).join('');
  },

  // ── Actions ──
  async purchase(itemId) {
    if (!this.user) return this.toast('Login first!', 'error');
    try {
      const res = await fetch(`/api/shop/${itemId}/purchase`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        this.toast(`Purchased ${data.item.name}!`, 'success');
        // Refresh user data
        const userRes = await fetch('/api/users/me');
        this.user = await userRes.json();
        this.updatePointsDisplay();
        await this.loadUserData();
      } else {
        this.toast(data.error || 'Purchase failed', 'error');
      }
    } catch (err) {
      this.toast('Purchase failed', 'error');
    }
  },

  async equip(itemId) {
    try {
      const res = await fetch(`/api/users/me/equip/${itemId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        await this.loadUserData();
        this.toast('Item equipped!', 'success');
      }
    } catch (err) {
      this.toast('Failed to equip', 'error');
    }
  },

  async unequip(itemId) {
    try {
      const res = await fetch(`/api/users/me/unequip/${itemId}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        await this.loadUserData();
        this.toast('Item unequipped', 'info');
      }
    } catch (err) {
      this.toast('Failed to unequip', 'error');
    }
  },

  async dailySpin() {
    if (!this.user) return this.toast('Login first!', 'error');
    try {
      const res = await fetch('/api/users/me/daily-spin', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        this.toast(`🎰 You won ✦ ${data.reward} points!`, 'success');
        this.user.points_balance = data.balance;
        this.updatePointsDisplay();
      } else {
        this.toast(data.error || 'Spin failed', 'info');
      }
    } catch (err) {
      this.toast('Spin failed', 'error');
    }
  },

  // ── Leaderboard ──
  async loadLeaderboard(type = 'points') {
    try {
      const res = await fetch(`/api/users/leaderboard?type=${type}`);
      const leaders = await res.json();

      const container = document.getElementById('leaderboardList');
      const labels = { points: 'points_balance', watch_time: 'watch_time_minutes', items: 'items_owned' };
      const field = labels[type];
      const suffix = type === 'watch_time' ? ' min' : type === 'items' ? ' items' : '';

      container.innerHTML = leaders.map((u, i) => `
        <div class="leaderboard-row">
          <span class="leaderboard-rank ${i < 3 ? 'top-' + (i + 1) : ''}">#${i + 1}</span>
          <span class="leaderboard-name">${this.escapeHtml(u.display_name)}</span>
          <span class="leaderboard-value">${(u[field] || 0).toLocaleString()}${suffix}</span>
        </div>
      `).join('');

      // Update tab active state
      document.querySelectorAll('.leaderboard-tabs .btn').forEach(btn => btn.classList.remove('active'));
      event?.target?.classList.add('active');
    } catch (err) {
      console.error('Leaderboard failed:', err);
    }
  },

  // ── Account Linking ──
  openSettings() {
    document.getElementById('settingsModal').style.display = 'flex';
    this.renderLinkedAccounts();
  },

  closeSettings() {
    document.getElementById('settingsModal').style.display = 'none';
  },

  renderLinkedAccounts() {
    const container = document.getElementById('linkedAccountsList');
    if (!this.user?.linked_accounts) return;

    const linked = this.user.linked_accounts.filter(a => a);
    const linkedPlatforms = linked.map(a => a.platform);

    // Show connected accounts
    container.innerHTML = linked.length > 0
      ? '<h3 class="mt-2">Connected Accounts</h3>' +
        linked.map(a => `
          <div class="equipped-slot mt-1 linked-account">
            <span>${a.platform === 'twitch' ? '💜' : a.platform === 'youtube' ? '🔴' : '🔷'}</span>
            <div>
              <div class="slot-label">${this.escapeHtml(a.platform.charAt(0).toUpperCase() + a.platform.slice(1))}</div>
              <div class="item-name">${this.escapeHtml(a.username || 'Connected')}</div>
            </div>
            <span class="link-status">✓</span>
          </div>
        `).join('')
      : '';

    // Show/hide link buttons based on what's already linked
    const twitchBtn = document.getElementById('linkTwitchBtn');
    const youtubeBtn = document.getElementById('linkYoutubeBtn');
    const seSection = document.getElementById('linkSeSection');

    if (twitchBtn) twitchBtn.style.display = linkedPlatforms.includes('twitch') ? 'none' : '';
    if (youtubeBtn) youtubeBtn.style.display = linkedPlatforms.includes('youtube') ? 'none' : '';
    if (seSection) seSection.style.display = linkedPlatforms.includes('streamelements') ? 'none' : '';
  },

  checkLinkSuccess() {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get('linked');
    const error = params.get('error');
    if (linked) {
      this.toast(`${linked.charAt(0).toUpperCase() + linked.slice(1)} account linked!`, 'success');
      window.history.replaceState({}, '', '/');
    }
    if (error === 'link_failed') {
      this.toast('Account linking failed. It may already be linked to another user.', 'error');
      window.history.replaceState({}, '', '/');
    }
  },

  async linkStreamElements() {
    const email = document.getElementById('seEmail').value.trim();
    if (!email) return this.toast('Enter your email', 'error');

    const res = await fetch('/auth/link/streamelements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    this.toast(data.message || (data.success ? 'StreamElements linked!' : 'Failed'), data.success ? 'success' : 'error');
    if (data.success) await this.checkAuth();
  },

  async deleteAccount() {
    const confirmed = confirm('Are you sure you want to delete your account? All your points, inventory, and data will be permanently lost.');
    if (!confirmed) return;

    const doubleConfirm = confirm('This is your last chance. This action CANNOT be undone. Delete your account?');
    if (!doubleConfirm) return;

    const res = await fetch('/api/users/me', { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      window.location.reload();
    } else {
      this.toast('Failed to delete account', 'error');
    }
  },

  // ── Admin ──
  async loadAdmin() {
    if (!this.user?.is_admin) return;

    // Stats
    try {
      const res = await fetch('/api/admin/stats');
      const stats = await res.json();
      document.getElementById('adminStats').innerHTML = `
        <div class="stat-card"><div class="stat-value">${stats.total_users}</div><div class="stat-label">Total Users</div></div>
        <div class="stat-card"><div class="stat-value">${stats.total_items}</div><div class="stat-label">Items</div></div>
        <div class="stat-card"><div class="stat-value">${stats.active_users_1h}</div><div class="stat-label">Active (1h)</div></div>
        <div class="stat-card"><div class="stat-value">${stats.transactions_24h}</div><div class="stat-label">Txns (24h)</div></div>
        <div class="stat-card"><div class="stat-value">${stats.total_points_circulation.toLocaleString()}</div><div class="stat-label">Points in Circulation</div></div>
      `;
    } catch (err) {
      console.error('Admin stats failed:', err);
    }

    // Items list
    try {
      const res = await fetch('/api/admin/items');
      const items = await res.json();
      document.getElementById('adminItemsList').innerHTML = items.map(item => {
        let limitedInfo = '';
        if (item.is_limited) {
          if (item.available_until) {
            const until = new Date(item.available_until);
            const isExpired = until < new Date();
            limitedInfo = `<div class="admin-limited ${isExpired ? 'limited-expired' : 'limited-active'}">
              ⏳ ${isExpired ? 'Expired' : 'Until ' + until.toLocaleDateString() + ' ' + until.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
            </div>`;
          } else {
            limitedInfo = '<div class="admin-limited limited-active">⏳ Limited (no end date)</div>';
          }
        }
        return `
        <div class="item-card" style="border-color: ${item.is_active ? 'var(--border)' : 'var(--danger)'}">
          <span class="rarity-badge rarity-${this.escapeHtml(item.rarity)}">${this.escapeHtml(item.rarity)}</span>
          <img src="/assets/cosmetics/${item.thumbnail_filename || item.image_filename}" alt="${this.escapeHtml(item.name)}" onerror="this.style.display='none'">
          <div class="item-name">${this.escapeHtml(item.name)}</div>
          <div class="item-layer">${this.escapeHtml(item.layer_type.replace('_', ' '))}</div>
          <div class="item-cost">${this.escapeHtml(item.unlock_type)}: ${item.unlock_cost || 'free'}</div>
          ${limitedInfo}
          ${!item.is_active ? '<div style="color:var(--danger);font-size:0.8rem">DISABLED</div>' : ''}
          <button class="btn btn-sm btn-primary mt-1" onclick="app.openItemDetail('${item.id}')">Manage</button>
        </div>
      `}).join('');
    } catch (err) {
      console.error('Admin items failed:', err);
    }

    // Error log
    await this.loadErrorStats();
    await this.loadErrors();
  },

  // ── Item Detail Modal ──
  _currentItemId: null,

  async openItemDetail(itemId) {
    this._currentItemId = itemId;
    document.getElementById('itemDetailModal').style.display = 'flex';
    await this.loadItemDetail(itemId);
  },

  closeItemDetail() {
    document.getElementById('itemDetailModal').style.display = 'none';
    this._currentItemId = null;
    document.getElementById('grantUserSearch').value = '';
    document.getElementById('grantUserResults').innerHTML = '';
  },

  async loadItemDetail(itemId) {
    const res = await fetch(`/api/admin/items/${itemId}/detail`);
    const data = await res.json();
    const { item, owners, total_users } = data;

    // Preview
    document.getElementById('itemDetailPreview').innerHTML = `
      <img src="/assets/cosmetics/${item.image_filename}" alt="${item.name}">
    `;

    // Info
    const isExpired = item.is_limited && item.available_until && new Date(item.available_until) < new Date();
    document.getElementById('itemDetailInfo').innerHTML = `
      <h2>${this.escapeHtml(item.name)}</h2>
      <span class="rarity-badge rarity-${this.escapeHtml(item.rarity)}" style="position:static">${this.escapeHtml(item.rarity)}</span>
      <span class="status-badge ${item.is_active ? 'status-active' : 'status-disabled'}">${item.is_active ? 'Active' : 'Disabled'}</span>
      ${item.is_limited ? `<span class="status-badge ${isExpired ? 'status-expired' : 'status-limited'}">
        ${isExpired ? 'Expired' : 'Limited Time'}
      </span>` : ''}
      <p class="text-muted mt-1">${this.escapeHtml(item.layer_type.replace('_', ' '))} · ${this.escapeHtml(item.unlock_type)}: ${item.unlock_cost || 'free'}</p>
      ${item.description ? `<p class="text-muted">${this.escapeHtml(item.description)}</p>` : ''}
      ${item.available_until ? `<p class="text-muted">Available until: ${new Date(item.available_until).toLocaleString()}</p>` : ''}
    `;

    // Action buttons
    document.getElementById('itemDetailActions').innerHTML = `
      <button class="btn btn-sm ${item.is_active ? 'btn-danger' : 'btn-success'}" onclick="app.toggleItemActive('${item.id}')">
        ${item.is_active ? 'Disable from Shop' : 'Enable in Shop'}
      </button>
      ${isExpired ? `
        <button class="btn btn-sm btn-primary" onclick="app.reactivateItem('${item.id}')">
          Re-enable Expired Item
        </button>
      ` : ''}
    `;

    // Owners
    document.getElementById('itemOwnerCount').textContent = `(${owners.length} / ${total_users} users)`;
    document.getElementById('itemOwnersList').innerHTML = owners.length === 0
      ? '<p class="text-muted">No users own this item yet.</p>'
      : owners.map(o => `
        <div class="owner-row">
          <div class="owner-info">
            <span class="owner-name">${this.escapeHtml(o.display_name)}</span>
            <span class="text-muted">${o.equipped ? '✓ Equipped' : ''} · Got ${new Date(o.acquired_at).toLocaleDateString()}</span>
          </div>
          <button class="btn btn-sm btn-danger" onclick="app.revokeItem('${itemId}', '${o.id}', '${this.escapeHtml(o.display_name.replace(/'/g, "\\'"))}')">Revoke</button>
        </div>
      `).join('');
  },

  async toggleItemActive(itemId) {
    const res = await fetch(`/api/admin/items/${itemId}/toggle`, { method: 'PUT' });
    const data = await res.json();
    if (data.success) {
      this.toast(`Item ${data.item.is_active ? 'enabled' : 'disabled'}`, 'success');
      await this.loadItemDetail(itemId);
      await this.loadAdmin();
      await this.loadShop();
    }
  },

  async reactivateItem(itemId) {
    const input = prompt('Set new expiry date (leave empty to remove time limit).\nFormat: YYYY-MM-DD HH:MM', '');
    let availableUntil = null;
    if (input) {
      const parsed = new Date(input);
      if (isNaN(parsed.getTime())) return this.toast('Invalid date format', 'error');
      availableUntil = parsed.toISOString();
    }

    const res = await fetch(`/api/admin/items/${itemId}/reactivate`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ available_until: availableUntil }),
    });
    const data = await res.json();
    if (data.success) {
      this.toast('Item re-enabled!', 'success');
      await this.loadItemDetail(itemId);
      await this.loadAdmin();
      await this.loadShop();
    }
  },

  async searchUsersForGrant(query) {
    const container = document.getElementById('grantUserResults');
    if (query.length < 2) { container.innerHTML = ''; return; }

    const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(query)}`);
    const users = await res.json();
    container.innerHTML = users.map(u => `
      <div class="search-result-row" onclick="app.grantItemToUser('${u.id}', '${this.escapeHtml(u.display_name.replace(/'/g, "\\'"))}')">
        <span>${this.escapeHtml(u.display_name)}</span>
        <span class="text-muted">✦ ${u.points_balance.toLocaleString()}</span>
      </div>
    `).join('') || '<div class="search-result-row text-muted">No users found</div>';
  },

  async grantItemToUser(userId, displayName) {
    const itemId = this._currentItemId;
    if (!itemId) return;

    const res = await fetch(`/api/admin/items/${itemId}/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    const data = await res.json();
    if (data.success) {
      this.toast(`Granted to ${displayName}`, 'success');
      document.getElementById('grantUserSearch').value = '';
      document.getElementById('grantUserResults').innerHTML = '';
      await this.loadItemDetail(itemId);
    } else {
      this.toast(data.message || 'Already owned', 'error');
    }
  },

  async revokeItem(itemId, userId, displayName) {
    if (!confirm(`Revoke this item from ${displayName}?`)) return;

    const res = await fetch(`/api/admin/items/${itemId}/owners/${userId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      this.toast(`Revoked from ${displayName}`, 'success');
      await this.loadItemDetail(itemId);
    }
  },

  async uploadItem(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);

    // Convert datetime-local values to proper UTC ISO strings
    // (datetime-local gives local time without timezone, which the server would misinterpret as UTC)
    ['available_from', 'available_until'].forEach(field => {
      const val = formData.get(field);
      if (val) {
        formData.set(field, new Date(val).toISOString());
      }
    });

    try {
      const res = await fetch('/api/admin/items', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.toast(`Created: ${data.item.name}`, 'success');
        form.reset();
        await this.loadAdmin();
        await this.loadShop();
      } else {
        this.toast(data.error || 'Upload failed', 'error');
      }
    } catch (err) {
      this.toast('Upload failed', 'error');
    }
  },

  async setMultiplier() {
    const val = parseFloat(document.getElementById('multiplierInput').value);
    const res = await fetch('/api/admin/economy/multiplier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ multiplier: val }),
    });
    const data = await res.json();
    this.toast(data.success ? `Multiplier set to ${val}x` : 'Failed', data.success ? 'success' : 'error');
  },

  async toggleDoublePoints() {
    const btn = document.getElementById('doublePointsBtn');
    const active = btn.textContent.includes('Activate');
    const res = await fetch('/api/admin/economy/double-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    const data = await res.json();
    if (data.success) {
      btn.textContent = active ? 'Deactivate Double Points' : 'Activate Double Points';
      btn.className = active ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-success';
      this.toast(active ? 'Double Points activated!' : 'Double Points deactivated', 'success');
    }
  },

  toggleUnlockFields() {
    const type = document.getElementById('unlockTypeSelect').value;
    document.getElementById('thresholdGroup').style.display = type === 'watch_time' ? '' : 'none';
  },

  // ── Error Log ──
  _errorOffset: 0,
  _errorLimit: 20,

  async loadErrorStats() {
    try {
      const res = await fetch('/api/admin/errors/stats');
      const stats = await res.json();
      document.getElementById('errorStats').innerHTML = `
        <div class="stat-card"><div class="stat-value">${stats.total}</div><div class="stat-label">Total Errors</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--danger)">${stats.unresolved}</div><div class="stat-label">Unresolved</div></div>
        <div class="stat-card"><div class="stat-value">${stats.last_24h}</div><div class="stat-label">Last 24h</div></div>
        <div class="stat-card"><div class="stat-value">${stats.by_severity?.error || 0}</div><div class="stat-label">Errors</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--warning)">${stats.by_severity?.warn || 0}</div><div class="stat-label">Warnings</div></div>
      `;
    } catch (err) {
      console.error('Error stats failed:', err);
    }
  },

  async loadErrors() {
    try {
      const severity = document.getElementById('errorSeverityFilter').value;
      const resolved = document.getElementById('errorResolvedFilter').value;

      let url = `/api/admin/errors?limit=${this._errorLimit}&offset=${this._errorOffset}`;
      if (severity) url += `&severity=${severity}`;
      if (resolved !== '') url += `&resolved=${resolved}`;

      const res = await fetch(url);
      const errors = await res.json();
      const container = document.getElementById('errorList');

      if (errors.length === 0) {
        container.innerHTML = '<p class="text-muted">No errors found.</p>';
        document.getElementById('errorPagination').innerHTML = '';
        return;
      }

      container.innerHTML = errors.map(err => `
        <div class="error-row ${err.resolved ? 'error-resolved' : ''}" onclick="app.toggleErrorDetail(this)">
          <div class="error-row-summary">
            <span class="severity-badge severity-${this.escapeHtml(err.severity)}">${this.escapeHtml(err.severity)}</span>
            <span class="error-id-label">${this.escapeHtml(err.error_id)}</span>
            <span class="error-source">${this.escapeHtml(err.source || 'unknown')}</span>
            <span class="error-message-preview">${this.escapeHtml((err.message || '').substring(0, 80))}${err.message?.length > 80 ? '...' : ''}</span>
            ${err.display_name ? '<span class="error-user">' + this.escapeHtml(err.display_name) + '</span>' : ''}
            <span class="error-time">${new Date(err.created_at).toLocaleString()}</span>
          </div>
          <div class="error-row-detail" style="display:none">
            <div class="error-detail-section">
              <strong>Full Message:</strong>
              <p>${this.escapeHtml(err.message)}</p>
            </div>
            ${err.method && err.path ? '<div class="error-detail-section"><strong>Request:</strong> <code>' + this.escapeHtml(err.method) + ' ' + this.escapeHtml(err.path) + '</code></div>' : ''}
            ${err.stack ? '<div class="error-detail-section"><strong>Stack Trace:</strong><pre class="error-stack">' + this.escapeHtml(err.stack) + '</pre></div>' : ''}
            ${err.metadata ? '<div class="error-detail-section"><strong>Metadata:</strong><pre class="error-stack">' + this.escapeHtml(JSON.stringify(err.metadata, null, 2)) + '</pre></div>' : ''}
            ${!err.resolved ? '<button class="btn btn-sm btn-success mt-1" onclick="event.stopPropagation(); app.resolveError(\'' + this.escapeHtml(err.error_id) + '\')">Mark Resolved</button>' : '<span class="text-muted">Resolved</span>'}
          </div>
        </div>
      `).join('');

      document.getElementById('errorPagination').innerHTML = `
        ${this._errorOffset > 0 ? '<button class="btn btn-sm btn-secondary" onclick="app.errorPage(-1)">Previous</button>' : ''}
        ${errors.length === this._errorLimit ? '<button class="btn btn-sm btn-secondary" onclick="app.errorPage(1)">Next</button>' : ''}
      `;
    } catch (err) {
      console.error('Error list failed:', err);
    }
  },

  toggleErrorDetail(row) {
    const detail = row.querySelector('.error-row-detail');
    if (detail) {
      detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
    }
  },

  async resolveError(errorId) {
    const res = await fetch(`/api/admin/errors/${errorId}/resolve`, { method: 'PUT' });
    const data = await res.json();
    if (data.success) {
      this.toast('Error marked as resolved', 'success');
      await this.loadErrors();
      await this.loadErrorStats();
    }
  },

  async clearResolvedErrors() {
    if (!confirm('Delete all resolved errors? This cannot be undone.')) return;
    const res = await fetch('/api/admin/errors/resolved', { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      this.toast(`Cleared ${data.deleted} resolved errors`, 'success');
      await this.loadErrors();
      await this.loadErrorStats();
    }
  },

  errorPage(direction) {
    this._errorOffset = Math.max(0, this._errorOffset + (direction * this._errorLimit));
    this.loadErrors();
  },

  // ── Navigation ──
  setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        this.navigateTo(page);
      });
    });
  },

  navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById(`page-${page}`)?.classList.add('active');
    document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

    if (page === 'leaderboard') this.loadLeaderboard('points');
    if (page === 'admin') this.loadAdmin();
    if (page === 'shop') this.loadShop();
  },

  // ── WebSocket ──
  connectWebSocket() {
    try {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.ws = new WebSocket(`${protocol}//${location.host}/ws?channel=alerts`);

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'new_unlock' && msg.data?.user?.id === this.user?.id) {
          const names = msg.data.items.map(i => i.name).join(', ');
          this.toast(`🎉 Unlocked: ${names}!`, 'success');
          this.loadUserData();
        }
        if (msg.type === 'announcement') {
          this.toast(`📢 ${msg.data.message}`, 'info');
        }
      };

      this.ws.onclose = () => {
        setTimeout(() => this.connectWebSocket(), 5000);
      };
    } catch (err) {
      console.error('WebSocket failed:', err);
    }
  },

  // ── Toast Notifications ──
  createToastContainer() {
    const container = document.createElement('div');
    container.className = 'toast-container';
    container.id = 'toastContainer';
    document.body.appendChild(container);
  },

  toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  },
};

// ── Start ──
document.addEventListener('DOMContentLoaded', () => app.init());
