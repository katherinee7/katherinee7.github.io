import { createApp, ref, computed, watch, nextTick, onMounted } from "vue";
import {
  createRouter,
  createWebHashHistory,
  useRoute,
  useRouter,
} from "vue-router";

import { GraffitiLocal } from "@graffiti-garden/implementation-local";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import {
  GraffitiPlugin,
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";

const directoryChannel = "group-project-chat";
const profileChannel = "group-project-chat-profiles";
const DEFAULT_GROUPS = ["Announcements", "Questions", "Tasks"];

const GROUP_PALETTE = [
  { bg: "#dbeafe", text: "#1d4ed8" },
  { bg: "#fce7d3", text: "#c2410c" },
  { bg: "#d1fae5", text: "#047857" },
  { bg: "#fde6f2", text: "#be185d" },
  { bg: "#e0e7ff", text: "#4338ca" },
  { bg: "#fef3c7", text: "#b45309" },
  { bg: "#ccfbf1", text: "#0f766e" },
  { bg: "#fce4ec", text: "#ad1457" },
  { bg: "#e8eaf6", text: "#283593" },
  { bg: "#fff3e0", text: "#e65100" },
  { bg: "#e0f2f1", text: "#00695c" },
  { bg: "#f3e5f5", text: "#7b1fa2" },
  { bg: "#e3f2fd", text: "#1565c0" },
  { bg: "#fbe9e7", text: "#bf360c" },
  { bg: "#e8f5e9", text: "#2e7d32" },
];


function userChatChannel(session) {
  return session.value ? `${session.value.actor}/chat-app` : "";
}

async function postJoinChat(graffiti, session, chatChannel) {
  if (!session.value) return;

  await graffiti.post(
    {
      value: {
        activity: "Join",
        type: "Chat",
        target: chatChannel,
        published: Date.now(),
      },
      channels: [userChatChannel(session)],
      allowed: [],
    },
    session.value,
  );
}

function useChats() {
  const { objects: chatObjects, isFirstPoll: areChatsLoading } =
    useGraffitiDiscover(
      [directoryChannel],
      {
        properties: {
          value: {
            required: ["activity", "type", "title", "channel", "published"],
            properties: {
              activity: { const: "Create" },
              type: { const: "Chat" },
              title: { type: "string" },
              channel: { type: "string" },
              published: { type: "number" },
            },
          },
        },
      },
      undefined,
      true,
    );

  const sortedChats = computed(() => {
    return chatObjects.value.toSorted((a, b) => {
      return b.value.published - a.value.published;
    });
  });

  return {
    chatObjects,
    areChatsLoading,
    sortedChats,
  };
}

function useJoinedChats() {
  const session = useGraffitiSession();

  const joinedChannels = computed(() => {
    return session.value ? [userChatChannel(session)] : [];
  });

  const { objects: joinObjects, isFirstPoll: areJoinsLoading } =
    useGraffitiDiscover(
      joinedChannels,
      {
        properties: {
          value: {
            required: ["activity", "type", "target", "published"],
            properties: {
              activity: { const: "Join" },
              type: { const: "Chat" },
              target: { type: "string" },
              published: { type: "number" },
            },
          },
        },
      },
      session,
      true,
    );

  const joinedChatChannels = computed(() => {
    return new Set(joinObjects.value.map((join) => join.value.target));
  });

  function getJoinObjectForChat(chatChannel) {
    return joinObjects.value.find((join) => join.value.target === chatChannel);
  }

  return {
    joinObjects,
    joinedChatChannels,
    getJoinObjectForChat,
    areJoinsLoading,
  };
}

function useProfiles() {
  const { objects: profileObjects } = useGraffitiDiscover(
    [profileChannel],
    {
      properties: {
        value: {
          required: ["type", "displayName"],
          properties: {
            type: { const: "Profile" },
            displayName: { type: "string" },
          },
        },
      },
    },
    undefined,
    true,
  );

  const displayNameMap = computed(() => {
    const map = new Map();
    for (const profile of profileObjects.value) {
      const existing = map.get(profile.actor);
      if (!existing || (profile.value.published || 0) > (existing.value.published || 0)) {
        map.set(profile.actor, profile);
      }
    }
    return map;
  });

  function getDisplayName(actor) {
    const profile = displayNameMap.value.get(actor);
    return profile ? profile.value.displayName : null;
  }

  return { profileObjects, displayNameMap, getDisplayName };
}

const CreateChatForm = {
  props: ["onCreated"],

  template: `
    <form @submit.prevent="createChat" class="inline-create-form">
      <input
        type="text"
        v-model="newChatTitle"
        placeholder="New chat name"
      />

      <button :disabled="!newChatTitle.trim() || isCreatingChat">
        {{ isCreatingChat ? "Creating..." : "Create" }}
      </button>

      <button type="button" class="secondary-btn" @click="$emit('cancel')">
        Cancel
      </button>
    </form>

    <p v-if="!session" class="help-text">
      Log in before creating a chat.
    </p>
  `,

  emits: ["cancel"],

  setup(props) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const router = useRouter();

    const newChatTitle = ref("");
    const isCreatingChat = ref(false);

    async function createChat() {
      if (!newChatTitle.value.trim() || !session.value) return;

      isCreatingChat.value = true;

      try {
        const chatChannel = crypto.randomUUID();

        await graffiti.post(
          {
            value: {
              activity: "Create",
              type: "Chat",
              title: newChatTitle.value.trim(),
              channel: chatChannel,
              published: Date.now(),
            },
            channels: [directoryChannel],
          },
          session.value,
        );

        await postJoinChat(graffiti, session, chatChannel);

        newChatTitle.value = "";

        if (props.onCreated) {
          props.onCreated();
        }

        router.push(`/chat/${encodeURIComponent(chatChannel)}`);
      } finally {
        isCreatingChat.value = false;
      }
    }

    return {
      session,
      newChatTitle,
      isCreatingChat,
      createChat,
    };
  },
};

const MessageBubble = {
  props: [
    "message",
    "session",
    "isDeleting",
    "deleteMessage",
    "editMessage",
    "isEditing",
    "availableGroups",
    "getMessageGroups",
    "updateMessageGroups",
    "isUpdatingGroups",
    "getGroupColor",
    "getDisplayName",
    "selectMode",
    "isSelected",
    "toggleSelect",
  ],

  setup(props) {
    const isMenuOpen = ref(false);
    const isEditingGroups = ref(false);
    const draftGroups = ref([]);
    const isEditingContent = ref(false);
    const editDraft = ref("");

    function toggleMenu() {
      isMenuOpen.value = !isMenuOpen.value;
    }

    function closeMenu() {
      isMenuOpen.value = false;
    }

    function startEditingGroups() {
      draftGroups.value = [...props.getMessageGroups(props.message)];
      isEditingGroups.value = true;
      isMenuOpen.value = false;
    }

    function cancelEditingGroups() {
      draftGroups.value = [];
      isEditingGroups.value = false;
    }

    function toggleDraftGroup(group) {
      if (draftGroups.value.includes(group)) {
        draftGroups.value = draftGroups.value.filter((g) => g !== group);
      } else {
        draftGroups.value = [...draftGroups.value, group];
      }
    }

    async function saveGroups() {
      await props.updateMessageGroups(props.message, [...draftGroups.value]);
      isEditingGroups.value = false;
    }

    async function handleDelete() {
      closeMenu();
      await props.deleteMessage(props.message);
    }

    function startEditingContent() {
      editDraft.value = props.message.value.content;
      isEditingContent.value = true;
      isMenuOpen.value = false;
    }

    function cancelEditingContent() {
      editDraft.value = "";
      isEditingContent.value = false;
    }

    async function saveEditedContent() {
      if (!editDraft.value.trim()) return;
      await props.editMessage(props.message, editDraft.value.trim());
      isEditingContent.value = false;
    }

    return {
      isMenuOpen,
      isEditingGroups,
      draftGroups,
      isEditingContent,
      editDraft,
      toggleMenu,
      closeMenu,
      startEditingGroups,
      cancelEditingGroups,
      toggleDraftGroup,
      saveGroups,
      handleDelete,
      startEditingContent,
      cancelEditingContent,
      saveEditedContent,
    };
  },

  template: `
    <li
      class="message-bubble"
      :class="{
        mine: message.actor === session?.actor,
        selected: selectMode && isSelected,
      }"
      @click="selectMode ? toggleSelect(message) : null"
    >
      <div class="message-topline">
        <div class="message-meta">
          <input
            v-if="selectMode"
            type="checkbox"
            class="select-checkbox"
            :checked="isSelected"
            @click.stop
            @change="toggleSelect(message)"
          />
          <strong>
            <template v-if="getDisplayName(message.actor)">
              {{ getDisplayName(message.actor) }}
            </template>
            <graffiti-actor-to-handle v-else :actor="message.actor"></graffiti-actor-to-handle>
          </strong>

          <span
            v-for="group of getMessageGroups(message)"
            :key="group"
            class="folder-badge"
            :style="{ background: getGroupColor(group).bg, color: getGroupColor(group).text }"
          >
            {{ group }}
          </span>

          <span v-if="message.value.edited" class="edited-indicator">(edited)</span>
        </div>

        <div v-if="!selectMode" class="message-menu-wrapper">
          <button class="menu-dot-btn" @click="toggleMenu">⋯</button>

          <div v-if="isMenuOpen" class="message-menu">
            <button
              v-if="message.actor === session?.actor"
              @click="startEditingContent"
            >
              Edit message
            </button>
            <button @click="startEditingGroups">Edit groups</button>
            <button
              v-if="message.actor === session?.actor"
              @click="handleDelete"
              :disabled="isDeleting.has(message.url)"
              class="danger-menu-btn"
            >
              {{ isDeleting.has(message.url) ? "Deleting..." : "Delete" }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="isEditingContent" class="edit-content-area" @click.stop>
        <textarea
          class="edit-textarea"
          v-model="editDraft"
          rows="3"
        ></textarea>
        <div class="message-actions">
          <button
            @click="saveEditedContent"
            :disabled="isEditing.has(message.url) || !editDraft.trim()"
            class="small-btn"
          >
            {{ isEditing.has(message.url) ? "Saving..." : "Save" }}
          </button>
          <button @click="cancelEditingContent" class="small-btn secondary-btn">
            Cancel
          </button>
        </div>
      </div>

      <div v-else class="message-content">
        {{ message.value.content }}
      </div>

      <div v-if="isEditingGroups" class="group-editor">
        <p class="group-editor-title">Message groups:</p>

        <label
          v-for="group of availableGroups"
          :key="group"
          class="group-checkbox"
        >
          <input
            type="checkbox"
            :checked="draftGroups.includes(group)"
            @change="toggleDraftGroup(group)"
          />
          {{ group }}
        </label>

        <div class="message-actions">
          <button
            @click="saveGroups"
            :disabled="isUpdatingGroups.has(message.url)"
            class="small-btn"
          >
            {{ isUpdatingGroups.has(message.url) ? "Saving..." : "Save" }}
          </button>

          <button @click="cancelEditingGroups" class="small-btn secondary-btn">
            Cancel
          </button>
        </div>
      </div>
    </li>
  `,
};

const MyChatsPage = {
  components: {
    CreateChatForm,
  },

  template: `
    <section class="panel">
      <div class="page-toolbar">
        <p class="page-intro">Chats you have joined.</p>

        <button v-if="!showCreateForm" @click="showCreateForm = true">
          + New Chat
        </button>
      </div>

      <create-chat-form
        v-if="showCreateForm"
        :onCreated="hideCreateForm"
        @cancel="hideCreateForm"
      />

      <p v-if="!session" class="help-text">
        Log in to see your joined chats.
      </p>

      <p v-else-if="areChatsLoading || areJoinsLoading">
        <em>Loading your chats...</em>
      </p>

      <template v-else>
        <ul v-if="myChats.length" class="chat-list">
          <li v-for="chat of myChats" :key="chat.url" class="chat-card">
            <div>
              <h3>{{ chat.value.title }}</h3>
              <p class="meta">
                Created by
                <graffiti-actor-to-handle :actor="chat.actor"></graffiti-actor-to-handle>
              </p>
            </div>

            <div class="chat-card-actions">
              <router-link
                class="button-link"
                :to="'/chat/' + encodeURIComponent(chat.value.channel)"
              >
                Open
              </router-link>

              <button
                v-if="chat.actor === session?.actor"
                class="small-btn leave-btn"
                @click="deleteChat(chat)"
                :disabled="isDeletingChat.has(chat.url)"
              >
                {{ isDeletingChat.has(chat.url) ? "Deleting..." : "Delete" }}
              </button>
            </div>
          </li>
        </ul>

        <div v-else class="empty-state">
          <p>You have not joined any chats yet.</p>
          <router-link class="button-link" to="/discover">
            Discover Chats
          </router-link>
        </div>
      </template>
    </section>
  `,

  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const { sortedChats, areChatsLoading } = useChats();
    const { joinedChatChannels, areJoinsLoading } = useJoinedChats();

    const showCreateForm = ref(false);
    const isDeletingChat = ref(new Set());

    const myChats = computed(() => {
      return sortedChats.value.filter((chat) => {
        return joinedChatChannels.value.has(chat.value.channel);
      });
    });

    function hideCreateForm() {
      showCreateForm.value = false;
    }

    async function deleteChat(chat) {
      if (!session.value) return;

      isDeletingChat.value.add(chat.url);

      try {
        await graffiti.delete(chat, session.value);
      } finally {
        isDeletingChat.value.delete(chat.url);
      }
    }

    return {
      graffiti,
      session,
      myChats,
      areChatsLoading,
      areJoinsLoading,
      showCreateForm,
      hideCreateForm,
      isDeletingChat,
      deleteChat,
    };
  },
};

const DiscoverPage = {
  template: `
    <section class="panel">
      <p class="page-intro">
        Browse public project chats and join the ones you want to keep in My Chats.
      </p>

      <p v-if="areChatsLoading"><em>Loading chats...</em></p>

      <ul v-else-if="sortedChats.length" class="chat-list">
        <li v-for="chat of sortedChats" :key="chat.url" class="chat-card">
          <div>
            <h3>{{ chat.value.title }}</h3>
            <p class="meta">
              Created by
              <graffiti-actor-to-handle :actor="chat.actor"></graffiti-actor-to-handle>
            </p>
          </div>

          <div class="chat-card-actions">
            <template v-if="joinedChatChannels.has(chat.value.channel)">
              <span class="joined-badge">&#10003; Joined</span>

              <button
                class="leave-btn"
                @click="leaveChat(chat)"
                :disabled="isLeaving.has(chat.value.channel)"
              >
                {{ isLeaving.has(chat.value.channel) ? "Leaving..." : "Leave" }}
              </button>
            </template>

            <button
              v-else
              @click="joinChat(chat)"
              :disabled="isJoining.has(chat.value.channel)"
            >
              {{ isJoining.has(chat.value.channel) ? "Joining..." : "Join" }}
            </button>
          </div>
        </li>
      </ul>

      <p v-else>No public chats yet. Create the first one from My Chats.</p>
    </section>
  `,

  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const router = useRouter();

    const { sortedChats, areChatsLoading } = useChats();
    const { joinedChatChannels, getJoinObjectForChat } = useJoinedChats();

    const isJoining = ref(new Set());
    const isLeaving = ref(new Set());

    async function joinChat(chat) {
      if (!session.value) return;

      isJoining.value.add(chat.value.channel);

      try {
        await postJoinChat(graffiti, session, chat.value.channel);
        router.push(`/chat/${encodeURIComponent(chat.value.channel)}`);
      } finally {
        isJoining.value.delete(chat.value.channel);
      }
    }

    async function leaveChat(chat) {
      if (!session.value) return;

      const joinObject = getJoinObjectForChat(chat.value.channel);
      if (!joinObject) return;

      isLeaving.value.add(chat.value.channel);

      try {
        await graffiti.delete(joinObject, session.value);
      } finally {
        isLeaving.value.delete(chat.value.channel);
      }
    }

    return {
      sortedChats,
      areChatsLoading,
      joinedChatChannels,
      isJoining,
      isLeaving,
      joinChat,
      leaveChat,
    };
  },
};

const ChatPage = {
  components: {
    MessageBubble,
  },

  template: `
    <section class="chat-view">
      <div class="chat-header">
        <router-link class="button-link" to="/">
          &larr; My Chats
        </router-link>

        <h2 v-if="currentChat">{{ currentChat.value.title }}</h2>
        <h2 v-else>Chat</h2>
      </div>

      <p v-if="areChatsLoading"><em>Loading chat...</em></p>

      <p v-else-if="!currentChat" class="panel">
        This chat could not be found.
      </p>

      <template v-else>
        <div v-if="activeBroadcast" class="broadcast-box broadcast-active">
          <div class="broadcast-header">
            <strong>&#128226; Live Broadcast</strong>
            <span class="broadcast-author">
              by <graffiti-actor-to-handle :actor="activeBroadcast.actor"></graffiti-actor-to-handle>
            </span>
            <span v-if="activeBroadcast.value.lastEditedBy" class="broadcast-last-edit">
              · last edited by
              <template v-if="getDisplayName(activeBroadcast.value.lastEditedBy)">
                {{ getDisplayName(activeBroadcast.value.lastEditedBy) }}
              </template>
              <graffiti-actor-to-handle v-else :actor="activeBroadcast.value.lastEditedBy"></graffiti-actor-to-handle>
            </span>
            <button
              v-if="session"
              class="broadcast-end-btn"
              @click="endBroadcast"
              :disabled="isEndingBroadcast"
            >
              {{ isEndingBroadcast ? "Ending..." : "End Broadcast" }}
            </button>
          </div>
          <textarea
            class="broadcast-editor"
            v-model="broadcastDraft"
            placeholder="Type important info here..."
          ></textarea>
          <div class="broadcast-actions">
            <button
              class="broadcast-update-btn"
              @click="updateBroadcast"
              :disabled="isUpdatingBroadcast || broadcastDraft === activeBroadcast.value.content"
            >
              {{ isUpdatingBroadcast ? "Updating..." : "Update Broadcast" }}
            </button>
          </div>
        </div>

        <div v-else-if="!activeBroadcast" class="broadcast-box broadcast-idle">
          <p class="broadcast-placeholder">No active broadcast.</p>
        </div>

        <div class="message-tabs">
          <span
            v-for="group of groupsWithAll"
            :key="group"
            class="group-tab-wrapper"
          >
            <button
              @click="selectedGroup = group"
              :class="{ active: selectedGroup === group }"
              :style="group !== 'All' ? { background: getGroupColor(group).bg, color: getGroupColor(group).text, boxShadow: selectedGroup === group ? 'inset 0 0 0 2px ' + getGroupColor(group).text : 'none' } : {}"
            >
              {{ group }}
            </button>
            <button
              v-if="canDeleteGroup(group)"
              class="group-delete-x"
              @click.stop="confirmDeleteGroup(group)"
              title="Delete group"
            >&times;</button>
          </span>

          <button
            v-if="!isAddingGroup"
            @click="isAddingGroup = true"
            class="add-group-btn"
            title="Create new message group"
          >
            +
          </button>

          <form
            v-else
            @submit.prevent="createGroupFromInlineForm"
            class="inline-group-form"
          >
            <input
              type="text"
              v-model="newGroupName"
              placeholder="Group name"
            />

            <button :disabled="!newGroupName.trim() || isCreatingGroup">
              {{ isCreatingGroup ? "Adding..." : "Add" }}
            </button>

            <button
              type="button"
              class="secondary-btn"
              @click="cancelNewGroup"
            >
              Cancel
            </button>
          </form>

          <button
            v-if="session"
            class="select-mode-btn"
            :class="{ active: selectMode }"
            @click="toggleSelectMode"
          >
            {{ selectMode ? "Cancel Select" : "Select" }}
          </button>
        </div>

        <div v-if="selectMode && selectedMessages.size > 0" class="bulk-toolbar">
          <span class="bulk-count">{{ selectedMessages.size }} selected</span>

          <div class="bulk-actions">
            <div class="bulk-group-picker">
              <select v-model="bulkGroupTarget">
                <option value="" disabled>Assign to group...</option>
                <option v-for="group of availableGroups" :key="group" :value="group">
                  {{ group }}
                </option>
              </select>
              <button
                @click="bulkAssignGroup"
                :disabled="!bulkGroupTarget || isBulkUpdating"
                class="small-btn"
              >
                {{ isBulkUpdating ? "Assigning..." : "Assign" }}
              </button>
            </div>

            <button
              class="small-btn leave-btn"
              @click="bulkDeleteMessages"
              :disabled="isBulkDeleting"
            >
              {{ isBulkDeleting ? "Deleting..." : "Delete Selected" }}
            </button>
          </div>
        </div>

        <div v-if="groupToDelete" class="delete-group-confirm">
          <p>Delete group <strong>"{{ groupToDelete }}"</strong>?</p>
          <div class="delete-group-actions">
            <button class="leave-btn" @click="executeDeleteGroup" :disabled="isDeletingGroup">
              {{ isDeletingGroup ? "Deleting..." : "Delete" }}
            </button>
            <button class="secondary-btn" @click="groupToDelete = null">Cancel</button>
          </div>
        </div>

        <div class="messages" ref="messagesContainer">
          <p v-if="areMessagesLoading"><em>Loading messages...</em></p>

          <template v-else>
            <ul v-if="visibleMessages.length" class="message-list">
              <message-bubble
                v-for="message of visibleMessages"
                :key="message.url"
                :message="message"
                :session="$graffitiSession.value"
                :isDeleting="isDeleting"
                :deleteMessage="deleteMessage"
                :editMessage="editMessage"
                :isEditing="isEditing"
                :availableGroups="availableGroups"
                :getMessageGroups="getMessageGroups"
                :updateMessageGroups="updateMessageGroups"
                :isUpdatingGroups="isUpdatingGroups"
                :getGroupColor="getGroupColor"
                :getDisplayName="getDisplayName"
                :selectMode="selectMode"
                :isSelected="selectedMessages.has(message.url)"
                :toggleSelect="toggleMessageSelect"
              />
            </ul>

            <p v-else class="empty-folder">
              No messages in this group yet.
            </p>
          </template>
        </div>

        <div class="message-form-row">
          <button
            v-if="!activeBroadcast && session"
            class="broadcast-start-btn"
            @click="startBroadcast"
            :disabled="isStartingBroadcast"
          >
            {{ isStartingBroadcast ? "Starting..." : "&#128226; Broadcast" }}
          </button>

          <form @submit.prevent="sendMessage" class="message-form">
            <input
              type="text"
              v-model="myMessage"
              placeholder="Type your message"
            />

            <button :disabled="!myMessage.trim() || isSending" :class="{ 'send-success': sendSuccess }">
              {{ isSending ? "Sending..." : "Send" }}
            </button>
          </form>
        </div>

        <p class="group-hint">
          Tip: use <code>/groupname</code> to tag a message, e.g. <code>/announcements meeting at 3pm</code>
        </p>

        <p v-if="!session" class="help-text">
          Log in before sending a message.
        </p>
      </template>
    </section>
  `,

  setup() {
    const route = useRoute();
    const graffiti = useGraffiti();
    const session = useGraffitiSession();

    const { chatObjects, areChatsLoading } = useChats();
    const { getDisplayName } = useProfiles();

    const chatId = computed(() => {
      return decodeURIComponent(route.params.chatId);
    });

    const currentChat = computed(() => {
      return chatObjects.value.find((chat) => {
        return chat.value.channel === chatId.value;
      });
    });

    const activeMessageChannels = computed(() => {
      return currentChat.value ? [currentChat.value.value.channel] : [];
    });

    const { objects: messageObjects, isFirstPoll: areMessagesLoading } =
      useGraffitiDiscover(
        activeMessageChannels,
        {
          properties: {
            value: {
              required: ["type", "content", "published"],
              properties: {
                type: { const: "Message" },
                content: { type: "string" },
                folder: { type: "string" },
                folders: {
                  type: "array",
                  items: { type: "string" },
                },
                groups: {
                  type: "array",
                  items: { type: "string" },
                },
                published: { type: "number" },
                edited: { type: "boolean" },
              },
            },
          },
        },
        undefined,
        true,
      );

    const { objects: groupObjects } = useGraffitiDiscover(
      activeMessageChannels,
      {
        properties: {
          value: {
            required: ["type", "name", "published"],
            properties: {
              type: { const: "MessageGroup" },
              name: { type: "string" },
              published: { type: "number" },
            },
          },
        },
      },
      undefined,
      true,
    );

    const { objects: groupUpdateObjects } = useGraffitiDiscover(
      activeMessageChannels,
      {
        properties: {
          value: {
            required: ["type", "messageUrl", "groups", "published"],
            properties: {
              type: { const: "MessageGroupsUpdate" },
              messageUrl: { type: "string" },
              groups: {
                type: "array",
                items: { type: "string" },
              },
              published: { type: "number" },
            },
          },
        },
      },
      undefined,
      true,
    );

    const { objects: groupDeletionObjects } = useGraffitiDiscover(
      activeMessageChannels,
      {
        properties: {
          value: {
            required: ["type", "name", "published"],
            properties: {
              type: { const: "GroupDeletion" },
              name: { type: "string" },
              published: { type: "number" },
            },
          },
        },
      },
      undefined,
      true,
    );

    const deletedGroupNames = computed(() => {
      const deleted = new Set();
      for (const del of groupDeletionObjects.value) {
        deleted.add(del.value.name);
      }
      return deleted;
    });

    function getOriginalMessageGroups(message) {
      if (Array.isArray(message.value.groups)) {
        return message.value.groups;
      }

      if (Array.isArray(message.value.folders)) {
        return message.value.folders;
      }

      if (message.value.folder) {
        return [message.value.folder];
      }

      return [];
    }

    const customGroups = computed(() => {
      return groupObjects.value
        .map((group) => group.value.name)
        .filter((name) => name && name.trim())
        .map((name) => name.trim());
    });

    const latestGroupUpdates = computed(() => {
      const updatesByMessage = new Map();

      for (const update of groupUpdateObjects.value) {
        const previous = updatesByMessage.get(update.value.messageUrl);

        if (!previous || update.value.published > previous.value.published) {
          updatesByMessage.set(update.value.messageUrl, update);
        }
      }

      return updatesByMessage;
    });

    function getMessageGroups(message) {
      let groups;
      const latestUpdate = latestGroupUpdates.value.get(message.url);

      if (latestUpdate) {
        groups = latestUpdate.value.groups;
      } else {
        groups = getOriginalMessageGroups(message);
      }

      return groups.filter((g) => !deletedGroupNames.value.has(g));
    }

    const availableGroups = computed(() => {
      const groupSet = new Set(DEFAULT_GROUPS);

      for (const group of customGroups.value) {
        groupSet.add(group);
      }

      for (const message of messageObjects.value) {
        for (const group of getOriginalMessageGroups(message)) {
          groupSet.add(group);
        }
      }

      for (const update of groupUpdateObjects.value) {
        for (const group of update.value.groups || []) {
          groupSet.add(group);
        }
      }

      for (const name of deletedGroupNames.value) {
        groupSet.delete(name);
      }

      return [...groupSet].toSorted();
    });

    const groupsWithAll = computed(() => {
      return ["All", ...availableGroups.value];
    });

    const groupColorMap = computed(() => {
      const map = new Map();
      for (let i = 0; i < availableGroups.value.length; i++) {
        map.set(availableGroups.value[i], GROUP_PALETTE[i % GROUP_PALETTE.length]);
      }
      return map;
    });

    function getGroupColor(name) {
      return groupColorMap.value.get(name) || GROUP_PALETTE[0];
    }

    const selectedGroup = ref("All");

    const sortedMessages = computed(() => {
      return messageObjects.value.toSorted((a, b) => {
        return a.value.published - b.value.published;
      });
    });

    const visibleMessages = computed(() => {
      if (selectedGroup.value === "All") {
        return sortedMessages.value;
      }

      return sortedMessages.value.filter((message) => {
        return getMessageGroups(message).includes(selectedGroup.value);
      });
    });

    const messagesContainer = ref(null);

    function scrollToBottom() {
      nextTick(() => {
        const el = messagesContainer.value;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    }

    watch(
      () => visibleMessages.value.length,
      () => scrollToBottom(),
    );

    onMounted(() => scrollToBottom());

    const isAddingGroup = ref(false);
    const newGroupName = ref("");
    const isCreatingGroup = ref(false);

    async function createGroup(groupName) {
      if (!groupName || !session.value || !currentChat.value) return;

      isCreatingGroup.value = true;

      try {
        await graffiti.post(
          {
            value: {
              type: "MessageGroup",
              name: groupName,
              published: Date.now(),
            },
            channels: [currentChat.value.value.channel],
          },
          session.value,
        );

        selectedGroup.value = groupName;
        newGroupName.value = "";
        isAddingGroup.value = false;
      } finally {
        isCreatingGroup.value = false;
      }
    }

    async function createGroupFromInlineForm() {
      const cleaned = newGroupName.value.trim();

      if (!cleaned) return;

      await createGroup(cleaned);
    }

    function cancelNewGroup() {
      newGroupName.value = "";
      isAddingGroup.value = false;
    }

    const groupToDelete = ref(null);
    const isDeletingGroup = ref(false);

    function canDeleteGroup(group) {
      return group !== "All";
    }

    function confirmDeleteGroup(group) {
      groupToDelete.value = group;
    }

    async function executeDeleteGroup() {
      if (!session.value || !groupToDelete.value || !currentChat.value) return;

      isDeletingGroup.value = true;

      try {
        await graffiti.post(
          {
            value: {
              type: "GroupDeletion",
              name: groupToDelete.value,
              published: Date.now(),
            },
            channels: [currentChat.value.value.channel],
          },
          session.value,
        );

        const groupObj = groupObjects.value.find(
          (g) => g.value.name === groupToDelete.value
        );
        if (groupObj) {
          try { await graffiti.delete(groupObj, session.value); } catch {}
        }

        if (selectedGroup.value === groupToDelete.value) {
          selectedGroup.value = "All";
        }

        groupToDelete.value = null;
      } finally {
        isDeletingGroup.value = false;
      }
    }

    const myMessage = ref("");
    const isSending = ref(false);
    const sendSuccess = ref(false);

    function parseGroupTags(text) {
      const matchedGroups = [];
      let content = text;

      const groupNames = availableGroups.value.map((g) => g.toLowerCase());

      const slashPattern = /\/(\S+)/g;
      let match;
      const tokensToRemove = [];

      while ((match = slashPattern.exec(text)) !== null) {
        const candidate = match[1].toLowerCase();
        const idx = groupNames.indexOf(candidate);
        if (idx !== -1) {
          matchedGroups.push(availableGroups.value[idx]);
          tokensToRemove.push(match[0]);
        }
      }

      for (const token of tokensToRemove) {
        content = content.replace(token, "");
      }

      return { content: content.trim(), groups: [...new Set(matchedGroups)] };
    }

    async function sendMessage() {
      if (!myMessage.value.trim() || !session.value || !currentChat.value) {
        return;
      }

      isSending.value = true;

      try {
        const { content, groups } = parseGroupTags(myMessage.value.trim());

        await graffiti.post(
          {
            value: {
              type: "Message",
              content: content || myMessage.value.trim(),
              groups,
              published: Date.now(),
            },
            channels: [currentChat.value.value.channel],
          },
          session.value,
        );

        myMessage.value = "";
        sendSuccess.value = true;
        setTimeout(() => { sendSuccess.value = false; }, 400);
      } finally {
        isSending.value = false;
      }
    }

    const isUpdatingGroups = ref(new Set());

    async function updateMessageGroups(message, groups) {
      if (!session.value || !currentChat.value) return;

      isUpdatingGroups.value.add(message.url);

      try {
        await graffiti.post(
          {
            value: {
              type: "MessageGroupsUpdate",
              messageUrl: message.url,
              groups,
              published: Date.now(),
            },
            channels: [currentChat.value.value.channel],
          },
          session.value,
        );
      } finally {
        isUpdatingGroups.value.delete(message.url);
      }
    }

    const isDeleting = ref(new Set());

    async function deleteMessage(message) {
      isDeleting.value.add(message.url);

      try {
        await graffiti.delete(message, session.value);
      } finally {
        isDeleting.value.delete(message.url);
      }
    }

    const isEditing = ref(new Set());

    async function editMessage(message, newContent) {
      if (!session.value || !currentChat.value) return;
      isEditing.value.add(message.url);
      try {
        await graffiti.patch(
          { value: { content: newContent, edited: true } },
          message,
          session.value,
        );
      } catch (e) {
        console.warn("Patch failed for edit, falling back to post+delete", e);
        const oldMsg = message;
        await graffiti.post(
          {
            value: {
              ...oldMsg.value,
              content: newContent,
              edited: true,
            },
            channels: [currentChat.value.value.channel],
          },
          session.value,
        );
        try { await graffiti.delete(oldMsg, session.value); } catch {}
      } finally {
        isEditing.value.delete(message.url);
      }
    }

    const selectMode = ref(false);
    const selectedMessages = ref(new Set());
    const bulkGroupTarget = ref("");
    const isBulkUpdating = ref(false);
    const isBulkDeleting = ref(false);

    function toggleSelectMode() {
      selectMode.value = !selectMode.value;
      if (!selectMode.value) {
        selectedMessages.value = new Set();
        bulkGroupTarget.value = "";
      }
    }

    function toggleMessageSelect(message) {
      const next = new Set(selectedMessages.value);
      if (next.has(message.url)) {
        next.delete(message.url);
      } else {
        next.add(message.url);
      }
      selectedMessages.value = next;
    }

    async function bulkAssignGroup() {
      if (!bulkGroupTarget.value || !session.value || !currentChat.value) return;
      isBulkUpdating.value = true;
      try {
        for (const msg of visibleMessages.value) {
          if (!selectedMessages.value.has(msg.url)) continue;
          const current = getMessageGroups(msg);
          if (!current.includes(bulkGroupTarget.value)) {
            await updateMessageGroups(msg, [...current, bulkGroupTarget.value]);
          }
        }
        selectedMessages.value = new Set();
        bulkGroupTarget.value = "";
      } finally {
        isBulkUpdating.value = false;
      }
    }

    async function bulkDeleteMessages() {
      if (!session.value) return;
      isBulkDeleting.value = true;
      try {
        for (const msg of visibleMessages.value) {
          if (!selectedMessages.value.has(msg.url)) continue;
          if (msg.actor === session.value.actor) {
            await graffiti.delete(msg, session.value);
          }
        }
        selectedMessages.value = new Set();
      } finally {
        isBulkDeleting.value = false;
      }
    }

    // --- Broadcast feature ---
    const { objects: broadcastObjects } = useGraffitiDiscover(
      activeMessageChannels,
      {
        properties: {
          value: {
            required: ["type", "content", "published"],
            properties: {
              type: { const: "Broadcast" },
              content: { type: "string" },
              published: { type: "number" },
              lastEditedBy: { type: "string" },
            },
          },
        },
      },
      undefined,
      true,
    );

    const activeBroadcast = computed(() => {
      if (!broadcastObjects.value.length) return null;
      return broadcastObjects.value.toSorted(
        (a, b) => b.value.published - a.value.published
      )[0];
    });

    const isStartingBroadcast = ref(false);
    const isEndingBroadcast = ref(false);
    const isUpdatingBroadcast = ref(false);
    const broadcastDraft = ref("");
    const loadedBroadcastUrl = ref(null);

    watch(activeBroadcast, (bc) => {
      if (bc) {
        if (bc.url !== loadedBroadcastUrl.value) {
          broadcastDraft.value = bc.value.content;
          loadedBroadcastUrl.value = bc.url;
        }
      } else {
        broadcastDraft.value = "";
        loadedBroadcastUrl.value = null;
      }
    }, { immediate: true });

    async function startBroadcast() {
      if (!session.value || !currentChat.value) return;

      isStartingBroadcast.value = true;

      try {
        await graffiti.post(
          {
            value: {
              type: "Broadcast",
              content: "",
              published: Date.now(),
            },
            channels: [currentChat.value.value.channel],
          },
          session.value,
        );
      } finally {
        isStartingBroadcast.value = false;
      }
    }

    async function updateBroadcast() {
      if (!session.value || !activeBroadcast.value || !currentChat.value) return;

      isUpdatingBroadcast.value = true;

      try {
        await graffiti.patch(
          { value: { content: broadcastDraft.value, lastEditedBy: session.value.actor } },
          activeBroadcast.value,
          session.value,
        );
      } catch (e) {
        console.warn("Broadcast patch failed, falling back to post+delete", e);
        const oldBroadcast = activeBroadcast.value;
        await graffiti.post(
          {
            value: {
              type: "Broadcast",
              content: broadcastDraft.value,
              lastEditedBy: session.value.actor,
              published: Date.now(),
            },
            channels: [currentChat.value.value.channel],
          },
          session.value,
        );
        try { await graffiti.delete(oldBroadcast, session.value); } catch {}
      } finally {
        isUpdatingBroadcast.value = false;
      }
    }

    async function endBroadcast() {
      if (!session.value || !activeBroadcast.value) return;

      isEndingBroadcast.value = true;

      try {
        await graffiti.delete(activeBroadcast.value, session.value);
      } finally {
        isEndingBroadcast.value = false;
      }
    }

    return {
      session,
      currentChat,
      areChatsLoading,
      areMessagesLoading,

      availableGroups,
      groupsWithAll,
      selectedGroup,

      isAddingGroup,
      newGroupName,
      isCreatingGroup,
      createGroupFromInlineForm,
      cancelNewGroup,

      getGroupColor,
      getDisplayName,
      canDeleteGroup,
      confirmDeleteGroup,
      groupToDelete,
      isDeletingGroup,
      executeDeleteGroup,

      visibleMessages,
      messagesContainer,
      getMessageGroups,
      updateMessageGroups,
      isUpdatingGroups,

      myMessage,
      isSending,
      sendSuccess,
      isDeleting,
      sendMessage,
      deleteMessage,

      editMessage,
      isEditing,

      selectMode,
      selectedMessages,
      toggleSelectMode,
      toggleMessageSelect,
      bulkGroupTarget,
      isBulkUpdating,
      isBulkDeleting,
      bulkAssignGroup,
      bulkDeleteMessages,

      activeBroadcast,
      broadcastDraft,
      isStartingBroadcast,
      isEndingBroadcast,
      isUpdatingBroadcast,
      startBroadcast,
      updateBroadcast,
      endBroadcast,
    };
  },
};

const ProfilePage = {
  template: `
    <section class="panel">
      <h2>Your Profile</h2>

      <p v-if="!session" class="help-text">
        Log in to set your display name.
      </p>

      <template v-else>
        <div class="profile-field">
          <label for="display-name">Display Name</label>
          <div class="profile-input-row">
            <input
              id="display-name"
              type="text"
              v-model="draftName"
              placeholder="Enter a display name"
            />
            <button
              @click="saveName"
              :disabled="isSaving || !draftName.trim() || draftName.trim() === currentName"
            >
              {{ isSaving ? "Saving..." : "Save" }}
            </button>
          </div>
        </div>

        <p v-if="currentName" class="profile-current">
          Currently displayed as: <strong>{{ currentName }}</strong>
        </p>
        <p v-else class="help-text">
          You haven't set a display name yet. Others will see your account handle.
        </p>
      </template>
    </section>
  `,

  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const { profileObjects, displayNameMap } = useProfiles();

    const draftName = ref("");
    const isSaving = ref(false);

    const myProfile = computed(() => {
      if (!session.value) return null;
      return displayNameMap.value.get(session.value.actor) || null;
    });

    const currentName = computed(() => {
      return myProfile.value ? myProfile.value.value.displayName : "";
    });

    watch(currentName, (name) => {
      if (name) draftName.value = name;
    }, { immediate: true });

    async function saveName() {
      if (!session.value || !draftName.value.trim()) return;

      isSaving.value = true;

      try {
        if (myProfile.value) {
          try {
            await graffiti.patch(
              { value: { displayName: draftName.value.trim(), published: Date.now() } },
              myProfile.value,
              session.value,
            );
          } catch {
            await graffiti.post(
              {
                value: {
                  type: "Profile",
                  displayName: draftName.value.trim(),
                  published: Date.now(),
                },
                channels: [profileChannel],
              },
              session.value,
            );
            try { await graffiti.delete(myProfile.value, session.value); } catch {}
          }
        } else {
          await graffiti.post(
            {
              value: {
                type: "Profile",
                displayName: draftName.value.trim(),
                published: Date.now(),
              },
              channels: [profileChannel],
            },
            session.value,
          );
        }
      } finally {
        isSaving.value = false;
      }
    }

    return {
      session,
      draftName,
      isSaving,
      currentName,
      saveName,
    };
  },
};

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: MyChatsPage },
    { path: "/discover", component: DiscoverPage },
    { path: "/newchat", component: MyChatsPage },
    { path: "/chat/:chatId", component: ChatPage },
    { path: "/profile", component: ProfilePage },
  ],
});

const App = {
  template: "#template",
};

createApp(App)
  .use(router)
  .use(GraffitiPlugin, {
    // Use this for local testing:
    // graffiti: new GraffitiLocal(),

    // Use this for submitted/shared version:
    graffiti: new GraffitiDecentralized(),
  })
  .mount("#app");
