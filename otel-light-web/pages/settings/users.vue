<template>
  <div class="settings-users-page">
    <!-- User Management -->
    <div class="settings-card">
      <div class="settings-section">
        <div class="section-header">
          <h3 class="section-title">
            <i class="bi bi-people-fill"></i>
            User Management
          </h3>
          <button class="btn-primary btn-sm" @click="openCreateUser()">
            <i class="bi bi-person-plus"></i> Create User
          </button>
        </div>
        <p class="section-desc">
          Manage users, roles, and scope permissions. At least one admin must
          exist.
        </p>

        <!-- Users Table -->
        <div class="users-table-wrap" v-if="users.length > 0">
          <table class="users-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Scopes</th>
                <th class="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.id">
                <td>
                  <span class="user-name">{{ u.name }}</span>
                  <span v-if="u.id === currentUserId" class="badge-self"
                    >You</span
                  >
                </td>
                <td>
                  <span
                    class="role-badge"
                    :class="u.role === 'admin' ? 'role-admin' : 'role-user'"
                  >
                    {{ u.role }}
                  </span>
                </td>
                <td class="scopes-cell">
                  <span v-if="u.role === 'admin'" class="scope-text"
                    >All scopes</span
                  >
                  <span v-else class="scope-list">
                    <i
                      class="bi"
                      :class="
                        u.scopes?.includes('traces')
                          ? 'bi-check-circle-fill text-green'
                          : 'bi-x-circle-fill text-muted'
                      "
                    ></i>
                    Traces
                    <i
                      class="bi"
                      :class="
                        u.scopes?.includes('metrics')
                          ? 'bi-check-circle-fill text-green'
                          : 'bi-x-circle-fill text-muted'
                      "
                    ></i>
                    Metrics
                    <i
                      class="bi"
                      :class="
                        u.scopes?.includes('logs')
                          ? 'bi-check-circle-fill text-green'
                          : 'bi-x-circle-fill text-muted'
                      "
                    ></i>
                    Logs
                  </span>
                </td>
                <td class="col-actions">
                  <button
                    class="icon-btn"
                    title="Edit"
                    @click="openEditUser(u)"
                  >
                    <i class="bi bi-pencil-fill"></i>
                  </button>
                  <button
                    class="icon-btn icon-btn--danger"
                    title="Delete"
                    :disabled="u.id === currentUserId"
                    @click="confirmDeleteUser(u)"
                  >
                    <i class="bi bi-trash3-fill"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty-state">
          <i class="bi bi-people"></i>
          <p>No users found.</p>
        </div>
      </div>
    </div>

    <!-- CREATE/EDIT USER MODAL -->
    <div v-if="showUserModal" class="modal" @click.self="closeUserModal">
      <div class="modal-card">
        <div class="modal-header">
          <h3>
            <i
              :class="editingUser ? 'bi bi-pencil-fill' : 'bi bi-person-plus'"
            ></i>
            {{ editingUser ? "Edit User" : "Create User" }}
          </h3>
          <button class="icon-btn" @click="closeUserModal">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="field-row">
            <label class="field-label">Username</label>
            <input
              type="text"
              v-model="userForm.name"
              placeholder="Enter username"
              class="field-input"
              :disabled="!!editingUser"
            />
          </div>
          <div class="field-row">
            <label class="field-label">
              {{
                editingUser
                  ? "New Password (leave blank to keep current)"
                  : "Password"
              }}
            </label>
            <input
              type="password"
              v-model="userForm.password"
              :placeholder="
                editingUser ? 'Leave blank to keep' : 'Enter password'
              "
              class="field-input"
            />
          </div>
          <div class="field-row">
            <label class="field-label">Role</label>
            <div class="radio-group">
              <label class="radio-label">
                <input type="radio" v-model="userForm.role" value="user" />
                User
              </label>
              <label class="radio-label">
                <input type="radio" v-model="userForm.role" value="admin" />
                Admin
              </label>
            </div>
          </div>

          <!-- Scopes (only for non-admin) -->
          <div v-if="userForm.role !== 'admin'" class="perms-section">
            <label class="field-label">Scopes</label>
            <div class="checkbox-group">
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  v-model="userForm.scopes"
                  value="traces"
                />
                Traces
              </label>
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  v-model="userForm.scopes"
                  value="metrics"
                />
                Metrics
              </label>
              <label class="checkbox-label">
                <input type="checkbox" v-model="userForm.scopes" value="logs" />
                Logs
              </label>
            </div>
          </div>
          <div v-else class="perms-section">
            <p class="perm-note">
              <i class="bi bi-info-circle-fill"></i>
              Admins have all scopes by default.
            </p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" @click="closeUserModal">Cancel</button>
          <button class="btn-primary" :disabled="savingUser" @click="saveUser">
            <i class="bi bi-check-lg"></i>
            {{ savingUser ? "Saving…" : "Save" }}
          </button>
        </div>
      </div>
    </div>

    <!-- DELETE CONFIRM MODAL -->
    <div
      v-if="showDeleteConfirm"
      class="modal"
      @click.self="showDeleteConfirm = false"
    >
      <div class="modal-card modal-card--sm">
        <div class="modal-header">
          <h3>
            <i class="bi bi-exclamation-triangle-fill text-warning"></i> Delete
            User
          </h3>
          <button class="icon-btn" @click="showDeleteConfirm = false">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
        <div class="modal-body">
          <p>
            Are you sure you want to delete user
            <strong>{{ deleteTarget?.name }}</strong
            >?
          </p>
          <p class="text-muted">This action cannot be undone.</p>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" @click="showDeleteConfirm = false">
            Cancel
          </button>
          <button
            class="btn-danger"
            :disabled="deletingUser"
            @click="executeDelete"
          >
            <i class="bi bi-trash3-fill"></i>
            {{ deletingUser ? "Deleting…" : "Delete" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { AuthService } from "~~/services/AuthService";
import { UserService } from "~~/services/UserService";
import { handleError, EventBus, EventTypes } from "~~/services/EventBus";

export default {
  data() {
    return {
      users: [],
      currentUserId: null,
      showUserModal: false,
      editingUser: null,
      savingUser: false,
      userForm: {
        name: "",
        password: "",
        role: "user",
        scopes: [],
      },
      showDeleteConfirm: false,
      deleteTarget: null,
      deletingUser: false,
    };
  },

  async created() {
    const auth = AuthenticationStore();
    await auth.ensureAuthenticated();
    if (!auth.isAdmin) {
      useRouter().push({ path: "/settings/maintenance" });
      return;
    }
    this.currentUserId = auth.userId;
    await this.loadUsers();
  },

  methods: {
    async loadUsers() {
      try {
        const res = await UserService.list();
        this.users = res.data || [];
      } catch (err) {
        handleError(err);
      }
    },

    resetUserForm() {
      this.userForm = {
        name: "",
        password: "",
        role: "user",
        scopes: [],
      };
    },

    openCreateUser() {
      this.editingUser = null;
      this.resetUserForm();
      this.showUserModal = true;
    },

    openEditUser(user) {
      this.editingUser = user;
      this.userForm = {
        name: user.name,
        password: "",
        role: user.role,
        scopes: user.scopes ? [...user.scopes] : [],
      };
      this.showUserModal = true;
    },

    closeUserModal() {
      this.showUserModal = false;
      this.editingUser = null;
      this.resetUserForm();
    },

    async saveUser() {
      this.savingUser = true;
      try {
        if (this.editingUser) {
          const payload = {
            role: this.userForm.role,
            scopes: this.userForm.scopes,
          };
          if (this.userForm.password) {
            payload.password = this.userForm.password;
          }
          await UserService.update(this.editingUser.id, payload);
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: "User updated",
          });
        } else {
          if (!this.userForm.name || !this.userForm.password) {
            EventBus.emit(EventTypes.ALERT_MESSAGE, {
              type: "error",
              text: "Username and password required",
            });
            this.savingUser = false;
            return;
          }
          await UserService.create({
            name: this.userForm.name,
            password: this.userForm.password,
            role: this.userForm.role,
            scopes: this.userForm.scopes,
          });
          EventBus.emit(EventTypes.ALERT_MESSAGE, {
            type: "info",
            text: "User created",
          });
        }
        this.closeUserModal();
        await this.loadUsers();
      } catch (err) {
        handleError(err);
      } finally {
        this.savingUser = false;
      }
    },

    confirmDeleteUser(user) {
      this.deleteTarget = user;
      this.showDeleteConfirm = true;
    },

    async executeDelete() {
      this.deletingUser = true;
      try {
        await UserService.delete(this.deleteTarget.id);
        EventBus.emit(EventTypes.ALERT_MESSAGE, {
          type: "info",
          text: "User deleted",
        });
        this.showDeleteConfirm = false;
        this.deleteTarget = null;
        await this.loadUsers();
      } catch (err) {
        handleError(err);
      } finally {
        this.deletingUser = false;
      }
    },
  },
};
</script>

<style scoped>
.settings-users-page {
  padding: var(--space-md) 0 var(--space-2xl);
}

.settings-card {
  border: 1px solid var(--color-border, #ddd);
  border-radius: var(--radius-lg, 8px);
  background: var(--color-bg, #fff);
  max-width: 800px;
}

.settings-section {
  padding: 1.2em 1.2em var(--space-compact);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-md);
}

.section-title {
  margin: 0 0 0.15em;
  font-size: var(--font-lg);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--color-text);
}

.section-desc {
  margin: 0 0 var(--space-loose);
  font-size: var(--font-base);
  color: var(--color-text-muted);
}

/* Users Table */
.users-table-wrap {
  overflow-x: auto;
}

.users-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-base);
}

.users-table th,
.users-table td {
  text-align: left;
  padding: var(--space-compact) var(--space-md);
  border-bottom: 1px solid var(--color-border-light);
}

.users-table th {
  font-weight: 600;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.users-table tbody tr:hover {
  background: var(--color-bg-secondary);
}

.col-actions {
  text-align: right;
  white-space: nowrap;
}

.user-name {
  font-weight: 500;
  color: var(--color-text);
}

.badge-self {
  display: inline-block;
  font-size: var(--font-sm);
  padding: 0.1em var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--color-primary-light);
  color: var(--color-primary-text);
  margin-left: var(--space-sm);
  vertical-align: middle;
}

.role-badge {
  display: inline-block;
  font-size: var(--font-md);
  padding: 0.15em var(--space-md);
  border-radius: var(--radius-sm);
  font-weight: 500;
}

.role-admin {
  background: #fce4ec;
  color: var(--color-danger);
}

.role-user {
  background: #e8f5e9;
  color: var(--color-success);
}

.scopes-cell {
  font-size: 0.82em;
  color: var(--color-text-secondary);
}

.scope-text {
  color: var(--color-text-muted);
  font-style: italic;
}

.scope-list {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  white-space: nowrap;
}

.scope-list .bi {
  font-size: var(--font-body);
}

/* Modal */
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-card {
  background: var(--color-bg, #fff);
  border-radius: var(--radius-xl);
  max-width: 480px;
  width: 90vw;
  padding: var(--space-loose) 1.2em;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}

.modal-card--sm {
  max-width: 380px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 0 var(--space-md);
}

.modal-header h3 {
  margin: 0;
  font-size: var(--font-lg);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  color: var(--color-text);
}

.modal-body {
  padding: var(--space-md) 0 var(--space-loose);
}

.modal-body p {
  margin: var(--space-md) 0;
  font-size: var(--font-body);
  color: var(--color-text-secondary);
}

.modal-footer {
  padding: var(--space-base) 0 0;
  display: flex;
  justify-content: flex-end;
  gap: var(--space-md);
}

/* Form fields */
.field-row {
  margin-bottom: var(--space-base);
}

.field-label {
  display: block;
  font-weight: 600;
  font-size: var(--font-base);
  color: var(--color-text-secondary);
  margin-bottom: var(--space-xs);
}

.field-input {
  display: block;
  width: 100%;
  padding: var(--space-md) var(--space-compact);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-body);
  background: var(--color-bg);
  color: var(--color-text-secondary);
  box-sizing: border-box;
}

.radio-group {
  display: flex;
  gap: var(--space-loose);
}

.radio-label {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--font-body);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.checkbox-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--font-body);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.perms-section {
  margin-top: var(--space-xs);
}

.perm-note {
  font-size: 0.82em;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25em var(--space-sm);
  color: var(--color-text-muted);
  border-radius: var(--radius-sm);
  transition: all 0.15s;
}

.icon-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text);
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.icon-btn--danger:hover {
  background: #fce4ec;
  color: var(--color-danger);
}

.empty-state {
  text-align: center;
  padding: var(--space-xl);
  color: var(--color-text-muted);
}
</style>
