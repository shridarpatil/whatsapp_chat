import re

import frappe
from frappe import _



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
def get(email):
    """Get all contacts assigned to email."""
    return frappe.db.get_all(
        "WhatsApp Contact",
        filters={"email": ['in', [email, '']]},
        fields=["*"])


def _digits(number):
    return re.sub(r"\D", "", number or "")


def _same_number(a, b):
    """True when two numbers are the same, allowing a missing country code on one side."""
    a, b = _digits(a), _digits(b)
    if not a or not b:
        return False
    if a == b:
        return True
    shorter, longer = sorted((a, b), key=len)
    return len(shorter) >= 8 and longer.endswith(shorter)


def _find(doctype, field, number, fields):
    """Rows of doctype whose field holds number, written in any format."""
    tail = _digits(number)[-8:]
    if not tail:
        return []
    # LIKE on the last digits narrows the scan; _same_number decides.
    like = "%" + "%".join(tail) + "%"
    rows = frappe.get_all(
        doctype,
        filters={field: ["like", like]},
        fields=fields,
        order_by="modified desc",
        limit=200,
    )
    return [r for r in rows if _same_number(r.get(field), number)]


@frappe.whitelist()
def get_or_create_for_number(mobile_no, contact_name=None):
    """Return the WhatsApp Contact (chat room) for a phone number, creating it if needed.

    The number may be written in any format ("+91 98450 12345", "098450-12345").
    An existing contact or the number already used in WhatsApp Message wins, so
    the conversation history is found.
    """
    frappe.has_permission("WhatsApp Contact", "read", throw=True)
    if not _digits(mobile_no):
        frappe.throw(_("{0} is not a phone number").format(mobile_no))

    fields = ["name", "contact_name", "mobile_no", "is_read", "last_message", "modified", "email"]
    user = frappe.session.user
    matches = [
        c for c in _find("WhatsApp Contact", "mobile_no", mobile_no, fields)
        if c.email in (None, "", user)
    ]
    if matches:
        contact = matches[0]
        # Rooms made from an incoming message are named by their number; use the real name.
        if (
            contact_name
            and _digits(contact.contact_name) == _digits(contact.mobile_no)
            and frappe.has_permission("WhatsApp Contact", "write", contact.name)
        ):
            frappe.db.set_value("WhatsApp Contact", contact.name, "contact_name", contact_name)
            contact.contact_name = contact_name
        return contact

    # Use the number exactly as WhatsApp Message has it, so the history query matches.
    number = _digits(mobile_no)
    for field in ("from", "to"):
        used = _find("WhatsApp Message", field, mobile_no, [field])
        if used:
            number = used[0].get(field)
            break

    doc = frappe.get_doc({
        "doctype": "WhatsApp Contact",
        "contact_name": contact_name or number,
        "mobile_no": number,
        "is_read": 1,
    }).insert()
    return {f: doc.get(f) for f in fields}

