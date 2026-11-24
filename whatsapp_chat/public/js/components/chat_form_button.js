// "WhatsApp Chat" button on forms that hold phone numbers (Contact, Lead and the
// DocTypes listed in WhatsApp Chat Settings). It opens the chat window on that
// number's conversation.

const PHONE_FIELDNAMES = ['mobile_no', 'phone', 'phone_no', 'whatsapp_no', 'whatsapp', 'mobile'];

function get_phone_numbers(frm) {
  const numbers = [];
  const add = (label, value) => {
    const digits = (value || '').replace(/\D/g, '');
    if (digits.length < 6) return;
    if (numbers.some((n) => n.value.replace(/\D/g, '') === digits)) return;
    numbers.push({ label, value });
  };

  for (const df of frm.meta.fields) {
    const is_phone =
      df.fieldtype === 'Phone' ||
      (df.fieldtype === 'Data' && df.options === 'Phone') ||
      (df.fieldtype === 'Data' && PHONE_FIELDNAMES.includes(df.fieldname));
    if (is_phone) add(__(df.label || df.fieldname), frm.doc[df.fieldname]);
  }
  // Contact keeps every number in a child table.
  (frm.doc.phone_nos || []).forEach((row) => add(__('Phone'), row.phone));
  return numbers;
}

function add_button(frm) {
  if (frm.is_new() || !frappe.Chat.instance) return;
  const numbers = get_phone_numbers(frm);
  if (!numbers.length) return;

  const title = __('WhatsApp Chat');
  const name = frm.doc[frm.meta.title_field] || frm.doc.full_name || frm.doc.lead_name || frm.doc.name;
  const open = (number) => frappe.Chat.instance.open_for_number(number, name);

  if (numbers.length === 1) {
    frm.add_custom_button(title, () => open(numbers[0].value));
  } else {
    numbers.forEach((n) => frm.add_custom_button(`${n.value} (${n.label})`, () => open(n.value), title));
  }
}

export function setup_form_buttons(doctypes) {
  doctypes.forEach((doctype) => {
    frappe.ui.form.on(doctype, 'refresh', add_button);
  });
  // A form opened before the chat settings arrived missed its refresh.
  if (window.cur_frm && doctypes.includes(cur_frm.doctype)) {
    add_button(cur_frm);
  }
}
