import {
  get_time,
  scroll_to_bottom,
  get_messages,
  get_date_from_now,
  is_date_change,
  send_message,
  set_typing,
  is_image,
  get_avatar_html,
  mark_message_read,
  get_patient_context,
  escape_html,
} from "./chat_utils";

export default class ChatSpace {
  constructor(opts) {
    this.chat_list = opts.chat_list;
    this.$wrapper = opts.$wrapper;
    this.profile = opts.profile;
    this.file = null;
    this.setup();
  }

  setup() {
    this.$chat_space = $(document.createElement("div"));
    this.typing = false;
    this.$chat_space.addClass("chat-space");
    this.setup_header();
    this.setup_loading();
    this.render();
    this.setup_navigation_events();
    this.fetch_and_setup_messages();
  }

  setup_header() {
    this.avatar_html = get_avatar_html(
      this.profile.room_type,
      this.profile.opposite_person_email,
      this.profile.room_name
    );
    const room_name = escape_html(
      __(
        this.profile.room_name || this.profile.user_email || __("Conversation")
      )
    );
    const phone_number = escape_html(this.profile.user_email || "");
    const header_html = `
			<header class='chat-header'>
				${
          this.profile.is_admin === true
            ? `<button type='button' class='chat-back-button'
                title='${__("Back to conversations")}' aria-label='${__(
                "Back to conversations"
              )}'>
								${frappe.utils.icon("left")}
							</button>`
            : ``
        }
				${this.avatar_html}
				<div class='chat-conversation-identity'>
					<div class='chat-profile-name'>
					${room_name}
					</div>
					<div class='chat-phone-number'>${phone_number}</div>
					<div class='chat-profile-status'>${__("Typing…")}</div>
				</div>
			</header>
				<div class='chat-patient-context' aria-live='polite'>
				<span class='patient-context-loading'>${__("Checking patient record…")}</span>
			</div>
		`;
    this.$chat_space.append(header_html);
    this.load_patient_context();
  }

  async load_patient_context() {
    if (!this.profile.is_admin || !this.profile.user_email) {
      this.$chat_space.find(".chat-patient-context").remove();
      return;
    }

    try {
      const context = await get_patient_context(this.profile.user_email);
      this.render_patient_context(context.patients || []);
    } catch (error) {
      const $context = this.$chat_space.find(".chat-patient-context").empty();
      $("<span>", { class: "patient-context-label" })
        .text(__("PATIENT RECORD"))
        .appendTo($context);
      $("<span>", { class: "patient-context-muted" })
        .text(__("Patient lookup unavailable"))
        .appendTo($context);
    }
  }

  render_patient_context(patients) {
    const $context = this.$chat_space.find(".chat-patient-context").empty();
    if (!patients.length) {
      $("<span>", { class: "patient-context-label" })
        .text(__("PATIENT RECORD"))
        .appendTo($context);
      $("<span>", { class: "patient-context-muted" })
        .text(__("No patient linked to this number"))
        .appendTo($context);
      return;
    }

    if (patients.length === 1) {
      const patient = patients[0];
      const patient_url = `/clinix/patients/${encodeURIComponent(
        patient.name
      )}`;
      const $profile_link = $("<a>", {
        class: "chat-profile-name profile-patient-link",
        href: patient_url,
        title: __("Open patient record"),
      });
      $("<span>").text(patient.patient_name).appendTo($profile_link);
      $("<span>", { class: "profile-patient-arrow", "aria-hidden": "true" })
        .html(frappe.utils.icon("right", "sm"))
        .appendTo($profile_link);
      this.$chat_space.find(".chat-profile-name").replaceWith($profile_link);
    } else {
      this.$chat_space
        .find(".chat-profile-name")
        .text(__("{0} linked patients", [patients.length]));
    }

    $("<span>", { class: "patient-context-label" })
      .text(patients.length === 1 ? __("PATIENT RECORD") : __("SHARED NUMBER"))
      .appendTo($context);
    const $patients = $("<div>", { class: "patient-context-patients" });
    patients.forEach((patient) => {
      const details = [
        patient.age !== null && patient.age !== undefined
          ? __("{0} years", [patient.age])
          : null,
        patient.gender,
        patient.family_relation
          ? __(patient.family_relation.replaceAll("_", " "))
          : null,
      ].filter(Boolean);
      const patient_url = `/clinix/patients/${encodeURIComponent(
        patient.name
      )}`;
      const $link = $("<a>", {
        class: "patient-context-link",
        href: patient_url,
        title: __("Open patient record"),
      });
      $("<span>", { class: "patient-context-name" })
        .text(
          patients.length === 1
            ? __("Open patient record")
            : patient.patient_name
        )
        .appendTo($link);
      $("<span>", { class: "patient-context-details" })
        .text(details.join(" · "))
        .appendTo($link);
      $("<span>", { class: "patient-context-arrow", "aria-hidden": "true" })
        .html(frappe.utils.icon("right", "sm"))
        .appendTo($link);
      $patients.append($link);
    });
    $context.append($patients);
  }

  setup_loading() {
    this.$conversation_state = $(`
      <div class='chat-conversation-state' role='status'>
        <span class='chat-state-spinner' aria-hidden='true'></span>
        <strong>${__("Loading messages")}</strong>
      </div>
    `);
    this.$chat_space.append(this.$conversation_state);
  }

  setup_navigation_events() {
    this.$chat_space.find(".chat-back-button").on("click", () => {
      this.destroy_socket_events();
      this.chat_list.active_room = null;
      this.chat_list.active_chat_space = null;
      this.chat_list.render_messages();
      this.chat_list.render();
    });
  }

  async fetch_and_setup_messages() {
    try {
      const res = await get_messages(
        this.profile.room,
        this.profile.user_email
      );
      this.$conversation_state.remove();
      this.setup_messages(res);
      this.setup_actions();
      this.setup_events();
      this.setup_socketio();
      scroll_to_bottom(this.$chat_space_container);

      // Mark messages as read when viewing the chat
      // This will also send read receipts to WhatsApp if enabled in settings
      mark_message_read(this.profile.room);
    } catch (error) {
      this.show_message_error();
    }
  }

  show_message_error() {
    this.$conversation_state
      .html(
        `<span class='chat-state-icon' aria-hidden='true'>${frappe.utils.icon(
          "solid-warning",
          "md"
        )}</span>
        <strong>${__("Could not load messages")}</strong>
        <span>${__("Check your connection and try again.")}</span>
        <button type='button' class='btn btn-default btn-sm retry-chat-messages'>
          ${__("Try again")}
        </button>`
      )
      .attr("role", "alert");
    this.$conversation_state.find(".retry-chat-messages").on("click", () => {
      this.$conversation_state.remove();
      this.setup_loading();
      this.fetch_and_setup_messages();
    });
  }

  setup_messages(messages_list) {
    this.$chat_space_container = $(document.createElement("div"));
    this.$chat_space_container.addClass("chat-space-container");

    this.make_messages_html(messages_list);

    this.$chat_space_container.html(this.message_html);
    this.$chat_space.append(this.$chat_space_container);
  }

  make_messages_html(messages_list) {
    messages_list = messages_list || [];
    this.prevMessage = {};
    this.message_html = ``;
    if (this.profile.message) {
      messages_list.push(this.profile.message);
      send_message(
        this.profile.message.content,
        this.profile.user,
        this.profile.room,
        this.profile.user_email
      );
    }
    if (!messages_list.length) {
      this.message_html = `
        <div class='chat-empty-conversation' role='status'>
          <strong>${__("No messages yet")}</strong>
          <span>${__("Write a message to start this conversation.")}</span>
        </div>
      `;
      return;
    }
    messages_list.forEach((element) => {
      const date_line_html = this.make_date_line_html(element.creation);
      this.message_html += date_line_html;

      let message_type = "sender";

      if (element.sender_user_no === this.profile.user_email) {
        message_type = "recipient";
      } else if (this.profile.room_type === "Guest") {
        if (this.profile.is_admin === true && element.sender !== "Guest") {
          message_type = "recipient";
        }
      }
      this.message_html += this.make_message(
        element.content,
        get_time(element.creation),
        message_type,
        element.sender,
        element.caption
      ).prop("outerHTML");

      this.prevMessage = element;
    });
  }

  make_date_line_html(dateObj) {
    let result = `
			<div class='date-line'>
				<span>
					${__(get_date_from_now(dateObj, "space"))}
				</span>
			</div>
		`;
    if ($.isEmptyObject(this.prevMessage)) {
      return result;
    } else if (is_date_change(dateObj, this.prevMessage.creation)) {
      return result;
    } else {
      return "";
    }
  }

  setup_actions() {
    this.$chat_actions = $(document.createElement("div"));
    this.$chat_actions.addClass("chat-space-actions");
    const chat_actions_html = `
			<button type='button' class='chat-composer-button open-attach-items'
				title='${__("Attach file")}' aria-label='${__("Attach file")}'>
				${frappe.utils.icon("attachment", "lg")}
			</button>
			<input type='file' id='chat-file-uploader'
				accept='image/*, application/pdf, .doc, .docx'
				style='display: none;'
			>
			<textarea class='form-control type-message' rows='1'
				aria-label='${__("Message")}'
				placeholder='${__("Write a message…")}'></textarea>
			<button type='button' class='message-send-button'
				title='${__("Send message")}' aria-label='${__("Send message")}' disabled>
					<svg xmlns="http://www.w3.org/2000/svg" width="1.1rem" height="1.1rem" viewBox="0 0 24 24">
						<path d="M24 0l-6 22-8.129-7.239 7.802-8.234-10.458 7.227-7.215-1.754 24-12zm-15 16.668v7.332l3.258-4.431-3.258-2.901z"/>
					</svg>
			</button>
		`;
    this.$chat_actions.html(chat_actions_html);
    this.$chat_space.append(this.$chat_actions);
  }

  async handle_upload_file(file) {
    const dataurl = await frappe.dom.file_to_base64(file.file_obj);
    file.dataurl = dataurl;
    file.name = file.file_obj.name;
    return this.upload_file(file);
  }

  upload_file(file) {
    const me = this;
    return new Promise((resolve, reject) => {
      let xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("load", () => {
        resolve();
      });

      xhr.addEventListener("error", () => {
        reject(frappe.throw(__("Internal Server Error")));
      });
      xhr.onreadystatechange = () => {
        if (xhr.readyState == XMLHttpRequest.DONE) {
          if (xhr.status === 200) {
            let r = null;
            let file_doc = null;
            try {
              r = JSON.parse(xhr.responseText);
              if (r.message.doctype === "File") {
                file_doc = r.message;
              }
            } catch (e) {
              r = xhr.responseText;
            }
            try {
              if (file_doc === null) {
                reject(frappe.throw(__("File upload failed!")));
              }
              me.handle_send_message(file_doc.file_url);
            } catch (error) {
              //pass
            }
          } else {
            try {
              const error = JSON.parse(xhr.responseText);
              const messages = JSON.parse(error._server_messages);
              const errorObj = JSON.parse(messages[0]);
              reject(frappe.throw(__(errorObj.message)));
            } catch (e) {
              // pass
            }
          }
        }
      };

      xhr.open("POST", "/api/method/upload_file", true);
      xhr.setRequestHeader("Accept", "application/json");
      xhr.setRequestHeader("X-Frappe-CSRF-Token", frappe.csrf_token);

      let form_data = new FormData();

      form_data.append("file", file.file_obj, file.name);
      form_data.append("is_private", +false);

      form_data.append("doctype", "WhatsApp Contact");
      form_data.append("docname", this.profile.room);
      form_data.append("optimize", +true);
      xhr.send(form_data);
    });
  }

  setup_events() {
    this.typing_timeout = () => {
      this.typing = false;
    };

    this.$chat_space.find(".open-attach-items").on("click", () => {
      this.$chat_space.find("#chat-file-uploader").trigger("click");
    });

    this.$chat_space.find("#chat-file-uploader").on("change", (event) => {
      if (event.currentTarget.files.length > 0) {
        this.file = { file_obj: event.currentTarget.files[0] };
        this.handle_upload_file(this.file);
        this.file = null;
      }
    });

    this.$chat_space.find(".message-send-button").on("click", () => {
      this.handle_send_message();
    });

    const $message_input = this.$chat_space.find(".type-message");
    $message_input.on("input", () => this.update_send_state());
    $message_input.on("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.handle_send_message();
      }
    });
  }

  setup_socketio() {
    this.received_message_ids = new Set();
    this.room_event_handler = (res) => this.handle_incoming_message(res);
    this.latest_event_handler = (res) => {
      if (res.room === this.profile.room) {
        this.handle_incoming_message(res);
      }
    };
    frappe.realtime.on(this.profile.room, this.room_event_handler);
    frappe.realtime.on("latest_chat_updates", this.latest_event_handler);
  }

  handle_incoming_message(res) {
    // Create a unique ID for the message to prevent duplicates
    const msg_id =
      res.name || `${res.content}-${res.creation}-${res.sender_user_no}`;

    // Skip if we've already processed this message
    if (this.received_message_ids.has(msg_id)) {
      return;
    }
    this.received_message_ids.add(msg_id);

    // Display the message
    this.receive_message(res, get_time(res.creation));

    // Mark as read since chat is open and user is viewing it
    mark_message_read(this.profile.room);
  }

  destroy_socket_events() {
    if (this.room_event_handler) {
      frappe.realtime.off(this.profile.room, this.room_event_handler);
    }
    if (this.latest_event_handler) {
      frappe.realtime.off("latest_chat_updates", this.latest_event_handler);
    }
  }

  get_typing_changes(res) {
    if (res.user != this.profile.user_email) {
      if (
        (this.profile.is_admin === true && res.is_guest === "true") ||
        this.profile.is_admin === false ||
        this.profile.room_type === "Group" ||
        this.profile.room_type === "Direct"
      ) {
        if (res.is_typing === "false") {
          $(".chat-profile-status").css("visibility", "hidden");
        } else {
          $(".chat-profile-status").css("visibility", "visible");
          const timeout = setTimeout(() => {
            $(".chat-profile-status").css("visibility", "hidden");
          }, 3000);
        }
      }
    }
  }

  make_message(content, time, type, name, caption) {
    content = String(content || "");
    const message_class =
      type === "recipient" ? "recipient-message" : "sender-message";
    const $recipient_element = $(document.createElement("div")).addClass(
      message_class
    );
    const $message_element = $(document.createElement("div")).addClass(
      "message-bubble"
    );

    const $name_element = $(document.createElement("div"))
      .addClass("message-name")
      .text(name);

    const n = content.lastIndexOf("/");
    const file_name = content.substring(n + 1) || "";
    let $sanitized_content;

    if (content.startsWith("/files/") && file_name !== "") {
      let $url;
      if (is_image(file_name)) {
        $url = $(document.createElement("img"));
        $url.attr({ src: content }).addClass("img-responsive chat-image");
        $message_element.css({ padding: "0px", background: "inherit" });
        $name_element.css({
          color: "var(--text-muted)",
          "padding-bottom": "var(--padding-xs)",
        });
      } else {
        $url = $(document.createElement("a"));
        $url.attr({ href: content, target: "_blank" }).text(__(file_name));

        if (type === "sender") {
          $url.css("color", "var(--cyan-100)");
        }
      }
      $sanitized_content = $url;
    } else {
      $sanitized_content = __($("<div>").text(content).html());
    }

    if (type === "sender" && this.profile.room_type === "Group") {
      $message_element.append($name_element);
    }
    $message_element.append($sanitized_content);

    // Add caption below image/media if present
    if (caption) {
      const $caption_element = $(document.createElement("div"))
        .addClass("message-caption")
        .css({
          padding: "var(--padding-sm)",
          "font-size": "var(--text-sm)",
          color: type === "sender" ? "var(--white)" : "var(--text-color)",
          background:
            type === "sender" ? "var(--primary-color)" : "var(--control-bg)",
          "border-radius": "0 0 13px 13px",
        })
        .text(caption);
      $message_element.append($caption_element);
    }

    $recipient_element.append($message_element);
    $recipient_element.append(`<div class='message-time'>${__(time)}</div>`);

    return $recipient_element;
  }

  update_send_state() {
    const has_message = Boolean(
      String(this.$chat_space.find(".type-message").val() || "").trim()
    );
    this.$chat_space
      .find(".message-send-button")
      .prop("disabled", !has_message || this.sending);
  }

  async handle_send_message(attachment) {
    const $type_message = this.$chat_space.find(".type-message");
    const content = attachment || String($type_message.val() || "").trim();
    if (!content || this.sending) {
      return;
    }

    this.sending = true;
    this.update_send_state();
    this.$chat_space.find(".chat-space-actions").addClass("is-sending");
    this.typing = false;
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    if (
      this.profile.is_admin === true &&
      frappe.Chat.settings.user.enable_message_tone === 1
    ) {
      frappe.utils.play_sound("chat-message-send");
    }

    try {
      await send_message(
        content,
        this.profile.user,
        this.profile.room,
        this.profile.user_email,
        attachment
      );
      this.$chat_space_container.find(".chat-empty-conversation").remove();
      this.$chat_space_container.append(
        this.make_message(content, get_time(), "recipient", this.profile.user)
      );
      $type_message.val("");
      scroll_to_bottom(this.$chat_space_container);
    } catch (error) {
      frappe.msgprint({
        title: __("Message not sent"),
        message: __(
          "Your message is still here. Check your connection and try again."
        ),
        indicator: "red",
      });
    } finally {
      this.sending = false;
      this.$chat_space.find(".chat-space-actions").removeClass("is-sending");
      this.update_send_state();
    }
  }

  receive_message(res, time) {
    res.content = String(res.content || "");
    let chat_type = "sender";
    // Skip if this is our own outgoing message (sender_user_no would be empty or 'Administrator' for outgoing)
    if (
      res.sender_user_no === "Administrator" ||
      res.sender_user_no === this.profile.user
    ) {
      return;
    }

    if (
      this.profile.is_admin === true &&
      $(".chat-element").is(":visible") &&
      frappe.Chat.settings.user.enable_message_tone === 1
    ) {
      frappe.utils.play_sound("chat-message-receive");
    }

    if (this.profile.room_type === "Guest") {
      if (this.profile.is_admin === true && res.user !== "Guest") {
        chat_type = "recipient";
      }
    }

    this.$chat_space_container.find(".chat-empty-conversation").remove();
    this.$chat_space_container.append(
      this.make_message(res.content, time, chat_type, res.user)
    );
    scroll_to_bottom(this.$chat_space_container);
  }

  render() {
    this.$wrapper.html(this.$chat_space);
  }
}
