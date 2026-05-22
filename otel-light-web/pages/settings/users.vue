<template>
  <div id="settings-page">
    <SettingsNavigation />
    <h3>User Management</h3>
    <div class="settings-users-content">
      <button @click="openCreateUser()" style="margin-bottom: 1rem">
        <i class="bi bi-person-plus"></i> Create User
      </button>

      <figure v-if="users.length > 0">
        <table>
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
                <span v-if="u.id === currentUserId" class="badge badge-self"
                  >You</span
                >
              </td>
              <td>
                <span
                  class="badge"
                  :class="u.role === 'admin' ? 'badge-admin' : 'badge-user'"
                  >{{ u.role }}</span
                >
              </td>
              <td class="scopes-cell">
                <span v-if="u.role === 'admin'" class="scope-all"
                  >All scopes</span
                >
                <span v-else class="scope-list">
                  <i
                    class="bi"
                    :class="
                      u.scopes?.includes('traces')
                        ? 'bi-check-circle-fill scope-yes'
                        : 'bi-x-circle-fill scope-no'
                    "
                  ></i>
                  Traces
                  <i
                    class="bi"
                    :class="
                      u.scopes?.includes('metrics')
                        ? 'bi-check-circle-fill scope-yes'
                        : 'bi-x-circle-fill scope-no'
                    "
                  ></i>
                  Metrics
                  <i
                    class="bi"
                    :class="
                      u.scopes?.includes('logs')
                        ? 'bi-check-circle-fill scope-yes'
                        : 'bi-x-circle-fill scope-no'
                    "
                  ></i>
                  Logs
                </span>
              </td>
              <td class="col-actions">
                <button class="icon-btn" title="Edit" @click="openEditUser(u)">
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
      </figure>
      <div v-else class="empty-state">
        <i class="bi bi-people"></i>
        <p>No users found.</p>
      </div>
    </div>
  </div>

  <!-- CREATE/EDIT USER MODAL -->
  <dialog
    v-if="showUserModal"
    :open="showUserModal"
    @click.self="closeUserModal"
  >
    <article>
      <header>
        <button aria-label="Close" rel="prev" @click="closeUserModal"></button>
        <h3>
          <i
            :class="editingUser ? 'bi bi-pencil-fill' : 'bi bi-person-plus'"
          ></i>
          {{ editingUser ? "Edit User" : "Create User" }}
        </h3>
      </header>
      <label>
        Username
        <input
          type="text"
          v-model="userForm.name"
          placeholder="Enter username"
          :disabled="!!editingUser"
        />
      </label>
      <label>
        {{
          editingUser
            ? "New Password (leave blank to keep current)"
            : "Password"
        }}
        <input
          type="password"
          v-model="userForm.password"
          :placeholder="editingUser ? 'Leave blank to keep' : 'Enter password'"
        />
      </label>
      <fieldset>
        <legend>Role</legend>
        <label
          ><input type="radio" v-model="userForm.role" value="user" />
          User</label
        >
        <label
          ><input type="radio" v-model="userForm.role" value="admin" />
          Admin</label
        >
      </fieldset>
      <div v-if="userForm.role !== 'admin'">
        <fieldset>
          <legend>Scopes</legend>
          <label
            ><input type="checkbox" v-model="userForm.scopes" value="traces" />
            Traces</label
          >
          <label
            ><input type="checkbox" v-model="userForm.scopes" value="metrics" />
            Metrics</label
          >
          <label
            ><input type="checkbox" v-model="userForm.scopes" value="logs" />
            Logs</label
          >
        </fieldset>
      </div>
      <div v-else>
        <small
          ><i class="bi bi-info-circle-fill"></i> Admins have all scopes by
          default.</small
        >
      </div>
      <footer>
        <button class="secondary" @click="closeUserModal">Cancel</button>
        <button :disabled="savingUser" @click="saveUser">
          <i class="bi bi-check-lg"></i> {{ savingUser ? "Saving…" : "Save" }}
        </button>
      </footer>
    </article>
  </dialog>

  <!-- DELETE CONFIRM MODAL -->
  <dialog
    v-if="showDeleteConfirm"
    :open="showDeleteConfirm"
    @click.self="showDeleteConfirm = false"
  >
    <article>
      <header>
        <button
          aria-label="Close"
          rel="prev"
          @click="showDeleteConfirm = false"
        ></button>
        <h3><i class="bi bi-exclamation-triangle-fill"></i> Delete User</h3>
      </header>
      <p>
        Are you sure you want to delete user
        <strong>{{ deleteTarget?.name }}</strong
        >?
      </p>
      <p>This action cannot be undone.</p>
      <footer>
        <button class="secondary" @click="showDeleteConfirm = false">
          Cancel
        </button>
        <button
          class="contrast"
          :disabled="deletingUser"
          @click="executeDelete"
        >
          <i class="bi bi-trash3-fill"></i>
          {{ deletingUser ? "Deleting…" : "Delete" }}
        </button>
      </footer>
    </article>
  </dialog>
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
#settings-page {
  display: grid;
  grid-template-rows: auto auto 1fr;
  height: 100%;
}

.settings-users-content {
  max-width: 100%;
  overflow-x: auto;
}

.col-actions {
  text-align: right;
  white-space: nowrap;
}

.badge {
  display: inline-block;
  font-size: 0.75em;
  padding: 0.1em 0.5em;
  border-radius: var(--pico-border-radius);
  vertical-align: middle;
  font-weight: 600;
}

.badge-self {
  color: var(--pico-primary);
  background: color-mix(in srgb, var(--pico-primary) 15%, transparent);
  margin-left: 0.4em;
}

.badge-admin {
  color: var(--pico-del-color);
  background: color-mix(in srgb, var(--pico-del-color) 15%, transparent);
}

.badge-user {
  color: var(--pico-ins-color);
  background: color-mix(in srgb, var(--pico-ins-color) 15%, transparent);
}

.scopes-cell {
  font-size: 0.85em;
}

.scope-all {
  font-style: italic;
  opacity: 0.7;
}

.scope-list {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  white-space: nowrap;
}

.scope-yes {
  color: var(--pico-ins-color);
}

.scope-no {
  color: var(--pico-muted-color);
}

.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25em 0.5em;
  color: var(--pico-muted-color);
  border-radius: var(--pico-border-radius);
  transition: all 0.15s;
}

.icon-btn:hover {
  background: var(--pico-card-sectioning-background-color);
  color: var(--pico-color);
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.icon-btn--danger:hover {
  background: color-mix(in srgb, var(--pico-del-color) 15%, transparent);
  color: var(--pico-del-color);
}

.empty-state {
  text-align: center;
  padding: 2rem;
  opacity: 0.6;
}
</style>
