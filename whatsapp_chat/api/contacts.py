import frappe




@frappe.whitelist()
def create(contact_name, mobile_no, email):
    """Create contact."""
    frappe.get_doc({
        "doctype": "WhatsApp Contact",
        "contact_name": contact_name,
        "mobile_no": mobile_no,
        "email": email
    }).save()
    return "email"




@frappe.whitelist()
def unread_count(email=None):
    """Number of chats with something still unread — the navbar badge.

    Derived from message status, not from WhatsApp Contact.is_read. is_read
    is a cached summary maintained by hooks; the messages are the fact. The
    badge used to keep a running +1/-1 tally in the browser instead, and
    several paths mark a room read without telling it (chat_list's
    mark_message_read when a message lands on an open chat, and both
    chat_space calls), so the number drifted and never recovered short of a
    page reload.

    Counts chats, not messages: one customer sending twenty lines is one
    conversation waiting for an answer.
    """
    from whatsapp_chat.api.message import READ_STATUS

    return frappe.db.sql(
        """
        SELECT COUNT(*)
        FROM `tabWhatsApp Contact` wc
        WHERE IFNULL(wc.email, '') IN (%(email)s, '')
          AND EXISTS (
              SELECT 1
              FROM `tabWhatsApp Message` m
              WHERE m.`from` = wc.mobile_no
                AND m.type = 'Incoming'
                AND COALESCE(m.status, '') != %(read_status)s
          )
        """,
        {"email": email or frappe.session.user, "read_status": READ_STATUS},
    )[0][0]


def reconcile_read_flags():
    """Bring WhatsApp Contact.is_read back in line with the messages.

    is_read is a cache, so anything that moved message status without going
    through the hooks — a backfill, a manual edit, an older build — leaves
    rooms claiming to be unread with nothing unread in them. The chat list
    then highlights empty rooms and the badge counts them.
    """
    from whatsapp_chat.api.message import READ_STATUS

    unread_exists = """
        EXISTS (
            SELECT 1 FROM `tabWhatsApp Message` m
            WHERE m.`from` = wc.mobile_no
              AND m.type = 'Incoming'
              AND COALESCE(m.status, '') != %(read_status)s
        )
    """

    repaired = 0
    for flag, condition in ((1, "NOT " + unread_exists), (0, unread_exists)):
        repaired += frappe.db.sql(
            f"""
            UPDATE `tabWhatsApp Contact` wc
            SET wc.is_read = {flag}
            WHERE wc.is_read != {flag} AND {condition}
            """,
            {"read_status": READ_STATUS},
        )

    frappe.db.commit()

    return repaired


@frappe.whitelist()
def get(email):
    """Get all contacts assigned to email, enriched with WhatsApp Profiles display name."""
    contacts = frappe.db.get_all(
        "WhatsApp Contact",
        filters={"email": ["in", [email, ""]]},
        fields=["*"],
    )

    # Enrich each contact with a display_name from WhatsApp Profiles.
    # WhatsApp Profiles stores a human-readable title (e.g. "Ravi - 917842272227")
    # that is set automatically from the sender's profile name on each incoming message.
    # Falling back to contact_name (which is the raw phone number) keeps backward compatibility.
    for contact in contacts:
        profile_title = frappe.db.get_value(
            "WhatsApp Profiles",
            {"number": contact.get("mobile_no")},
            "title",
        )
        contact["display_name"] = profile_title or contact.get("contact_name") or contact.get("mobile_no")

    return contacts
