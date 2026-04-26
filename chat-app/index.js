import { createApp, ref, computed } from "vue";
import { GraffitiLocal } from "@graffiti-garden/implementation-local";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import {
  GraffitiPlugin,
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";

function setup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();

  const directoryChannel = "group-project-chat";

  // App state
  const selectedChat = ref(null);

  // Form state
  const newChatTitle = ref("");
  const myMessage = ref("");

  // -------------------------
  // Discover all created chats
  // -------------------------
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

  // -------------------------
  // Discover messages for selected chat
  // -------------------------
  const activeMessageChannels = computed(() => {
    return selectedChat.value ? [selectedChat.value.value.channel] : [];
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
              published: { type: "number" },
            },
          },
        },
      },
      undefined,
      true,
    );

  const sortedMessages = computed(() => {
    return messageObjects.value.toSorted((a, b) => {
      return a.value.published - b.value.published;
    });
  });

  // -------------------------
  // Create chat
  // -------------------------
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

      newChatTitle.value = "";
    } finally {
      isCreatingChat.value = false;
    }
  }

  // -------------------------
  // Join chat (private memory of joined chats)
  // -------------------------
  async function joinChat(chatObject) {
    selectedChat.value = chatObject;

    if (!session.value) return;

    try {
      await graffiti.post(
        {
          value: {
            activity: "Join",
            type: "Chat",
            target: chatObject.value.channel,
            published: Date.now(),
          },
          channels: [`${session.value.actor}/chat-app`],
          allowed: [],
        },
        session.value,
      );
    } catch (e) {
      console.error("Failed to persist join action", e);
    }
  }

  function leaveChat() {
    selectedChat.value = null;
    myMessage.value = "";
  }

  // -------------------------
  // Send message
  // -------------------------
  const isSending = ref(false);

  async function sendMessage() {
    if (!myMessage.value.trim() || !session.value || !selectedChat.value) return;

    isSending.value = true;
    try {
      await graffiti.post(
        {
          value: {
            type: "Message",
            content: myMessage.value.trim(),
            published: Date.now(),
          },
          channels: [selectedChat.value.value.channel],
        },
        session.value,
      );

      myMessage.value = "";
    } finally {
      isSending.value = false;
    }
  }

  // -------------------------
  // Delete message
  // -------------------------
  const isDeleting = ref(new Set());

  async function deleteMessage(message) {
    isDeleting.value.add(message.url);
    try {
      await graffiti.delete(message, session.value);
    } finally {
      isDeleting.value.delete(message.url);
    }
  }

  return {
    session,
    selectedChat,
    newChatTitle,
    myMessage,

    areChatsLoading,
    sortedChats,

    areMessagesLoading,
    sortedMessages,

    isCreatingChat,
    isSending,
    isDeleting,

    createChat,
    joinChat,
    leaveChat,
    sendMessage,
    deleteMessage,
  };
}

const App = {
  template: "#template",
  setup,
};

createApp(App)
  .use(GraffitiPlugin, {
    // graffiti: new GraffitiLocal(),
    graffiti: new GraffitiDecentralized(),
  })
  .mount("#app");
