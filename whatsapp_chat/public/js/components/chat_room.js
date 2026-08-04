import ChatSpace from './chat_space';
import {
	get_date_from_now,
	mark_message_read,
	get_time,
	get_avatar_html,
	set_notification_count,
} from './chat_utils';

export default class ChatRoom {
	constructor(opts) {
		this.$wrapper = opts.$wrapper;
		this.$chat_rooms_container = opts.$chat_rooms_container;
		this.chat_list = opts.chat_list;
		this.profile = opts.element;
		this.setup();
		// The badge is no longer seeded by counting rooms as they are built:
		// ChatList asks the server once the list is up. Incrementing here
		// double-counted whenever a room object was rebuilt for a chat that
		// was already on the badge.
	}

	setup() {
		this.$chat_room = $(document.createElement('div'));
		this.$chat_room.addClass('chat-room');

		// Add unread highlight class if message is unread
		if (!this.profile.is_read) {
			this.$chat_room.addClass('chat-room--unread');
		}

		this.avatar_html = get_avatar_html(
			this.profile.room_type,
			this.profile.opposite_person_email,
			this.profile.room_name
		);

		let last_message = this.sanitize_last_message(this.profile.last_message);

		const info_html = `
			<div class='chat-profile-info'>
				<div class='chat-name'>
					${__(this.profile.room_name)}
					<div class='chat-latest'
						style='display: ${this.profile.is_read ? 'none' : 'inline-block'}'
					></div>
				</div>
				<div style='color: ${
					this.profile.is_read ? 'var(--text-muted)' : 'var(--text-color)'
				}' class='last-message'>${__(last_message)}</div>
			</div>
		`;
		const date_html = `
			<div class='chat-date'>
				${__(get_date_from_now(this.profile.last_date, 'room'))}
			</div>
		`;
		let inner_html = '';

		inner_html += this.avatar_html + info_html + date_html;

		this.$chat_room.html(inner_html);
	}

	sanitize_last_message(message) {
		let sanitize_last_message = $('<div>').text(message).html();
		if (sanitize_last_message) {
			if (sanitize_last_message.length > 20) {
				sanitize_last_message = sanitize_last_message.substring(0, 20) + '...';
			}
		}
		return sanitize_last_message;
	}

	set_as_read() {
		// Guarded exactly as set_as_unread() is. Without this, reading a room
		// that was already read still decremented the badge, so the count
		// drifted below the truth.
		if (!this.profile.is_read) {
			set_notification_count('decrement');
		}
		this.profile.is_read = 1;
		this.$chat_room.find('.last-message').css('color', 'var(--text-muted)');
		this.$chat_room.find('.chat-latest').hide();
		this.$chat_room.removeClass('chat-room--unread');
	}

	set_last_message(message, date) {
		const sanitized_message = this.sanitize_last_message(message);
		this.$chat_room.find('.last-message').html(__(sanitized_message));
		this.$chat_room.find('.chat-date').text(__(get_time(date)));
	}

	set_as_unread() {
		if (this.profile.is_read) {
			set_notification_count('increment');
		}
		this.profile.is_read = 0;
		this.$chat_room.find('.last-message').css('color', 'var(--text-color)');
		this.$chat_room.find('.chat-latest').show();
		this.$chat_room.addClass('chat-room--unread');
	}

	render(mode) {
		if (mode == 'append') {
			this.$chat_rooms_container.append(this.$chat_room);
		} else {
			this.$chat_rooms_container.prepend(this.$chat_room);
		}

		this.setup_events();
	}

	move_to_top() {
		$(this.$chat_room).prependTo(this.$chat_rooms_container);
	}

	setup_events() {
		this.$chat_room.on('click', () => {
			// Always create new ChatSpace to fetch latest messages
			if (typeof this.chat_space !== 'undefined') {
				this.chat_space.destroy_socket_events();
			}
			this.chat_space = new ChatSpace({
				$wrapper: this.$wrapper,
				chat_list: this.chat_list,
				profile: this.profile,
			});
			if (this.profile.is_read === 0) {
				mark_message_read(this.profile.room);
				this.set_as_read();
			}
		});
	}
}
