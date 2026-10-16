export const DEFAULT_CHECKOUT_PAGE_URL = "https://nxgs-play-checkout.vercel.app/";

export function customerDetails(nameValue: unknown, phoneValue: unknown): { name: string; phone: string } {
  const name = typeof nameValue === "string" ? nameValue.trim().replace(/\s+/gu, " ") : "";
  if (!name || name.length > 80 || /[\p{Cc}\p{Cf}]/u.test(name)) throw new Error("invalid_customer_name");
  const rawPhone = typeof phoneValue === "string" ? phoneValue.trim() : "";
  if (!/^[+\d\s()-]+$/.test(rawPhone) || rawPhone.length > 24) throw new Error("invalid_customer_phone");
  let digits = rawPhone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (!/^[6-9]\d{9}$/.test(digits)) throw new Error("invalid_customer_phone");
  return { name, phone: `+91${digits}` };
}

// This capability only authorizes the mobile details endpoints. It is independent
// of the station's client_token and becomes invalid whenever an attempt changes.
export async function mobileToken(row: Record<string, any>, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const payload = JSON.stringify(["nxgs-mobile-details-v1", row.id, row.razorpay_payment_link_reference, row.expires_at]);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function paymentUrl(value: unknown): string {
  const url = new URL(String(value));
  if (url.protocol !== "https:" || url.username || url.password
    || !["rzp.io", "rzp.link", "razorpay.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error("invalid_payment_url");
  }
  return url.href;
}
