import frappe
import mimetypes

from whatsapp_chat.api import contact_sync

# The status frappe_whatsapp writes once Meta accepts a read receipt.
READ_STATUS = "marked as read"

@frappe.whitelist()
def get_all(room: str, user_no: str):
    """Get all the messages of a particular room

    Args:
        room (str): Room's name.

    """
    return frappe.db.sql("""
        SELECT creation,
        case
            when `to` <> '' then `to`
            else
            'Administrator'
            end as sender_user_no,
        case
            when COALESCE(content_type, 'text') = 'text' then COALESCE(message, '')
            else COALESCE(attach, message, '')
            end as content,
        case
            when COALESCE(content_type, 'text') <> 'text' then message
            else NULL
            end as caption,
        COALESCE(content_type, 'text') as content_type,
        COALESCE(status, 'sent') as status,
        case
            when `to` <> '' then 'Outgoing'
            else 'Incoming'
            end as direction
        from `tabWhatsApp Message` where (`to` = %(user_no)s or `from` = %(user_no)s)
        AND COALESCE(message_type, '') <> 'Template'
        order by creation asc
        """, {"user_no": user_no}, as_dict=True)

@frappe.whitelist()
def mark_as_read(room):
    """Mark a room read — called by the chat UI when a room is opened."""
    try:
        mark_conversation_read(room)
        frappe.db.commit()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "WhatsApp Chat Mark As Read")
    return "ok"


def mark_conversation_read(room, send_receipt=True):
    """Clear a conversation's unread state, locally and at Meta.

    Called when a room is opened *and* on every outgoing message, so a reply
    from the chat UI, the REST API or Claude Desktop all settle the
    conversation identically. Previously only the UI path existed, which is
    why a chat answered from Claude Desktop stayed unread until someone
    opened it by hand.

    Note the direction of travel. Meta reports statuses only for messages we
    *sent* (sent -> delivered -> read), and that already works. "Read" on an
    incoming message is something we push *to* Meta; it never arrives on the
    webhook. There is nothing to fetch.

    `room` accepts a name or a loaded document.
    """
    if isinstance(room, str):
        room = frappe.get_doc("WhatsApp Contact", room)

    if not room.mobile_no:
        return 0

    if not room.is_read:
        frappe.db.set_value(
            "WhatsApp Contact", room.name, "is_read", 1, update_modified=False
        )
        room.is_read = 1

    # COALESCE, not a `!=` filter: 477 incoming messages on this site have a
    # NULL status, and `status != 'marked as read'` evaluates to NULL for
    # every one of them in SQL — so the old filter matched nothing at all.
    pending = frappe.db.sql(
        """
        SELECT name, message_id, whatsapp_account
        FROM `tabWhatsApp Message`
        WHERE `from` = %(mobile_no)s
          AND type = 'Incoming'
          AND COALESCE(status, '') != %(status)s
        ORDER BY creation DESC
        """,
        {"mobile_no": room.mobile_no, "status": READ_STATUS},
        as_dict=True,
    )

    if not pending:
        return 0

    # One receipt, for the newest message. Meta settles the whole
    # conversation from it, so a chat with 40 unread messages costs one API
    # call rather than 40.
    if send_receipt:
        send_read_receipt(pending[0])

    frappe.db.set_value(
        "WhatsApp Message",
        {"name": ("in", [msg.name for msg in pending])},
        "status",
        READ_STATUS,
        update_modified=False,
    )

    return len(pending)


def send_read_receipt(message):
    """Push a read receipt to Meta for one message, if the account allows it.

    Silent no-op when `allow_auto_read_receipt` is off on the WhatsApp
    Account — that switch is the business's decision about whether senders
    see blue ticks, and it is respected here rather than worked around.
    """
    if not message.get("message_id") or not message.get("whatsapp_account"):
        return False

    if not frappe.db.get_value(
        "WhatsApp Account", message.whatsapp_account, "allow_auto_read_receipt"
    ):
        return False

    try:
        frappe.get_doc("WhatsApp Message", message.name).send_read_receipt()
        return True
    except Exception:
        frappe.log_error(
            f"Read receipt failed for {message.name}\n\n{frappe.get_traceback()}",
            "WhatsApp Chat Read Receipt",
        )
        return False


def send_whatsapp_read_receipts(room):
    """Kept for callers outside this module; use mark_conversation_read()."""
    return mark_conversation_read(room)

@frappe.whitelist()
def send(content, user, room, user_no, attachment=None):
    content_type = "text"
    if attachment:
        file_type = mimetypes.guess_type(content)[0]
        if file_type in ["image/apng","image/avif","image/gif","image/jpeg","image/png","image/svg","image/webp"]:
            content_type = 'image'
        elif file_type in ["application/pdf", "application/vnd.ms-powerpoint", "application/msword", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]:
            content_type = "document"
        elif file_type in ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"]:
            content_type = 'audio'
        elif file_type in ["video/mp4", "video/3gp"]:
            content_type = "video"

        frappe.get_doc({
            "doctype": "WhatsApp Message",
            "to": user_no,
            "type": "Outgoing",
            "attach": content,
            "content_type": content_type
        }).save()
    else:
        frappe.get_doc({
            "doctype": "WhatsApp Message",
            "to": user_no,
            "type": "Outgoing",
            "message": content,
            "content_type": content_type
        }).save()

    return "ok"

def last_message(doc, method):
    """after_insert on WhatsApp Message — keep the chat list in step.

    Three jobs in order: refresh the room, give it its best name, then
    settle the read state. The name is resolved before the realtime push so
    the chat list shows the customer's name rather than their number.
    """
    is_outgoing = doc.type == "Outgoing"
    mobile_no = doc.to if is_outgoing else doc.get("from")

    if not mobile_no:
        return "ok"

    contact_name = frappe.db.get_value("WhatsApp Contact", filters={"mobile_no": mobile_no})
    if contact_name:
        chat_doc = frappe.get_doc("WhatsApp Contact", contact_name)
        chat_doc.last_message = doc.message
        # An outgoing message IS the reply, so the conversation has been
        # dealt with and must not flip back to unread. Setting is_read = 0
        # unconditionally here is what made a Claude Desktop reply leave the
        # chat looking unanswered until someone opened it by hand.
        chat_doc.is_read = 1 if is_outgoing else 0
        chat_doc.save(ignore_permissions=True)
    else:
        chat_doc = frappe.get_doc({
            "doctype": "WhatsApp Contact",
            "mobile_no": mobile_no,
            "last_message": doc.message,
            "contact_name": mobile_no,
            "is_read": 1 if is_outgoing else 0
        })
        chat_doc.save(ignore_permissions=True)

    try:
        contact_sync.apply_to_room(chat_doc, doc)
    except Exception:
        # A name is a nicety; never let it stop a message being recorded.
        frappe.log_error(frappe.get_traceback(), "WhatsApp Contact Sync")

    if is_outgoing:
        mark_conversation_read(chat_doc)

    if chat_doc.email and doc.type != 'Outgoing':
        message_data = {
            "content": doc.message or doc.attach or '',
            "creation": frappe.utils.now(),
            "room": chat_doc.name,
            "contact_name": chat_doc.contact_name,
            "sender_user_no": mobile_no,
            "user": "Guest"
        }
        # Notify chat list
        frappe.publish_realtime(
            "latest_chat_updates",
            message_data,
            user=chat_doc.email
        )
        # Notify open chat room
        frappe.publish_realtime(
            chat_doc.name,
            message_data,
            user=chat_doc.email
        )

    return "ok"
