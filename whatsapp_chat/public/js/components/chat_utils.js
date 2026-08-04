import moment from 'moment';

function get_time(time) {
  let current_time;
  if (time) {
    current_time = moment(time);
  } else {
    current_time = moment();
  }
  return current_time.format('h:mm A');
}

function get_date_from_now(dateObj, type) {
  const sameDay = type === 'space' ? '[Today]' : 'h:mm A';
  const elseDay = type === 'space' ? 'MMM D, YYYY' : 'DD/MM/YYYY';
  const result = moment(dateObj).calendar(null, {
    sameDay: sameDay,
    lastDay: '[Yesterday]',
    lastWeek: elseDay,
    sameElse: elseDay,
  });
  return result;
}

function is_date_change(dateObj, prevObj) {
  const curDate = moment(dateObj).format('DD/MM/YYYY');
  const prevDate = moment(prevObj).format('DD/MM/YYYY');
  return curDate !== prevDate;
}

function scroll_to_bottom($element) {
  $element.animate(
    {
      scrollTop: $element[0].scrollHeight,
    },
    300
  );
}

function is_image(filename) {
  const allowedExtensions = /(\.jpg|\.jpeg|\.png|\.gif|\.webp)$/i;
  if (!allowedExtensions.exec(filename)) {
    return false;
  }
  return true;
}

async function get_rooms(email) {
  const res = await frappe.call({
    type: 'GET',
    method: 'whatsapp_chat.api.contacts.get',
    args: {
      email: email,
    },
  });
  return await res.message;
}

async function get_messages(room, user_no) {
  const res = await frappe.call({
    method: 'whatsapp_chat.api.message.get_all',
    args: {
      room: room,
      user_no: user_no,
    },
  });
  return await res.message;
}

async function send_message(content, user, room, user_no, attachment) {
  try {
    await frappe.call({
      method: 'whatsapp_chat.api.message.send',
      args: {
        content: content,
        user: user,
        room: room,
        user_no: user_no,
        attachment: attachment
      },
    });
  } catch (error) {
    frappe.msgprint({
      title: __('Error'),
      message: __('Something went wrong. Please refresh and try again.'),
    });
  }
}

async function get_settings(token) {
  const res = await frappe.call({
    type: 'GET',
    method: 'whatsapp_chat.api.config.settings',
    args: {
      token: token,
    },
  });
  return await res.message;
}

async function mark_message_read(room) {
  try {
    await frappe.call({
      method: 'whatsapp_chat.api.message.mark_as_read',
      args: {
        room: room,
      },
    });
    // Every caller of this changes the unread state on the server, and two
    // of the three never touched the badge. Reconciling here covers all of
    // them at once.
    refresh_notification_count();
  } catch (error) {
    //pass
  }
}


async function create_guest({ email, full_name, message }) {
  const res = await frappe.call({
    method: 'chat.api.user.get_guest_room',
    args: {
      email: email,
      full_name: full_name,
      message: message,
    },
  });
  return await res.message;
}

async function set_typing(room, user, is_typing, is_guest) {
  try {
    await frappe.call({
      method: 'whatsapp_chat.api.message.set_typing',
      args: {
        room: room,
        user: user,
        is_typing: is_typing,
        is_guest: is_guest,
      },
    });
  } catch (error) {
    //pass
  }
}

async function create_private_room(contact_name, mobile_no, email) {
  await frappe.call({
    method: 'whatsapp_chat.api.contacts.create',
    args: {
      contact_name: contact_name,
      mobile_no: mobile_no,
      email: email
    },
  });
}

async function set_user_settings(settings) {
  await frappe.call({
    method: 'chat.api.config.user_settings',
    args: {
      settings: settings,
    },
  });
}

function get_avatar_html(room_type, user_email, room_name) {
  let avatar_html;
  if (room_type === 'Direct' && 'desk' in frappe) {
    avatar_html = frappe.avatar(user_email, 'avatar-medium');
  } else {
    avatar_html = frappe.get_avatar('avatar-medium', room_name);
  }
  return avatar_html;
}

/**
 * Paint the badge. Never below zero, blank at zero.
 *
 * The old code blanked the badge only when `current - 1 === 0`, so a
 * decrement at zero rendered a literal "-1" in the navbar.
 */
function render_notification_count(count) {
  const value = Math.max(0, Number(count) || 0);
  frappe.Chat.settings.unread_count = value;
  $('#chat-notification-count').text(value > 0 ? value : '');
  return value;
}

let unread_refresh_timer = null;

/**
 * Ask the server for the true unread-chat count and repaint.
 *
 * The badge was a running +/-1 tally seeded once at page load, so every
 * path that changes read state had to adjust it by exactly one — and
 * several never did (chat_list's mark_message_read when a message lands on
 * an open chat, and both chat_space calls). It drifted and stayed wrong
 * until a reload. The server is now the authority; the tally survives only
 * as instant feedback.
 *
 * Debounced, so a burst of arriving messages costs one request, not one
 * each.
 */
function refresh_notification_count() {
  clearTimeout(unread_refresh_timer);
  unread_refresh_timer = setTimeout(async () => {
    try {
      const res = await frappe.call({
        method: 'whatsapp_chat.api.contacts.unread_count',
      });
      render_notification_count(res.message);
    } catch (error) {
      // Keep the optimistic value rather than blanking a badge that may
      // well be right; the next event reconciles it.
    }
  }, 400);
}

/**
 * Optimistic +/-1 for immediate feedback, then reconciled against the
 * server. Callers stay unchanged.
 */
function set_notification_count(type) {
  const current_count = Number(frappe.Chat.settings.unread_count) || 0;
  render_notification_count(
    type === 'increment' ? current_count + 1 : current_count - 1
  );
  refresh_notification_count();
}

export {
  get_time,
  scroll_to_bottom,
  get_rooms,
  get_messages,
  get_settings,
  create_guest,
  send_message,
  get_date_from_now,
  is_date_change,
  mark_message_read,
  set_typing,
  is_image,
  create_private_room,
  set_user_settings,
  get_avatar_html,
  set_notification_count,
  refresh_notification_count,
  render_notification_count,
};
