import { createApp, computed, onMounted, onUnmounted, ref, watch } from "vue";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import {
  GraffitiPlugin,
  useGraffiti,
  useGraffitiDiscover,
  useGraffitiSession,
} from "@graffiti-garden/wrapper-vue";

const DIRECTORY_CHANNEL = "location-im-directory-v4";
const DEFAULT_LOCATION = "Dorm";
const LOCATION_ORDER = ["Dorm", "MIT", "Home"];
const BASE_LOCATION_OPTIONS = [...LOCATION_ORDER, "Other"];

function setup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();
  const currentPath = ref(getPathFromHash());

  const newFriendActor = ref("");
  const activeChatId = ref("");
  const activeOtherActor = ref("");
  const activeChatLocation = ref("");
  const activeChatMemberActors = ref([]);
  const activeChatType = ref("direct");
  const draftMessage = ref("");

  const isCreatingChannel = ref(false);
  const isJoiningChat = ref(false);
  const isSendingMessage = ref(false);
  const isSavingLocation = ref(false);
  const isAddingLocation = ref(false);
  const didCopyActorId = ref(false);
  const didAddFriend = ref(false);
  const didFriendAlreadyAdded = ref(false);
  const didAddLocation = ref(false);
  const lovingMessageUrls = ref(new Set());
  const deletingChatIds = ref(new Set());
  const collapsedLocations = ref(new Set());
  const selectedCurrentLocation = ref(DEFAULT_LOCATION);
  const newLocationName = ref("");
  const addFriendFormRef = ref(null);
  let friendAddedToastTimeoutId = null;
  let friendAlreadyAddedToastTimeoutId = null;
  let locationAddedToastTimeoutId = null;

  function getPathFromHash() {
    const rawHash = window.location.hash || "";
    const withoutPound = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
    return normalizePath(withoutPound);
  }

  function normalizePath(path) {
    if (!path || path === "/") return "/home";
    const sanitized = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
    return sanitized || "/home";
  }

  function matchRoute(path) {
    const normalizedPath = normalizePath(path);
    if (normalizedPath === "/login") return { name: "login", params: {} };
    if (normalizedPath === "/home") return { name: "home", params: {} };
    if (normalizedPath === "/explore") return { name: "explore", params: {} };

    const chatMatch = normalizedPath.match(/^\/chat\/([^/]+)$/);
    if (chatMatch) {
      return {
        name: "chat",
        params: { chatId: decodeURIComponent(chatMatch[1]) },
      };
    }
    return { name: "not-found", params: {} };
  }

  function navigate(path, { replace = false } = {}) {
    const normalizedPath = normalizePath(path);
    const currentNormalized = getPathFromHash();
    if (normalizedPath === currentNormalized) {
      currentPath.value = normalizedPath;
      return;
    }

    const targetHash = `#${normalizedPath}`;
    if (replace) {
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}${targetHash}`);
    } else {
      window.location.hash = targetHash;
    }
    currentPath.value = normalizedPath;
  }

  function goTo(path) {
    navigate(path);
  }

  function routeToChat(chatId) {
    navigate(`/chat/${encodeURIComponent(chatId)}`);
  }

  function toLocationChannelId(location) {
    const normalizedLocation = (location || DEFAULT_LOCATION).trim().toLowerCase();
    const safeLocation = normalizedLocation
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return `location-${safeLocation || "general"}`;
  }

  const route = computed(() => matchRoute(currentPath.value));
  const routeName = computed(() => route.value.name);
  const routeChatId = computed(() =>
    route.value.name === "chat" ? route.value.params.chatId : "",
  );
  const shouldShowFriends = computed(
    () => routeName.value === "home" || routeName.value === "chat",
  );
  const showChatPanel = computed(() => routeName.value === "chat");

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
    const friendActor = newFriendActor.value.trim();
    if (friendActor === session.value.actor) return;

    const existingWithFriend = createdFriendChannels.value.find((ch) => ch.otherActor === friendActor);
    if (existingWithFriend) {
      newFriendActor.value = "";
      didFriendAlreadyAdded.value = true;
      if (friendAlreadyAddedToastTimeoutId) {
        clearTimeout(friendAlreadyAddedToastTimeoutId);
      }
      friendAlreadyAddedToastTimeoutId = setTimeout(() => {
        didFriendAlreadyAdded.value = false;
      }, 1800);
      await joinChat(existingWithFriend);
      return;
    }

    isCreatingChannel.value = true;
    const friendLocation = getActorLocation(friendActor);

    const channel = {
      chatId: crypto.randomUUID(),
      chatLocation: friendLocation,
      memberActors: [session.value.actor, friendActor],
    };

    try {
      await postChatAction("create", channel);
      activeChatId.value = channel.chatId;
      activeOtherActor.value = friendActor;
      activeChatLocation.value = channel.chatLocation;
      activeChatMemberActors.value = channel.memberActors;
      routeToChat(channel.chatId);
      newFriendActor.value = "";
      didAddFriend.value = true;
      if (friendAddedToastTimeoutId) {
        clearTimeout(friendAddedToastTimeoutId);
      }
      friendAddedToastTimeoutId = setTimeout(() => {
        didAddFriend.value = false;
      }, 1800);
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
      activeChatType.value = "direct";
      routeToChat(chat.chatId);
    } finally {
      isJoiningChat.value = false;
    }
  }

  function joinLocationChannel(location) {
    const normalizedLocation = location || DEFAULT_LOCATION;
    activeChatId.value = toLocationChannelId(normalizedLocation);
    activeOtherActor.value = "";
    activeChatLocation.value = normalizedLocation;
    activeChatMemberActors.value = [];
    activeChatType.value = "location";
    routeToChat(activeChatId.value);
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

  async function saveCurrentLocation() {
    if (!session.value) return;
    const location = selectedCurrentLocation.value || DEFAULT_LOCATION;
    isSavingLocation.value = true;
    try {
      await graffiti.post(
        {
          value: {
            app: "location-im",
            object: "user-profile",
            action: "set-location",
            location,
            published: Date.now(),
          },
          channels: [DIRECTORY_CHANNEL],
        },
        session.value,
      );
    } finally {
      isSavingLocation.value = false;
    }
  }

  async function addLocationOption() {
    if (!session.value) return;
    const locationName = newLocationName.value.trim();
    if (!locationName) return;

    isAddingLocation.value = true;
    try {
      await graffiti.post(
        {
          value: {
            app: "location-im",
            object: "location-catalog",
            action: "add-location",
            location: locationName,
            published: Date.now(),
          },
          channels: [DIRECTORY_CHANNEL],
        },
        session.value,
      );
      newLocationName.value = "";
      didAddLocation.value = true;
      if (locationAddedToastTimeoutId) {
        clearTimeout(locationAddedToastTimeoutId);
      }
      locationAddedToastTimeoutId = setTimeout(() => {
        didAddLocation.value = false;
      }, 1800);
    } finally {
      isAddingLocation.value = false;
    }
  }

  async function loveMessage(message) {
    const messageUrl = message?.url;
    if (!messageUrl || !canLoveMessage(message)) return;
    if (lovingMessageUrls.value.has(messageUrl)) return;

    lovingMessageUrls.value = new Set(lovingMessageUrls.value).add(messageUrl);
    try {
      const nextAction = didLoveMessage(messageUrl) ? "unlove" : "love";
      await postChatAction(nextAction, {
        chatId: activeChatId.value,
        chatLocation: activeChatLocation.value,
        memberActors: activeChatMemberActors.value,
        targetMessageUrl: messageUrl,
        targetMessageActor: message.actor,
      });
    } finally {
      const next = new Set(lovingMessageUrls.value);
      next.delete(messageUrl);
      lovingMessageUrls.value = next;
    }
  }

  async function deleteFriendChannel(chat) {
    if (!session.value?.actor || !chat?.chatId) return;
    if (!Array.isArray(chat.memberActors) || !chat.memberActors.includes(session.value.actor)) return;
    if (deletingChatIds.value.has(chat.chatId)) return;

    deletingChatIds.value = new Set(deletingChatIds.value).add(chat.chatId);
    try {
      await postChatAction("delete", {
        chatId: chat.chatId,
        chatLocation: chat.chatLocation,
        memberActors: chat.memberActors,
      });
      if (activeChatId.value === chat.chatId) {
        closeActiveChat();
      }
    } finally {
      const next = new Set(deletingChatIds.value);
      next.delete(chat.chatId);
      deletingChatIds.value = next;
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
    activeChatType.value = "direct";
    navigate("/home");
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
            action: { type: "string", enum: ["create", "join", "delete", "participate", "love", "unlove"] },
            chatId: { type: "string" },
            chatLocation: { type: "string" },
            memberActors: { type: "array", items: { type: "string" } },
            content: { type: "string" },
            targetMessageUrl: { type: "string" },
            targetMessageActor: { type: "string" },
            published: { type: "number" },
          },
        },
      },
    },
    undefined,
    true,
  );

  const { objects: profileObjects } = useGraffitiDiscover(
    () => [DIRECTORY_CHANNEL],
    {
      properties: {
        value: {
          required: ["app", "object", "action", "location", "published"],
          properties: {
            app: { type: "string" },
            object: { type: "string" },
            action: { type: "string", enum: ["set-location"] },
            location: { type: "string" },
            published: { type: "number" },
          },
        },
      },
    },
  );

  const { objects: locationObjects } = useGraffitiDiscover(
    () => [DIRECTORY_CHANNEL],
    {
      properties: {
        value: {
          required: ["app", "object", "action", "location", "published"],
          properties: {
            app: { type: "string" },
            object: { type: "string" },
            action: { type: "string", enum: ["add-location"] },
            location: { type: "string" },
            published: { type: "number" },
          },
        },
      },
    },
  );

  const currentLocationOptions = computed(() => {
    const options = new Set(BASE_LOCATION_OPTIONS);
    locationObjects.value
      .filter(
        (item) =>
          item.value.app === "location-im" &&
          item.value.object === "location-catalog" &&
          item.value.action === "add-location" &&
          typeof item.value.location === "string" &&
          item.value.location.trim().length > 0,
      )
      .forEach((item) => {
        options.add(item.value.location.trim());
      });

    const ordered = [];
    for (const baseLocation of BASE_LOCATION_OPTIONS) {
      if (options.has(baseLocation)) {
        ordered.push(baseLocation);
        options.delete(baseLocation);
      }
    }
    return [...ordered, ...[...options].sort((a, b) => a.localeCompare(b))];
  });

  const latestLocationByActor = computed(() => {
    const latestByActor = new Map();
    profileObjects.value
      .filter(
        (item) =>
          item.value.app === "location-im" &&
          item.value.object === "user-profile" &&
          item.value.action === "set-location",
      )
      .toSorted((a, b) => b.value.published - a.value.published)
      .forEach((item) => {
        if (!latestByActor.has(item.actor)) {
          latestByActor.set(item.actor, item.value.location || DEFAULT_LOCATION);
        }
      });
    return latestByActor;
  });

  function getActorLocation(actor) {
    if (!actor) return DEFAULT_LOCATION;
    return latestLocationByActor.value.get(actor) || DEFAULT_LOCATION;
  }

  const myCurrentLocation = computed(() => getActorLocation(session.value?.actor));
  const activeOtherLocation = computed(() => getActorLocation(activeOtherActor.value));

  // groups together friend channels created by current user
  const createdFriendChannels = computed(() => {
    const myActor = session.value?.actor;
    if (!myActor) return [];

    const latestChannelStateById = new Map();
    actionObjects.value
      .filter(
        (item) =>
          item.value.app === "location-im" &&
          item.value.object === "chat-action" &&
          (item.value.action === "create" || item.value.action === "delete") &&
          Array.isArray(item.value.memberActors) &&
          item.value.memberActors.includes(myActor),
      )
      .toSorted((a, b) => b.value.published - a.value.published)
      .forEach((item) => {
        if (!latestChannelStateById.has(item.value.chatId)) {
          latestChannelStateById.set(item.value.chatId, item);
        }
      });

    const byId = new Map();
    [...latestChannelStateById.values()]
      .filter((item) => item.value.action === "create")
      .forEach((item) => {
        if (!byId.has(item.value.chatId)) {
          const otherActor = item.value.memberActors.find((actor) => actor !== myActor) || "";
          byId.set(item.value.chatId, {
            chatId: item.value.chatId,
            chatLocation:
              latestLocationByActor.value.get(otherActor) || item.value.chatLocation || DEFAULT_LOCATION,
            memberActors: item.value.memberActors,
            otherActor,
            seeded: false,
          });
        }
      });
    return [...byId.values()];
  });

  const locationChannels = computed(() =>
    currentLocationOptions.value.map((location) => ({
      chatId: toLocationChannelId(location),
      chatLocation: location,
      memberActors: [],
      otherActor: "",
      isLocationChannel: true,
    })),
  );

  const availableChatChannels = computed(() => [...createdFriendChannels.value, ...locationChannels.value]);

  // creates an array of objects corresponding to channels at each location
  const groupedFriendChannels = computed(() => {
    const groups = new Map();
    for (const location of currentLocationOptions.value) {
      if (location !== "Other") groups.set(location, []);
    }
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

  const totalMessageCount = computed(
    () =>
      actionObjects.value.filter(
        (item) =>
          item.value.app === "location-im" &&
          item.value.object === "chat-action" &&
          item.value.action === "participate",
      ).length,
  );

  const lovesByMessageUrl = computed(() => {
    const grouped = new Map();
    actionObjects.value
      .toSorted((a, b) => a.value.published - b.value.published)
      .filter(
        (item) =>
          item.value.app === "location-im" &&
          item.value.object === "chat-action" &&
          (item.value.action === "love" || item.value.action === "unlove") &&
          item.value.chatId === activeChatId.value &&
          typeof item.value.targetMessageUrl === "string",
      )
      .forEach((item) => {
        if (!grouped.has(item.value.targetMessageUrl)) {
          grouped.set(item.value.targetMessageUrl, new Map());
        }
        grouped
          .get(item.value.targetMessageUrl)
          .set(item.actor, item.value.action === "love");
      });

    const lovedActorsByMessage = new Map();
    for (const [messageUrl, actorStateMap] of grouped.entries()) {
      const lovedActors = new Set();
      for (const [actor, isLoved] of actorStateMap.entries()) {
        if (isLoved) lovedActors.add(actor);
      }
      lovedActorsByMessage.set(messageUrl, lovedActors);
    }
    return lovedActorsByMessage;
  });

  function getLoveCount(messageUrl) {
    return lovesByMessageUrl.value.get(messageUrl)?.size || 0;
  }

  function isMessageLoved(message) {
    if (!message?.url) return false;
    const myActor = session.value?.actor;
    if (message.actor === myActor) {
      return getLoveCount(message.url) > 0;
    }
    return didLoveMessage(message.url);
  }

  function didLoveMessage(messageUrl) {
    const myActor = session.value?.actor;
    if (!myActor) return false;
    return lovesByMessageUrl.value.get(messageUrl)?.has(myActor) || false;
  }

  function canLoveMessage(message) {
    const myActor = session.value?.actor;
    if (!myActor || !message?.url || !activeChatId.value) return false;
    if (message.actor === myActor) return false;
    return true;
  }

  function isLovingMessage(messageUrl) {
    return lovingMessageUrls.value.has(messageUrl);
  }

  function isDeletingChat(chatId) {
    return deletingChatIds.value.has(chatId);
  }

  function toggleLocationGroup(location) {
    const next = new Set(collapsedLocations.value);
    if (next.has(location)) {
      next.delete(location);
    } else {
      next.add(location);
    }
    collapsedLocations.value = next;
  }

  function isLocationCollapsed(location) {
    return collapsedLocations.value.has(location);
  }

  function scrollToAddFriendForm() {
    if (!addFriendFormRef.value) return;
    addFriendFormRef.value.scrollIntoView({ behavior: "smooth", block: "center" });
    const friendInput = addFriendFormRef.value.querySelector("input");
    friendInput?.focus();
  }

  function formatUsername(name) {
    if (!name) return "";
    return name.replace(/\.graffiti\.actor$/, "");
  }

  function syncRouteToState() {
    if (routeName.value === "chat" && routeChatId.value) {
      activeChatId.value = routeChatId.value;
      const matchedChannel = availableChatChannels.value.find(
        (channel) => channel.chatId === routeChatId.value,
      );
      if (matchedChannel) {
        activeOtherActor.value = matchedChannel.otherActor || "";
        activeChatLocation.value = matchedChannel.chatLocation;
        activeChatMemberActors.value = matchedChannel.memberActors || [];
        activeChatType.value = matchedChannel.isLocationChannel ? "location" : "direct";
      }
      return;
    }

    if (routeName.value !== "chat") {
      activeChatId.value = "";
      activeOtherActor.value = "";
      activeChatLocation.value = "";
      activeChatMemberActors.value = [];
      activeChatType.value = "direct";
    }
  }

  watch([routeName, routeChatId, createdFriendChannels], syncRouteToState, {
    immediate: true,
  });

  watch(
    myCurrentLocation,
    (location) => {
      selectedCurrentLocation.value = location || DEFAULT_LOCATION;
    },
    { immediate: true },
  );

  watch(
    [session, routeName],
    () => {
      if (routeName.value === "not-found") {
        navigate(session.value?.actor ? "/home" : "/login", { replace: true });
        return;
      }
      if (session.value === null && routeName.value !== "login") {
        navigate("/login", { replace: true });
      }
      if (session.value?.actor && routeName.value === "login") {
        navigate("/home", { replace: true });
      }
    },
    { immediate: true },
  );

  const onHashChange = () => {
    currentPath.value = getPathFromHash();
  };

  onMounted(() => {
    window.addEventListener("hashchange", onHashChange);
    currentPath.value = getPathFromHash();
  });
  onUnmounted(() => {
    window.removeEventListener("hashchange", onHashChange);
    if (friendAddedToastTimeoutId) {
      clearTimeout(friendAddedToastTimeoutId);
    }
    if (friendAlreadyAddedToastTimeoutId) {
      clearTimeout(friendAlreadyAddedToastTimeoutId);
    }
    if (locationAddedToastTimeoutId) {
      clearTimeout(locationAddedToastTimeoutId);
    }
  });

  return {
    routeName,
    showChatPanel,
    shouldShowFriends,
    newFriendActor,
    activeChatId,
    activeOtherActor,
    activeChatLocation,
    activeChatType,
    draftMessage,
    isCreatingChannel,
    isJoiningChat,
    isSendingMessage,
    didCopyActorId,
    didAddFriend,
    didFriendAlreadyAdded,
    didAddLocation,
    areActionsLoading,
    currentLocation: myCurrentLocation,
    currentLocationOptions,
    selectedCurrentLocation,
    isSavingLocation,
    isAddingLocation,
    newLocationName,
    addFriendFormRef,
    activeOtherLocation,
    groupedFriendChannels,
    activeChatMessages,
    totalMessageCount,
    getLoveCount,
    isMessageLoved,
    didLoveMessage,
    canLoveMessage,
    isLovingMessage,
    formatUsername,
    createFriendChannel,
    joinChat,
    joinLocationChannel,
    closeActiveChat,
    copyMyActorId,
    saveCurrentLocation,
    addLocationOption,
    sendMessage,
    loveMessage,
    deleteFriendChannel,
    goTo,
    isDeletingChat,
    toggleLocationGroup,
    isLocationCollapsed,
    scrollToAddFriendForm,
  };
}

const LoveButton = {
  props: {
    count: { type: Number, default: 0 },
    canLove: { type: Boolean, default: false },
    lovedByMe: { type: Boolean, default: false },
    isLoading: { type: Boolean, default: false },
  },
  emits: ["love"],
  template: `
    <button
      class="love-btn"
      type="button"
      :disabled="!canLove || isLoading"
      @click="$emit('love')"
    >
      <span>{{ lovedByMe ? "Loved" : "Love" }}</span>
      <span class="love-icon">❤</span>
      <span class="love-count">{{ count }}</span>
    </button>
  `,
};

const App = { template: "#template", setup, components: { LoveButton } };

createApp(App)
  .use(GraffitiPlugin, {
    graffiti: new GraffitiDecentralized(),
  })
  .mount("#app");
