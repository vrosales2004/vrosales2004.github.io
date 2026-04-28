import { createApp, computed, ref } from "vue";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import {
  GraffitiPlugin,
  useGraffiti,
  useGraffitiDiscover,
  useGraffitiSession,
} from "@graffiti-garden/wrapper-vue";

const DIRECTORY_CHANNEL = "location-im-directory-v2";
const CURRENT_LOCATION = "Dorm";
const LOCATION_ORDER = ["Dorm", "MIT", "Home"];

function setup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();

  const newFriendLocation = ref("Dorm");
  const newFriendActor = ref("");
  const activeChatId = ref("");
  const activeOtherActor = ref("");
  const activeChatLocation = ref("");
  const activeChatMemberActors = ref([]);
  const draftMessage = ref("");

  const isCreatingChannel = ref(false);
  const isJoiningChat = ref(false);
  const isSendingMessage = ref(false);
  const didCopyActorId = ref(false);

  // generalized graffiti posting function for future actions
  async function postChatAction(action, data = {}) {
    if (!session.value) return;

    await graffiti.post(
      {
        value: {
          app: "location-im",
          object: "chat-action",
          action,
          published: Date.now(),
          ...data,
        },
        channels: [DIRECTORY_CHANNEL],
      },
      session.value,
    );
  }

  // creates a new channel between current actor and friend
  async function createFriendChannel() {
    if (!session.value || !newFriendActor.value.trim()) return;
    isCreatingChannel.value = true;
    const friendActor = newFriendActor.value.trim();

    const channel = {
      chatId: crypto.randomUUID(),
      chatLocation: newFriendLocation.value || "Dorm",
      memberActors: [session.value.actor, friendActor],
    };

    try {
      await postChatAction("create", channel);
      activeChatId.value = channel.chatId;
      activeOtherActor.value = friendActor;
      activeChatLocation.value = channel.chatLocation;
      activeChatMemberActors.value = channel.memberActors;
      newFriendLocation.value = "Dorm";
      newFriendActor.value = "";
    } finally {
      isCreatingChannel.value = false;
    }
  }

  // joins a friend chat
  async function joinChat(chat) {
    if (!session.value || !chat.memberActors?.includes(session.value.actor)) return;
    isJoiningChat.value = true;
    try {
      await postChatAction("join", {
        chatId: chat.chatId,
        chatLocation: chat.chatLocation,
        memberActors: chat.memberActors,
      });
      activeChatId.value = chat.chatId;
      activeOtherActor.value = getOtherActor(chat);
      activeChatLocation.value = chat.chatLocation;
      activeChatMemberActors.value = chat.memberActors || [];
    } finally {
      isJoiningChat.value = false;
    }
  }

  // participates (sends) a message in the current active chat
  async function sendMessage() {
    if (!session.value || !activeChatId.value || !draftMessage.value.trim()) return;
    isSendingMessage.value = true;
    try {
      await postChatAction("participate", {
        chatId: activeChatId.value,
        chatLocation: activeChatLocation.value,
        memberActors: activeChatMemberActors.value,
        content: draftMessage.value.trim(),
      });
      draftMessage.value = "";
    } finally {
      isSendingMessage.value = false;
    }
  }

  // helper function to get other actor in a chat
  function getOtherActor(chat) {
    const myActor = session.value?.actor;
    if (!myActor || !Array.isArray(chat.memberActors)) return "";
    return chat.memberActors.find((actor) => actor !== myActor) || "";
  }

  // closes the chat screen on the front end
  function closeActiveChat() {
    activeChatId.value = "";
    activeOtherActor.value = "";
    activeChatLocation.value = "";
    activeChatMemberActors.value = [];
  }

  // copies the current actor id for easy sharing
  async function copyMyActorId() {
    const actorId = session.value?.actor;
    if (!actorId) return;
    await navigator.clipboard.writeText(actorId);
    didCopyActorId.value = true;
    setTimeout(() => {
      didCopyActorId.value = false;
    }, 1500);
  }

  // discovery
  const { objects: actionObjects, isFirstPoll: areActionsLoading } = useGraffitiDiscover(
    () => [DIRECTORY_CHANNEL],
    {
      properties: {
        value: {
          required: ["app", "object", "action", "chatId", "published"],
          properties: {
            app: { type: "string" },
            object: { type: "string" },
            action: { type: "string" },
            chatId: { type: "string" },
            chatLocation: { type: "string" },
            memberActors: { type: "array", items: { type: "string" } },
            content: { type: "string" },
            published: { type: "number" },
          },
        },
      },
    },
    undefined,
    true,
  );

  // groups together friend channels created by current user
  const createdFriendChannels = computed(() => {
    const myActor = session.value?.actor;
    if (!myActor) return [];

    const byId = new Map();
    actionObjects.value
      .filter(
        (item) =>
          item.value.app === "location-im" &&
          item.value.object === "chat-action" &&
          item.value.action === "create" &&
          Array.isArray(item.value.memberActors) &&
          item.value.memberActors.includes(myActor),
      )
      .toSorted((a, b) => b.value.published - a.value.published)
      .forEach((item) => {
        if (!byId.has(item.value.chatId)) {
          byId.set(item.value.chatId, {
            chatId: item.value.chatId,
            chatLocation: item.value.chatLocation || "Other",
            memberActors: item.value.memberActors,
            otherActor: item.value.memberActors.find((actor) => actor !== myActor) || "",
            seeded: false,
          });
        }
      });
    return [...byId.values()];
  });

  // creates an array of objects corresponding to channels at each location
  const groupedFriendChannels = computed(() => {
    const groups = new Map();
    for (const location of LOCATION_ORDER) groups.set(location, []);
    groups.set("Other", []);

    for (const channel of createdFriendChannels.value) {
      const location = groups.has(channel.chatLocation) ? channel.chatLocation : "Other";
      groups.get(location).push(channel);
    }

    for (const list of groups.values()) {
      list.sort((a, b) => a.otherActor.localeCompare(b.otherActor));
    }

    return [...groups.entries()].map(([location, channels]) => ({
      location,
      channels,
      hasChannels: channels.length > 0,
    }));
  });

  // computes all messages (sorted) for current active chat
  const activeChatMessages = computed(() => {
    if (!activeChatId.value) return [];

    return actionObjects.value
      .filter(
        (item) =>
          item.value.app === "location-im" &&
          item.value.object === "chat-action" &&
          item.value.action === "participate" &&
          item.value.chatId === activeChatId.value,
      )
      .toSorted((a, b) => a.value.published - b.value.published);
  });

  return {
    newFriendLocation,
    newFriendActor,
    activeChatId,
    activeOtherActor,
    activeChatLocation,
    draftMessage,
    isCreatingChannel,
    isJoiningChat,
    isSendingMessage,
    didCopyActorId,
    areActionsLoading,
    currentLocation: CURRENT_LOCATION,
    groupedFriendChannels,
    activeChatMessages,
    createFriendChannel,
    joinChat,
    closeActiveChat,
    copyMyActorId,
    sendMessage,
  };
}

const App = { template: "#template", setup };

createApp(App)
  .use(GraffitiPlugin, {
    graffiti: new GraffitiDecentralized(),
  })
  .mount("#app");
