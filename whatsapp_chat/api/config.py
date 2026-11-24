import frappe


@frappe.whitelist(allow_guest=True)
def settings(token):
    """Fetch and return the settings for a chat session

    Args:
        token (str): Guest token.

    """
    config = {
        'socketio_port': frappe.conf.socketio_port,
        'user_email': frappe.session.user,
        'is_admin': True if 'user_type' in frappe.session.data else False,
        'guest_title': ''.join(frappe.get_hooks('guest_title')),
    }

    config = {**config, **get_chat_settings()}

    if config['is_admin']:
        config['user'] = get_admin_name(config['user_email'])
        config['user_settings'] = get_user_settings()
    else:
        config['user'] = 'Guest'
        token_verify = validate_token(token)
        if token_verify[0] is True:
            config['room'] = token_verify[1]['room']
            config['user_email'] = token_verify[1]['email']
            config['is_verified'] = True
        else:
            config['is_verified'] = False

    return config


def get_admin_name(user_key):
    """Get the admin name for specified user key"""
    full_name = frappe.db.get_value('User', user_key, 'full_name')
    return full_name

DEFAULT_FORM_DOCTYPES = ["Contact", "Lead"]


def _get_settings_doc():
    """WhatsApp Chat Settings, or None before the doctype is migrated."""
    try:
        return frappe.get_cached_doc("WhatsApp Chat Settings")
    except frappe.DoesNotExistError:
        return None


def get_chat_settings():
    """Get the chat settings

    Chat is on when it is enabled in WhatsApp Chat Settings (the default) and,
    for Desk users, when the user may read WhatsApp Contact. Grant access with
    Role Permission Manager instead of giving it to everyone.

    Returns:
        dict: Dictionary containing chat settings.
    """
    settings = _get_settings_doc()
    enabled = True if settings is None else bool(settings.enable_chat)

    if frappe.session.user != "Guest":
        enabled = enabled and bool(frappe.has_permission("WhatsApp Contact", "read"))

    form_doctypes = DEFAULT_FORM_DOCTYPES
    if settings is not None and settings.form_button_doctypes is not None:
        form_doctypes = [
            d.strip() for d in settings.form_button_doctypes.splitlines() if d.strip()
        ]

    return {
        "enable_chat": enabled,
        "chat_status": "Online",
        "form_doctypes": form_doctypes,
        "can_create_contact": bool(frappe.has_permission("WhatsApp Contact", "create"))
        if frappe.session.user != "Guest"
        else False,
    }

def get_user_settings():
    """Get the user settings

    Returns:
        dict: user settings
    """
    # if frappe.db.exists('Chat User Settings', frappe.session.user):
    #     user_doc = frappe.db.get_value('Chat User Settings', frappe.session.user, [
    #         'enable_message_tone', 'enable_notifications'], as_dict=1)
    # else:
    user_doc = {
        'enable_message_tone': 1,
        'enable_notifications': 1
    }

    return user_doc