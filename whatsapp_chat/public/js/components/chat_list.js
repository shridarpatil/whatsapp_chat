import ChatRoom from "./chat_room";
import ChatAddRoom from "./chat_add_room";
import {
  escape_html,
  get_rooms,
  mark_message_read,
  set_notification_count,
} from "./chat_utils";

export default class ChatList {
  constructor(opts) {
    this.$wrapper = opts.$wrapper;
    this.user = opts.user;
    this.user_email = opts.user_email;
    this.is_admin = opts.is_admin;
    this.setup();
  }

  setup() {
    this.$chat_list = $("<section>", {
      class: "chat-list",
      "aria-label": __("WhatsApp conversations"),
    });
    this.chat_rooms = [];
    this.pending_rooms = [];
    this.setup_header();
    this.setup_search();
    this.show_loading();
    this.fetch_and_setup_rooms();
    this.setup_socketio();
  }

  setup_header() {
    const header_html = `
      <header class='chat-list-header'>
        <div>
          <p class='chat-eyebrow'>${__("WHATSAPP")}</p>
          <h3>${__("Patient messages")}</h3>
        </div>
        <button type='button' class='chat-icon-button add-room'
          title='${__("New conversation")}' aria-label='${__(
      "New conversation"
    )}'>
          ${frappe.utils.icon("add", "md")}
        </button>
      </header>
    `;
    this.$chat_list.append(header_html);
  }

  setup_search() {
    const search_html = `
      <div class='chat-search'>
        <span class='search-icon' aria-hidden='true'>
          ${frappe.utils.icon("search", "sm")}
        </span>
        <label class='sr-only' for='whatsapp-chat-search'>
          ${__("Search conversations")}
        </label>
        <input id='whatsapp-chat-search' class='form-control chat-search-box'
          type='search' autocomplete='off'
          placeholder='${__("Search name, number, or message")}'>
      </div>
    `;
    this.$chat_list.append(search_html);
  }

  show_loading() {
    this.$state = $(`
      <div class='chat-list-state' role='status'>
        <span class='chat-state-spinner' aria-hidden='true'></span>
        <strong>${__("Loading conversations")}</strong>
        <span>${__("Checking for new patient messages…")}</span>
      </div>
    `);
    this.$chat_list.append(this.$state);
  }

  async fetch_and_setup_rooms() {
    try {
      this.rooms = (await get_rooms(this.user_email)) || [];
      this.$state.remove();
      this.setup_rooms();
      this.render_messages();
      const pending_rooms = this.pending_rooms;
      this.pending_rooms = [];
      pending_rooms.forEach((profile) => this.create_new_room(profile));
    } catch (error) {
      this.show_error();
    }
  }

  show_error() {
    this.$state
      .html(
        `
      <span class='chat-state-icon' aria-hidden='true'>${frappe.utils.icon(
        "solid-warning",
        "md"
      )}</span>
      <strong>${__("Could not load conversations")}</strong>
      <span>${__("Check your connection and try again.")}</span>
      <button type='button' class='btn btn-default btn-sm retry-chat-list'>${__(
        "Try again"
      )}</button>
    `
      )
      .attr("role", "alert");
    this.$state.find(".retry-chat-list").on("click", () => {
      this.$state.remove();
      this.show_loading();
      this.fetch_and_setup_rooms();
    });
  }

  setup_rooms() {
    this.$chat_rooms_container = $("<div>", { class: "chat-rooms-container" });
    this.$search_empty = $(`
      <div class='chat-list-state chat-search-empty' role='status'>
        <strong>${__("No matching conversations")}</strong>
        <span>${__("Try a patient name or phone number.")}</span>
      </div>
    `).hide();
    this.chat_rooms = this.rooms.map((element) => {
      const profile = {
        user: this.user,
        user_email: element.mobile_no,
        last_message: element.last_message,
        last_date: element.modified,
        is_admin: this.is_admin,
        room: element.name,
        is_read: element.is_read,
        room_name: element.contact_name,
        room_type: element.type,
        opposite_person_email: element.mobile_no,
      };
      return [
        profile.room,
        new ChatRoom({
          $wrapper: this.$wrapper,
          $chat_rooms_container: this.$chat_rooms_container,
          chat_list: this,
          element: profile,
        }),
      ];
    });
    this.$chat_list.append(this.$chat_rooms_container, this.$search_empty);

    if (!this.chat_rooms.length) {
      this.$chat_rooms_container.html(`
        <div class='chat-list-state' role='status'>
          <span class='chat-state-icon' aria-hidden='true'>${frappe.utils.icon(
            "small-message",
            "md"
          )}</span>
          <strong>${__("No conversations yet")}</strong>
          <span>${__("New WhatsApp replies will appear here.")}</span>
        </div>
      `);
    }
  }

  filter_rooms(query) {
    const normalized_query = query.trim().toLowerCase();
    let visible_count = 0;

    this.chat_rooms.forEach(([, room]) => {
      const profile = room.profile;
      const searchable = [
        profile.room_name,
        profile.user_email,
        profile.last_message,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const visible = searchable.includes(normalized_query);
      room.$chat_room.toggle(visible);
      visible_count += visible ? 1 : 0;
    });

    this.$search_empty.toggle(Boolean(normalized_query) && visible_count === 0);
  }

  create_new_room(profile) {
    if (!this.$chat_rooms_container) {
      this.pending_rooms.push(profile);
      return;
    }
    if (this.chat_rooms.some(([room]) => room === profile.room)) {
      return;
    }
    const room = new ChatRoom({
      $wrapper: this.$wrapper,
      $chat_rooms_container: this.$chat_rooms_container,
      chat_list: this,
      element: profile,
    });
    this.chat_rooms.unshift([profile.room, room]);
    this.$chat_rooms_container.find(".chat-list-state").remove();
    room.render("prepend");
  }

  setup_events() {
    this.$chat_list
      .find(".chat-search-box")
      .off("input.whatsapp-chat")
      .on("input.whatsapp-chat", (event) => {
        this.filter_rooms($(event.currentTarget).val());
      });

    this.$chat_list
      .find(".add-room")
      .off("click.whatsapp-chat")
      .on("click.whatsapp-chat", () => {
        if (!this.chat_add_room_modal) {
          this.chat_add_room_modal = new ChatAddRoom({
            user: this.user,
            user_email: this.user_email,
          });
        }
        this.chat_add_room_modal.show();
      });
  }

  render_messages() {
    this.$chat_rooms_container.empty();
    this.chat_rooms.forEach(([, room]) => room.render("append"));
  }

  render() {
    this.$wrapper.html(this.$chat_list);
    this.setup_events();
  }

  move_room_to_top(chat_room_item) {
    this.chat_rooms = [
      chat_room_item,
      ...this.chat_rooms.filter((item) => item !== chat_room_item),
    ];
  }

  setup_socketio() {
    frappe.realtime.on("latest_chat_updates", (res) => {
      const chat_room_item = this.chat_rooms.find(
        ([room]) => room === res.room
      );
      if (!chat_room_item) {
        return;
      }

      frappe.utils.play_sound("chat-message-receive");
      const content = String(res.content || "");
      const preview =
        content.length > 44 ? `${content.substring(0, 44)}…` : content;
      const contact_name = escape_html(res.contact_name || __("New message"));
      const message = escape_html(preview);

      frappe.show_alert(
        {
          message: `<a href='#' data-action='open-chat' class='chat-alert-link'>
          <strong>${contact_name}</strong><span>${message}</span>
        </a>`,
          indicator: "green",
        },
        5,
        {
          "open-chat": () => {
            if (!$(".chat-element").is(":visible")) {
              $("#chat-bubble").trigger("click");
            }
            setTimeout(
              () => chat_room_item[1].$chat_room.trigger("click"),
              100
            );
          },
        }
      );

      chat_room_item[1].set_last_message(preview, res.creation);
      if ($(".chat-list").is(":visible")) {
        chat_room_item[1].set_as_unread();
        chat_room_item[1].move_to_top();
        this.move_room_to_top(chat_room_item);
      } else if (
        $(".chat-space").is(":visible") &&
        this.active_room === res.room
      ) {
        mark_message_read(res.room);
      } else {
        chat_room_item[1].set_as_unread();
        chat_room_item[1].move_to_top();
        this.move_room_to_top(chat_room_item);
      }
    });

    frappe.realtime.on("new_room_creation", (res) => {
      frappe.utils.play_sound("chat-notification");
      res.user = this.user;
      this.create_new_room(res);
    });

    frappe.realtime.on("private_room_creation", (res) => {
      if (
        !$(".chat-element").is(":visible") &&
        frappe.Chat.settings.user.enable_notifications === 1
      ) {
        frappe.utils.play_sound("chat-notification");
      }
      if (!res.members.includes(this.user_email)) {
        return;
      }
      if (res.room_type === "Direct") {
        const [first_member, second_member] = res.member_names;
        const opposite_member =
          first_member.email === this.user_email ? second_member : first_member;
        res.room_name = opposite_member.name;
        res.opposite_person_email = opposite_member.email;
      }
      res.user = this.user;
      res.is_admin = this.is_admin;
      res.user_email = this.user_email;
      this.create_new_room(res);
    });
  }
}
