// frappe.Chat
// Author - Nihal Mittal <nihal@erpnext.com>

import {
  ChatBubble,
  ChatList,
  ChatSpace,
  ChatWelcome,
  get_settings,
  scroll_to_bottom,
  get_or_create_contact,
} from './components';
import { setup_form_buttons } from './components/chat_form_button';
frappe.provide('frappe.Chat');
frappe.provide('frappe.Chat.settings');

/** Spawns a chat widget on any web page */
frappe.Chat = class {
  constructor() {
    this.setup_app();
  }

  /** Create all the required elements for chat widget */
  create_app() {
    this.$app_element = $(document.createElement('div'));
    this.$app_element.addClass('chat-app');
    this.$chat_container = $(document.createElement('div'));
    this.$chat_container.addClass('chat-container');
    $('body').append(this.$app_element);
    this.is_open = false;

    this.$chat_element = $(document.createElement('div'))
      .addClass('chat-element')
      .hide();

    this.$chat_element.append(`
			<span class="chat-cross-button">
				${frappe.utils.icon('close', 'lg')}
			</span>
		`);
    this.$chat_element.append(this.$chat_container);
    this.$chat_element.appendTo(this.$app_element);

    this.chat_bubble = new ChatBubble(this);
    this.chat_bubble.render();

    this.add_launcher();
    this.setup_events();
  }

  /**
   * Put the chat launcher where Desk keeps its notification bell.
   * Frappe v16: a row in the sidebar's standard-items band and a button in the dock.
   * Frappe v14/v15: an icon in the top navbar.
   * Desk re-renders its sidebar, so this runs again on every route change.
   */
  add_launcher() {
    if (this.is_desk !== true) return;
    const title = __('WhatsApp Chat');
    const count = frappe.Chat.settings.unread_count || '';
    const icon = frappe.utils.icon('small-message', 'sm');

    // Frappe v16 sidebar
    $('.standard-items-band').each(function () {
      if ($(this).find('.chat-navbar-icon').length) return;
      const $row = $(`
        <div class="chat-navbar-icon" item-name="WhatsApp Chat" data-id="WhatsApp Chat">
          <div class="standard-sidebar-item">
            <a class="item-anchor" title="${title}" aria-label="${title}">
              <span class="sidebar-item-icon" item-icon="small-message">${icon}</span>
              <span class="sidebar-item-label">${title}</span>
              <span class="sidebar-item-suffix">
                <span class="chat-notification-count" aria-live="polite">${count}</span>
              </span>
              <div class="sidebar-item-control"></div>
            </a>
          </div>
        </div>`);
      const $bell = $(this).children('.sidebar-notification');
      $bell.length ? $row.insertAfter($bell) : $(this).append($row);
    });

    // Frappe v16 dock
    $('.dock-utilities').each(function () {
      if ($(this).find('.chat-navbar-icon').length) return;
      const $btn = $(`
        <button class="dock-item chat-navbar-icon" aria-label="${title}" title="${title}">
          <span class="dock-item-icon">${icon}</span>
          <span class="chat-notification-count dock-item-dot" aria-live="polite">${count}</span>
        </button>`);
      const $bell = $(this).children('.sidebar-notification');
      $bell.length ? $btn.insertAfter($bell) : $(this).append($btn);
    });

    // Frappe v14/v15 navbar
    const $navbar = $('header.navbar > .container > .navbar-collapse > ul');
    if ($navbar.length && !$navbar.find('.chat-navbar-icon').length) {
      $navbar.prepend(`
        <li class='nav-item dropdown dropdown-notifications
          dropdown-mobile chat-navbar-icon' title="${__('Show Chats')}">
          ${frappe.utils.icon('small-message', 'md')}
          <span class="badge chat-notification-count"></span>
        </li>`);
    }
  }

  /**
   * Open the chat window on the conversation with a phone number.
   * Finds the WhatsApp Contact for the number (any format), or creates it.
   */
  async open_for_number(mobile_no, contact_name) {
    if (!this.chat_list) {
      frappe.throw(__('WhatsApp Chat is not enabled for you.'));
    }
    const contact = await get_or_create_contact(mobile_no, contact_name);
    let item = this.chat_list.chat_rooms.find((r) => r[0] === contact.name);
    if (!item) {
      this.chat_list.create_new_room({
        user: this.chat_list.user,
        user_email: contact.mobile_no,
        last_message: contact.last_message,
        last_date: contact.modified,
        is_admin: this.is_admin,
        room: contact.name,
        is_read: 1,
        room_name: contact.contact_name,
        opposite_person_email: contact.mobile_no,
      });
      item = this.chat_list.chat_rooms[0];
    } else if (item[1].profile.room_name !== contact.contact_name) {
      item[1].profile.room_name = contact.contact_name;
      item[1].$chat_room
        .find('.chat-name')
        .contents()
        .first()
        .replaceWith(document.createTextNode(contact.contact_name + ' '));
    }
    if (!this.is_open) this.chat_bubble.change_bubble();
    item[1].$chat_room.trigger('click');
  }

  /** Load dependencies and fetch the settings */
  async setup_app() {
    try {
      const token = localStorage.getItem('guest_token') || '';
      const res = await get_settings(token);
      this.is_admin = res.is_admin;
      this.is_desk = 'desk' in frappe;
      frappe.Chat.instance = this;

      if (res.enable_chat === false || (!this.is_desk && this.is_admin)) {
        return;
      }

      frappe.Chat.settings = {};
      frappe.Chat.settings.user = res.user_settings;
      frappe.Chat.settings.unread_count = 0;

      this.create_app();
      if (frappe.socketio && !frappe.socketio.socket) {
        await frappe.socketio.init(res.socketio_port);
      }
      if (this.is_desk && res.is_admin) {
        setup_form_buttons(res.form_doctypes || []);
      }

      if (res.is_admin) {
        // If the user is admin, render everthing
        this.chat_list = new ChatList({
          $wrapper: this.$chat_container,
          user: res.user,
          user_email: res.user_email,
          is_admin: res.is_admin,
        });
        this.chat_list.render();
      } else if (res.is_verified) {
        // If the token and ip address matches, directly render the chat space
        this.chat_space = new ChatSpace({
          $wrapper: this.$chat_container,
          profile: {
            room_name: res.guest_title,
            room: res.room,
            is_admin: res.is_admin,
            user: res.user,
            user_email: res.user_email,
          },
        });
      } else {
        //Render the welcome screen if the user is not verified
        this.chat_welcome = new ChatWelcome({
          $wrapper: this.$chat_container,
          profile: {
            name: res.guest_title,
            is_admin: res.is_admin,
            chat_status: res.chat_status,
          },
        });
        this.chat_welcome.render();
      }
    } catch (error) {
      console.error(error);
    }
  }

  /** Shows the chat widget */
  show_chat_widget() {
    this.is_open = true;
    this.$chat_element.fadeIn(250);
    if (typeof this.chat_space !== 'undefined') {
      scroll_to_bottom(this.chat_space.$chat_space_container);
    }
  }

  /** Hides the chat widget */
  hide_chat_widget() {
    this.is_open = false;
    this.$chat_element.fadeOut(300);
  }

  should_close(e) {
    const chat_app = $('.chat-app');
    const navbar = $('.navbar, .chat-navbar-icon');
    const modal = $('.modal');
    return (
      !chat_app.is(e.target) &&
      chat_app.has(e.target).length === 0 &&
      !navbar.is(e.target) &&
      navbar.has(e.target).length === 0 &&
      !modal.is(e.target) &&
      modal.has(e.target).length === 0
    );
  }

  setup_events() {
    const me = this;
    $(document).on('click', '.chat-navbar-icon', function (e) {
      e.preventDefault();
      me.chat_bubble.change_bubble();
    });
    // Desk rebuilds its sidebar and dock; put the launcher back each time.
    frappe.router?.on('change', () => setTimeout(() => me.add_launcher(), 300));

    $(document).mouseup(function (e) {
      if (me.should_close(e) && me.is_open === true) {
        me.chat_bubble.change_bubble();
      }
    });
  }
};

$(function () {
  new frappe.Chat();
});
