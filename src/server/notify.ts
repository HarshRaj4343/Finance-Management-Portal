import "server-only";
import nodemailer from "nodemailer";
import { db } from "./db";

/**
 * Outbound mail.
 *
 * architecture.jpeg: "Notify User". The applicant is told when their bill
 * is rejected, put on hold, or finally approved.
 *
 * While the portal is being demonstrated, MAIL_REDIRECT_TO diverts every
 * message to a single inbox so that real students are never mailed by a
 * test run. The intended recipient is printed at the top of the message.
 */

const REDIRECT_TO = process.env.MAIL_REDIRECT_TO?.trim() || null;
const MAIL_ENABLED = process.env.MAIL_ENABLED !== "false";

function transporter() {
  if (!process.env.EMAIL || !process.env.EMAIL_PASSWORD) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL, pass: process.env.EMAIL_PASSWORD },
  });
}

const money = (n: number) =>
  "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 });

type Outcome = "Approved" | "Rejected" | "Hold";

export type BillNotification = {
  billId: string;
  billNumber: string | null;
  stage: string;
  outcome: Outcome;
  remark: string | null;
  actorName: string | null;
};

const HEADLINE: Record<Outcome, (stage: string) => string> = {
  Approved: () => "Your bill has been approved",
  Rejected: (stage) => `Your bill was rejected at ${stage}`,
  Hold: (stage) => `Your bill is on hold at ${stage}`,
};

const LEAD: Record<Outcome, (stage: string) => string> = {
  Approved: () =>
    "This bill has completed the approval workflow and has been entered in the departmental purchase register.",
  Rejected: (stage) =>
    `The ${stage} desk has rejected this bill. The amount has been returned to the PDA account. A fresh bill will need to be filed.`,
  Hold: (stage) =>
    `The ${stage} desk has put this bill on hold. It will move again once the point below is addressed.`,
};

/**
 * Sends the notification. Never throws: a mail failure must not roll back
 * an approval that has already happened in the database.
 */
export async function notifyApplicant(n: BillNotification): Promise<void> {
  try {
    if (!MAIL_ENABLED) return;

    const { data: bill } = await db()
      .from("bills")
      .select(
        "id, bill_number, employee_id, employee_name, po_value, item_description, supplier_name, po_details, status"
      )
      .eq("id", n.billId)
      .maybeSingle();
    if (!bill) return;

    const { data: emp } = await db()
      .from("employees")
      .select("email, employee_name")
      .eq("employee_code", bill.employee_id)
      .maybeSingle();

    const intended = emp?.email;
    if (!intended) {
      console.warn("[notify] no email on file for", bill.employee_id);
      return;
    }

    const post = transporter();
    if (!post) {
      console.warn("[notify] EMAIL / EMAIL_PASSWORD are not set; skipping", {
        to: intended,
        bill: bill.bill_number,
      });
      return;
    }

    const to = REDIRECT_TO ?? intended;
    const redirected = REDIRECT_TO !== null && REDIRECT_TO !== intended;

    const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
    const link = base ? `${base}/bill/${bill.id}` : null;

    const html = `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
  ${
    redirected
      ? `<p style="background:#fef3c7;border:1px solid #fcd34d;padding:10px 12px;border-radius:6px;font-size:13px;margin:0 0 16px">
           <strong>Test message.</strong> This would have gone to ${intended}.
         </p>`
      : ""
  }
  <div style="background:#217093;color:#fff;padding:18px 20px;border-radius:8px 8px 0 0">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">
      IIT Mandi &middot; Finance Management Portal
    </div>
    <h1 style="margin:6px 0 0;font-size:19px;font-weight:600">${HEADLINE[n.outcome](n.stage)}</h1>
  </div>

  <div style="border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px;padding:20px">
    <p style="margin:0 0 16px;line-height:1.55">
      Dear ${bill.employee_name ?? bill.employee_id},<br/>${LEAD[n.outcome](n.stage)}
    </p>

    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${[
        ["Bill number", bill.bill_number ?? "—"],
        ["Item", bill.item_description ?? "—"],
        ["Supplier", bill.supplier_name ?? "—"],
        ["Amount", money(Number(bill.po_value))],
        ["PO details", bill.po_details ?? "—"],
        ["Current status", bill.status],
      ]
        .map(
          ([k, v]) => `<tr>
            <td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${k}</td>
            <td style="padding:6px 0;font-weight:500">${v}</td>
          </tr>`
        )
        .join("")}
    </table>

    ${
      n.remark
        ? `<div style="margin-top:16px;padding:12px 14px;background:#f9fafb;border-left:3px solid #217093;border-radius:0 4px 4px 0">
             <div style="font-size:12px;color:#6b7280;margin-bottom:4px">
               Remark from ${n.actorName ?? n.stage}
             </div>
             <div style="line-height:1.5">${n.remark}</div>
           </div>`
        : ""
    }

    ${
      link
        ? `<p style="margin:20px 0 0">
             <a href="${link}" style="background:#217093;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block;font-size:14px">
               View the full history
             </a>
           </p>`
        : ""
    }

    <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;line-height:1.5">
      This is an automated message from the Integrated Finance Management Portal.
      Please do not reply to it.
    </p>
  </div>
</div>`;

    await post.sendMail({
      from: process.env.EMAIL,
      to,
      subject: `[IIT Mandi Finance] ${HEADLINE[n.outcome](n.stage)} — ${bill.bill_number ?? bill.id.slice(0, 8)}`,
      html,
    });

    // Record that the applicant was told. The event log should show the
    // notification alongside the decision that triggered it.
    await db().rpc("fn_log_event", {
      p_bill_id: n.billId,
      p_stage: "System",
      p_action: "Notified",
      p_actor_code: null,
      p_actor_name: null,
      p_actor_role: null,
      p_remark: `Notification sent to ${intended}${redirected ? ` (redirected to ${to} for this deployment)` : ""}.`,
      p_from_status: bill.status,
      p_to_status: bill.status,
      p_amount: null,
    });
  } catch (err) {
    // Deliberately swallowed: the bill has already moved.
    console.error("[notify] failed to send", err);
  }
}
