"""Resolve WhatsApp numbers to ERPNext Contacts and keep names in step.

WhatsApp reports a number as 918884477288 — country code, no plus. ERPNext
Contacts on this site store bare ten-digit locals (8884477288), and the
Contact Phone rows carry whatever the importer wrote, spaces and all. The
last ten digits are the only thing both sides reliably agree on.
"""

import re

import frappe

MOBILE_DIGITS = 10


def normalize_number(number):
    """Last ten digits of a phone number, or None if it is not a number."""
    if not number:
        return None

    digits = re.sub(r"\D", "", str(number))
    if len(digits) < MOBILE_DIGITS:
        return None

    return digits[-MOBILE_DIGITS:]


def _contact_full_name(contact):
    row = frappe.db.get_value(
        "Contact", contact, ["first_name", "last_name"], as_dict=True
    )
    if not row:
        return None

    return " ".join(part for part in (row.first_name, row.last_name) if part).strip() or None


def find_contact(number):
    """Resolve a WhatsApp number to one ERPNext Contact.

    Returns (contact, full_name), or (None, None) when there is no safe
    answer.

    The Contact table here is heavily duplicated: the same person exists as
    "Arun Prakash", "Arun Prakash-1" and "Arun Prakash-2", and each carries
    two Contact Phone rows — one flagged primary mobile, one primary phone.
    Duplicates that agree on the name are harmless, so they collapse on the
    name and the oldest Contact wins, which keeps the answer stable as more
    duplicates arrive.

    A number that maps to two genuinely *different* people resolves to
    nothing. Showing the wrong customer's name against a live chat is worse
    than showing the number, and one number on this site (919400510794)
    already does exactly that.
    """
    digits = normalize_number(number)
    if not digits:
        return None, None

    rows = frappe.db.sql(
        """
        SELECT
            c.name,
            c.creation,
            TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS full_name,
            MAX(cp.is_primary_mobile_no) AS is_mobile
        FROM `tabContact Phone` cp
        JOIN `tabContact` c ON c.name = cp.parent
        WHERE RIGHT(REGEXP_REPLACE(cp.phone, '[^0-9]', ''), 10) = %(digits)s
        GROUP BY c.name, c.creation, full_name
        """,
        {"digits": digits},
        as_dict=True,
    )

    named = [row for row in rows if row.full_name]
    if not named:
        return None, None

    if len({row.full_name for row in named}) > 1:
        return None, None

    named.sort(key=lambda row: (0 if row.is_mobile else 1, row.creation))

    return named[0].name, named[0].full_name


def resolve_display_name(mobile_no, fallback=None):
    """Best available name for a number, and the Contact it came from.

    ERPNext Contact first, as agreed — it is the business record. Meta's own
    profile name is the fallback, which is all we have for 141 of the 146
    rooms on this site, and is still far better than a bare number.
    """
    contact, full_name = find_contact(mobile_no)
    if full_name:
        return contact, full_name

    profile_name = frappe.db.get_value(
        "WhatsApp Profiles", {"number": mobile_no}, "profile_name"
    )

    return None, profile_name or fallback or None


def _propagate_profile_name(mobile_no, full_name):
    """Push the resolved name onto this number's incoming messages.

    Only incoming: profile_name means "the name the sender goes by", so
    stamping a customer's name onto our own outgoing messages would be
    wrong.

    Written straight to the database rather than through the document, so
    WhatsAppMessage.update_profile_name() does not fire and overwrite the
    WhatsApp Profiles record with a name Meta never sent.
    """
    return frappe.db.sql(
        """
        UPDATE `tabWhatsApp Message`
        SET profile_name = %(full_name)s
        WHERE `from` = %(mobile_no)s
          AND COALESCE(profile_name, '') != %(full_name)s
        """,
        {"full_name": full_name, "mobile_no": mobile_no},
    )


def apply_to_room(room, doc=None):
    """Give a WhatsApp Contact its best name and link its ERPNext Contact.

    An existing link wins over a fresh lookup: it is either our own earlier
    match or a correction the owner made by hand, and both should stick.
    Clearing the Contact field forces a re-match on the next message.
    """
    contact = room.get("contact")
    full_name = None

    if contact and frappe.db.exists("Contact", contact):
        full_name = _contact_full_name(contact)
    else:
        contact, full_name = resolve_display_name(
            room.mobile_no, fallback=doc.profile_name if doc else None
        )

    values = {}
    if contact and contact != room.get("contact"):
        values["contact"] = contact
    if full_name and full_name != room.contact_name:
        values["contact_name"] = full_name

    if values:
        frappe.db.set_value("WhatsApp Contact", room.name, values, update_modified=False)
        room.update(values)

    if full_name:
        _propagate_profile_name(room.mobile_no, full_name)

    return full_name


@frappe.whitelist()
def sync_contact(mobile_no):
    """Re-resolve one room on demand. Returns the name that was applied."""
    frappe.only_for("System Manager")

    name = frappe.db.get_value("WhatsApp Contact", {"mobile_no": mobile_no})
    if not name:
        return None

    full_name = apply_to_room(frappe.get_doc("WhatsApp Contact", name))
    frappe.db.commit()

    return full_name


def refresh_unlinked_rooms():
    """Daily: re-check rooms that have no ERPNext Contact yet.

    A number often reaches WhatsApp before anyone creates the Contact for
    it. Without this the room would keep Meta's name forever, because
    apply_to_room only runs when a message arrives.
    """
    rooms = frappe.get_all(
        "WhatsApp Contact",
        filters={"contact": ["in", ["", None]]},
        pluck="name",
    )

    for name in rooms:
        try:
            apply_to_room(frappe.get_doc("WhatsApp Contact", name))
        except Exception:
            frappe.log_error(
                f"Could not refresh WhatsApp Contact {name}", "WhatsApp Contact Sync"
            )

    frappe.db.commit()

    return len(rooms)


@frappe.whitelist()
def backfill(mark_read=True):
    """One-off repair of rooms and messages created before this shipped.

    Names are resolved for every room. Old incoming messages are marked read
    locally *only* — no receipts go to Meta. Blue-ticking months-old chats
    that nobody actually answered would tell customers something untrue, and
    Meta rejects receipts outside its window anyway.
    """
    frappe.only_for("System Manager")

    from whatsapp_chat.api.message import READ_STATUS

    named = 0
    for name in frappe.get_all("WhatsApp Contact", pluck="name"):
        room = frappe.get_doc("WhatsApp Contact", name)
        before = room.contact_name
        if apply_to_room(room) and room.contact_name != before:
            named += 1

    marked = 0
    if mark_read:
        pending = frappe.db.sql(
            "SELECT name FROM `tabWhatsApp Message` WHERE type = 'Incoming' AND COALESCE(status, '') = ''",
            pluck="name",
        )
        if pending:
            frappe.db.set_value(
                "WhatsApp Message",
                {"name": ("in", pending)},
                "status",
                READ_STATUS,
                update_modified=False,
            )
            marked = len(pending)

    frappe.db.commit()

    return {"rooms_renamed": named, "messages_marked_read": marked}
