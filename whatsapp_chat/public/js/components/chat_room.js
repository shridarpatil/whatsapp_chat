import ChatSpace from "./chat_space";
import {
  get_date_from_now,
  mark_message_read,
  get_time,
  get_avatar_html,
  set_notification_count,
} from "./chat_utils";

const MESSAGE_PREVIEW_LENGTH = 44;

export default class ChatRoom {
  constructor(opts) {
    this.$wrapper = opts.$wrapper;
    this.$chat_rooms_container = opts.$chat_rooms_container;
    this.chat_list = opts.chat_list;
    this.profile = opts.element;
    this.setup();
    if (!this.profile.is_read) {
      set_notification_count("increment");
    }
  }

  setup() {
    this.$chat_room = $("<button>", {
      type: "button",
      class: "chat-room",
      "aria-label": __("Open conversation with {0}", [
        this.profile.room_name || this.profile.user_email,
      ]),
    });

    const avatar_html = get_avatar_html(
      this.profile.room_type,
      this.profile.opposite_person_email,
      this.profile.room_name
    );
    const $identity = $("<div>", { class: "chat-profile-info" });
    const $name_row = $("<div>", { class: "chat-name-row" });

    $("<span>", { class: "chat-name" })
      .text(this.profile.room_name || this.profile.user_email)
      .appendTo($name_row);
    $("<span>", {
      class: "chat-latest",
      "aria-label": __("Unread conversation"),
    })
      .toggle(!this.profile.is_read)
      .appendTo($name_row);

    $identity.append($name_row);
    $("<span>", { class: "chat-phone" })
      .text(this.profile.user_email || "")
      .appendTo($identity);
    $("<span>", { class: "last-message" })
      .text(this.message_preview(this.profile.last_message))
      .toggleClass("is-unread", !this.profile.is_read)
      .appendTo($identity);

    const $meta = $("<div>", { class: "chat-room-meta" });
    $("<time>", { class: "chat-date" })
      .text(get_date_from_now(this.profile.last_date, "room"))
      .appendTo($meta);
    $("<span>", { class: "chat-room-arrow", "aria-hidden": "true" })
      .html(frappe.utils.icon("right", "sm"))
      .appendTo($meta);

    this.$chat_room.append(avatar_html, $identity, $meta);
  }

  message_preview(message) {
    const preview = String(message || "").trim();
    if (!preview) {
      return __("No messages yet");
    }
    return preview.length > MESSAGE_PREVIEW_LENGTH
      ? `${preview.substring(0, MESSAGE_PREVIEW_LENGTH)}…`
      : preview;
  }

  set_as_read() {
    if (this.profile.is_read) {
      return;
    }
    this.profile.is_read = 1;
    this.$chat_room.find(".last-message").removeClass("is-unread");
    this.$chat_room.find(".chat-latest").hide();
    set_notification_count("decrement");
  }

  set_last_message(message, date) {
    this.profile.last_message = message;
    this.profile.last_date = date;
    this.$chat_room.find(".last-message").text(this.message_preview(message));
    this.$chat_room.find(".chat-date").text(get_time(date));
  }

  set_as_unread() {
    if (this.profile.is_read) {
      set_notification_count("increment");
    }
    this.profile.is_read = 0;
    this.$chat_room.find(".last-message").addClass("is-unread");
    this.$chat_room.find(".chat-latest").show();
  }

  render(mode) {
    if (mode === "append") {
      this.$chat_rooms_container.append(this.$chat_room);
    } else {
      this.$chat_rooms_container.prepend(this.$chat_room);
    }
    this.setup_events();
  }

  move_to_top() {
    this.$chat_room.prependTo(this.$chat_rooms_container);
  }

  setup_events() {
    this.$chat_room.off("click.whatsapp-chat").on("click.whatsapp-chat", () => {
      if (this.chat_list.active_chat_space) {
        this.chat_list.active_chat_space.destroy_socket_events();
      }
      this.chat_list.active_room = this.profile.room;
      this.chat_space = new ChatSpace({
        $wrapper: this.$wrapper,
        chat_list: this.chat_list,
        profile: this.profile,
      });
      this.chat_list.active_chat_space = this.chat_space;
      if (this.profile.is_read === 0) {
        mark_message_read(this.profile.room);
        this.set_as_read();
      }
    });
  }
}
