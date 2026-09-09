import { create_private_room } from "./chat_utils";

export default class ChatAddRoom {
  constructor(opts) {
    this.user = opts.user;
    this.users_list = [...frappe.user.get_emails(), "Administrator"];
    this.user_email = opts.user_email;
    this.users_list = this.users_list.filter(function (user) {
      return user != opts.user_email;
    });
    this.setup();
  }

  async setup() {
    this.add_room_dialog = new frappe.ui.Dialog({
      title: __("New WhatsApp Conversation"),
      fields: [
        {
          label: __("Contact name"),
          fieldname: "contact_name",
          fieldtype: "Data",
          reqd: true,
        },
        {
          label: __("WhatsApp number"),
          fieldname: "mobile_no",
          description: __(
            "Include the country code, for example 919876543210."
          ),
          fieldtype: "Data",
          reqd: true,
        },
        {
          label: __("User"),
          fieldname: "email",
          description: __("Assign this conversation to a staff member."),
          fieldtype: "Link",
          options: "User",
          reqd: true,
        },
      ],
      action: {
        primary: {
          label: __("Create"),
          onsubmit: async (values) => {
            await this.handle_room_creation(
              values.contact_name,
              values.mobile_no,
              values.email
            );
          },
        },
      },
    });
  }

  show() {
    this.add_room_dialog.show();
  }

  async handle_room_creation(contact_name, mobile_no, email) {
    try {
      await create_private_room(contact_name, mobile_no, email);
      this.add_room_dialog.clear();
      this.add_room_dialog.hide();
      frappe.show_alert({
        message: __("Conversation created"),
        indicator: "green",
      });
    } catch (error) {
      frappe.msgprint({
        title: __("Conversation not created"),
        message: __("Check the number and assigned user, then try again."),
        indicator: "red",
      });
    }
  }
}
